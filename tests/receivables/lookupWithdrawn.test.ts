import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The lookup contract for a withdrawn record (S2), end to end: GET /api/verify/receivables/lookup
 * over the registry's real SQL on tests/helpers/receivablesDbFake.ts.
 *
 *   - a live record's body carries no withdrawn and no withdrawnAt key (pinned, so S2 adds nothing
 *     to every answer that already exists);
 *   - a withdrawn record with another tenant's claim or statement answers found: true with the
 *     same body as before the withdrawal plus withdrawn: true and withdrawnAt, lifecycle unchanged;
 *   - a withdrawn record with no other party's evidence answers the existing found: false body.
 * tests/receivables/lookupRoute.test.ts keeps the route's own characterization (errors, headers).
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

let fake: ReceivablesDbFake;
const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);
let ipSeq = 0;

async function lookup(id = RID) {
	const { GET } = await import('../../src/pages/api/verify/receivables/lookup');
	const url = new URL('https://almstins.com/api/verify/receivables/lookup');
	url.searchParams.set('id', id);
	const ip = `203.0.113.${++ipSeq}`;
	const res: Response = await (GET as any)({ request: new Request(url, { headers: { 'cf-connecting-ip': ip } }), url, clientAddress: ip });
	return { status: res.status, body: await res.json() };
}

async function withdraw() {
	const reg = await import('../../src/lib/receivablesRegistry');
	const r = await reg.deleteReceivable(OWNER, RID);
	expect(r.ok).toBe(true);
	return (r as { withdrawnAt: string }).withdrawnAt;
}

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: 'Net 60', due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, created_at: '2026-09-01 10:00:00', updated_at: null,
	});
});

const seedClaim = (tenant: string) => fake.seed('receivable_claims', {
	id: tenant === OWNER ? 'claim-a' : 'claim-b', receivable_id: RID, tenant_id: tenant, financier: 'Lender Co', amount: 400, currency: 'USD',
	claim_date: '2026-09-02', status: 'active', manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64),
	anchor_json: null, discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
});
const seedStatement = (tenant: string) => fake.seed('receivable_attestations', {
	id: tenant === OWNER ? 'att-a' : 'att-b', receivable_id: RID, tenant_id: tenant, role: 'inspector', label: 'Surveyor',
	statement: 'Inspected the goods.', attested_at: '2026-09-03', manifest_json: '{}', signature_json: null,
	digest: 'f'.repeat(64), anchor_json: null, created_at: '2026-09-03 10:00:00',
});

describe('lookup: the withdrawn shape', () => {
	it('a live record carries neither key', async () => {
		seedClaim(LENDER);
		const { status, body } = await lookup();
		expect(status).toBe(200);
		expect(body.found).toBe(true);
		expect(body.receivable).not.toHaveProperty('withdrawn');
		expect(body.receivable).not.toHaveProperty('withdrawnAt');
	});

	it("withdrawn with another tenant's claim: the same body plus withdrawn and withdrawnAt", async () => {
		seedClaim(LENDER);
		const before = (await lookup()).body;
		const withdrawnAt = await withdraw();
		const { status, body } = await lookup();
		expect(status).toBe(200);
		expect(body).toEqual({ ok: true, found: true, receivable: { ...before.receivable, withdrawn: true, withdrawnAt } });
		expect(body.receivable.lifecycle).toBe('financed');
		// Still nothing that names a tenant.
		expect(JSON.stringify(body)).not.toMatch(/tenant-/);
	});

	it("withdrawn with another tenant's statement only: still answers, lifecycle created", async () => {
		seedStatement(LENDER);
		const withdrawnAt = await withdraw();
		const { body } = await lookup();
		expect(body.found).toBe(true);
		expect(body.receivable).toMatchObject({ withdrawn: true, withdrawnAt, lifecycle: 'created' });
	});

	it("withdrawn with only the owner's evidence: the existing found: false body", async () => {
		seedClaim(OWNER);
		seedStatement(OWNER);
		await withdraw();
		expect(await lookup()).toEqual({ status: 200, body: { ok: true, found: false, receivable: null } });
	});

	it('the counts follow what the withdrawal closed: files purged, open requests revoked', async () => {
		seedClaim(LENDER);
		fake.seed('receivable_documents', {
			id: 'doc-1', receivable_id: RID, tenant_id: OWNER, filename: 'note.pdf', mime_type: 'application/pdf',
			file_size: 4, sha256: 'b'.repeat(64), data: 'JVBERg==', uploaded_at: '2026-09-06 10:00:00', purged_at: null,
		});
		fake.seed('receivable_invites', {
			token: 'tok-open', receivable_id: RID, from_tenant: OWNER, role: 'buyer', label: null, email: 'ap@debtor.test',
			expires_at: '2099-01-01 00:00:00', accepted_at: null, accepted_by: null, revoked_at: null, created_at: '2026-09-04 10:00:00',
		});
		expect((await lookup()).body.receivable).toMatchObject({ documentCount: 1, requestCount: 1 });
		await withdraw();
		expect((await lookup()).body.receivable).toMatchObject({ documentCount: 0, requestCount: 0, withdrawn: true });
	});
});
