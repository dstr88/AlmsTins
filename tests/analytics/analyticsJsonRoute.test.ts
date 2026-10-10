import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ session: null as null | { tenantId: string }, realtime: null as unknown }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/owner', () => ({ isOwner: (t: string | null | undefined) => t === 'owner-tenant' }));
vi.mock('@/lib/ga4', () => ({ getGA4Realtime: async () => state.realtime }));

import { GET } from '../../src/pages/api/analytics.json';

const call = () => (GET as unknown as (ctx: { request: Request }) => Promise<Response>)({ request: new Request('https://almstins.com/api/analytics.json') });

beforeEach(() => { state.session = null; state.realtime = null; });

describe('/api/analytics.json (live visitors)', () => {
	it('is not found for anyone but the owner', async () => {
		expect((await call()).status).toBe(404);
		state.session = { tenantId: 'some-tenant' };
		expect((await call()).status).toBe(404);
	});

	it('says unavailable when GA does not answer', async () => {
		state.session = { tenantId: 'owner-tenant' };
		const res = await call();
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, error: 'Google Analytics is not connected or did not answer.' });
	});

	it('returns the live numbers to the owner, uncached', async () => {
		state.session = { tenantId: 'owner-tenant' };
		state.realtime = { activeUsers: 1, countries: [{ country: 'Iran', activeUsers: 1 }], pages: [] };
		const res = await call();
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toEqual({ ok: true, activeUsers: 1, countries: [{ country: 'Iran', activeUsers: 1 }], pages: [] });
	});
});
