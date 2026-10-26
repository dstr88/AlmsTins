import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Fill Missing Prices" (src/lib/priceMissingImportTransactions.ts) prices a Bitcoin or Litecoin
 * import row CoinGecko cannot price (older than 365 days without a Pro key) from Coinbase's
 * candles, with price_source 'coinbase:candles'. CoinGecko still wins when it has a price, and
 * other coins keep today's behavior (no price, skipped, Coinbase not asked).
 *
 * The database, CoinGecko and Coinbase are stubs. No database, no network.
 */

const state = vi.hoisted(() => ({
	rows: [] as Array<{ id: string; asset_symbol: string; amount: number; timestamp_utc: string }>,
	updates: [] as unknown[][],
	coinbaseAsked: [] as string[],
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
			if (/^\s*SELECT/i.test(sql)) return { rows: state.rows };
			if (/^\s*UPDATE import_transactions/i.test(sql)) { state.updates.push(args); return { rows: [], rowsAffected: 1 }; }
			throw new Error(`unexpected sql ${sql}`);
		},
	},
}));
vi.mock('../../src/lib/lifecycle', () => ({ rebuildAssetLifecycles: vi.fn(async () => {}) }));
vi.mock('../../src/lib/priceSourceColumn', () => ({ ensurePriceSourceColumn: async () => true }));
vi.mock('../../src/lib/coingeckoHistorical', () => ({
	getCoingeckoIdBySymbol: async (s: string) => ({ BTC: 'bitcoin', LTC: 'litecoin', LINK: 'chainlink' } as Record<string, string>)[s] ?? null,
	// CoinGecko answers only recent days, as without a Pro key.
	getUsdUnitPriceAtTimestampCoinGecko: async ({ timestampUtcIso }: { timestampUtcIso: string }) =>
		timestampUtcIso.startsWith('2026-06-01') ? { unitPriceUsd: 70_000, pricedAtIso: timestampUtcIso, source: 'coingecko:range', confidence: 'historical' } : null,
}));
vi.mock('../../src/lib/coinbaseHistorical', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/coinbaseHistorical')>()),
	coinbaseDayUsdPrice: async (symbol: string, day: string) => {
		state.coinbaseAsked.push(`${symbol}|${day}`);
		return ({ 'BTC|2017-01-01': 1_000, 'LTC|2017-01-01': 4 } as Record<string, number>)[`${symbol}|${day}`] ?? null;
	},
}));

beforeEach(() => {
	state.updates = [];
	state.coinbaseAsked = [];
});

describe('Fill Missing Prices: Bitcoin and Litecoin fallback', () => {
	it('prices old BTC/LTC rows from Coinbase, recent ones from CoinGecko, and leaves other coins as before', async () => {
		state.rows = [
			{ id: 'b-old', asset_symbol: 'BTC', amount: -0.5, timestamp_utc: '2017-01-01T09:00:00Z' },
			{ id: 'l-old', asset_symbol: 'LTC', amount: 10, timestamp_utc: '2017-01-01T20:00:00Z' },
			{ id: 'b-new', asset_symbol: 'BTC', amount: 0.1, timestamp_utc: '2026-06-01T03:00:00Z' },
			{ id: 'k-old', asset_symbol: 'LINK', amount: 5, timestamp_utc: '2017-01-01T09:00:00Z' },
			{ id: 'b-none', asset_symbol: 'BTC', amount: 1, timestamp_utc: '2014-01-01T09:00:00Z' },
		];
		const { priceMissingImportTransactions } = await import('../../src/lib/priceMissingImportTransactions');
		const res = await priceMissingImportTransactions('tenant-a');

		const byId = new Map(state.updates.map((a) => [a[2], { usd: a[0], source: a[1], tenant: a[3] }]));
		expect(byId.get('b-old')).toEqual({ usd: 500, source: 'coinbase:candles', tenant: 'tenant-a' });
		expect(byId.get('l-old')).toEqual({ usd: 40, source: 'coinbase:candles', tenant: 'tenant-a' });
		expect(byId.get('b-new')).toEqual({ usd: 7_000, source: 'coingecko:range', tenant: 'tenant-a' });
		expect(byId.has('k-old')).toBe(false);
		expect(byId.has('b-none')).toBe(false);
		expect(state.coinbaseAsked.sort()).toEqual(['BTC|2014-01-01', 'BTC|2017-01-01', 'LTC|2017-01-01']);
		expect(res).toMatchObject({ ok: true, scanned: 5, priced: 3, skipped: 2, errors: 0 });
	});
});
