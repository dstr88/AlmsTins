import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * While PetroTins is owner-only, the demo never shows it: GET /api/demo/start must not seed
 * the PetroTins tables and must not land a demo visitor on a PetroTins page, even when the
 * link asks for one with ?next=. A signed-in account is sent to the page the link named, but a
 * PetroTins page only for the owner. No database: '@/lib/db' records every statement.
 */
const state = vi.hoisted(() => ({
	sql: [] as string[],
	session: null as null | { user: { id: string }; tenantId?: string | null },
	resolvedTenantId: '' as string,
}));

vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string }) => {
			state.sql.push(typeof stmt === 'string' ? stmt : stmt.sql);
			return { rows: [], rowsAffected: 0 };
		},
		batch: async (stmts: Array<{ sql: string }>) => {
			for (const s of stmts) state.sql.push(s.sql);
			return [];
		},
	},
}));
vi.mock('../../src/lib/authSession', () => ({ getAuthSession: async () => state.session }));
vi.mock('../../src/lib/requireTenantSession', () => ({
	// An older token without a tenant ID: resolved like the gate does (here: to the owner).
	requireTenantSession: async () => (state.session ? { tenantId: state.resolvedTenantId } : null),
}));
vi.mock('../../src/lib/tursoCache', () => ({ setCache: async () => {} }));

import { GET } from '../../src/pages/api/demo/start';
import { GET as petroDemo } from '../../src/pages/api/petro-tins/demo';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

const start = async (query = '') => {
	const res = (await GET({
		request: new Request(`https://almstins.com/api/demo/start${query}`),
	} as never)) as Response;
	// Let the fire-and-forget seed steps settle before reading the recorded SQL.
	await new Promise((r) => setTimeout(r, 0));
	return res;
};
const petroSql = () => state.sql.filter((s) => /petro_/i.test(s));

beforeEach(() => {
	state.sql = [];
	state.session = null;
	state.resolvedTenantId = '';
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('demo start while PetroTins is owner-only', () => {
	it('a PetroTins ?next= lands the demo visitor on the vault, and nothing touches the PetroTins tables', async () => {
		const res = await start('?next=/dashboard/petro-tins');
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/dashboard/vault');
		expect(res.headers.get('Set-Cookie')).toContain('almstins-demo=1');
		expect(state.sql.length).toBeGreaterThan(0); // the ordinary demo seed still ran
		expect(petroSql()).toEqual([]);
	});

	it('an encoded or nested PetroTins ?next= is refused the same way', async () => {
		for (const next of ['/petro%2Dtins', '/dashboard/petro-tins/upgrade', '/petro-tins/docs?x=1', '/api/petro-tins']) {
			const res = await start(`?next=${encodeURIComponent(next)}`);
			expect(res.headers.get('Location'), next).toBe('/dashboard/vault');
		}
		expect(petroSql()).toEqual([]);
	});

	it('control: any other ?next= is kept', async () => {
		const res = await start('?next=/dashboard/verify');
		expect(res.headers.get('Location')).toBe('/dashboard/verify');
		const bare = await start();
		expect(bare.headers.get('Location')).toBe('/dashboard/vault');
	});

	it('a signed-in account that is not the owner goes to /dashboard instead of a PetroTins page', async () => {
		state.session = { user: { id: 'u-other' }, tenantId: '00000000-0000-4000-8000-000000000002' };
		const res = await start('?next=/dashboard/petro-tins');
		expect(res.headers.get('Location')).toBe('/dashboard');
		expect(res.headers.get('Set-Cookie')).toBeNull();
		expect((await start('?next=/dashboard/verify')).headers.get('Location')).toBe('/dashboard/verify');
		expect(state.sql).toEqual([]);
	});

	it('the owner signed in is sent to the PetroTins page the link named', async () => {
		state.session = { user: { id: 'u-owner' }, tenantId: OWNER_TENANT_ID };
		const res = await start('?next=/dashboard/petro-tins');
		expect(res.headers.get('Location')).toBe('/dashboard/petro-tins');
	});

	it('the owner on an older token without a tenant ID is resolved like the gate does', async () => {
		state.session = { user: { id: 'u-owner' }, tenantId: null };
		state.resolvedTenantId = OWNER_TENANT_ID;
		expect((await start('?next=/dashboard/petro-tins')).headers.get('Location')).toBe('/dashboard/petro-tins');
		state.resolvedTenantId = '00000000-0000-4000-8000-000000000002';
		expect((await start('?next=/dashboard/petro-tins')).headers.get('Location')).toBe('/dashboard');
	});

	it('the PetroTins demo link (reachable by the owner alone) keeps the owner signed in and opens the dashboard', async () => {
		const res = (await petroDemo({} as never)) as Response;
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('/dashboard/petro-tins');
		expect(res.headers.get('Set-Cookie')).toBeNull();
	});
});
