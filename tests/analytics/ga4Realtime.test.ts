import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

/**
 * Live visitors for the owner's admin page: GA4 Realtime through the same service account
 * as the 28-day summary. No network: the token and report endpoints are stubbed. A Google
 * error must come back as null (shown as "unavailable"), never as "0 people here".
 */

let realtimeAnswer: (body: any) => unknown;
const calls: Array<{ url: string; body: any }> = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input);
	if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
	const body = init?.body ? JSON.parse(String(init.body)) : null;
	calls.push({ url, body });
	return new Response(JSON.stringify(realtimeAnswer(body)), { status: 200 });
});

let getGA4Realtime: typeof import('../../src/lib/ga4').getGA4Realtime;

beforeAll(async () => {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	vi.stubEnv('GA4_PROPERTY_ID', '530365354');
	vi.stubEnv('GA4_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
	vi.stubGlobal('fetch', fetchMock);
	({ getGA4Realtime } = await import('../../src/lib/ga4'));
});

beforeEach(() => { calls.length = 0; });

const rows = (dim: string | null, data: Array<[string, number]>) => ({
	dimensionHeaders: dim ? [{ name: dim }] : [],
	metricHeaders: [{ name: 'activeUsers' }],
	rows: data.map(([d, n]) => ({ dimensionValues: dim ? [{ value: d }] : [], metricValues: [{ value: String(n) }] })),
});

describe('getGA4Realtime', () => {
	it('returns the total, countries and page titles from the Realtime API', async () => {
		realtimeAnswer = (body) => {
			const dim = body?.dimensions?.[0]?.name ?? null;
			if (!dim) return rows(null, [['', 3]]);
			if (dim === 'country') return rows('country', [['United States', 2], ['Iran', 1]]);
			return rows('unifiedScreenName', [['Wallet Checker', 2], ['Almstins', 1]]);
		};
		const r = await getGA4Realtime();
		expect(r).toEqual({
			activeUsers: 3,
			countries: [{ country: 'United States', activeUsers: 2 }, { country: 'Iran', activeUsers: 1 }],
			pages: [{ title: 'Wallet Checker', activeUsers: 2 }, { title: 'Almstins', activeUsers: 1 }],
		});
		expect(calls).toHaveLength(3);
		for (const c of calls) expect(c.url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/530365354:runRealtimeReport');
	});

	it('an API error is "unavailable" (null), not zero visitors', async () => {
		realtimeAnswer = () => ({ error: { message: 'quota exceeded' } });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await getGA4Realtime()).toBeNull();
		warn.mockRestore();
	});
});
