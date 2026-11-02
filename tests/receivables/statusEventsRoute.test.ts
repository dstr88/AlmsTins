import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * GET /api/verify/receivables/status-events — the signed-in tier of D3 (aging A2), end to end
 * through the registry: the desk reads a claim's extended/unpaid chain WITH its structured
 * reasons HERE, and only for the caller's own claim. The public lookup carries the dated chain
 * but never a reason; a non-owner gets 404, never that the claim exists. A read, so the demo can
 * browse its own chain, and a discharged claim's — or a withdrawn record's — chain stays
 * readable: the dated history is the record. The registry's real SQL runs against the db fake.
 * Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c4'.repeat(32);
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

function seedEvent(over: Record<string, unknown> = {}) {
	return fake.seed('receivable_status_events', {
		id: 'ev-x', tenant_id: LENDER, receivable_id: RID, claim_id: CLAIM, kind: 'unpaid',
		new_promised_date: null, reason_code: null, reason_note: null,
		manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
		created_at: '2026-10-01 09:00:00',
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
	await freshRegistry();
});
afterEach(() => { vi.unstubAllEnvs(); });

async function get(claimId: string | null) {
	const mod = await import('../../src/pages/api/verify/receivables/status-events.ts');
	const qs = claimId === null ? '' : `?claimId=${encodeURIComponent(claimId)}`;
	const request = new Request(`https://almstins.com/api/verify/receivables/status-events${qs}`);
	const res: Response = await (mod.GET as any)({ request, url: new URL(request.url) });
	return { status: res.status, body: await res.json() };
}

describe('GET /status-events', () => {
	it('401 signed out', async () => {
		mem.session = null;
		const { status, body } = await get(CLAIM);
		expect(status).toBe(401);
		expect(body).toEqual({ ok: false, error: 'unauthenticated' });
	});

	it("404 on another account's claim — never that the claim exists", async () => {
		seedReceivable();
		seedClaim({ tenant_id: 'tenant-someone-else' });
		seedEvent({ tenant_id: 'tenant-someone-else' });
		const { status, body } = await get(CLAIM);
		expect(status).toBe(404);
		expect(body).toMatchObject({ ok: false, error: 'not_found' });
		expect(JSON.stringify(body)).not.toContain('ev-x');
	});

	it('404 without a claimId', async () => {
		const { status, body } = await get(null);
		expect(status).toBe(404);
		expect(body).toMatchObject({ ok: false, error: 'not_found' });
	});

	it("200: the owner's own chain, reasons included, oldest first — and only his tenant's rows", async () => {
		seedReceivable();
		seedClaim();
		const ext = await reg.addExtension(LENDER, CLAIM,
			{ newPromisedDate: '2026-10-20', reasonCode: 'debtor_requested', reasonNote: 'two more weeks agreed' },
			new Date('2026-10-05T10:00:00Z'));
		expect(ext.ok).toBe(true);
		const flag = await reg.markUnpaid(LENDER, CLAIM, {}, new Date('2026-10-28T09:00:00Z'));
		expect(flag.ok).toBe(true);
		// A row written under another tenant on the same claim never rides the answer.
		seedEvent({ id: 'ev-foreign', tenant_id: 'tenant-someone-else', reason_note: 'not yours to read' });

		const { status, body } = await get(CLAIM);
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.events).toEqual([
			{
				id: (ext as any).eventId, kind: 'extended', date: '2026-10-05 10:00:00',
				newPromisedDate: '2026-10-20', reasonCode: 'debtor_requested', reasonNote: 'two more weeks agreed',
			},
			{
				id: (flag as any).eventId, kind: 'unpaid', date: '2026-10-28 09:00:00',
				newPromisedDate: null, reasonCode: null, reasonNote: null,
			},
		]);
	});

	it('200 for the demo on its own claim: a read — the demo browses, never writes', async () => {
		seedReceivable();
		seedClaim();
		seedEvent({ id: 'ev-1', kind: 'extended', new_promised_date: '2026-11-10', reason_code: 'other' });
		mem.session = { tenantId: LENDER, isDemo: true };
		const { status, body } = await get(CLAIM);
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.events).toHaveLength(1);
		expect(body.events[0]).toMatchObject({ id: 'ev-1', kind: 'extended', reasonCode: 'other' });
	});

	it('200 on a discharged claim on a withdrawn record: the dated chain is the record', async () => {
		seedReceivable({ deleted_at: '2026-10-20 09:00:00' });
		seedClaim({ status: 'discharged', discharged_at: '2026-10-19 12:00:00' });
		seedEvent({ id: 'ev-1', created_at: '2026-10-02 09:00:00' });
		seedEvent({ id: 'ev-2', kind: 'extended', new_promised_date: '2026-10-15', reason_code: 'partial_payment_received', created_at: '2026-10-10 09:00:00' });
		const { status, body } = await get(CLAIM);
		expect(status).toBe(200);
		expect(body.events.map((e: any) => e.id)).toEqual(['ev-1', 'ev-2']);
	});
});
