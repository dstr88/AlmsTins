import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The day prices Bitcoin and Litecoin rows are stored at come through src/lib/coingeckoHistorical.ts,
 * whose caches keep a long history from asking CoinGecko once per row:
 *
 *   - the same coin and day is fetched once, then answered from memory, and from the shared cache
 *     table (keyed by coin and day) by another process or a later sync;
 *   - LTC is litecoin without reading CoinGecko's coin list (other coins share the symbol);
 *   - without an API key a day over 365 days old is no price, and nothing is fetched.
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

	it('without a key, a day over 365 days old is no price and costs no request', async () => {
		expect(await (await load()).dailyUsdPrice('BTC', '2025-01-01')).toBeNull();
		expect(state.fetched).toEqual([]);
	});
});
