import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * POST /api/verify/receivables/extend and /unpaid, end to end through the registry: auth, the
 * demo guard, owner scoping, the error map (400 invalid_reason / 400 invalid / 404 / 409 / 410),
 * and the in-request Bitcoin stamp (anchorNow, kind status_event). The registry's real SQL runs
 * against the db fake; the OpenTimestamps calendars are a local stub. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
	stamps: [] as string[],
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(digestHex: string) {
			mem.stamps.push(digestHex);
			return { type: 'opentimestamps', digestHex, otsProofBase64: 'ZmFrZS1wcm9vZg==', anchoredAt: null };
		}
		async upgrade(): Promise<never> { throw new Error('these routes never upgrade'); }
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c3'.repeat(32);
const CLAIM = 'claim-1';
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: null, due_date: '2026-10-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: true,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null, deleted_at: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

function seedClaim(over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: CLAIM, receivable_id: RID, tenant_id: LENDER, financier: 'Sahel Capital',
		amount: 600, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
		...over,
	});
}

async function freshRegistry() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	mem.session = { tenantId: LENDER, isDemo: false };
	mem.stamps = [];
	await freshRegistry();
});
afterEach(() => { vi.unstubAllEnvs(); });

async function post(route: 'extend' | 'unpaid', body: unknown) {
	const mod = await import(`../../src/pages/api/verify/receivables/${route}.ts`);
	const request = new Request(`https://almstins.com/api/verify/receivables/${route}`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await (mod.POST as any)({ request });
	return { status: res.status, body: await res.json() };
}

const GOOD = { claimId: CLAIM, newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested' };

describe('POST /extend', () => {
	it('401 signed out', async () => {
		mem.session = null;
		const { status, body } = await post('extend', GOOD);
		expect(status).toBe(401);
		expect(body).toEqual({ ok: false, error: 'unauthenticated' });
	});

	it('403 demo_readonly: the demo browses, never writes', async () => {
		mem.session = { tenantId: 'demo-tenant', isDemo: true };
		const { status, body } = await post('extend', GOOD);
		expect(status).toBe(403);
		expect(body).toEqual({ ok: false, error: 'demo_readonly' });
	});

	it("404 on another account's claim (owner scoping)", async () => {
		seedReceivable();
		seedClaim({ tenant_id: 'tenant-someone-else' });
		const { status, body } = await post('extend', GOOD);
		expect(status).toBe(404);
		expect(body).toMatchObject({ ok: false, error: 'not_found' });
	});

	it('400 invalid_reason without a structured reason', async () => {
		seedReceivable();
		seedClaim();
		const { status, body } = await post('extend', { claimId: CLAIM, newPromisedDate: '2026-12-15' });
		expect(status).toBe(400);
		expect(body).toMatchObject({ ok: false, error: 'invalid_reason' });
		expect(mem.stamps).toEqual([]);
	});

	it('400 invalid without a YYYY-MM-DD date', async () => {
		seedReceivable();
		seedClaim();
		const { status, body } = await post('extend', { claimId: CLAIM, newPromisedDate: 'next month', reasonCode: 'other' });
		expect(status).toBe(400);
		expect(body).toMatchObject({ ok: false, error: 'invalid' });
	});

	it('409 on a discharged claim', async () => {
		seedReceivable();
		seedClaim({ status: 'discharged', discharged_at: '2026-10-10' });
		const { status, body } = await post('extend', GOOD);
		expect(status).toBe(409);
		expect(body).toMatchObject({ ok: false, error: 'already_discharged' });
	});

	it('410 on a withdrawn record', async () => {
		seedReceivable({ deleted_at: '2026-10-20 09:00:00' });
		seedClaim();
		const { status, body } = await post('extend', GOOD);
		expect(status).toBe(410);
		expect(body).toMatchObject({ ok: false, error: 'withdrawn' });
	});

	it('200: records the signed event, stamps it in-request, and echoes the reason to the actor', async () => {
		seedReceivable();
		seedClaim();
		const { status, body } = await post('extend', { ...GOOD, reasonNote: 'two more weeks agreed' });
		expect(status).toBe(200);
		expect(body).toMatchObject({
			ok: true, kind: 'extended', signed: true, aging: 'active', promisedDate: '2026-12-15',
			newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested', reasonNote: 'two more weeks agreed',
			anchored: true,
		});
		const row = fake.rows('receivable_status_events')[0];
		expect(mem.stamps).toEqual([String(row.digest)]);
		expect(row.anchor_json).toBeTruthy();

		// The public lookup shows the dated chain and the state — never the reason.
		const pub = JSON.stringify(await reg.getReceivableStatus(RID));
		expect(pub).toContain('"statusEvents"');
		expect(pub).not.toContain('debtor_requested');
		expect(pub).not.toContain('two more weeks agreed');
	});
});

describe('POST /unpaid', () => {
	it('403 demo_readonly', async () => {
		mem.session = { tenantId: 'demo-tenant', isDemo: true };
		const { status, body } = await post('unpaid', { claimId: CLAIM });
		expect(status).toBe(403);
		expect(body).toEqual({ ok: false, error: 'demo_readonly' });
	});

	it("404 on another account's claim", async () => {
		seedReceivable();
		seedClaim({ tenant_id: 'tenant-someone-else' });
		const { status, body } = await post('unpaid', { claimId: CLAIM });
		expect(status).toBe(404);
		expect(body).toMatchObject({ ok: false, error: 'not_found' });
	});

	it('200: flags the claim with the optional note, stamped in-request; the note stays off the lookup', async () => {
		seedReceivable();
		seedClaim();
		const { status, body } = await post('unpaid', { claimId: CLAIM, note: 'wire never arrived' });
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, kind: 'unpaid', signed: true, note: 'wire never arrived', anchored: true });
		const row = fake.rows('receivable_status_events')[0];
		expect(row).toMatchObject({ kind: 'unpaid', reason_note: 'wire never arrived' });
		expect(mem.stamps).toEqual([String(row.digest)]);

		const pub = JSON.stringify(await reg.getReceivableStatus(RID));
		expect(pub).not.toContain('wire never arrived');
	});

	it('200 without a note: the flag alone is the signal (D4)', async () => {
		seedReceivable();
		seedClaim();
		const { status, body } = await post('unpaid', { claimId: CLAIM });
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, kind: 'unpaid' });
		expect('note' in body).toBe(false);
	});
});
