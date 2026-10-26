import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coingeckoConfig } from '../../src/lib/coingeckoApi';

/**
 * CoinGecko's host and key header follow the plan (src/lib/coingeckoApi.ts): a Pro key goes to
 * pro-api.coingecko.com with x-cg-pro-api-key, a demo key (or a key with no plan set) to
 * api.coingecko.com with x-cg-demo-api-key, and no key sends no header. Only Pro reaches history
 * older than 365 days. Checked on the config and on the requests the historical lookup makes.
 *
 * The shared cache table is a Map and fetch is a stub. No database, no network, no real key.
 */

describe('coingeckoConfig', () => {
	it('no key: the public API, no header', () => {
		expect(coingeckoConfig({})).toEqual({ plan: 'public', baseUrl: 'https://api.coingecko.com/api/v3', headers: {}, fullHistory: false });
		expect(coingeckoConfig({ COINGECKO_API_KEY: '  ', COINGECKO_API_PLAN: 'pro' }).plan).toBe('public');
	});

	it('a Pro key: the Pro host and header, full history', () => {
		expect(coingeckoConfig({ COINGECKO_API_KEY: 'test-key', COINGECKO_API_PLAN: 'Pro' })).toEqual({
			plan: 'pro', baseUrl: 'https://pro-api.coingecko.com/api/v3', headers: { 'x-cg-pro-api-key': 'test-key' }, fullHistory: true,
		});
	});

	it('a demo key, or a key with no plan: the public host with the demo header', () => {
		const demo = { plan: 'demo', baseUrl: 'https://api.coingecko.com/api/v3', headers: { 'x-cg-demo-api-key': 'test-key' }, fullHistory: false };
		expect(coingeckoConfig({ COINGECKO_API_KEY: 'test-key', COINGECKO_API_PLAN: 'demo' })).toEqual(demo);
		expect(coingeckoConfig({ COINGECKO_API_KEY: 'test-key' })).toEqual(demo);
	});
});

const state = vi.hoisted(() => ({ requests: [] as Array<{ url: string; headers: Record<string, string> }> }));

vi.mock('@/lib/tursoCache', () => ({ getCache: async () => null, setCache: async () => {} }));

describe('the historical lookup uses the plan', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-26T00:00:00Z') });
		state.requests = [];
		vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
			state.requests.push({ url: String(input), headers: { ...(init?.headers ?? {}) } });
			return new Response(JSON.stringify({ prices: [[Date.parse('2017-01-01T12:00:00Z'), 1_000]] }));
		}));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	const price = async (day: string) =>
		(await import('../../src/lib/coingeckoHistorical')).getUsdUnitPriceAtTimestampCoinGecko({ coinId: 'bitcoin', timestampUtcIso: `${day}T12:00:00Z` });

	it('Pro: pro-api host with the Pro header, and days older than 365 are asked for', async () => {
		vi.stubEnv('COINGECKO_API_KEY', 'test-key');
		vi.stubEnv('COINGECKO_API_PLAN', 'pro');
		expect(await price('2017-01-01')).toMatchObject({ unitPriceUsd: 1_000 });
		expect(state.requests[0].url).toMatch(/^https:\/\/pro-api\.coingecko\.com\/api\/v3\/coins\/bitcoin\/market_chart\/range\?/);
		expect(state.requests[0].headers).toMatchObject({ 'x-cg-pro-api-key': 'test-key' });
		expect(state.requests[0].headers).not.toHaveProperty('x-cg-demo-api-key');
	});

	it('demo: the public host with the demo header; an old day is not asked for', async () => {
		vi.stubEnv('COINGECKO_API_KEY', 'test-key');
		vi.stubEnv('COINGECKO_API_PLAN', '');
		expect(await price('2017-01-01')).toBeNull();
		expect(state.requests).toEqual([]);
		await price('2026-06-01');
		expect(state.requests[0].url).toMatch(/^https:\/\/api\.coingecko\.com\/api\/v3\//);
		expect(state.requests[0].headers).toMatchObject({ 'x-cg-demo-api-key': 'test-key' });
		expect(state.requests[0].headers).not.toHaveProperty('x-cg-pro-api-key');
	});

	it('no key: the public host and no key header', async () => {
		vi.stubEnv('COINGECKO_API_KEY', '');
		await price('2026-06-01');
		expect(state.requests[0].url).toMatch(/^https:\/\/api\.coingecko\.com\/api\/v3\//);
		expect(Object.keys(state.requests[0].headers).filter((h) => h.startsWith('x-cg-'))).toEqual([]);
	});
});
