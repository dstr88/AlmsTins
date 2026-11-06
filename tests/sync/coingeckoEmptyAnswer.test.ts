import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * src/lib/coingeckoHistorical.ts keeps a price answer for 90 days. An answer for a window that has not
 * ended yet (a transfer made this morning, priced at 12:00 UTC, with the window running six hours past
 * that) comes back empty or partial, and keeping it would hide the real price for 90 days. So only an
 * answer with a price, for a window wholly in the past, is kept; an empty answer kept before this rule
 * is asked for again. The shared cache table is a Map here. No database, no network.
 */

const state = vi.hoisted(() => ({ cache: new Map<string, unknown>(), fetched: [] as string[], prices: [] as Array<[number, number]> }));

vi.mock('@/lib/tursoCache', () => ({
	getCache: async (key: string) => state.cache.get(key) ?? null,
	setCache: async (key: string, value: unknown) => { state.cache.set(key, value); },
}));

const NOON = '2026-10-18T12:00:00.000Z';

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv('COINGECKO_API_KEY', '');
	state.cache.clear();
	state.fetched = [];
	state.prices = [];
	vi.stubGlobal('fetch', vi.fn(async (input: string) => {
		const url = String(input);
		state.fetched.push(url);
		if (url.includes('/market_chart/range')) return new Response(JSON.stringify({ prices: state.prices }));
		if (url.includes('/history')) return new Response(JSON.stringify({}));
		return new Response('{}', { status: 404 });
	}));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

const load = () => import('../../src/lib/coingeckoHistorical');
const rangeKeys = () => [...state.cache.keys()].filter((k) => k.startsWith('coingecko:range:'));

describe('a price answer is kept only when it is complete', () => {
	it('an empty answer is not kept, so the price is found once it exists', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T13:00:00Z') });
		const { getUsdUnitPriceAtTimestampCoinGecko } = await load();
		expect(await getUsdUnitPriceAtTimestampCoinGecko({ coinId: 'ethereum', timestampUtcIso: NOON })).toBeNull();
		expect(rangeKeys()).toEqual([]);

		vi.setSystemTime(new Date('2026-10-19T00:00:00Z'));
		state.prices = [[Date.parse(NOON), 2500]];
		expect(await getUsdUnitPriceAtTimestampCoinGecko({ coinId: 'ethereum', timestampUtcIso: NOON })).toMatchObject({ unitPriceUsd: 2500 });
		expect(rangeKeys()).toHaveLength(1);
	});

	it('an answer for a window that has not ended yet is used but not kept', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T14:00:00Z') });
		state.prices = [[Date.parse('2026-10-18T11:55:00Z'), 2400]];
		const { getUsdUnitPriceAtTimestampCoinGecko } = await load();
		expect(await getUsdUnitPriceAtTimestampCoinGecko({ coinId: 'ethereum', timestampUtcIso: NOON })).toMatchObject({ unitPriceUsd: 2400 });
		expect(rangeKeys()).toEqual([]);
	});

	it('an empty answer kept before this rule is asked for again', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T00:00:00Z') });
		const { getUsdUnitPriceAtTimestampCoinGecko } = await load();
		state.cache.set('coingecko:range:ethereum:2026-10-18T12', { prices: [] });
		state.prices = [[Date.parse(NOON), 2500]];
		expect(await getUsdUnitPriceAtTimestampCoinGecko({ coinId: 'ethereum', timestampUtcIso: NOON })).toMatchObject({ unitPriceUsd: 2500 });
		expect(state.fetched.some((u) => u.includes('/market_chart/range'))).toBe(true);
	});

	it('the rule itself: a price, and a window wholly in the past', async () => {
		const { isKeepableRange } = await load();
		const end = Date.parse('2026-10-18T18:00:00Z') / 1000;
		expect(isKeepableRange({ prices: [[1, 2]] }, end, end * 1000)).toBe(true);
		expect(isKeepableRange({ prices: [[1, 2]] }, end, end * 1000 - 1)).toBe(false);
		expect(isKeepableRange({ prices: [] }, end, end * 1000 + 1)).toBe(false);
		expect(isKeepableRange(null, end, end * 1000 + 1)).toBe(false);
	});
});
