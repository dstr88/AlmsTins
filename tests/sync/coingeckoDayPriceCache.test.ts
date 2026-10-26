import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The day prices Bitcoin and Litecoin rows are stored at come through src/lib/coingeckoHistorical.ts,
 * whose caches keep a long history from asking CoinGecko once per row:
 *
 *   - the same coin and day is fetched once, then answered from memory, and from the shared cache
 *     table (keyed by coin and day) by another process or a later sync;
 *   - LTC is litecoin without reading CoinGecko's coin list (other coins share the symbol);
 *   - without an API key a day over 365 days old costs no CoinGecko request: Bitcoin and Litecoin
 *     go to Coinbase's candles (src/lib/coinbaseHistorical.ts), other coins have no price.
 *
 * The shared cache table is a Map here. No database, no network.
 */

const state = vi.hoisted(() => ({ cache: new Map<string, unknown>(), fetched: [] as string[] }));

vi.mock('@/lib/tursoCache', () => ({
	getCache: async (key: string) => state.cache.get(key) ?? null,
	setCache: async (key: string, value: unknown) => { state.cache.set(key, value); },
}));

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv('COINGECKO_API_KEY', '');
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T00:00:00Z') });
	state.cache.clear();
	state.fetched = [];
	vi.stubGlobal('fetch', vi.fn(async (input: string) => {
		const url = String(input);
		state.fetched.push(url);
		if (url.includes('/market_chart/range')) return new Response(JSON.stringify({ prices: [[Date.parse('2026-06-01T12:00:00Z'), 70_000]] }));
		// Coinbase: one 06:00 candle on 2025-01-01, closing at 94,000 at noon.
		if (url.includes('api.exchange.coinbase.com')) return new Response(JSON.stringify([[Date.parse('2025-01-01T06:00:00Z') / 1000, 0, 0, 93_000, 94_000, 1]]));
		return new Response('{}', { status: 404 });
	}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

const load = () => import('../../src/lib/sync/utxoHistoricalPrice');

describe('day prices are cached by coin and day', () => {
	it('fetches a coin and day once, then answers from memory', async () => {
		const { dailyUsdPrice } = await load();
		expect(await dailyUsdPrice('BTC', '2026-06-01')).toEqual({ unitPriceUsd: 70_000, source: 'coingecko:range' });
		expect(await dailyUsdPrice('BTC', '2026-06-01')).toEqual({ unitPriceUsd: 70_000, source: 'coingecko:range' });
		expect(state.fetched).toHaveLength(1);
		expect(state.fetched[0]).toContain('/coins/bitcoin/market_chart/range');
	});

	it('a later process reads the shared cache instead of CoinGecko', async () => {
		await (await load()).dailyUsdPrice('BTC', '2026-06-01');
		vi.resetModules(); // a new process: empty memory
		state.fetched = [];
		expect(await (await load()).dailyUsdPrice('BTC', '2026-06-01')).toEqual({ unitPriceUsd: 70_000, source: 'coingecko:range' });
		expect(state.fetched).toEqual([]);
	});

	it('LTC is litecoin, without the coin list', async () => {
		await (await load()).dailyUsdPrice('LTC', '2026-06-01');
		expect(state.fetched).toHaveLength(1);
		expect(state.fetched[0]).toContain('/coins/litecoin/market_chart/range');
	});

	it('without a key, a day over 365 days old costs no CoinGecko request and comes from Coinbase', async () => {
		expect(await (await load()).dailyUsdPrice('BTC', '2025-01-01')).toEqual({ unitPriceUsd: 94_000, source: 'coinbase:candles' });
		expect(state.fetched).toHaveLength(1);
		expect(state.fetched[0]).toMatch(/^https:\/\/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles\?/);
	});

	it('a coin the fallback does not cover has no price for such a day, and nothing is fetched', async () => {
		expect(await (await load()).dailyUsdPrice('LINK', '2025-01-01')).toBeNull();
		expect(state.fetched).toEqual([]);
	});
});
