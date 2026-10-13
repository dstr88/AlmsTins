import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * "Ask the client to confirm receipt" (desk -> POST /api/verify/receivables/invite with a
 * claimId -> /verify/countersign). The route used to drop claimId, so every such link was
 * stored without its advance and the answer page answered not_found. Runs the registry's
 * real SQL against tests/helpers/receivablesDbFake.ts.
 */

const holder = vi.hoisted(() => ({ db: null as any, session: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => holder.session }));

type Registry = typeof import('../../src/lib/receivablesRegistry');
let fake: ReceivablesDbFake;
let reg: Registry;
let POST: any;

const OWNER = 'tenant-owner';
const RID = 'c0'.repeat(32);
const OTHER_RID = 'd0'.repeat(32);

function seedReceivable(id: string) {
	fake.seed('receivables', {
		id, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
	});
}

function seedClaim(id: string, receivableId: string, tenantId = OWNER) {
	fake.seed('receivable_claims', {
		id, receivable_id: receivableId, tenant_id: tenantId, financier: 'Lender One',
		amount: 900, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
	});
}

const post = async (body: Record<string, unknown>) => {
	const request = new Request('https://almstins.com/api/verify/receivables/invite', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await POST({ request, url: new URL(request.url) });
	return { status: res.status, body: await res.json() };
};

// Exactly what the desk sends (src/pages/verify/desk.astro, "cs-claim").
const deskBody = (claimId: string, receivableId = RID) =>
	({ role: 'borrower', receivableId, claimId, email: 'client@example.com' });

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	holder.session = { tenantId: OWNER, isDemo: false };
	reg = await import('../../src/lib/receivablesRegistry');
	POST = (await import('../../src/pages/api/verify/receivables/invite')).POST;
	seedReceivable(RID);
	seedReceivable(OTHER_RID);
});

describe('confirm-receipt links carry their advance', () => {
	it('stores the claim, so the answer page finds the advance', async () => {
		seedClaim('claim-1', RID);
		const r = await post(deskBody('claim-1'));
		expect(r.status).toBe(200);
		expect(r.body.ok).toBe(true);

		const req = await reg.readCountersignRequest(r.body.token);
		expect(req).toMatchObject({ ok: true, claimId: 'claim-1', receivableId: RID, amount: 900, financier: 'Lender One' });
		expect(await reg.listCountersignRequests(OWNER, 'claim-1')).toHaveLength(1);
	});

	it('refuses an advance the sender does not hold', async () => {
		seedClaim('claim-x', RID, 'tenant-someone-else');
		const r = await post(deskBody('claim-x'));
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('claim_not_found');
	});

	it('refuses an advance filed against another receivable', async () => {
		seedClaim('claim-2', OTHER_RID);
		const r = await post(deskBody('claim-2', RID));
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('claim_not_found');
	});

	it('leaves links without a claim as they were', async () => {
		const r = await post({ role: 'borrower', receivableId: RID, email: 'client@example.com' });
		expect(r.status).toBe(200);
		expect(await reg.readCountersignRequest(r.body.token)).toEqual({ ok: false, error: 'not_found' });
	});
});
