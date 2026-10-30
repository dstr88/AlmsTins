/**
 * The January 1, 2025 positions (src/lib/tax/openingPositions.ts) and the owner-only route that
 * shows them and saves an allocation (src/pages/api/yearEnd/opening-positions.ts).
 *
 *   - The positions are the units each wallet held at the end of 2024, with the lots that make
 *     them up, and they add up to the history: units per wallet equal what the quantity ledger
 *     has, and the cost carried in equals the cost of the lots left at the end of 2024.
 *   - Anything that did not reconcile is listed, with a code, for the owner to look at.
 *   - An allocation is checked against the history before it is stored; a bad one is refused,
 *     stores nothing, and leaves the rebuilt positions in force.
 *   - Coins that left a wallet in a transfer fee are taken from that wallet's own lots, so what a
 *     wallet is recorded as holding never exceeds its balance by the fee.
 *
 * Invented amounts and addresses; the database is mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLotLedger, type LedgerEvent } from '../../src/lib/tax/lotLedger';
import { openingPositionsOf } from '../../src/lib/tax/openingPositions';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

const state = vi.hoisted(() => ({
	session: { tenantId: '' } as { tenantId: string } | null,
	saved: [] as Record<string, unknown>[],
	batches: [] as { sql: string; args: unknown[] }[][],
	clearedPrefixes: [] as string[],
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/authSession', () => ({ getAuthSession: async () => (state.session ? { user: { id: 'user-1' } } : null) }));
vi.mock('@/lib/taxAuth', () => ({ requireTaxOwner: async () => null }));
vi.mock('@/lib/tursoCache', () => ({
	getCache: async () => ({ value: null }),
	setCache: async () => {},
	deleteCachePrefix: async (p: string) => { state.clearedPrefixes.push(p); },
}));

const WALLET = `0x${'a'.repeat(40)}`;
const FAR = `0x${'f'.repeat(40)}`;
const HASH = `0x${'1'.repeat(64)}`;

vi.mock('@/lib/db', () => {
	const lifecycle = () => {
		const base = { asset_symbol: 'ETH', group_id: 'g-eth', tx_hash: null as string | null };
		const chain = { tx_wallet_id: 'w1', tx_chain: 'ethereum' };
		return [
			{ ...base, direction: 'in', amount: 1, native_usd: 2_000, timestamp_utc: '2023-01-10T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
			{ ...base, direction: 'in', amount: 1, native_usd: 3_000, timestamp_utc: '2023-03-01T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-2', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
			{ ...base, direction: 'out', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:00:00Z', transaction_class: 'other', source_id: 'send-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1', tx_hash: HASH },
			{ ...base, ...chain, direction: 'in', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:30:00Z', transaction_class: 'owned_acquisition', source_id: 'arrive-1', source_type: 'onchain', from_address: FAR, to_address: WALLET, tx_hash: HASH },
			{ ...base, ...chain, direction: 'out', amount: 1, native_usd: 4_000, timestamp_utc: '2023-11-01T00:00:00Z', transaction_class: 'other', source_id: 'pay-1', source_type: 'onchain', from_address: WALLET, to_address: FAR, tx_hash: `0x${'2'.repeat(64)}` },
			{ ...base, direction: 'out', amount: 0.5, native_usd: 1_500, timestamp_utc: '2024-04-01T00:00:00Z', transaction_class: 'other', source_id: 'sell-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Sell', import_account_id: 'acct-1' },
		];
	};
	const execute = vi.fn(async ({ sql, args }: { sql: string; args: unknown[] }) => {
		if (sql.includes('/* tax:source */')) return { rows: [] };
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) return { rows: lifecycle() };
		if (sql.includes('/* tax:wallets */')) return { rows: [{ id: 'w1', address: WALLET }] };
		if (sql.includes('/* tax:allocation-overrides */')) return { rows: state.saved.filter((r) => r.tenant_id === args[0]) };
		return { rows: [] };
	});
	const batch = vi.fn(async (stmts: { sql: string; args: unknown[] }[]) => { state.batches.push(stmts); return []; });
	return { db: { execute, batch } };
});

import * as route from '../../src/pages/api/yearEnd/opening-positions';

const call = (method: 'GET' | 'POST' | 'DELETE', body?: unknown, query = '') => {
	const url = new URL(`https://almstins.com/api/yearEnd/opening-positions${query}`);
	const request = new Request(url, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
	return (route as unknown as Record<string, (c: unknown) => Promise<Response>>)[method]({ request, url });
};

beforeEach(() => {
	state.session = { tenantId: OWNER_TENANT_ID };
	state.saved = [];
	state.batches = [];
	state.clearedPrefixes = [];
});

// ── The positions ────────────────────────────────────────────────────────────

describe('what the page shows for the end of 2024', () => {
	it('lists the wallet that holds the coin, the lot in it, and how it got there', async () => {
		const res = await call('GET');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, enabled: true, from: '2025-01-01', needsReview: [] });
		expect(body.assets).toHaveLength(1);
		const eth = body.assets[0];
		expect(eth).toMatchObject({ asset: 'ETH', source: 'reconstruction', overrideRejected: false, totalUnits: 0.5, totalCostUsd: 1_500 });
		expect(eth.wallets).toHaveLength(1);
		expect(eth.wallets[0]).toMatchObject({ walletKey: 'cex:coinbase:acct-1', units: 0.5, costUsd: 1_500 });
		expect(eth.wallets[0].lots).toEqual([expect.objectContaining({ qty: 0.5, costUsd: 1_500, pass: 'origin' })]);
	});

	it('adds up to the history: the cost carried in is the cost of the lots left at the end of 2024', async () => {
		const eth = (await (await call('GET')).json()).assets[0];
		const carried = eth.unused.reduce((a: number, u: { costUsd: number }) => a + u.costUsd, 0);
		expect(eth.totalCostUsd).toBe(carried);
		expect(eth.totalUnits).toBe(eth.unused.reduce((a: number, u: { qty: number }) => a + u.qty, 0));
	});

	it('answers an account outside the rollout with nothing to show', async () => {
		state.session = { tenantId: 'tenant-not-owner' };
		const body = await (await call('GET')).json();
		expect(body).toMatchObject({ ok: true, enabled: false, assets: [] });
	});
});

describe('what needs a look', () => {
	it('lists units a wallet holds with no cost on record, and negative balances, by code', () => {
		const W1 = 'ethereum:0xaaa';
		const W2 = 'ethereum:0xbbb';
		const events: LedgerEvent[] = [
			{ kind: 'acquire', id: 'a', asset: 'ETH', wallet: W1, at: '2023-01-10T00:00:00Z', qty: 1, costUsd: 100, origin: 'purchase', sourceRef: 'src:a' },
			// W2 received 2 and sent on 3: it sent more than it ever recorded.
			{ kind: 'move', id: 'm1', asset: 'ETH', fromWallet: W1, toWallet: W2, outAt: '2023-02-01T00:00:00Z', inAt: '2023-02-01T00:10:00Z', qtyOut: 1, qtyIn: 1, link: 'hash', ownersDiffer: false, outRef: 'm1:out', inRef: 'm1:in' },
			{ kind: 'dispose', id: 'd', asset: 'ETH', wallet: W2, at: '2024-06-01T00:00:00Z', qty: 3, proceedsUsd: 600, taxable: true, category: 'sell', sourceRef: 'src:d' },
		];
		const result = runLotLedger(events, { perWalletFrom: '2025-01-01' });
		const out = openingPositionsOf(result, [], '2025-01-01');
		const gaps = out.assets.flatMap((a) => a.gaps.map((g) => g.detail));
		expect(gaps).toContain('negative_balance');
		expect(out.needsReview).toEqual(out.assets.filter((a) => a.gaps.length).map((a) => a.asset));
		for (const a of out.assets) for (const g of a.gaps) expect(g.detail === null || /^[a-z_]+$/.test(g.detail)).toBe(true);
	});
});

// ── The allocation ───────────────────────────────────────────────────────────

describe('entering your own allocation', () => {
	const mine = { asset: 'ETH', rows: [{ walletKey: 'cex:coinbase:acct-1', lotAcquiredAt: '2023-03-01T00:00:00Z', quantity: 0.5, costBasisUsd: 1_500, note: 'from my own records' }] };

	it('stores an allocation that matches the history, in one batch for the tenant, and clears what was computed', async () => {
		const res = await call('POST', mine);
		expect(res.status).toBe(200);
		expect(state.batches).toHaveLength(1);
		expect(state.batches[0][0].args).toEqual([OWNER_TENANT_ID, 'ETH']);
		expect(state.clearedPrefixes).toEqual([`t:${OWNER_TENANT_ID}:`]);
	});

	it('refuses one that puts the units in a different place than the history has them, and stores nothing', async () => {
		const res = await call('POST', { ...mine, rows: [{ ...mine.rows[0], walletKey: `ethereum:${WALLET}` }] });
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ ok: false, error: 'allocation_rejected', detail: 'units_mismatch' });
		expect(state.batches).toEqual([]);
		expect(state.clearedPrefixes).toEqual([]);
	});

	it('refuses one that draws on a lot that is not there', async () => {
		const res = await call('POST', { ...mine, rows: [{ ...mine.rows[0], lotAcquiredAt: '2019-05-05T00:00:00Z' }] });
		expect(res.status).toBe(422);
		expect(state.batches).toEqual([]);
	});

	it('refuses malformed input before it looks at the history', async () => {
		expect((await call('POST', { asset: 'ETH', rows: [] })).status).toBe(400);
		expect((await call('POST', { asset: 'not a coin!', rows: mine.rows })).status).toBe(400);
		expect(state.batches).toEqual([]);
	});

	it('is not available to an account outside the rollout', async () => {
		state.session = { tenantId: 'tenant-not-owner' };
		expect((await call('POST', mine)).status).toBe(409);
		expect(state.batches).toEqual([]);
	});

	it('takes the tenant from the session, never from the body', async () => {
		await call('POST', { ...mine, tenantId: 'someone-else' });
		for (const stmt of state.batches[0]) expect(stmt.args).not.toContain('someone-else');
	});

	it('removing a saved allocation is scoped to the tenant and the coin', async () => {
		const res = await call('DELETE', undefined, '?asset=ETH');
		expect(res.status).toBe(200);
		const { db } = await import('../../src/lib/db');
		const del = (db.execute as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).find((s: { sql: string }) => /DELETE FROM tax_wallet_allocation_override/.test(s.sql));
		expect(del.args).toEqual([OWNER_TENANT_ID, 'ETH']);
		expect((await call('DELETE', undefined, '?asset=')).status).toBe(400);
	});
});

// ── Fees ─────────────────────────────────────────────────────────────────────

describe('coins that left in a transfer fee', () => {
	it('come out of the wallet that sent them, so no wallet holds more than its balance', () => {
		const A = 'cex:coinbase:acct-1';
		const B = 'ethereum:0xbbb';
		const result = runLotLedger(
			[
				{ kind: 'acquire', id: 'a1', asset: 'ETH', wallet: A, at: '2023-01-10T00:00:00Z', qty: 1, costUsd: 2_000, origin: 'purchase', sourceRef: 'src:a1' },
				{ kind: 'acquire', id: 'a2', asset: 'ETH', wallet: A, at: '2023-06-01T00:00:00Z', qty: 1, costUsd: 3_000, origin: 'purchase', sourceRef: 'src:a2' },
				// 1 left the account, 0.999 arrived: 0.001 went to the network.
				{ kind: 'move', id: 'mv', asset: 'ETH', fromWallet: A, toWallet: B, outAt: '2025-02-01T00:00:00Z', inAt: '2025-02-01T00:30:00Z', qtyOut: 1, qtyIn: 0.999, link: 'hash', ownersDiffer: false, outRef: 'mv:out', inRef: 'mv:in' },
			],
			{ perWalletFrom: '2025-01-01', snapshotsAt: ['2025-12-31T23:59:59.999Z'] },
		);
		const held = new Map<string, number>();
		for (const l of result.snapshots[0].lots) held.set(l.wallet, (held.get(l.wallet) ?? 0) + l.qty);
		expect(held.get(A)).toBeCloseTo(1, 9);
		expect(held.get(B)).toBeCloseTo(0.999, 9);
		const fee = result.findings.find((f) => f.reason === 'transfer_fee_units');
		expect(fee).toMatchObject({ wallet: A, toWallet: B });
		expect(fee?.qty).toBeCloseTo(0.001, 9);
		// Listed for review, not booked as a sale.
		expect(result.slices.filter((s) => s.taxable)).toEqual([]);
	});
});
