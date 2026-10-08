import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The PetroTins gate resolves the viewer with the real requireTenantSession, the same resolver
 * the PetroTins pages and endpoints use. A real session wins over a demo cookie, a demo cookie
 * alone is the demo tenant (refused), and an older token without a tenant ID falls back to the
 * database lookup. The owner checks outside the gate (nav, admin, demo start) use the same
 * resolution. Only the JWT decode and that lookup are stubbed; no database.
 */
const state = vi.hoisted(() => ({
	session: null as null | { user: { id: string }; tenantId?: string | null },
	activeTenantId: '' as string,
	lookupThrows: false,
}));

vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));
vi.mock('../../src/lib/authSession', () => ({
	getAuthSession: async () => state.session,
}));
vi.mock('../../src/lib/tenants', () => ({
	requireActiveTenantId: async () => {
		if (state.lookupThrows) throw new Error('database unavailable');
		return state.activeTenantId;
	},
}));

import { isPetroTinsOwnerSession, petroTinsGate, petroTinsRefusal } from '../../src/lib/petroTinsAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEMO_COOKIE = { cookie: 'almstins-demo=1' };

const gate = (path: string, headers: Record<string, string> = {}) =>
	petroTinsGate(new Request(`https://almstins.com${path}`, { headers }), path);
const HIDDEN_SIGNED_OUT = { kind: 'hidden', hasSession: false };
const HIDDEN_WITH_SESSION = { kind: 'hidden', hasSession: true };
const OWNER = { kind: 'owner' };

beforeEach(() => {
	state.session = null;
	state.activeTenantId = '';
	state.lookupThrows = false;
});

describe('PetroTins gate with the real session resolver', () => {
	it('hides PetroTins from a signed-out visitor; the demo cookie counts as a session (it goes through app.ts)', async () => {
		expect(await gate('/dashboard/petro-tins')).toEqual(HIDDEN_SIGNED_OUT);
		expect(await gate('/dashboard/petro-tins', DEMO_COOKIE)).toEqual(HIDDEN_WITH_SESSION);
		expect(await gate('/api/petro-tins/demo', DEMO_COOKIE)).toEqual(HIDDEN_WITH_SESSION);
	});

	it('lets the owner through, even with a leftover demo cookie', async () => {
		state.session = { user: { id: 'u-owner' }, tenantId: OWNER_TENANT_ID };
		expect(await gate('/dashboard/petro-tins')).toEqual(OWNER);
		expect(await gate('/api/petro-tins/receipts', DEMO_COOKIE)).toEqual(OWNER);
	});

	it('hides PetroTins from another signed-in account', async () => {
		state.session = { user: { id: 'u-other' }, tenantId: OTHER_TENANT_ID };
		expect(await gate('/petro-tins')).toEqual(HIDDEN_WITH_SESSION);
	});

	it('an older token without a tenant ID is resolved from the database, and fails closed', async () => {
		state.session = { user: { id: 'u-owner' }, tenantId: null };
		state.activeTenantId = OWNER_TENANT_ID;
		expect(await gate('/dashboard/petro-tins')).toEqual(OWNER);

		state.activeTenantId = OTHER_TENANT_ID;
		expect(await gate('/dashboard/petro-tins')).toEqual(HIDDEN_WITH_SESSION);

		// The lookup fails: requireTenantSession gives up (null), so the viewer is treated as
		// signed out and gets the 404 page directly.
		state.lookupThrows = true;
		expect(await gate('/dashboard/petro-tins')).toEqual(HIDDEN_SIGNED_OUT);
	});

	it('ignores every path that is not PetroTins', async () => {
		expect(await gate('/dashboard/vault')).toEqual({ kind: 'open' });
		expect(await gate('/petro')).toEqual({ kind: 'open' });
	});
});

describe("the 404 page pass is only ever Astro's 404 route for a request the gate refused", () => {
	it('a refused request, rendered as the 404 route, is the 404 page pass; any other render is refused again', async () => {
		const request = new Request('https://almstins.com/dashboard/petro-tins');
		expect(await petroTinsGate(request, '/dashboard/petro-tins', '/dashboard/petro-tins')).toEqual(HIDDEN_SIGNED_OUT);

		const refusal = petroTinsRefusal(request, false);
		expect(refusal.status).toBe(404);
		expect(refusal.body).toBeNull(); // Astro renders its 404 page for a bodiless 404

		expect(await petroTinsGate(request, '/dashboard/petro-tins', '/404')).toEqual({ kind: 'not-found-page', hasSession: false });
		// Not the 404 route: never let through, whatever the flag says.
		expect(await petroTinsGate(request, '/dashboard/petro-tins', '/dashboard/petro-tins')).toEqual(HIDDEN_SIGNED_OUT);
	});

	it('a request that was never refused gets no 404 page pass, even on the 404 route', async () => {
		// e.g. a PetroTins subpath with no page: Astro renders the 404 route directly.
		expect(await gate('/petro-tins/nope')).toEqual(HIDDEN_SIGNED_OUT);
		expect(
			await petroTinsGate(new Request('https://almstins.com/petro-tins/nope'), '/petro-tins/nope', '/404'),
		).toEqual(HIDDEN_SIGNED_OUT);
		// Another request object for the same URL as a refused one is judged on its own.
		petroTinsRefusal(new Request('https://almstins.com/dashboard/petro-tins'), true);
		expect(
			await petroTinsGate(new Request('https://almstins.com/dashboard/petro-tins'), '/dashboard/petro-tins', '/404'),
		).toEqual(HIDDEN_SIGNED_OUT);
	});

	it('remembers whether the refused viewer had a session', async () => {
		const request = new Request('https://almstins.com/api/petro-tins', { headers: DEMO_COOKIE });
		expect(await petroTinsGate(request, '/api/petro-tins')).toEqual(HIDDEN_WITH_SESSION);
		petroTinsRefusal(request, true);
		expect(await petroTinsGate(request, '/api/petro-tins', '/404')).toEqual({ kind: 'not-found-page', hasSession: true });
	});
});

describe('isPetroTinsOwnerSession: every owner check outside the gate agrees with it', () => {
	const req = new Request('https://almstins.com/dashboard/vault');

	it('reads the tenant from the token', async () => {
		expect(await isPetroTinsOwnerSession(req, { user: { id: 'u' }, tenantId: OWNER_TENANT_ID })).toBe(true);
		expect(await isPetroTinsOwnerSession(req, { user: { id: 'u' }, tenantId: OWNER_TENANT_ID.toUpperCase() })).toBe(true);
		expect(await isPetroTinsOwnerSession(req, { user: { id: 'u' }, tenantId: OTHER_TENANT_ID })).toBe(false);
	});

	it('resolves an older token without a tenant the way the gate does', async () => {
		state.session = { user: { id: 'u-owner' }, tenantId: null };
		state.activeTenantId = OWNER_TENANT_ID;
		expect(await isPetroTinsOwnerSession(req, state.session)).toBe(true);
		state.activeTenantId = OTHER_TENANT_ID;
		expect(await isPetroTinsOwnerSession(req, state.session)).toBe(false);
		state.lookupThrows = true;
		expect(await isPetroTinsOwnerSession(req, state.session)).toBe(false);
	});

	it('a demo or signed-out viewer is never the owner', async () => {
		expect(await isPetroTinsOwnerSession(new Request('https://almstins.com/', { headers: DEMO_COOKIE }), null)).toBe(false);
		expect(await isPetroTinsOwnerSession(req, null)).toBe(false);
		expect(await isPetroTinsOwnerSession(req, { user: null, tenantId: OWNER_TENANT_ID })).toBe(false);
	});
});
