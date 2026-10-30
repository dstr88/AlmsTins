import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetXprServerProofs } from '@/lib/xpr/client';
import { ALICE, BOB, NOW, chainServer, fakeFetch } from '../xpr/fixtures';

/**
 * Adding an XPR Network wallet.
 *
 * An account name is plain text (it has no shape that tells it from other input; '1abc' is a real
 * account that looks like a Bitcoin address), so an XPR wallet is added only with an explicit chain
 * choice (chains: ['xpr']), never by what the input looks like. The name must have the chain's
 * shape AND exist on the chain; when no server can say, the wallet is not added (503), never added
 * unchecked and never refused as "missing". The name is stored lowercase, once per tenant, with
 * the chains ['xpr'] and no EVM chain beside it. An XPR wallet's chain and name cannot be edited
 * into or out of it.
 *
 * Hermetic: '@/lib/db' is a small stub, the chain answers from a table. Invented names. No network.
 */

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const SERVER = 'https://proton.eosusa.io';

const state = vi.hoisted(() => ({ wallets: [] as Array<Record<string, unknown>>, calls: [] as Array<{ sql: string; args: unknown[] }>, chainDown: false }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
			state.calls.push({ sql, args });
			if (/^\s*SELECT COUNT/i.test(sql)) return { rows: [{ cnt: 0 }] };
			if (/SELECT id FROM wallets WHERE tenant_id = \? AND address = \?/i.test(sql)) {
				return { rows: state.wallets.filter((w) => w.tenant_id === args[0] && w.address === args[1]).map((w) => ({ id: w.id })) };
			}
			if (/SELECT address, chains FROM wallets WHERE id = \? AND tenant_id = \?/i.test(sql)) {
				return { rows: state.wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]) };
			}
			if (/^\s*INSERT INTO wallets/i.test(sql)) {
				const [tenant_id, address, label, chains, is_default] = args;
				const row = { id: `w-${state.wallets.length + 1}`, tenant_id, address, label, chains, is_default, wallet_type: 'onchain', created_at: '2026-10-30' };
				state.wallets.push(row);
				return { rows: [row] };
			}
			if (/^\s*UPDATE wallets SET/i.test(sql)) return { rows: [{ id: args.at(-2), address: 'x', label: 'x', chains: '[]', is_default: 0, created_at: '' }] };
			return { rows: [], rowsAffected: 0 };
		},
	},
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT, isDemo: false }) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: async () => {} }));
vi.mock('@/lib/subscriptions', () => ({ checkWalletLimit: async () => ({ allowed: true }) }));
vi.mock('@/lib/walletOwnerLabel', () => ({
	OWNER_LABEL_MAX: 60,
	ownerLabelDemoBlocked: () => false,
	ownerLabelDemoResponse: () => new Response('demo', { status: 403 }),
	ownerLabelWriteAllowed: () => true,
	parseOwnerLabel: () => ({ ok: true, value: null }),
	removeWalletIdentity: async () => {},
	writeWalletOwnerLabel: async () => {},
}));

const EXISTING = new Set([ALICE, BOB, '1abc']);
function installChain() {
	const chain = chainServer({
		'/v1/chain/get_account': (b) =>
			EXISTING.has(b.account_name)
				? { json: { account_name: b.account_name } }
				: { status: 400, json: { code: 400, message: 'Account lookup', error: { code: 3060002, name: 'account_query_exception' } } },
	});
	const { fetchImpl } = fakeFetch({ [SERVER]: (path, init) => (state.chainDown ? new Error('connect ECONNREFUSED') : chain(path, init)) });
	vi.stubGlobal('fetch', fetchImpl);
}

const post = async (body: unknown) => {
	const { POST } = await import('../../src/pages/api/wallets');
	const res = await POST({ request: new Request('https://app.test/api/wallets', { method: 'POST', body: JSON.stringify(body) }) } as never);
	return { status: res.status, body: await res.json() };
};
const patch = async (id: string, body: unknown) => {
	const { PATCH } = await import('../../src/pages/api/wallets/[id]');
	const res = await PATCH({ params: { id }, request: new Request('https://app.test/x', { method: 'PATCH', body: JSON.stringify(body) }) } as never);
	return { status: res.status, body: await res.json() };
};

beforeEach(() => {
	vi.resetModules();
	resetXprServerProofs();
	// The servers' answers carry their own clock (the freshness check): freeze ours at the recorded moment.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	state.wallets = [];
	state.calls = [];
	state.chainDown = false;
	installChain();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('POST /api/wallets with the XPR Network chain', () => {
	it('adds an account that exists on the chain: the name, lowercase, tagged xpr, labeled by its name', async () => {
		const { status, body } = await post({ address: ` ${ALICE.toUpperCase()} `, chains: ['xpr'] });

		expect(status).toBe(201);
		expect(body).toMatchObject({ address: ALICE, label: ALICE, chains: ['xpr'] });
		expect(state.wallets).toHaveLength(1);
		expect(state.wallets[0]).toMatchObject({ tenant_id: TENANT, address: ALICE, chains: JSON.stringify(['xpr']) });
	});

	it('takes the label the owner gave it', async () => {
		const { body } = await post({ address: ALICE, chains: ['xpr'], label: 'Main XPR' });
		expect(body.label).toBe('Main XPR');
	});

	it('the symbol-typed alias "proton" is the same chain', async () => {
		const { status, body } = await post({ address: ALICE, chains: ['proton'] });
		expect(status).toBe(201);
		expect(body.chains).toEqual(['xpr']);
	});

	it('refuses a name no account has, and stores nothing', async () => {
		const { status, body } = await post({ address: 'testnobody1', chains: ['xpr'] });

		expect(status).toBe(400);
		expect(body.message).toBe('No XPR Network account has that name.');
		expect(state.wallets).toHaveLength(0);
	});

	it('refuses what is not shaped like a name, without asking the chain', async () => {
		const { fetchImpl, calls } = fakeFetch({ [SERVER]: chainServer({}) });
		vi.stubGlobal('fetch', fetchImpl);
		for (const bad of ['0x' + 'ab'.repeat(20), 'has space', 'abc.', 'x'.repeat(14), '']) {
			const { status } = await post({ address: bad, chains: ['xpr'] });
			expect(status, bad).toBe(400);
		}
		expect(calls).toHaveLength(0);
		expect(state.wallets).toHaveLength(0);
	});

	it('when no server can say whether the account exists, it is not added: 503, never added unchecked', async () => {
		state.chainDown = true;
		const { status, body } = await post({ address: ALICE, chains: ['xpr'] });

		expect(status).toBe(503);
		expect(body.message).toMatch(/could not be reached/);
		expect(state.wallets).toHaveLength(0);
	});

	it('is added on its own: not together with an EVM chain', async () => {
		const { status } = await post({ address: ALICE, chains: ['xpr', 'ethereum'] });
		expect(status).toBe(400);
		expect(state.wallets).toHaveLength(0);
	});

	it('is a duplicate the second time, for this tenant only', async () => {
		state.wallets.push({ id: 'w-theirs', tenant_id: OTHER, address: ALICE, chains: JSON.stringify(['xpr']) });
		expect((await post({ address: ALICE, chains: ['xpr'] })).status).toBe(201);
		const again = await post({ address: ALICE, chains: ['xpr'] });

		expect(again.status).toBe(409);
		expect(again.body).toMatchObject({ code: 'DUPLICATE_ADDRESS' });
		expect(state.wallets.filter((w) => w.tenant_id === TENANT)).toHaveLength(1);
	});

	it('a name that looks like a Bitcoin address is XPR when the chain is chosen', async () => {
		const { status, body } = await post({ address: '1abc', chains: ['xpr'] });
		expect(status).toBe(201);
		expect(body).toMatchObject({ address: '1abc', chains: ['xpr'] });
	});

	it('without the chain choice a bare name is not an XPR wallet: it is refused like any other bad address', async () => {
		const { status } = await post({ address: ALICE });
		expect(status).toBe(400);
		expect(state.wallets).toHaveLength(0);
	});
});

describe('PATCH /api/wallets/[id] on an XPR wallet', () => {
	const seed = () =>
		state.wallets.push(
			{ id: 'w-xpr', tenant_id: TENANT, address: ALICE, chains: JSON.stringify(['xpr']), label: 'x' },
			{ id: 'w-evm', tenant_id: TENANT, address: '0x' + 'ab'.repeat(20), chains: JSON.stringify(['ethereum']), label: 'y' },
		);
	const updates = () => state.calls.filter((c) => /^\s*UPDATE wallets/i.test(c.sql));

	it('cannot be moved to another chain', async () => {
		seed();
		const { status, body } = await patch('w-xpr', { chains: ['ethereum'] });

		expect(status).toBe(400);
		expect(body.message).toMatch(/cannot be changed into another chain/);
		expect(updates()).toHaveLength(0);
	});

	it('cannot be given another account name', async () => {
		seed();
		expect((await patch('w-xpr', { address: BOB })).status).toBe(400);
		expect(updates()).toHaveLength(0);
	});

	it('an EVM wallet cannot be turned into an XPR one (its address is no account name)', async () => {
		seed();
		expect((await patch('w-evm', { chains: ['xpr'] })).status).toBe(400);
		expect((await patch('w-evm', { chains: ['xpr'], address: ALICE })).status).toBe(400);
		expect(updates()).toHaveLength(0);
	});

	it('saving the unchanged name and chain (an edit form) works, and renames', async () => {
		seed();
		const { status } = await patch('w-xpr', { address: ALICE.toUpperCase(), chains: ['xpr'], label: 'Renamed' });

		expect(status).toBe(200);
		expect(updates()).toHaveLength(1);
		expect(updates()[0].sql).not.toMatch(/address = \?/);
		expect(updates()[0].sql).toMatch(/label = \?/);
	});

	it('a plain EVM edit still goes through', async () => {
		seed();
		expect((await patch('w-evm', { address: '0x' + 'cd'.repeat(20) })).status).toBe(200);
		expect(updates()).toHaveLength(1);
	});
});
