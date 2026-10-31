import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The load-bearing behavioral change (aging A1, D7): a LAPSED claim — no owner-initiated dated
 * event for 180 days — stops counting toward headroom and the financing answer, while its signed
 * record and full history stay visible, marked. One ordinary dated update revives it; a revival
 * over a gap-financed second claim reads as over-financed attention, never an adjudication.
 *
 * The registry's real SQL runs against the db fake; every `now` is an explicit parameter. The
 * receivable is a test record (is_test), which skips the diligence gate the way the existing
 * claim tests do. All names, amounts and dates are invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const FIRST = 'tenant-first-lender';
const SECOND = 'tenant-second-lender';
const THIRD = 'tenant-checker';
const RID = 'b2'.repeat(32);
const CLAIM_A = 'claim-a';
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

/** Claim A is registered 2026-01-01. 2026-05-01 is 120 days later (maintained); 2026-11-01 is
 *  304 days later (well past the 180-day lapse backstop). */
const NOW_FRESH = new Date('2026-05-01T00:00:00Z');
const NOW_LAPSED = new Date('2026-11-01T00:00:00Z');

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: 'tenant-client', supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-7001',
		face: 1000, currency: 'USD', terms: null, due_date: '2026-02-01', acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: true,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null, deleted_at: null,
		created_at: '2026-01-01 09:00:00', updated_at: null,
		...over,
	});
}

function seedClaimA(over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: CLAIM_A, receivable_id: RID, tenant_id: FIRST, financier: 'First Lender',
		amount: 1000, currency: 'USD', claim_date: '2026-01-01', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-01-01 10:00:00',
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
	await freshRegistry();
});
afterEach(() => { vi.unstubAllEnvs(); });

const claimFullFace = (now: Date) =>
	reg.addClaim(SECOND, RID, { financier: 'Second Lender', amount: 1000 }, { now });

describe('a lapsed claim frees headroom', () => {
	it('while the first claim is maintained, a second full-face claim exceeds headroom', async () => {
		seedReceivable();
		seedClaimA();
		const r = await claimFullFace(NOW_FRESH);
		expect(r).toMatchObject({ ok: false, error: 'exceeds_headroom', available: 0, claimed: 1000, face: 1000 });
	});

	it('once the first claim lapses, the full face is unencumbered again', async () => {
		seedReceivable();
		seedClaimA();
		const r = await claimFullFace(NOW_LAPSED);
		expect(r).toMatchObject({ ok: true, claimed: 1000, available: 0, face: 1000 });
		// Nothing was removed: both claims stand on the record.
		expect(fake.rows('receivable_claims')).toHaveLength(2);
	});

	it('the history still returns, marked lapsed; the financing answer stops counting it', async () => {
		seedReceivable();
		seedClaimA();
		const status = await reg.getReceivableStatus(RID, NOW_LAPSED);
		expect(status!.claims).toHaveLength(1);
		expect(status!.claims[0]).toMatchObject({ id: CLAIM_A, status: 'active', aging: 'lapsed', amount: 1000 });
		expect(status!.claimed).toBe(0);
		expect(status!.available).toBe(1000);
		expect(status!.status).toBe('unfinanced');
		// The lifecycle axis does not flip: a lapsed claim was never discharged.
		expect(status!.lifecycle).toBe('financed');
	});

	it('discharge figures agree with the public status (lapsed left out)', async () => {
		seedReceivable();
		seedClaimA();
		fake.seed('receivable_claims', {
			id: 'claim-b', receivable_id: RID, tenant_id: SECOND, financier: 'Second Lender',
			amount: 400, currency: 'USD', claim_date: '2026-10-01', status: 'active',
			manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-10-01 10:00:00',
		});
		const r = await reg.dischargeClaim(SECOND, 'claim-b', undefined, NOW_LAPSED);
		expect(r).toMatchObject({ ok: true, claimed: 0, available: 1000, face: 1000 });
	});
});

describe('revival re-counts a lapsed claim', () => {
	it('an extension revives it: the headroom guard counts it again', async () => {
		seedReceivable();
		seedClaimA();
		const revived = await reg.addExtension(FIRST, CLAIM_A, { newPromisedDate: '2026-12-01', reasonCode: 'debtor_requested' }, NOW_LAPSED);
		expect(revived).toMatchObject({ ok: true, aging: 'active' });
		const r = await claimFullFace(new Date('2026-11-01T01:00:00Z'));
		expect(r).toMatchObject({ ok: false, error: 'exceeds_headroom', available: 0, claimed: 1000 });
	});

	it('an unpaid flag revives it too (any owner status event is a touch)', async () => {
		seedReceivable();
		seedClaimA();
		const flagged = await reg.markUnpaid(FIRST, CLAIM_A, { note: 'chasing the debtor' }, NOW_LAPSED);
		// The date did not move, so the record honestly stays past due — but it counts again.
		expect(flagged).toMatchObject({ ok: true, aging: 'past_due_not_updated' });
		const r = await claimFullFace(new Date('2026-11-01T01:00:00Z'));
		expect(r).toMatchObject({ ok: false, error: 'exceeds_headroom', available: 0, claimed: 1000 });
	});

	it('revival over a gap-financed second claim reads over-financed attention, never an adjudication', async () => {
		seedReceivable();
		seedClaimA();
		// The gap: A lapsed, a second lender records 800 against the freed headroom.
		const gap = await reg.addClaim(SECOND, RID, { financier: 'Second Lender', amount: 800 }, { now: NOW_LAPSED });
		expect(gap).toMatchObject({ ok: true, claimed: 800, available: 200 });
		// The first lender wakes up and extends: the claim counts again.
		await reg.addExtension(FIRST, CLAIM_A, { newPromisedDate: '2026-12-01', reasonCode: 'renegotiated_terms' }, new Date('2026-11-01T02:00:00Z'));

		const after = new Date('2026-11-01T03:00:00Z');
		const status = await reg.getReceivableStatus(RID, after);
		expect(status!.claimed).toBe(1800);
		expect(status!.status).toBe('over_financed');
		// Both claims stay listed, dated, each with its own state — humans sort priority, never us.
		expect(status!.claims).toHaveLength(2);
		expect(status!.claims.every((c) => typeof c.aging === 'string')).toBe(true);
		expect(fake.rows('receivable_claims')).toHaveLength(2);

		const verify = await reg.reverifyReceivable(THIRD, RID, { persist: false, now: after });
		expect(verify.ok).toBe(true);
		if (verify.ok) {
			expect(verify.verdict).toBe('attention');
			expect(verify.checks.find((c) => c.key === 'headroom')).toMatchObject({ state: 'fail' });
		}
	});
});

describe('what counts as an owner touch (D7)', () => {
	it('the supplier affirmation is a touch', async () => {
		seedReceivable();
		seedClaimA({ affirmed_at: '2026-06-01 00:00:00', affirmed_by: 'Acme Supplies Ltd' });
		// 153 days after the affirmation: still counted.
		expect(await claimFullFace(NOW_LAPSED)).toMatchObject({ ok: false, error: 'exceeds_headroom' });
		// 183 days after the affirmation: lapsed.
		expect(await claimFullFace(new Date('2026-12-01T00:00:00Z'))).toMatchObject({ ok: true });
	});

	it("the financier's own Verify now is a touch", async () => {
		seedReceivable();
		seedClaimA();
		fake.seed('receivable_reverifications', {
			id: 'rv-own', receivable_id: RID, tenant_id: FIRST, verdict: 'attention',
			checks_json: '[]', manifest_json: '{}', signature_json: null, digest: 'a9'.repeat(32),
			anchor_json: null, created_at: '2026-06-01 00:00:00',
		});
		expect(await claimFullFace(NOW_LAPSED)).toMatchObject({ ok: false, error: 'exceeds_headroom' });
	});

	it("another tenant's Verify now is NOT the financier's touch", async () => {
		seedReceivable();
		seedClaimA();
		fake.seed('receivable_reverifications', {
			id: 'rv-checker', receivable_id: RID, tenant_id: THIRD, verdict: 'attention',
			checks_json: '[]', manifest_json: '{}', signature_json: null, digest: 'b8'.repeat(32),
			anchor_json: null, created_at: '2026-06-01 00:00:00',
		});
		expect(await claimFullFace(NOW_LAPSED)).toMatchObject({ ok: true });
	});

	it("a checker's lookup writes nothing and is not a touch", async () => {
		seedReceivable();
		seedClaimA();
		// A mid-silence public read, and a persist-free Verify now by a third party.
		await reg.getReceivableStatus(RID, new Date('2026-06-01T00:00:00Z'));
		const check = await reg.reverifyReceivable(THIRD, RID, { persist: false, now: new Date('2026-06-01T00:00:00Z') });
		expect(check.ok).toBe(true);
		expect(fake.rows('receivable_reverifications')).toHaveLength(0);
		// The silence still ran out.
		expect(await claimFullFace(NOW_LAPSED)).toMatchObject({ ok: true });
	});

	it('a settled receivable never lapses its claims: they keep encumbering as before', async () => {
		seedReceivable({ settled_at: '2026-03-01' });
		seedClaimA();
		const status = await reg.getReceivableStatus(RID, NOW_LAPSED);
		expect(status!.claims[0].aging).toBe('settled');
		expect(await claimFullFace(NOW_LAPSED)).toMatchObject({ ok: false, error: 'exceeds_headroom' });
	});
});
