import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as addAssetTin from '@/i18n/components/addAssetTin';
import * as accountErrors from '@/i18n/apiErrors/account';

/**
 * New custom wallets can no longer be added.
 *
 * The Vault's Add Asset box has no Custom tab, and POST /api/wallets refuses walletType 'custom'
 * with a 400 before it writes anything. A custom wallet made before then keeps working: it is
 * listed, the Vault still has its "Custom Wallets" section, and it can still be deleted.
 *
 * Hermetic: '@/lib/db' is a small stub over an in-memory wallets table. No network.
 */

const TENANT = 'tenant-a';
const CUSTOM_ID = 'w-custom';
const CUSTOM_ADDRESS = 'custom_0123456789abcdef0123456789abcdef';
const EVM = '0x1111111111111111111111111111111111111111';

const state = vi.hoisted(() => ({
	wallets: [] as Array<Record<string, unknown>>,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	plan: { allowed: true } as Record<string, unknown>,
}));

vi.mock('@/lib/db', () => {
	const execute = async (stmt: string | { sql: string; args?: unknown[] }) => {
		const sql = typeof stmt === 'string' ? stmt : stmt.sql;
		const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
		state.calls.push({ sql, args });
		if (/^\s*SELECT COUNT/i.test(sql)) return { rows: [{ cnt: state.wallets.length }] };
		if (/SELECT id FROM wallets WHERE tenant_id = \? AND address = \?/i.test(sql)) {
			return { rows: state.wallets.filter((w) => w.tenant_id === args[0] && w.address === args[1]).map((w) => ({ id: w.id })) };
		}
		if (/^\s*SELECT .* FROM wallets WHERE tenant_id = \?/i.test(sql)) {
			return { rows: state.wallets.filter((w) => w.tenant_id === args[0]) };
		}
		if (/^\s*INSERT INTO wallets/i.test(sql)) {
			const [tenant_id, address, label, chains, is_default] = args;
			const wallet_type = /'custom'/.test(sql) ? 'custom' : 'onchain';
			const row = { id: `w-${state.wallets.length + 1}`, tenant_id, address, label, chains, is_default, wallet_type, created_at: '2026-11-25' };
			state.wallets.push(row);
			return { rows: [row] };
		}
		if (/^\s*DELETE FROM wallets WHERE id = \? AND tenant_id = \?/i.test(sql)) {
			const gone = state.wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]);
			state.wallets = state.wallets.filter((w) => !gone.includes(w));
			return { rows: gone.map((w) => ({ id: w.id, address: w.address })) };
		}
		return { rows: [], rowsAffected: 0 };
	};
	return {
		db: {
			execute,
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => Promise.all(stmts.map((s) => execute(s))),
		},
	};
});
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT, isDemo: false }) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: async () => {} }));
vi.mock('@/lib/subscriptions', () => ({ checkWalletLimit: async () => state.plan }));
vi.mock('@/lib/walletOwnerLabel', () => ({
	OWNER_LABEL_MAX: 60,
	ownerLabelDemoBlocked: () => false,
	ownerLabelDemoResponse: () => new Response('demo', { status: 403 }),
	ownerLabelWriteAllowed: () => true,
	parseOwnerLabel: () => ({ ok: true, value: null }),
	removeWalletIdentity: async () => {},
	writeWalletOwnerLabel: async () => {},
}));

const post = async (body: unknown, cookie?: string) => {
	const { POST } = await import('../../src/pages/api/wallets');
	const headers: Record<string, string> = cookie ? { cookie } : {};
	const res = await POST({ request: new Request('https://app.test/api/wallets', { method: 'POST', headers, body: JSON.stringify(body) }) } as never);
	return { status: res.status, body: await res.json() };
};
const insertCalls = () => state.calls.filter((c) => /^\s*INSERT INTO wallets/i.test(c.sql));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

beforeEach(() => {
	vi.resetModules();
	state.calls = [];
	state.plan = { allowed: true };
	// The one custom wallet made before the change: hand entries only, a placeholder address.
	state.wallets = [
		{ id: CUSTOM_ID, tenant_id: TENANT, address: CUSTOM_ADDRESS, label: 'CashApp', chains: '[]', is_default: 0, wallet_type: 'custom', created_at: '2026-01-02' },
	];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the Add Asset box has no Custom tab', () => {
	const source = read('../../src/components/dashboard/AddAssetTin.astro');

	it('keeps the Wallet and Exchange tabs and has no Custom tab, panel or submit script', () => {
		expect(source).toContain('data-add-tab="wallet"');
		expect(source).toContain('data-add-tab="exchange"');
		expect(source).not.toContain('data-add-tab="custom"');
		expect(source).not.toContain('data-add-panel="custom"');
		expect(source).not.toMatch(/data-custom-(label|address|submit|message)/);
		expect(source).not.toMatch(/walletType:\s*'custom'/);
	});

	it('no language keeps the strings only the Custom tab used', () => {
		const gone = ['tabCustom', 'customHint', 'btnSaveCustom', 'customPlaceholderLabel', 'customPlaceholderAddress', 'labelRequired', 'planLimitCustom', 'savedReloading'];
		for (const locale of [addAssetTin.en, addAssetTin.es, addAssetTin.fr]) {
			for (const key of gone) expect(locale, `${locale.lang}.${key}`).not.toHaveProperty(key);
		}
	});
});

describe('POST /api/wallets refuses a new custom wallet', () => {
	it('answers 400 with a clear message and writes nothing', async () => {
		const { status, body } = await post({ walletType: 'custom', label: 'Paper wallet' });

		expect(status).toBe(400);
		expect(body).toMatchObject({ error: true, code: 'CUSTOM_WALLETS_CLOSED', message: accountErrors.getAccountErrors('en').customWalletClosed });
		expect(insertCalls()).toHaveLength(0);
		expect(state.wallets).toHaveLength(1);
	});

	it('refuses it with an address too', async () => {
		const { status } = await post({ walletType: 'custom', label: 'Ledger', address: EVM });
		expect(status).toBe(400);
		expect(insertCalls()).toHaveLength(0);
	});

	it('says so even when the plan limit is reached, rather than asking for an upgrade', async () => {
		state.plan = { allowed: false, message: 'Plan limit reached', current: 1, limit: 1, plan: { id: 'free' } };
		const { status, body } = await post({ walletType: 'custom', label: 'Ledger' });
		expect(status).toBe(400);
		expect(body.code).toBe('CUSTOM_WALLETS_CLOSED');
	});

	it('answers in the language the person chose', async () => {
		const es = await post({ walletType: 'custom', label: 'x' }, 'almstins-lang=es');
		const fr = await post({ walletType: 'custom', label: 'x' }, 'almstins-lang=fr');
		expect(es.body.message).toBe(accountErrors.getAccountErrors('es').customWalletClosed);
		expect(fr.body.message).toBe(accountErrors.getAccountErrors('fr').customWalletClosed);
	});

	it('every language has the message', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			expect(accountErrors.getAccountErrors(lang).customWalletClosed.trim().length, lang).toBeGreaterThan(0);
		}
	});

	it('still adds an on-chain wallet', async () => {
		const { status, body } = await post({ address: EVM, chains: ['ethereum'] });
		expect(status).toBe(201);
		expect(body).toMatchObject({ address: EVM });
		expect(insertCalls()).toHaveLength(1);
		expect(insertCalls()[0].sql).toMatch(/'onchain'/);
	});
});

describe('a custom wallet made before the change keeps working', () => {
	it('is still listed, as a custom wallet', async () => {
		const { GET } = await import('../../src/pages/api/wallets');
		const res = await GET({ request: new Request('https://app.test/api/wallets') } as never);
		expect(res.status).toBe(200);
		const wallets = await res.json();
		expect(wallets).toEqual([expect.objectContaining({ id: CUSTOM_ID, label: 'CashApp', walletType: 'custom' })]);
	});

	it('the Vault still shows the Custom Wallets section with its card', () => {
		const vault = read('../../src/pages/dashboard/vault.astro');
		expect(vault).toMatch(/customWallets\s*=\s*walletsSorted\.filter\(\(w\) => w\.walletType === 'custom'\)/);
		expect(vault).toContain('<CustomWalletCard wallet={wallet} />');
	});

	it('can still be deleted, with its hand entries', async () => {
		const { DELETE } = await import('../../src/pages/api/wallets/[id]');
		const res = await DELETE({ params: { id: CUSTOM_ID }, request: new Request('https://app.test/api/wallets/' + CUSTOM_ID, { method: 'DELETE' }) } as never);

		expect(res.status).toBe(204);
		expect(state.wallets).toHaveLength(0);
		const txDelete = state.calls.find((c) => /^\s*DELETE FROM transactions WHERE wallet_id = \?/i.test(c.sql));
		expect(txDelete?.args).toEqual([CUSTOM_ID, TENANT]);
	});
});
