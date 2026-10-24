import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: after the shared token discovery shipped, a wallet's Polygon tokens (POL, WMATIC,
 * WBTC, USDC) showed no value and no unpricedReason.
 *
 * - The wallet card's refresh (tokens?refreshMissing=1) stored every snapshot unpriced and left
 *   pricing to a background reprice that the request did not wait for. Ethereum is written first and
 *   its reprice had time to land; Polygon is written last, so the response, and every read until its
 *   reprice landed, showed Polygon unpriced.
 * - The reader turned a stored null into 0, so those tokens read as $0 with unpricedReason null,
 *   breaking the rule that a missing price is UNPRICED and never a silent $0.
 *
 * All addresses are public token contracts or invented; all amounts and prices are invented.
 */

const WALLET = '0x000000000000000000000000000000000000b0b0';
const WPOL = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
const POLY_WBTC = '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6';
const POLY_USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca';

const TICKERS = [
	{ id: 'btc-bitcoin', symbol: 'BTC', rank: 1, quotes: { USD: { price: 100000 } } },
	{ id: 'eth-ethereum', symbol: 'ETH', rank: 2, quotes: { USD: { price: 2000 } } },
	{ id: 'link-chainlink', symbol: 'LINK', rank: 15, quotes: { USD: { price: 10 } } },
	{ id: 'wbtc-wrapped-bitcoin', symbol: 'WBTC', rank: 20, quotes: { USD: { price: 99000 } } },
	{ id: 'pol-polygon-ecosystem-token', symbol: 'POL', rank: 30, quotes: { USD: { price: 0.2 } } },
	{ id: 'avax-avalanche', symbol: 'AVAX', rank: 12, quotes: { USD: { price: 20 } } },
];

const discovered = vi.hoisted(() => ({ byChain: new Map<string, any[]>() }));
vi.mock('@/lib/evmTokenDiscovery', () => ({
	discoverEvmBalances: vi.fn(async (chain: string) => discovered.byChain.get(chain) ?? []),
}));

const tickerState = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: vi.fn(async () => {
		if (tickerState.fail) throw new Error('Coinpaprika HTTP 503');
		return TICKERS;
	}),
}));

const dbState = vi.hoisted(() => ({ snapshotRows: [] as any[], inserts: [] as any[] }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async (query: any, positional?: any[]) => {
			const sql = typeof query === 'string' ? query : String(query?.sql ?? '');
			if (/INSERT INTO wallet_snapshots/.test(sql)) {
				dbState.inserts.push(query.args);
				return { rows: [] };
			}
			if (/SELECT id, address, chains, label FROM wallets/.test(sql)) {
				return { rows: [{ id: 'w1', address: WALLET, chains: '["ethereum","polygon"]', label: 'Test wallet' }] };
			}
			if (/FROM wallets WHERE id/.test(sql)) {
				return { rows: [{ id: 'w1', address: WALLET, label: 'Test wallet' }] };
			}
			if (/FROM wallet_snapshots ws/.test(sql)) return { rows: dbState.snapshotRows };
			void positional;
			return { rows: [] };
		}),
	},
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: vi.fn(async () => ({ tenantId: 't1' })) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: vi.fn(async () => undefined) }));
vi.mock('@/lib/aave/client', () => ({ getAaveTotalsForWallet: vi.fn() }));
const reprice = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/repriceMissingWalletTokens', () => ({ repriceMissingWalletTokens: reprice }));

import { walletTokenUsdPrice } from '@/lib/prices/walletTokenPricing';
import { buildTickerPriceMap } from '@/lib/aave/pricing';
import { getWalletTokenBreakdown } from '@/lib/networth';
import { GET } from '@/pages/api/wallets/[id]/tokens';

const prices = buildTickerPriceMap(TICKERS);

function bal(chain: string, tokenSymbol: string, tokenAddress: string | null, decimals: number, rawBalance: bigint) {
	return { chain, address: WALLET, tokenSymbol, tokenAddress, decimals, rawBalance };
}

beforeEach(() => {
	discovered.byChain.clear();
	tickerState.fail = false;
	dbState.snapshotRows = [];
	dbState.inserts = [];
	reprice.mockClear();
});

describe('walletTokenUsdPrice', () => {
	it('prices Polygon holdings by the house rule', () => {
		expect(walletTokenUsdPrice('MATIC', prices)).toBe(0.2); // native Polygon coin as POL
		expect(walletTokenUsdPrice('WPOL', prices)).toBe(0.2);
		expect(walletTokenUsdPrice('WMATIC', prices)).toBe(0.2);
		expect(walletTokenUsdPrice('WBTC', prices)).toBe(99000); // its own ticker, not BTC
		expect(walletTokenUsdPrice('USDC', prices)).toBe(1);
	});

	it('prices Avalanche holdings by the same rule', () => {
		expect(walletTokenUsdPrice('AVAX', prices)).toBe(20);
		expect(walletTokenUsdPrice('WAVAX', prices)).toBe(20);
		expect(walletTokenUsdPrice('LINK.e', prices)).toBe(10); // bridged copy as its base coin
		expect(walletTokenUsdPrice('USDT.e', prices)).toBe(1);
		expect(walletTokenUsdPrice('DAI.e', prices)).toBeNull(); // no DAI ticker allowed: unpriced
	});

	it('leaves a token unpriced rather than guessing', () => {
		expect(walletTokenUsdPrice('WBTC', buildTickerPriceMap(TICKERS.filter((t) => t.symbol !== 'WBTC')))).toBeNull();
		expect(walletTokenUsdPrice('USDC-REWARD', prices)).toBeNull();
		expect(walletTokenUsdPrice('DQUICK', prices)).toBeNull();
		expect(walletTokenUsdPrice('POL', new Map())).toBeNull();
	});
});

describe('wallet card refresh (GET tokens?refreshMissing=1)', () => {
	it('writes the Polygon snapshot already priced, without waiting on a background reprice', async () => {
		discovered.byChain.set('ethereum', [bal('ethereum', 'LINK', LINK, 18, 2n * 10n ** 18n)]);
		discovered.byChain.set('polygon', [
			bal('polygon', 'MATIC', null, 18, 50n * 10n ** 18n), // 50 POL
			bal('polygon', 'WMATIC', WPOL, 18, 3n * 10n ** 18n), // 3 WMATIC
			bal('polygon', 'WBTC', POLY_WBTC, 8, 20000n), // 0.0002 WBTC
			bal('polygon', 'USDC', POLY_USDC, 6, 250000n), // 0.25 USDC
		]);

		const request = new Request('https://example.test/api/wallets/w1/tokens?refreshMissing=1');
		await GET({ params: { id: 'w1' }, request } as any);

		// args: tenant, wallet, chain, totals_usd, payload_json
		const polygonInsert = dbState.inserts.find((args) => args[2] === 'polygon');
		expect(polygonInsert).toBeTruthy();
		const tokens = JSON.parse(polygonInsert[4]);
		const value = (symbol: string) => tokens.find((t: any) => t.symbol === symbol)?.valueUsd;
		expect(value('MATIC')).toBeCloseTo(10);
		expect(value('WMATIC')).toBeCloseTo(0.6);
		expect(value('WBTC')).toBeCloseTo(19.8);
		expect(value('USDC')).toBeCloseTo(0.25);
		expect(polygonInsert[3]).toBeCloseTo(30.65);
		expect(reprice).not.toHaveBeenCalled();
	});

	it('stores tokens unpriced (null), not $0, when the price feed is down', async () => {
		tickerState.fail = true;
		discovered.byChain.set('polygon', [bal('polygon', 'MATIC', null, 18, 50n * 10n ** 18n)]);

		const request = new Request('https://example.test/api/wallets/w1/tokens?refreshMissing=1');
		await GET({ params: { id: 'w1' }, request } as any);

		const polygonInsert = dbState.inserts.find((args) => args[2] === 'polygon');
		const [pol] = JSON.parse(polygonInsert[4]);
		expect(pol).toMatchObject({ symbol: 'MATIC', priceUsd: null, valueUsd: null });
	});
});

describe('getWalletTokenBreakdown', () => {
	it('reports a held token with no price as unpriced, never as $0', async () => {
		dbState.snapshotRows = [
			{
				id: 's1',
				chain: 'polygon',
				capturedAt: '2026-01-02 03:04:05',
				totalsUsd: 0,
				payloadJson: JSON.stringify([
					{ symbol: 'MATIC', amount: 50, priceUsd: null, valueUsd: null, tokenAddress: 'native' },
					{ symbol: 'USDC', amount: 0.25, priceUsd: null, valueUsd: null, tokenAddress: POLY_USDC },
				]),
			},
		];

		const result = await getWalletTokenBreakdown('t1', 'w1');
		for (const symbol of ['POL', 'USDC']) {
			const token = result.tokens.find((t) => t.tokenSymbol === symbol);
			expect(token).toMatchObject({ usdValue: null, priceUsd: null, unpricedReason: 'no_price' });
		}
	});

	it('keeps a fallback-valued token priced so the API does not drop its value', async () => {
		dbState.snapshotRows = [
			{
				id: 's1',
				chain: 'polygon',
				capturedAt: '2026-01-02 03:04:05',
				totalsUsd: 0,
				payloadJson: JSON.stringify([
					{ symbol: 'WBTC', amount: 0.001, priceUsd: null, valueUsd: null, tokenAddress: POLY_WBTC },
				]),
			},
		];

		const [wbtc] = (await getWalletTokenBreakdown('t1', 'w1')).tokens;
		expect(wbtc.priceUsd).toBeGreaterThan(0);
		expect(wbtc.usdValue).toBeCloseTo(wbtc.priceUsd! * 0.001);
		expect(wbtc.unpricedReason).toBeNull();
	});
});
