import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeAaveApi, type FakeAave, type FakeAaveHandle } from '../helpers/fakeAaveApi';

/**
 * The real Aave client, run against a fake Aave API and a fake price feed. It checks the pipeline end to end:
 * what the client asks Aave for, how each position is priced, and what the totals admit they leave out.
 * No network, no database, no secrets. Every symbol, amount and price here is invented.
 */
vi.mock('@/lib/db', () => ({
	db: {
		execute: async () => {
			throw new Error('the Aave client must not touch the database');
		},
	},
}));

const feed = vi.hoisted(() => ({ tickers: [] as unknown[], fail: false, calls: 0 }));
vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: async () => {
		feed.calls += 1;
		if (feed.fail) throw new Error('price feed down');
		return feed.tickers;
	},
}));

import { getAavePositionsForWallet, getAaveTotalsForWallet } from '../../src/lib/aave/client';

const ADDR = `0x${'1'.repeat(40)}`;
const ETHEREUM = 1;
const POLYGON = 137;
const AVALANCHE = 43114;

const ticker = (symbol: string, price: number) => ({ symbol, quotes: { USD: { price } } });

let api: FakeAaveHandle;
const serve = (fake: FakeAave) => {
	api = installFakeAaveApi(fake);
};

beforeEach(() => {
	feed.tickers = [];
	feed.fail = false;
	feed.calls = 0;
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	api?.restore();
	vi.restoreAllMocks();
});

// A healthy account: its collateral is WBTC, a bridged BTC and a bridged ETH, with a staking token on the side.
const healthyAvalanche: FakeAave['chains'][number] = {
	supplies: [
		{ symbol: 'WBTC', amount: '0.1', usd: '6100', usdPerToken: '61000', isCollateral: true },
		{ symbol: 'BTC.b', amount: '0.05', usd: '3050', usdPerToken: '61000', isCollateral: true },
		{ symbol: 'WETH.e', amount: '1.5', usd: '3300', usdPerToken: '2200', isCollateral: true },
		{ symbol: 'sAVAX', amount: '40', usd: '1100', usdPerToken: '27.5', isCollateral: false },
	],
	borrows: [{ symbol: 'USDt', amount: '4000', usd: '4000', usdPerToken: '1' }],
	state: { totalCollateralBase: '12450', totalDebtBase: '4000' },
};

describe('what the client asks Aave for', () => {
	it('asks for Aave\'s own USD figure and the collateral flag, and for the state in every market in one request', async () => {
		serve({ chains: { [AVALANCHE]: healthyAvalanche } });
		await getAaveTotalsForWallet(ADDR);
		const positionQueries = api.positionQueries();
		expect(positionQueries.length).toBe(3); // Ethereum, Polygon, Avalanche
		for (const q of positionQueries) {
			expect(q).toContain('usdPerToken');
			expect(q).toContain('isCollateral');
		}
		expect(api.stateQueries()).toBe(1);
	});

	it('does not ask for the market state when the caller only wants amounts (Memory Lane)', async () => {
		serve({ chains: { [AVALANCHE]: healthyAvalanche } });
		const out = await getAavePositionsForWallet(ADDR);
		expect(api.stateQueries()).toBe(0);
		expect(out.chains.every((c) => c.reported === undefined)).toBe(true);
	});

	it('makes no request at all for something that is not an EVM address', async () => {
		serve({ chains: {} });
		const out = await getAaveTotalsForWallet('not-an-evm-address');
		expect(api.queries).toEqual([]);
		expect(out.chains).toEqual([]);
		expect(out.suppliedUsdTotal).toBe(0);
		expect(out.coverage.partial).toBe(false);
	});
});

describe('getAavePositionsForWallet carries Aave\'s own valuation', () => {
	it('puts Aave\'s USD figure on each position, flags collateral, and keeps the raw amounts', async () => {
		serve({ chains: { [AVALANCHE]: healthyAvalanche } });
		const out = await getAavePositionsForWallet(ADDR, { withReported: true });
		const avax = out.chains.find((c) => c.chain === 'avalanche')!;
		const wbtc = avax.positions.find((p) => p.assetSymbol === 'WBTC')!;
		expect(wbtc).toMatchObject({ side: 'supply', amount: 0.1, usdValue: 6100, aaveUsd: 6100, isCollateral: true });
		const savax = avax.positions.find((p) => p.assetSymbol === 'sAVAX')!;
		expect(savax.isCollateral).toBe(false);
		const debt = avax.positions.find((p) => p.side === 'borrow')!;
		expect(debt).toMatchObject({ amount: 4000, usdValue: 4000 });
		expect(avax.suppliedUsd).toBe(13550);
		expect(avax.debtUsd).toBe(4000);
		expect(avax.reported).toEqual({ totalCollateralUsd: 12450, totalDebtUsd: 4000 });
	});
});

describe('getAaveTotalsForWallet', () => {
	it('prices WBTC, bridged BTC and ETH, and a staking token from Aave\'s own figures, so a healthy account nets positive', async () => {
		serve({ chains: { [AVALANCHE]: healthyAvalanche } });
		const out = await getAaveTotalsForWallet(ADDR);
		expect(out.suppliedUsdTotal).toBe(13550);
		expect(out.debtUsdTotal).toBe(4000);
		expect(out.suppliedUsdTotal - out.debtUsdTotal).toBe(9550);
		expect(out.coverage).toMatchObject({ partial: false, unpricedCount: 0, gaps: [], unavailableChains: [] });
		expect(out.chains.flatMap((c) => c.positions).every((p) => p.priceSource === 'aave')).toBe(true);
		// Aave valued everything, so the price feed was never needed.
		expect(feed.calls).toBe(0);
	});

	it('falls back to the shared rule for a position Aave did not value, and counts what that cannot price', async () => {
		feed.tickers = [ticker('BTC', 60000), ticker('WBTC', 59900), ticker('ETH', 2000)]; // no sAVAX
		serve({
			chains: {
				[AVALANCHE]: {
					supplies: [
						{ symbol: 'WBTC', amount: '0.1' },
						{ symbol: 'BTC.b', amount: '0.05' },
						{ symbol: 'WETH.e', amount: '1.5' },
						{ symbol: 'sAVAX', amount: '40' },
					],
					state: 'fail',
				},
			},
		});
		const out = await getAaveTotalsForWallet(ADDR);
		const avax = out.chains.find((c) => c.chain === 'avalanche')!;
		const priced = Object.fromEntries(avax.positions.map((p) => [p.assetSymbol, p]));
		expect(priced['WBTC'].usdValue).toBeCloseTo(0.1 * 59900); // its own ticker, not BTC's
		expect(priced['BTC.b'].usdValue).toBeCloseTo(0.05 * 60000); // as its base coin
		expect(priced['WETH.e'].usdValue).toBeCloseTo(1.5 * 2000); // as its base coin
		expect(priced['sAVAX']).toMatchObject({ usdValue: 0, priceSource: 'none' });
		expect(out.coverage.partial).toBe(true);
		expect(out.coverage.unpricedCount).toBe(1);
		expect(out.coverage.unpriced).toEqual([{ chain: 'avalanche', side: 'supply', symbol: 'sAVAX', amount: 40 }]);
		expect(feed.calls).toBe(1);
	});

	it('keeps the positions when the API rejects the USD fields, pricing them from the shared rule', async () => {
		feed.tickers = [ticker('ETH', 2000)];
		serve({
			rejectUsdFields: true,
			chains: { [POLYGON]: { supplies: [{ symbol: 'WETH', amount: '3', usd: '6000', usdPerToken: '2000', isCollateral: true }] } },
		});
		const out = await getAaveTotalsForWallet(ADDR);
		// Every chain was asked again without the USD fields.
		const plain = api.positionQueries().filter((q) => !q.includes('usdPerToken'));
		expect(plain.length).toBe(3);
		const polygon = out.chains.find((c) => c.chain === 'polygon')!;
		expect(polygon.ok).toBe(true);
		expect(polygon.positions[0]).toMatchObject({ assetSymbol: 'WETH', amount: 3, usdValue: 6000, priceSource: 'market' });
		expect(out.coverage.partial).toBe(false);
	});

	it('loses nothing when the market-state lookup fails: only the sanity check is off', async () => {
		serve({ chains: { [AVALANCHE]: { ...healthyAvalanche, state: 'fail' } } });
		const out = await getAaveTotalsForWallet(ADDR);
		// One request covers every market, so a failure switches the check off for all of them.
		expect(out.chains.filter((c) => c.market).every((c) => c.reported === null)).toBe(true);
		expect(out.suppliedUsdTotal).toBe(13550);
		expect(out.coverage.gaps).toEqual([]);
		expect(out.coverage.partial).toBe(false);
	});

	it('flags a large gap between priced collateral and Aave\'s totalCollateralBase, and logs it', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		serve({
			chains: {
				[POLYGON]: {
					supplies: [{ symbol: 'ZED', amount: '1', usd: '8200', usdPerToken: '8200', isCollateral: true }],
					// Aave counts 31400 of collateral; our positions add up to 8200.
					state: { totalCollateralBase: '31400', totalDebtBase: '0' },
				},
			},
		});
		const out = await getAaveTotalsForWallet(ADDR);
		expect(out.coverage.gaps).toEqual([
			{ chain: 'polygon', kind: 'collateral', pricedUsd: 8200, aaveUsd: 31400, gapUsd: 23200 },
		]);
		expect(out.coverage.partial).toBe(true);
		expect(warn.mock.calls.some((call) => String(call[0]).includes('disagree'))).toBe(true);
	});

	it('does not throw when the price feed is down: the positions Aave did not value stay unpriced', async () => {
		feed.fail = true;
		serve({ chains: { [ETHEREUM]: { supplies: [{ symbol: 'WETH', amount: '1' }] } } });
		const out = await getAaveTotalsForWallet(ADDR);
		expect(out.coverage.partial).toBe(true);
		expect(out.coverage.unpricedCount).toBe(1);
		expect(out.suppliedUsdTotal).toBe(0);
	});

	it('reports a chain whose lookup failed as unavailable, and still counts the chains that answered', async () => {
		serve({
			chains: {
				[POLYGON]: { supplies: [{ symbol: 'ZED', amount: '2', usd: '500', usdPerToken: '250', isCollateral: true }], state: { totalCollateralBase: '500', totalDebtBase: '0' } },
				[AVALANCHE]: { positionsHttpStatus: 500 },
			},
		});
		const out = await getAaveTotalsForWallet(ADDR);
		expect(out.coverage.unavailableChains).toEqual(['avalanche']);
		expect(out.coverage.partial).toBe(true);
		expect(out.suppliedUsdTotal).toBe(500);
	});

	it('handles an account that supplies nothing anywhere as a clean zero', async () => {
		serve({ chains: {} });
		const out = await getAaveTotalsForWallet(ADDR);
		expect(out.suppliedUsdTotal).toBe(0);
		expect(out.debtUsdTotal).toBe(0);
		expect(out.coverage.partial).toBe(false);
		expect(feed.calls).toBe(0);
	});
});
