import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The owner's health check tests both database logins. On 2026-10-10 WEB_DATABASE_URL (every
 * signed-in page) still held a deleted credential while DATABASE_URL (public pages) worked,
 * and nothing reported it. It also no longer expects settings nothing reads (Turso, the
 * per-chain Aave subgraph URLs), which kept it permanently "not ok".
 */

const state = vi.hoisted(() => ({ webFails: false, inContext: false }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: 'owner-tenant' }) }));
vi.mock('@/lib/owner', () => ({ isOwner: () => true }));
vi.mock('@/lib/scanSync', () => ({ fetchAccountData: async () => ({ status: '1', message: 'OK', result: '0' }) }));
vi.mock('@/lib/dbContext', () => ({
	runWithDbContext: async (_ctx: unknown, fn: () => Promise<unknown>) => {
		state.inContext = true;
		try { return await fn(); } finally { state.inContext = false; }
	},
}));
vi.mock('@/lib/db', () => ({
	db: {
		execute: async () => {
			if (state.inContext && state.webFails) throw new Error('password authentication failed for user "old"');
			return { rows: [{ '?column?': 1 }] };
		},
	},
}));

import { GET } from '../../src/pages/api/debug/health';

const call = async () => {
	const res = await (GET as unknown as (ctx: { request: Request }) => Promise<Response>)({ request: new Request('https://almstins.com/api/debug/health') });
	return { status: res.status, body: await res.json() };
};

beforeEach(() => {
	state.webFails = false;
	for (const k of ['ETHERSCAN_API_KEY', 'SNOWTRACE_API_KEY', 'AAVE_V3_SUBGRAPH_API_KEY']) vi.stubEnv(k, 'set');
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('/api/debug/health', () => {
	it('is ok with both database logins working and no stale settings expected', async () => {
		const { status, body } = await call();
		expect(body.envVars).not.toHaveProperty('TURSO_DATABASE_URL');
		expect(body.envVars).not.toHaveProperty('AAVE_V3_SUBGRAPH_ETHEREUM');
		expect(body.webDb).toBe('ok');
		expect(body.ok).toBe(true);
		expect(status).toBe(200);
	});

	it('fails when the signed-in pages\' database login fails, even if the other works', async () => {
		state.webFails = true;
		const { status, body } = await call();
		expect(body.db).toBe('ok');
		expect(body.webDb).toBe('fail');
		expect(body.ok).toBe(false);
		expect(status).toBe(500);
	});
});
