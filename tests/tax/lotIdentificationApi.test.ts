/**
 * The owner-only routes behind the identifications page (src/pages/api/lot-identifications/*).
 *
 *   - Anyone but the owner gets the generic 404 and nothing is read.
 *   - A tenant outside the wallet-by-wallet rollout cannot record.
 *   - The tenant comes from the session: a tenantId in the body is ignored, and only the tenant's own
 *     wallet keys can be named.
 *   - Apply to all writes one entry per wallet key with one server time; a backdated effective time is
 *     refused with nothing stored; created-at cannot be supplied.
 *   - The computed figures and caches are dropped after a write.
 *
 * Invented ids and wallet keys; every data-layer module is a stub.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	owner: 'tenant-owner',
	enabled: true,
	created: [] as { tenantId: string; raw: unknown; source: string }[],
	stamped: [] as unknown[],
	invalidated: [] as string[],
	cleared: [] as string[],
	reads: 0,
	groups: [
		{ id: 'cex:coinbase:acct-a', kind: 'exchange', display: 'Coinbase · Account #1', ownerLabel: null, keys: ['cex:coinbase:acct-a'], exchangeHeld: true },
		{ id: '0x' + 'a'.repeat(40), kind: 'onchain', display: 'Cold wallet', ownerLabel: null, keys: ['ethereum:0x' + 'a'.repeat(40), 'polygon:0x' + 'a'.repeat(40)], exchangeHeld: false },
	],
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/taxAuth', async () => {
	const json = (s: number) => new Response(JSON.stringify({ error: 'Not found' }), { status: s, headers: { 'Content-Type': 'application/json' } });
	return {
		requireTaxOwner: async () => {
			state.reads += 0;
			return state.session && !state.session.isDemo && state.session.tenantId === state.owner ? null : json(404);
		},
	};
});
vi.mock('@/lib/tax/computeLedger', () => ({
	perWalletEnabled: async () => state.enabled,
	invalidateLedger: (t: string) => { state.invalidated.push(t); },
}));
vi.mock('@/lib/lotIdentificationWallets', () => ({ loadWalletGroups: async () => { state.reads++; return state.groups; } }));
vi.mock('@/lib/lotIdentificationState', () => ({
	loadIdentificationState: async (t: string) => { state.reads++; return { groups: [], entries: [], undecidedCount: 0, applyAllMethod: null, tenant: t }; },
}));
vi.mock('@/lib/lotIdentificationStamp', () => ({
	stampBatch: async (_t: string, entries: unknown) => { state.stamped.push(entries); return { status: 'pending' }; },
	refreshAll: async () => new Map(),
	loadStamps: async () => new Map(),
}));
vi.mock('@/lib/tursoCache', () => ({ deleteCachePrefix: async (p: string) => { state.cleared.push(p); } }));
vi.mock('@/lib/lotIdentificationStore', async () => {
	const real = await vi.importActual<typeof import('../../src/lib/tax/lotIdentification')>('../../src/lib/tax/lotIdentification');
	return {
		createIdentifications: async (tenantId: string, raw: unknown, source: string) => {
			const createdAt = '2025-06-01T10:00:00.000Z';
			const parsed = real.parseNewEntries(raw, createdAt);
			if (!parsed.ok) return parsed;
			state.created.push({ tenantId, raw, source });
			return { ok: true, batchId: 'b1', createdAt, entries: parsed.entries.map((e, i) => ({ ...e, id: `e${i}`, createdAt, batchId: 'b1' })) };
		},
		confirmWithExchange: async () => true,
		loadIdentifications: async () => [],
	};
});

import * as index from '../../src/pages/api/lot-identifications/index';
import * as confirm from '../../src/pages/api/lot-identifications/confirm';
import * as refresh from '../../src/pages/api/lot-identifications/refresh';
import * as proof from '../../src/pages/api/lot-identifications/proof';

type Handler = (c: unknown) => Promise<Response>;
const call = (mod: unknown, method: 'GET' | 'POST', body?: unknown, query = '') => {
	const url = new URL(`https://almstins.com/api/lot-identifications${query}`);
	const request = new Request(url, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
	return (mod as Record<string, Handler>)[method]({ request, url });
};

beforeEach(() => {
	state.session = { tenantId: state.owner };
	state.enabled = true;
	state.created = [];
	state.stamped = [];
	state.invalidated = [];
	state.cleared = [];
	state.reads = 0;
});

describe('who can reach the routes', () => {
	it.each([
		['a signed-in account that is not the owner', { tenantId: 'tenant-other' }],
		['a demo session', { tenantId: 'tenant-owner', isDemo: true }],
		['nobody', null],
	])('answers %s with the generic 404 and reads nothing', async (_l, session) => {
		state.session = session;
		const calls = [call(index, 'GET'), call(index, 'POST', { applyAll: true, method: 'earliest' }), call(confirm, 'POST', { identificationId: '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12) }), call(refresh, 'POST', {}), call(proof, 'GET', undefined, '?id=x')];
		for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
		expect(state.reads).toBe(0);
		expect(state.created).toEqual([]);
	});

	it('a tenant outside the rollout sees nothing and cannot record', async () => {
		state.enabled = false;
		expect(await (await call(index, 'GET')).json()).toMatchObject({ ok: true, enabled: false, entries: [] });
		const res = await call(index, 'POST', { applyAll: true, method: 'earliest' });
		expect(res.status).toBe(409);
		expect(state.created).toEqual([]);
	});
});

describe('recording', () => {
	it('Apply to all writes one entry per wallet key, in one batch, and stamps it', async () => {
		const res = await call(index, 'POST', { applyAll: true, method: 'highest_basis', note: 'standing choice' });
		expect(await res.clone().json()).toMatchObject({ ok: true });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, count: 3, exchangeHeld: 1, stampStatus: 'pending' });
		const written = state.created[0];
		expect(written.tenantId).toBe(state.owner);
		expect(written.source).toBe('apply_all');
		expect((written.raw as { walletKey: string }[]).map((r) => r.walletKey).sort()).toEqual([
			'cex:coinbase:acct-a', 'ethereum:0x' + 'a'.repeat(40), 'polygon:0x' + 'a'.repeat(40),
		]);
		expect(state.stamped).toHaveLength(1);
		expect(state.stamped[0]).toHaveLength(3);
	});

	it('drops the computed figures and the cache after a write', async () => {
		await call(index, 'POST', { entries: [{ walletKey: 'cex:coinbase:acct-a', method: 'latest' }] });
		expect(state.invalidated).toEqual([state.owner]);
		expect(state.cleared).toEqual([`t:${state.owner}:`]);
	});

	it('takes the tenant from the session, never the body', async () => {
		await call(index, 'POST', { tenantId: 'tenant-victim', tenant_id: 'tenant-victim', entries: [{ walletKey: 'cex:coinbase:acct-a', method: 'latest', tenantId: 'tenant-victim' }] });
		expect(state.created.map((c) => c.tenantId)).toEqual([state.owner]);
	});

	it('refuses a wallet key that is not one of the tenant\'s own', async () => {
		const res = await call(index, 'POST', { entries: [{ walletKey: 'cex:kraken:someone-elses', method: 'latest' }] });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ ok: false, error: 'wallet_unknown' });
		expect(state.created).toEqual([]);
	});

	it('refuses a backdated effective time with nothing stored or stamped', async () => {
		const res = await call(index, 'POST', { entries: [{ walletKey: 'cex:coinbase:acct-a', method: 'latest', effectiveAt: '2025-01-01T00:00:00Z' }] });
		expect(res.status).toBe(422);
		expect(await res.json()).toMatchObject({ ok: false, error: 'effective_before_recorded' });
		expect(state.stamped).toEqual([]);
		expect(state.invalidated).toEqual([]);
	});

	it('refuses an unknown method', async () => {
		const res = await call(index, 'POST', { applyAll: true, method: 'fifo' });
		expect(res.status).toBe(400);
	});

	it('refuses a body that is not JSON', async () => {
		const url = new URL('https://almstins.com/api/lot-identifications');
		const res = await (index as unknown as Record<string, Handler>).POST({ request: new Request(url, { method: 'POST', body: 'nope' }), url });
		expect(res.status).toBe(400);
	});

	it('has no way to edit or remove an entry', () => {
		for (const mod of [index, confirm, refresh, proof]) {
			expect(Object.keys(mod)).not.toContain('PUT');
			expect(Object.keys(mod)).not.toContain('PATCH');
			expect(Object.keys(mod)).not.toContain('DELETE');
		}
	});
});
