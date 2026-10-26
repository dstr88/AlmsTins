import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Bitcoin and Litecoin price fallback (src/lib/coinbaseHistorical.ts): Coinbase Exchange's
 * public 6-hour candles, for days CoinGecko cannot price.
 *
 *   - A day's price is the price at 12:00 UTC (the 06:00 candle's close, else the 12:00 candle's
 *     open, else the candle edge nearest noon that day), from a request that names only the
 *     product, the candle size and the dates.
 *   - One request covers a 74-day block; blocks are cached by product in memory and, once wholly
 *     past, in the shared cache table, so a later process asks nothing.
 *   - A failed request, a 429, an error body or a day without candles is no price, and a failure
 *     is not cached. Coins other than BTC and LTC are not asked for.
 *
 * The shared cache table is a Map and fetch is a stub serving generated candles. No database, no
 * network.
 */

const H = 3_600_000;
const state = vi.hoisted(() => ({
	cache: new Map<string, unknown>(),
	fetched: [] as Array<{ url: string; at: number }>,
	fail: null as null | 'status500' | 'status429' | 'throw' | 'errorBody',
	listedFrom: '2015-07-20',
}));

vi.mock('@/lib/tursoCache', () => ({
	getCache: async (key: string) => state.cache.get(key) ?? null,
	setCache: async (key: string, value: unknown) => { state.cache.set(key, value); },
}));

/** The generated price at an instant: hours since the epoch (so noon of a day is easy to check). */
const priceAt = (ms: number) => ms / H;
const noonPrice = (day: string) => priceAt(Date.parse(`${day}T12:00:00Z`));

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T00:00:00Z') });
	state.cache.clear();
	state.fetched = [];
	state.fail = null;
	vi.stubGlobal('fetch', vi.fn(async (input: string) => {
		const url = new URL(String(input));
		state.fetched.push({ url: String(input), at: performance.now() });
		if (state.fail === 'throw') throw new Error('network down');
		if (state.fail === 'status500') return new Response('{}', { status: 500 });
		if (state.fail === 'status429') return new Response('{}', { status: 429 });
		if (state.fail === 'errorBody') return new Response(JSON.stringify({ message: 'granularity too small' }));
		const step = Number(url.searchParams.get('granularity')) * 1000;
		const from = Math.max(Date.parse(url.searchParams.get('start')!), Date.parse(`${state.listedFrom}T00:00:00Z`));
		const to = Math.min(Date.parse(url.searchParams.get('end')!), Date.now() - step); // no candle that has not closed
		const out: number[][] = [];
		for (let t = from; t <= to; t += step) out.unshift([t / 1000, 0, 0, priceAt(t), priceAt(t + step), 1]); // newest first
		return new Response(JSON.stringify(out));
	}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const load = () => import('../../src/lib/coinbaseHistorical');

describe('Coinbase day prices', () => {
	it('prices an old Bitcoin day at 12:00 UTC from a request naming only product and dates', async () => {
		const { coinbaseDayUsdPrice, blockStartMs, BLOCK_DAYS } = await load();
		expect(await coinbaseDayUsdPrice('BTC', '2017-01-01')).toBe(noonPrice('2017-01-01'));
		expect(state.fetched).toHaveLength(1);
		const url = new URL(state.fetched[0].url);
		expect(url.origin + url.pathname).toBe('https://api.exchange.coinbase.com/products/BTC-USD/candles');
		expect([...url.searchParams.keys()]).toEqual(['granularity', 'start', 'end']);
		const start = blockStartMs(Date.parse('2017-01-01T00:00:00Z'));
		expect(url.searchParams.get('granularity')).toBe('21600');
		expect(url.searchParams.get('start')).toBe(new Date(start).toISOString());
		// 74 days of 6-hour candles: 296, under Coinbase's 300 per request.
		expect((Date.parse(url.searchParams.get('end')!) - start) / (6 * H) + 1).toBe(BLOCK_DAYS * 4);
	});

	it('Litecoin is LTC-USD; other coins are not asked for', async () => {
		const { coinbaseDayUsdPrice } = await load();
		expect(await coinbaseDayUsdPrice('ltc', '2018-05-05')).toBe(noonPrice('2018-05-05'));
		expect(state.fetched[0].url).toContain('/products/LTC-USD/candles');
		expect(await coinbaseDayUsdPrice('ETH', '2018-05-05')).toBeNull();
		expect(await coinbaseDayUsdPrice('BTC', 'not-a-day')).toBeNull();
		expect(state.fetched).toHaveLength(1);
	});

	it('one request covers many days; a day in another block is a second request', async () => {
		const { coinbaseDayUsdPrice } = await load();
		for (let d = 1; d <= 10; d++) {
			const day = `2016-11-${String(d).padStart(2, '0')}`;
			expect(await coinbaseDayUsdPrice('BTC', day)).toBe(noonPrice(day));
		}
		expect(state.fetched).toHaveLength(1);
		await coinbaseDayUsdPrice('BTC', '2019-03-01');
		expect(state.fetched).toHaveLength(2);
		// Paced: the second request waited for the spacing after the first.
		expect(state.fetched[1].at - state.fetched[0].at).toBeGreaterThanOrEqual(240);
	});

	it('a block wholly in the past is kept in the shared cache table: a later process asks nothing', async () => {
		await (await load()).coinbaseDayUsdPrice('BTC', '2017-01-01');
		expect([...state.cache.keys()]).toEqual([expect.stringMatching(/^coinbase:candles6h:BTC-USD:\d{4}-\d{2}-\d{2}$/)]);
		const stored = [...state.cache.values()][0] as { days: Record<string, number> };
		expect(Object.keys(stored)).toEqual(['days']); // prices by day, nothing else

		vi.resetModules(); // a new process: empty memory
		state.fetched = [];
		expect(await (await load()).coinbaseDayUsdPrice('BTC', '2016-12-25')).toBe(noonPrice('2016-12-25'));
		expect(state.fetched).toEqual([]);
	});

	it('a block reaching today is not stored in the table, and today has no price yet', async () => {
		const { coinbaseDayUsdPrice } = await load();
		expect(await coinbaseDayUsdPrice('BTC', '2026-10-20')).toBe(noonPrice('2026-10-20'));
		expect(await coinbaseDayUsdPrice('BTC', '2026-10-26')).toBeNull(); // never another day's price
		expect(state.cache.size).toBe(0);
		expect(state.fetched).toHaveLength(1); // memory still answers within the process
	});

	it('a day before the coin was listed is no price', async () => {
		expect(await (await load()).coinbaseDayUsdPrice('BTC', '2015-07-01')).toBeNull();
	});

	it.each(['status500', 'status429', 'throw', 'errorBody'] as const)('a failure (%s) is no price and is not cached', async (fail) => {
		const { coinbaseDayUsdPrice } = await load();
		state.fail = fail;
		expect(await coinbaseDayUsdPrice('BTC', '2017-01-01')).toBeNull();
		expect(state.cache.size).toBe(0);
		state.fail = null;
		expect(await coinbaseDayUsdPrice('BTC', '2017-01-01')).toBe(noonPrice('2017-01-01'));
		expect(state.fetched).toHaveLength(2);
	});
});

describe('noonPrices', () => {
	const t = (iso: string) => Date.parse(iso) / 1000;
	it('takes the 06:00 candle\'s close, else the 12:00 candle\'s open, else the edge nearest noon', async () => {
		const { noonPrices } = await load();
		// [time, low, high, open, close, volume]
		expect(noonPrices([
			[t('2020-01-01T12:00:00Z'), 0, 0, 120, 121, 1],
			[t('2020-01-01T06:00:00Z'), 0, 0, 106, 119, 1],
		])).toEqual({ '2020-01-01': 119 });
		expect(noonPrices([[t('2020-01-02T12:00:00Z'), 0, 0, 220, 221, 1]])).toEqual({ '2020-01-02': 220 });
		expect(noonPrices([[t('2020-01-03T00:00:00Z'), 0, 0, 300, 306, 1]])).toEqual({ '2020-01-03': 306 });
		expect(noonPrices([[t('2020-01-04T18:00:00Z'), 0, 0, 418, 424, 1]])['2020-01-04']).toBe(418);
		expect(noonPrices([[t('2020-01-05T06:00:00Z'), 0, 0, 0, -1, 1]])).toEqual({}); // no usable price
		expect(noonPrices({ message: 'x' })).toEqual({});
		// The 18:00 candle's close lands at midnight: it is that day's last trade, not the next day's price.
		expect(noonPrices([[t('2020-01-06T18:00:00Z'), 0, 0, 0, 624, 1]])).toEqual({ '2020-01-06': 624 });
	});
});
