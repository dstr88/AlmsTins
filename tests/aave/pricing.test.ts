import { describe, it, expect } from 'vitest';
import {
	AAVE_ALL_CHAINS,
	AAVE_BASE_COIN,
	AAVE_GAP_ABS_TOLERANCE_USD,
	AAVE_GAP_REL_TOLERANCE,
	MAX_UNPRICED_LISTED,
	aaveSymbolUsdPrice,
	buildTickerPriceMap,
	completeAaveTotals,
	emptyCoverage,
	findGap,
	isUnpricedPosition,
	mergeCoverage,
	priceAavePosition,
	readAaveUsd,
} from '../../src/lib/aave/pricing';
import type { AaveChainSummary, AavePosition, AavePositionsResponse } from '../../src/lib/aave/client';

/**
 * How an Aave position gets its USD value, and what the totals admit they leave out. All of it is pure,
 * so there is nothing to mock. Every symbol, amount and price here is invented; the real symbols appear
 * only where the rule being tested is keyed on them (WBTC, BTC.b, WETH.e, sAVAX, stETH, wstETH).
 */

// Invented prices, keyed the way the price feed is: UPPERCASE ticker symbol.
const prices = new Map<string, number>([
	['ETH', 2000],
	['BTC', 60000],
	['WBTC', 59900],
	['AVAX', 20],
	['POL', 0.5],
]);

describe('aaveSymbolUsdPrice: the fallback rule', () => {
	it('prices WBTC from its own ticker, not as BTC', () => {
		expect(aaveSymbolUsdPrice('WBTC', prices)).toBe(59900);
	});

	it('never guesses WBTC from BTC when its own ticker is missing', () => {
		const noWbtc = new Map(prices);
		noWbtc.delete('WBTC');
		expect(aaveSymbolUsdPrice('WBTC', noWbtc)).toBeNull();
	});

	it('prices the bridged 1:1 copies as their base coin, in any case', () => {
		expect(aaveSymbolUsdPrice('BTC.b', prices)).toBe(60000);
		expect(aaveSymbolUsdPrice('BTC.B', prices)).toBe(60000);
		expect(aaveSymbolUsdPrice('WETH.e', prices)).toBe(2000);
		expect(aaveSymbolUsdPrice(' weth.e ', prices)).toBe(2000);
	});

	it('prices a staking token from its own ticker when there is one, and as unpriced when there is not', () => {
		const withStaking = new Map([...prices, ['SAVAX', 25], ['STETH', 2100], ['WSTETH', 2500]]);
		expect(aaveSymbolUsdPrice('sAVAX', withStaking)).toBe(25);
		expect(aaveSymbolUsdPrice('stETH', withStaking)).toBe(2100);
		expect(aaveSymbolUsdPrice('wstETH', withStaking)).toBe(2500);
		// The base coins are priced, but a staking token is not its base coin.
		expect(aaveSymbolUsdPrice('sAVAX', prices)).toBeNull();
		expect(aaveSymbolUsdPrice('stETH', prices)).toBeNull();
		expect(aaveSymbolUsdPrice('wstETH', prices)).toBeNull();
	});

	it('prices the four 1:1 wrappers as their base coin', () => {
		expect(aaveSymbolUsdPrice('WETH', prices)).toBe(2000);
		expect(aaveSymbolUsdPrice('WAVAX', prices)).toBe(20);
		expect(aaveSymbolUsdPrice('WPOL', prices)).toBe(0.5);
		expect(aaveSymbolUsdPrice('WMATIC', prices)).toBe(0.5);
	});

	it('prices stablecoins at $1 with no ticker at all', () => {
		for (const s of ['USDC', 'USDT', 'USDT0', 'USDC.e', 'USDt.e']) {
			expect(aaveSymbolUsdPrice(s, new Map()), s).toBe(1);
		}
	});

	it('keeps the base-coin list to exactly the four wrappers and the two bridged copies', () => {
		expect([...AAVE_BASE_COIN.keys()].sort()).toEqual(['BTC.B', 'WAVAX', 'WETH', 'WETH.E', 'WMATIC', 'WPOL']);
	});

	it('does not price a lookalike wrapper, staking token or bridged copy as its base coin', () => {
		const zed = new Map([['ZED', 10]]);
		expect(aaveSymbolUsdPrice('ZED', zed)).toBe(10);
		for (const s of ['WZED', 'STZED', 'ZED.B', 'ZED.E']) {
			expect(aaveSymbolUsdPrice(s, zed), s).toBeNull();
		}
	});

	it('returns null for an empty symbol and for a missing, zero, negative or non-finite price', () => {
		expect(aaveSymbolUsdPrice('', prices)).toBeNull();
		expect(aaveSymbolUsdPrice('NOSUCH', prices)).toBeNull();
		expect(aaveSymbolUsdPrice('ETH', new Map([['ETH', 0]]))).toBeNull();
		expect(aaveSymbolUsdPrice('ETH', new Map([['ETH', -3]]))).toBeNull();
		expect(aaveSymbolUsdPrice('ETH', new Map([['ETH', Number.NaN]]))).toBeNull();
		expect(aaveSymbolUsdPrice('ETH', new Map([['ETH', Number.POSITIVE_INFINITY]]))).toBeNull();
	});
});

describe('buildTickerPriceMap', () => {
	const ticker = (symbol: unknown, price: unknown) => ({ symbol, quotes: { USD: { price } } });

	it('uppercases symbols and keeps USD prices', () => {
		const map = buildTickerPriceMap([ticker('eth', 2000), ticker(' Btc ', 60000)]);
		expect(map.get('ETH')).toBe(2000);
		expect(map.get('BTC')).toBe(60000);
	});

	it('lets the first (best-ranked) ticker per symbol win over a later one that reuses the symbol', () => {
		const map = buildTickerPriceMap([ticker('ZED', 10), ticker('ZED', 0.0001)]);
		expect(map.get('ZED')).toBe(10);
	});

	it('skips tickers without a positive finite USD price, and takes the next usable one', () => {
		const map = buildTickerPriceMap([
			ticker('AAA', 0),
			ticker('AAA', 7),
			ticker('BBB', Number.NaN),
			ticker('CCC', '5'),
			ticker('', 3),
			{ symbol: 'DDD' },
			null,
		]);
		expect(map.get('AAA')).toBe(7);
		expect(map.has('BBB')).toBe(false);
		expect(map.has('CCC')).toBe(false);
		expect(map.has('DDD')).toBe(false);
		expect(map.size).toBe(1);
	});

	it('returns an empty map for anything that is not a list', () => {
		for (const bad of [undefined, null, {}, 'x', 5]) {
			expect(buildTickerPriceMap(bad).size).toBe(0);
		}
	});
});

describe('readAaveUsd', () => {
	it('reads Aave\'s own USD figure, numeric or as a string', () => {
		expect(readAaveUsd({ usd: '1234.5', usdPerToken: '61' }, 20)).toBe(1234.5);
		expect(readAaveUsd({ usd: 99 }, 1)).toBe(99);
	});

	it('accepts a 0 only when it is real: nothing to value, or Aave also gave a positive price', () => {
		expect(readAaveUsd({ usd: '0', usdPerToken: '0' }, 0)).toBe(0);
		expect(readAaveUsd({ usd: '0', usdPerToken: '61' }, 0.0000001)).toBe(0);
		// A balance with a 0 value and no price is "no price", not "worth nothing".
		expect(readAaveUsd({ usd: '0', usdPerToken: '0' }, 5)).toBeNull();
		expect(readAaveUsd({ usd: '0' }, 5)).toBeNull();
	});

	it('returns null for a missing, negative or unreadable figure', () => {
		for (const node of [undefined, null, {}, { usd: null }, { usd: '' }, { usd: 'abc' }, { usd: -1 }, { usd: Number.NaN }]) {
			expect(readAaveUsd(node, 5), JSON.stringify(node)).toBeNull();
		}
	});
});

describe('priceAavePosition', () => {
	it('uses Aave\'s own figure first, even when a ticker would give another number', () => {
		const out = priceAavePosition({ assetSymbol: 'WBTC', amount: 2, aaveUsd: 100000 }, prices);
		expect(out).toEqual({ usdValue: 100000, priceSource: 'aave' });
	});

	it('falls back to the shared rule when Aave gave no figure', () => {
		expect(priceAavePosition({ assetSymbol: 'WBTC', amount: 2, aaveUsd: null }, prices)).toEqual({
			usdValue: 119800,
			priceSource: 'market',
		});
		expect(priceAavePosition({ assetSymbol: 'BTC.b', amount: 0.5 }, prices)).toEqual({
			usdValue: 30000,
			priceSource: 'market',
		});
	});

	it('marks a position neither source can value as unpriced, with a placeholder 0', () => {
		expect(priceAavePosition({ assetSymbol: 'sAVAX', amount: 40, aaveUsd: null }, prices)).toEqual({
			usdValue: 0,
			priceSource: 'none',
		});
	});

	it('takes a real 0 from Aave as priced', () => {
		expect(priceAavePosition({ assetSymbol: 'ZED', amount: 0, aaveUsd: 0 }, prices)).toEqual({
			usdValue: 0,
			priceSource: 'aave',
		});
	});

	it('counts as unpriced only a position that holds something', () => {
		expect(isUnpricedPosition({ amount: 3, priceSource: 'none' })).toBe(true);
		expect(isUnpricedPosition({ amount: 0, priceSource: 'none' })).toBe(false);
		expect(isUnpricedPosition({ amount: Number.NaN, priceSource: 'none' })).toBe(false);
		expect(isUnpricedPosition({ amount: 3, priceSource: 'aave' })).toBe(false);
		expect(isUnpricedPosition({ amount: 3, priceSource: 'market' })).toBe(false);
	});
});

describe('findGap: the sanity check', () => {
	it('is silent when our figure matches Aave\'s', () => {
		expect(findGap('ethereum', 'collateral', 1000, 1000)).toBeNull();
	});

	it('is silent for drift inside the tolerance', () => {
		const base = 100000;
		const drift = base * (AAVE_GAP_REL_TOLERANCE - 0.01);
		expect(findGap('ethereum', 'collateral', base - drift, base)).toBeNull();
		expect(findGap('ethereum', 'collateral', base + drift, base)).toBeNull();
	});

	it('reports a large gap in either direction, with both figures', () => {
		const low = findGap('polygon', 'collateral', 8200, 31400);
		expect(low).toEqual({ chain: 'polygon', kind: 'collateral', pricedUsd: 8200, aaveUsd: 31400, gapUsd: 23200 });
		const high = findGap('avalanche', 'debt', 900, 100);
		expect(high?.gapUsd).toBe(800);
	});

	it('ignores a gap smaller than the dollar floor, whatever its share', () => {
		expect(findGap('ethereum', 'debt', 0, AAVE_GAP_ABS_TOLERANCE_USD - 0.5)).toBeNull();
		expect(findGap('ethereum', 'debt', 0, AAVE_GAP_ABS_TOLERANCE_USD + 0.5)).not.toBeNull();
	});

	it('does nothing without a usable Aave figure', () => {
		expect(findGap('ethereum', 'collateral', 1000, null)).toBeNull();
		expect(findGap('ethereum', 'collateral', 1000, undefined)).toBeNull();
		expect(findGap('ethereum', 'collateral', 1000, Number.NaN)).toBeNull();
		expect(findGap('ethereum', 'collateral', Number.NaN, 1000)).toBeNull();
	});
});

// ── completeAaveTotals ────────────────────────────────────────────────────────

const pos = (over: Partial<AavePosition> & Pick<AavePosition, 'assetSymbol' | 'amount'>): AavePosition => ({
	side: 'supply',
	marketName: 'FakeMarket',
	apy: 0.02,
	usdValue: 0,
	...over,
});

const chainOf = (
	chain: AaveChainSummary['chain'],
	positions: AavePosition[],
	over: Partial<AaveChainSummary> = {},
): AaveChainSummary => ({
	chain,
	suppliedUsd: 0,
	debtUsd: 0,
	suppliedUsdTotal: 0,
	debtUsdTotal: 0,
	positions,
	ok: true,
	market: '0xmarket',
	...over,
});

const lookup = (chains: AaveChainSummary[], over: Partial<AavePositionsResponse> = {}): AavePositionsResponse => ({
	ok: true,
	address: '0xwallet',
	chains,
	...over,
});

describe('completeAaveTotals: the regression', () => {
	// The incident: a healthy account whose collateral is WBTC, a bridged BTC and a staking token read as
	// deeply negative because every one of them priced at $0 while the debt was counted in full.
	const supplies = [
		pos({ assetSymbol: 'WBTC', amount: 0.1, aaveUsd: 6100, isCollateral: true }),
		pos({ assetSymbol: 'BTC.b', amount: 0.05, aaveUsd: 3050, isCollateral: true }),
		pos({ assetSymbol: 'WETH.e', amount: 1.5, aaveUsd: 3300, isCollateral: true }),
		pos({ assetSymbol: 'sAVAX', amount: 40, aaveUsd: 1100, isCollateral: true }),
	];
	const debt = pos({ side: 'borrow', assetSymbol: 'USDT', amount: 4000, aaveUsd: 4000 });

	it('counts every supply Aave valued, so a healthy account nets positive', () => {
		const out = completeAaveTotals(lookup([chainOf('avalanche', [...supplies, debt])]), new Map());
		expect(out.suppliedUsdTotal).toBe(13550);
		expect(out.debtUsdTotal).toBe(4000);
		expect(out.suppliedUsdTotal - out.debtUsdTotal).toBeGreaterThan(0);
		expect(out.coverage.partial).toBe(false);
		expect(out.coverage.unpricedCount).toBe(0);
		expect(out.chains[0].positions.every((p) => p.priceSource === 'aave')).toBe(true);
	});

	it('prices the same positions from the shared rule when Aave gave no figure', () => {
		const bare = supplies.map((p) => ({ ...p, aaveUsd: null }));
		const feed = new Map([['BTC', 60000], ['WBTC', 59900], ['ETH', 2000], ['SAVAX', 25]]);
		const out = completeAaveTotals(lookup([chainOf('avalanche', bare)]), feed);
		const byName = Object.fromEntries(out.chains[0].positions.map((p) => [p.assetSymbol, p]));
		expect(byName['WBTC'].usdValue).toBeCloseTo(0.1 * 59900);
		expect(byName['BTC.b'].usdValue).toBeCloseTo(0.05 * 60000);
		expect(byName['WETH.e'].usdValue).toBeCloseTo(1.5 * 2000);
		expect(byName['sAVAX'].usdValue).toBeCloseTo(40 * 25);
		expect(out.coverage.partial).toBe(false);
	});

	it('counts what no source can value as unpriced and marks the total partial, never a silent $0', () => {
		const bare = supplies.map((p) => ({ ...p, aaveUsd: null }));
		// BTC and ETH have tickers; WBTC and sAVAX do not (the feed drops coins as its cut moves).
		const feed = new Map([['BTC', 60000], ['ETH', 2000]]);
		const out = completeAaveTotals(lookup([chainOf('avalanche', bare)]), feed);
		expect(out.coverage.partial).toBe(true);
		expect(out.coverage.unpricedCount).toBe(2);
		expect(out.coverage.unpriced.map((u) => u.symbol).sort()).toEqual(['WBTC', 'sAVAX']);
		expect(out.coverage.unpriced[0]).toMatchObject({ chain: 'avalanche', side: 'supply' });
		// The two it could price are in the total; the two it could not are named, not folded in as $0.
		expect(out.suppliedUsdTotal).toBeCloseTo(0.05 * 60000 + 1.5 * 2000);
	});

	it('flags an unpriced borrow too, since a debt left out flips the sign of the net', () => {
		const out = completeAaveTotals(
			lookup([chainOf('ethereum', [pos({ side: 'borrow', assetSymbol: 'ZED', amount: 7, aaveUsd: null })])]),
			new Map(),
		);
		expect(out.coverage.partial).toBe(true);
		expect(out.coverage.unpriced).toEqual([{ chain: 'ethereum', side: 'borrow', symbol: 'ZED', amount: 7 }]);
		expect(out.debtUsdTotal).toBe(0);
	});
});

describe('completeAaveTotals: totals and coverage', () => {
	it('totals per chain and overall, and mirrors the totals into suppliedUsd and debtUsd', () => {
		const out = completeAaveTotals(
			lookup([
				chainOf('ethereum', [pos({ assetSymbol: 'ZED', amount: 1, aaveUsd: 100 })]),
				chainOf('polygon', [
					pos({ assetSymbol: 'ZED', amount: 2, aaveUsd: 250 }),
					pos({ side: 'borrow', assetSymbol: 'ZED', amount: 1, aaveUsd: 40 }),
				]),
			]),
			new Map(),
		);
		expect(out.chains.map((c) => [c.suppliedUsdTotal, c.debtUsdTotal])).toEqual([[100, 0], [250, 40]]);
		expect(out.chains[1].suppliedUsd).toBe(250);
		expect(out.suppliedUsdTotal).toBe(350);
		expect(out.suppliedUsd).toBe(350);
		expect(out.debtUsdTotal).toBe(40);
		expect(out.debtUsd).toBe(40);
	});

	it('never counts an empty position as unpriced', () => {
		const out = completeAaveTotals(lookup([chainOf('ethereum', [pos({ assetSymbol: 'ZED', amount: 0 })])]), new Map());
		expect(out.coverage.unpricedCount).toBe(0);
		expect(out.coverage.partial).toBe(false);
	});

	it('names at most MAX_UNPRICED_LISTED unpriced positions but always counts them all', () => {
		const many = Array.from({ length: MAX_UNPRICED_LISTED + 7 }, (_, i) => pos({ assetSymbol: `ZED${i}`, amount: 1 }));
		const out = completeAaveTotals(lookup([chainOf('ethereum', many)]), new Map());
		expect(out.coverage.unpricedCount).toBe(MAX_UNPRICED_LISTED + 7);
		expect(out.coverage.unpriced).toHaveLength(MAX_UNPRICED_LISTED);
	});

	it('marks a chain that did not answer, and the whole lookup when it failed before any chain did', () => {
		const down = completeAaveTotals(lookup([chainOf('polygon', [], { ok: false, error: 'HTTP 500' })]), new Map());
		expect(down.coverage.unavailableChains).toEqual(['polygon']);
		expect(down.coverage.partial).toBe(true);

		const failed = completeAaveTotals({ ok: false, chains: [], error: 'boom' }, new Map());
		expect(failed.coverage.unavailableChains).toEqual([AAVE_ALL_CHAINS]);
		expect(failed.coverage.partial).toBe(true);
	});

	it('treats a wallet with nothing to look up (not an EVM address) as complete', () => {
		const out = completeAaveTotals({ ok: true, chains: [] }, new Map());
		expect(out.coverage).toEqual(emptyCoverage());
	});

	it('does not count a chain whose market is not configured as a failure', () => {
		const out = completeAaveTotals(
			lookup([chainOf('ethereum_v4', [], { market: null, status: 'UNAVAILABLE', reason: 'MARKET_NOT_FOUND' })]),
			new Map(),
		);
		expect(out.coverage.partial).toBe(false);
	});

	it('does not change its input', () => {
		const input = lookup([chainOf('ethereum', [pos({ assetSymbol: 'WETH', amount: 1 })])]);
		const before = JSON.stringify(input);
		completeAaveTotals(input, new Map([['ETH', 2000]]));
		expect(JSON.stringify(input)).toBe(before);
	});
});

describe('completeAaveTotals: the sanity check against Aave\'s own totals', () => {
	const supplies = [
		pos({ assetSymbol: 'ZED', amount: 1, aaveUsd: 12000, isCollateral: true }),
		pos({ assetSymbol: 'ZEE', amount: 1, aaveUsd: 1800, isCollateral: false }),
	];

	it('is quiet when priced collateral and debt match what Aave reports (supply that is not collateral is not in its figure)', () => {
		const chain = chainOf('ethereum', [...supplies, pos({ side: 'borrow', assetSymbol: 'ZED', amount: 1, aaveUsd: 1500 })], {
			reported: { totalCollateralUsd: 12000.4, totalDebtUsd: 1500.2 },
		});
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.gaps).toEqual([]);
		expect(out.coverage.partial).toBe(false);
	});

	it('flags collateral that falls far short of what Aave reports, even when nothing is "unpriced"', () => {
		// The shape of the original bug: Aave counts 31400 of collateral, our positions add up to 8200.
		const chain = chainOf('polygon', [pos({ assetSymbol: 'ZED', amount: 1, aaveUsd: 8200, isCollateral: true })], {
			reported: { totalCollateralUsd: 31400, totalDebtUsd: 0 },
		});
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.unpricedCount).toBe(0);
		expect(out.coverage.gaps).toEqual([
			{ chain: 'polygon', kind: 'collateral', pricedUsd: 8200, aaveUsd: 31400, gapUsd: 23200 },
		]);
		expect(out.coverage.partial).toBe(true);
	});

	it('flags debt that disagrees with what Aave reports', () => {
		const chain = chainOf('avalanche', [pos({ side: 'borrow', assetSymbol: 'ZED', amount: 1, aaveUsd: 100 })], {
			reported: { totalCollateralUsd: 0, totalDebtUsd: 5000 },
		});
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.gaps.map((g) => g.kind)).toEqual(['debt']);
		expect(out.coverage.partial).toBe(true);
	});

	it('skips the collateral check when a supply does not say whether it is collateral, but still checks debt', () => {
		const chain = chainOf(
			'ethereum',
			[
				pos({ assetSymbol: 'ZED', amount: 1, aaveUsd: 100 }), // isCollateral unknown
				pos({ side: 'borrow', assetSymbol: 'ZED', amount: 1, aaveUsd: 100 }),
			],
			{ reported: { totalCollateralUsd: 99999, totalDebtUsd: 9999 } },
		);
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.gaps.map((g) => g.kind)).toEqual(['debt']);
	});

	it('skips the check when Aave\'s totals could not be fetched', () => {
		const chain = chainOf('ethereum', [pos({ assetSymbol: 'ZED', amount: 1, aaveUsd: 20000, isCollateral: true })], {
			reported: null,
		});
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.gaps).toEqual([]);
		expect(out.coverage.partial).toBe(false);
	});

	it('does not check a chain that did not answer (it is already reported as unavailable)', () => {
		const chain = chainOf('ethereum', [], { ok: false, reported: { totalCollateralUsd: 50000, totalDebtUsd: 0 } });
		const out = completeAaveTotals(lookup([chain]), new Map());
		expect(out.coverage.gaps).toEqual([]);
		expect(out.coverage.unavailableChains).toEqual(['ethereum']);
	});
});

describe('mergeCoverage', () => {
	const part = (over: Partial<ReturnType<typeof emptyCoverage>>) => ({ ...emptyCoverage(), ...over });

	it('is partial when any part is, and adds the counts', () => {
		const out = mergeCoverage([
			part({ partial: true, unpricedCount: 2, unpriced: [{ chain: 'ethereum', side: 'supply', symbol: 'ZED', amount: 1 }] }),
			part({}),
			part({ partial: true, unpricedCount: 1, unavailableChains: ['polygon'] }),
		]);
		expect(out.partial).toBe(true);
		expect(out.unpricedCount).toBe(3);
		expect(out.unpriced).toHaveLength(1);
		expect(out.unavailableChains).toEqual(['polygon']);
	});

	it('is complete when every part is, and ignores missing parts', () => {
		expect(mergeCoverage([part({}), null, undefined])).toEqual(emptyCoverage());
		expect(mergeCoverage([])).toEqual(emptyCoverage());
	});

	it('caps the named positions at MAX_UNPRICED_LISTED', () => {
		const named = Array.from({ length: MAX_UNPRICED_LISTED }, (_, i) => ({
			chain: 'ethereum',
			side: 'supply' as const,
			symbol: `ZED${i}`,
			amount: 1,
		}));
		const out = mergeCoverage([part({ partial: true, unpricedCount: named.length, unpriced: named }), part({ partial: true, unpricedCount: 1, unpriced: named.slice(0, 1) })]);
		expect(out.unpriced).toHaveLength(MAX_UNPRICED_LISTED);
		expect(out.unpricedCount).toBe(MAX_UNPRICED_LISTED + 1);
	});
});
