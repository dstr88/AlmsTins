import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/wallets/[id]/approvals: owner only (the real requireWalletOwnedByTenant over a stub
 * wallets table), Ethereum-family wallets only, answered from the 30-minute cache when it can be,
 * and limited per account. The chain reads are replaced by a stub; no network. Invented data.
 */

const state = vi.hoisted(() => ({
	tenant: 'tenant-a' as string | null,
	wallets: [] as Array<{ id: string; tenant_id: string; address: string }>,
	checks: 0,
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args?: unknown[] }) => {
			const args = stmt.args ?? [];
			if (/FROM wallets WHERE id = \? AND tenant_id = \?/i.test(stmt.sql)) {
				return { rows: state.wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]) };
			}
			return { rows: [] };
		},
	},
}));
vi.mock('@/lib/tursoCache', () => ({ getCache: async () => null, setCache: async () => {} }));
vi.mock('@/lib/requireTenantSession', () => ({
	requireTenantSession: async () => (state.tenant ? { tenantId: state.tenant, isDemo: false } : null),
}));
vi.mock('@/lib/approvals/index', () => ({
	checkWalletApprovals: async (walletId: string) => {
		state.checks += 1;
		return {
			ok: true,
			walletId,
			checkedAt: new Date().toISOString(),
			chains: [],
			approvals: [],
			counts: { total: 0, revokeFirst: 0, stillARisk: 0, unknown: 0 },
		};
	},
}));

const EVM_A = '0x1111111111111111111111111111111111111111';
const EVM_B = '0x2222222222222222222222222222222222222222';

async function get(id: string, query = '') {
	const { GET } = await import('../../src/pages/api/wallets/[id]/approvals');
	const res = await GET({ params: { id }, request: new Request(`https://app.test/api/wallets/${id}/approvals${query}`) } as never);
	return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
	state.tenant = 'tenant-a';
	state.checks = 0;
	state.wallets = [
		{ id: 'w-a', tenant_id: 'tenant-a', address: EVM_A },
		{ id: 'w-b', tenant_id: 'tenant-b', address: EVM_B },
		{ id: 'w-btc', tenant_id: 'tenant-a', address: 'bc1qexampleexampleexampleexampleexample0' },
	];
	const { _clearApprovalsCache } = await import('../../src/lib/approvals/cache');
	_clearApprovalsCache();
});

describe('GET /api/wallets/[id]/approvals', () => {
	it("refuses another account's wallet and reads nothing", async () => {
		const res = await get('w-b');
		expect(res.status).toBe(404);
		expect(state.checks).toBe(0);
	});

	it('refuses a signed-out request', async () => {
		state.tenant = null;
		expect((await get('w-a')).status).toBe(401);
		expect(state.checks).toBe(0);
	});

	it('refuses a wallet that is not Ethereum-family', async () => {
		const res = await get('w-btc');
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('NOT_EVM');
		expect(state.checks).toBe(0);
	});

	it("reads the owner's wallet once, then answers from the cache", async () => {
		const first = await get('w-a');
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ ok: true, walletId: 'w-a', cached: false });
		const second = await get('w-a');
		expect(second.body.cached).toBe(true);
		expect(state.checks).toBe(1);
	});

	it('?cached=1 never starts a check', async () => {
		const res = await get('w-a', '?cached=1');
		expect(res.body).toEqual({ ok: true, cached: false });
		expect(state.checks).toBe(0);
	});

	it('limits fresh checks per account', async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 14; i++) statuses.push((await get('w-a', '?refresh=1')).status);
		expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(12);
		expect(statuses).toContain(429);
	});
});
