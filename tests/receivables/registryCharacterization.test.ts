import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Characterization of the registry behavior the S0a hardening touches, pinned BEFORE the code
 * moved: the financing status and lifecycle that getReceivableStatus derives (now
 * src/lib/receivables/status.ts), the diligence gate's acceptance rules on legacy rows (now
 * source-first), and the headroom answer. These ran green against the original registry; the
 * refactor must leave every one of them green, unchanged.
 *
 * Runs the registry's real SQL against tests/helpers/receivablesDbFake.ts. Modules are reset
 * per test, so the single-flight ensure starts cold against each fresh fake.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
let fake: ReceivablesDbFake;
let reg: Registry;

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c0'.repeat(32);

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', terms: null, due_date: '2026-12-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

let claimSeq = 0;
function seedClaim(amount: number, over: Record<string, unknown> = {}) {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: RID, tenant_id: LENDER, financier: `Lender ${claimSeq}`,
		amount, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null,
		created_at: `2026-09-02 10:00:${String(claimSeq).padStart(2, '0')}`,
		...over,
	});
}

let attSeq = 0;
function seedAttestation(over: Record<string, unknown>) {
	attSeq++;
	return fake.seed('receivable_attestations', {
		id: `att-${attSeq}`, receivable_id: RID, tenant_id: OWNER, role: 'other', label: 'Someone',
		statement: 'A statement.', attested_at: '2026-09-03', manifest_json: '{}', signature_json: null,
		digest: 'f'.repeat(64), anchor_json: null,
		created_at: `2026-09-03 10:00:${String(attSeq).padStart(2, '0')}`,
		...over,
	});
}

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	claimSeq = 0;
	attSeq = 0;
});

describe('getReceivableStatus: financing status and lifecycle (pinned before status.ts)', () => {
	const cases: Array<{
		name: string; face?: number; settled?: boolean;
		claims: Array<[number, 'active' | 'discharged']>;
		status: string; lifecycle: string; claimed: number; available: number;
	}> = [
		{ name: 'no claims', claims: [], status: 'unfinanced', lifecycle: 'created', claimed: 0, available: 1000 },
		{ name: 'one partial claim', claims: [[400, 'active']], status: 'partially_financed', lifecycle: 'financed', claimed: 400, available: 600 },
		{ name: 'claims summing to face', claims: [[400, 'active'], [600, 'active']], status: 'fully_financed', lifecycle: 'financed', claimed: 1000, available: 0 },
		{ name: 'claims above face', claims: [[700, 'active'], [600, 'active']], status: 'over_financed', lifecycle: 'financed', claimed: 1300, available: -300 },
		{ name: 'every claim discharged', claims: [[400, 'discharged'], [600, 'discharged']], status: 'unfinanced', lifecycle: 'released', claimed: 0, available: 1000 },
		{ name: 'discharged claims do not count', claims: [[400, 'discharged'], [300, 'active']], status: 'partially_financed', lifecycle: 'financed', claimed: 300, available: 700 },
		{ name: 'settled with an active claim', settled: true, claims: [[400, 'active']], status: 'partially_financed', lifecycle: 'settled', claimed: 400, available: 600 },
		{ name: 'settled with no claims', settled: true, claims: [], status: 'unfinanced', lifecycle: 'settled', claimed: 0, available: 1000 },
		// Pinned as found, not endorsed: the active amounts are summed in created_at order with
		// plain floating point, so 0.1 + 0.2 against a face of 0.3 reads over-financed. The
		// extraction must reproduce this exactly; changing it is its own decision.
		{ name: 'float sums are compared as computed', face: 0.3, claims: [[0.1, 'active'], [0.2, 'active']], status: 'over_financed', lifecycle: 'financed', claimed: 0.1 + 0.2, available: 0.3 - (0.1 + 0.2) },
	];

	for (const c of cases) {
		it(c.name, async () => {
			seedReceivable({ face: c.face ?? 1000, settled_at: c.settled ? '2026-09-30' : null });
			for (const [amount, status] of c.claims) seedClaim(amount, { status });
			const s = await reg.getReceivableStatus(RID);
			expect(s).not.toBeNull();
			expect(s!.status).toBe(c.status);
			expect(s!.lifecycle).toBe(c.lifecycle);
			expect(s!.claimed).toBe(c.claimed);
			expect(s!.available).toBe(c.available);
			expect(s!.settled).toBe(!!c.settled);
		});
	}

	it('an unknown ID answers null, and surrounding spaces are trimmed', async () => {
		seedReceivable();
		expect(await reg.getReceivableStatus('ff'.repeat(32))).toBeNull();
		expect((await reg.getReceivableStatus(`  ${RID}  `))?.id).toBe(RID);
	});

	it('the public read never carries tenant_id', async () => {
		seedReceivable();
		seedClaim(100);
		seedAttestation({ role: 'supplier', statement: 'Confirms this is their receivable.' });
		const s = await reg.getReceivableStatus(RID);
		expect(JSON.stringify(s)).not.toContain('tenant');
		expect(JSON.stringify(s)).not.toContain(OWNER);
		expect(JSON.stringify(s)).not.toContain(LENDER);
	});

	it('attestations keep their id, role, label, statement, date and anchor fields', async () => {
		seedReceivable();
		seedAttestation({ role: 'supplier', label: 'Acme', statement: 'Confirms receipt.', attested_at: '2026-09-04' });
		seedAttestation({ role: 'weird', label: 'X', statement: 'DISPUTED — states the record is wrong.' });
		const s = await reg.getReceivableStatus(RID);
		expect(s!.attestations).toHaveLength(2);
		expect(s!.attestations[0]).toMatchObject({
			id: 'att-1', role: 'supplier', label: 'Acme', statement: 'Confirms receipt.', date: '2026-09-04',
			signed: false, anchored: false, anchoredAt: null,
		});
		// An unknown stored role reads as 'other'.
		expect(s!.attestations[1].role).toBe('other');
	});
});

describe('addClaim: the diligence gate on legacy rows (pinned before source-first)', () => {
	const claim = (receivableId = RID) =>
		reg.addClaim(LENDER, receivableId, { financier: 'Lender Co', amount: 100 });

	it('a real record with no debtor confirmation and no acceptance asks for diligence', async () => {
		seedReceivable();
		const r = await claim();
		expect(r).toMatchObject({ ok: false, error: 'diligence_required' });
		expect(fake.rows('receivable_claims')).toHaveLength(0);
	});

	it("a buyer attestation from anyone satisfies it", async () => {
		seedReceivable();
		seedAttestation({ role: 'buyer', tenant_id: OWNER, statement: 'Confirms invoice INV-0042.' });
		expect(await claim()).toMatchObject({ ok: true });
	});

	it("the claiming tenant's own DILIGENCE row satisfies it", async () => {
		seedReceivable();
		seedAttestation({ tenant_id: LENDER, statement: 'DILIGENCE — accepts responsibility for having personally verified this debtor via a phone call.' });
		expect(await claim()).toMatchObject({ ok: true });
	});

	it("another tenant's DILIGENCE row does not", async () => {
		seedReceivable();
		seedAttestation({ tenant_id: OWNER, statement: 'DILIGENCE — accepts responsibility for having personally verified this debtor via a phone call.' });
		expect(await claim()).toMatchObject({ ok: false, error: 'diligence_required' });
	});

	it('a statement that only resembles the prefix does not', async () => {
		seedReceivable();
		seedAttestation({ tenant_id: LENDER, statement: 'Diligence — checked by phone.' });
		seedAttestation({ tenant_id: LENDER, statement: 'DILIGENCE - checked by phone.' });
		expect(await claim()).toMatchObject({ ok: false, error: 'diligence_required' });
	});

	it('a test record skips the gate', async () => {
		seedReceivable({ is_test: true });
		expect(await claim()).toMatchObject({ ok: true });
	});

	it('an unknown receivable is not_found', async () => {
		expect(await claim('ff'.repeat(32))).toMatchObject({ ok: false, error: 'not_found' });
	});
});

describe('addClaim: headroom', () => {
	it('a claim above the unencumbered headroom answers exceeds_headroom with the figures', async () => {
		seedReceivable({ is_test: true });
		seedClaim(800);
		const r = await reg.addClaim(LENDER, RID, { financier: 'Second Lender', amount: 300 });
		expect(r).toEqual({
			ok: false, error: 'exceeds_headroom',
			message: 'Only 200 of 1000 USD is unencumbered; 800 is already claimed.',
			available: 200, claimed: 800, face: 1000,
		});
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('force records the over-claim', async () => {
		seedReceivable({ is_test: true });
		seedClaim(800);
		const r = await reg.addClaim(LENDER, RID, { financier: 'Second Lender', amount: 300, force: true });
		expect(r).toMatchObject({ ok: true, claimed: 1100, available: -100, face: 1000 });
		const rows = fake.rows('receivable_claims');
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({ receivable_id: RID, tenant_id: LENDER, financier: 'Second Lender', amount: 300, status: 'active' });
	});

	it('a claim within headroom is recorded under the caller tenant', async () => {
		seedReceivable({ is_test: true });
		const r = await reg.addClaim(LENDER, RID, { financier: 'Lender Co', amount: 250, currency: 'usd' });
		expect(r).toMatchObject({ ok: true, claimed: 250, available: 750, face: 1000 });
		expect(fake.rows('receivable_claims')[0]).toMatchObject({ tenant_id: LENDER, currency: 'USD' });
	});
});
