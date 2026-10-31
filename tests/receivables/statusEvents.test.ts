import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { digestOf } from '../../src/lib/recordProof/isoSign';

/**
 * addExtension / markUnpaid (aging A1): signed, dated, append-only status events on a claim,
 * written only by the claim's own financier, and how the public status carries them — the aging
 * state and the dated chain, never the reason (D3).
 *
 * The registry's real SQL runs against tests/helpers/receivablesDbFake.ts. Every `now` is an
 * explicit parameter; nothing reads the system time. All names, amounts and dates are invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'a1'.repeat(32);
const CLAIM = 'claim-1';
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';

/** The moment the updates happen in these tests. The record's due date (2026-10-01) is past. */
const NOW = new Date('2026-11-05T12:00:00Z');
const NOW_STAMP = '2026-11-05 12:00:00';

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
	await freshRegistry();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('addExtension', () => {
	it('writes one signed, dated event and answers with the claim back to active', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested' }, NOW);
		expect(r).toMatchObject({
			ok: true, kind: 'extended', signed: true, at: NOW_STAMP,
			aging: 'active', promisedDate: '2026-12-15',
			newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested',
		});
		expect('reasonNote' in (r as any)).toBe(false);

		const rows = fake.rows('receivable_status_events');
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row).toMatchObject({
			tenant_id: LENDER, receivable_id: RID, claim_id: CLAIM, kind: 'extended',
			new_promised_date: '2026-12-15', reason_code: 'debtor_requested', reason_note: null,
			created_at: NOW_STAMP,
		});
		const manifest = JSON.parse(row.manifest_json);
		expect(manifest).toEqual({
			v: 1, kind: 'claim_extension', receivableId: RID, claimId: CLAIM,
			financier: 'Sahel Capital', newPromisedDate: '2026-12-15',
			reasonCode: 'debtor_requested', date: '2026-11-05',
		});
		expect(row.digest).toBe(digestOf(manifest));
		expect((r as any).digest).toBe(row.digest);
		expect(row.signature_json).toBeTruthy();
	});

	it('an optional note is clamped into the signed manifest; blank stays omitted', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.addExtension(LENDER, CLAIM, {
			newPromisedDate: '2026-12-15', reasonCode: 'partial_payment_received', reasonNote: '  40% wired, rest on delivery  ',
		}, NOW);
		expect(r).toMatchObject({ ok: true, reasonNote: '40% wired, rest on delivery' });
		const manifest = JSON.parse(fake.rows('receivable_status_events')[0].manifest_json);
		expect(manifest.reasonNote).toBe('40% wired, rest on delivery');
		// Keys stay in the fixed order, note last, so unnoted manifests keep their bytes.
		expect(Object.keys(manifest).at(-1)).toBe('reasonNote');
	});

	it('a missing reason records nothing (invalid_reason)', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: '' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'invalid_reason' });
		expect(fake.rows('receivable_status_events')).toHaveLength(0);
	});

	it('an unknown reason records nothing (invalid_reason)', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'because' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'invalid_reason' });
	});

	it('a missing or malformed date records nothing (invalid)', async () => {
		seedReceivable();
		seedClaim();
		expect(await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '', reasonCode: 'other' }, NOW))
			.toMatchObject({ ok: false, error: 'invalid' });
		expect(await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '12/15/2026', reasonCode: 'other' }, NOW))
			.toMatchObject({ ok: false, error: 'invalid' });
		expect(fake.rows('receivable_status_events')).toHaveLength(0);
	});

	it('tenant scoping: another account updating this claim reads not_found', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.addExtension(OWNER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'not_found' });
		expect(fake.rows('receivable_status_events')).toHaveLength(0);
	});

	it('an unknown claim reads not_found', async () => {
		seedReceivable();
		const r = await reg.addExtension(LENDER, 'claim-unknown', { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'not_found' });
	});

	it('a discharged claim needs no status update (already_discharged)', async () => {
		seedReceivable();
		seedClaim({ status: 'discharged', discharged_at: '2026-10-10' });
		const r = await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'already_discharged' });
	});

	it('a withdrawn record answers 410 withdrawn (the S2 fail-closed default for new writers)', async () => {
		seedReceivable({ deleted_at: '2026-10-20 09:00:00' });
		seedClaim();
		const r = await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		expect(r).toMatchObject({ ok: false, error: 'withdrawn', withdrawnAt: '2026-10-20 09:00:00' });
		expect(fake.rows('receivable_status_events')).toHaveLength(0);
	});

	it('bumps the record last-activity clock, so every party book shows the update', async () => {
		seedReceivable();
		seedClaim();
		await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		expect(fake.rows('receivables')[0].updated_at).toBeTruthy();
	});
});

describe('markUnpaid', () => {
	it('flags the claim with an optional note and does NOT move the promised date', async () => {
		seedReceivable(); // due 2026-10-01, 35 days before NOW: past grace
		seedClaim();
		const r = await reg.markUnpaid(LENDER, CLAIM, { note: 'promised wire never arrived' }, NOW);
		expect(r).toMatchObject({
			ok: true, kind: 'unpaid', signed: true, at: NOW_STAMP,
			aging: 'past_due_not_updated', promisedDate: '2026-10-01',
			note: 'promised wire never arrived',
		});
		const row = fake.rows('receivable_status_events')[0];
		expect(row).toMatchObject({ kind: 'unpaid', new_promised_date: null, reason_code: null, reason_note: 'promised wire never arrived' });
		const manifest = JSON.parse(row.manifest_json);
		expect(manifest).toEqual({
			v: 1, kind: 'claim_unpaid', receivableId: RID, claimId: CLAIM,
			financier: 'Sahel Capital', date: '2026-11-05', note: 'promised wire never arrived',
		});
		expect(row.digest).toBe(digestOf(manifest));
	});

	it('without a note the manifest carries no note key (D4: the flag is the signal)', async () => {
		seedReceivable();
		seedClaim();
		const r = await reg.markUnpaid(LENDER, CLAIM, {}, NOW);
		expect(r).toMatchObject({ ok: true, kind: 'unpaid' });
		expect('note' in (r as any)).toBe(false);
		const manifest = JSON.parse(fake.rows('receivable_status_events')[0].manifest_json);
		expect('note' in manifest).toBe(false);
	});

	it('tenant scoping holds here too', async () => {
		seedReceivable();
		seedClaim();
		expect(await reg.markUnpaid(OWNER, CLAIM, {}, NOW)).toMatchObject({ ok: false, error: 'not_found' });
	});
});

describe('the chain and the public status (D3)', () => {
	it('events append in order; the LAST extension sets the promised date, even an earlier one', async () => {
		seedReceivable();
		seedClaim();
		await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested' }, new Date('2026-11-05T12:00:00Z'));
		await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-11-20', reasonCode: 'renegotiated_terms' }, new Date('2026-11-06T09:00:00Z'));
		expect(fake.rows('receivable_status_events')).toHaveLength(2);

		const status = await reg.getReceivableStatus(RID, new Date('2026-11-06T10:00:00Z'));
		const claim = status!.claims[0];
		expect(claim.promisedDate).toBe('2026-11-20');
		expect(claim.aging).toBe('active');
		expect(claim.statusEvents.map((e) => [e.kind, e.newPromisedDate])).toEqual([
			['extended', '2026-12-15'],
			['extended', '2026-11-20'],
		]);
		expect(claim.lastOwnerTouchAt).toBe('2026-11-06 09:00:00');
	});

	it('the public status never carries a reason, a note, or the reason vocabulary', async () => {
		seedReceivable();
		seedClaim();
		await reg.addExtension(LENDER, CLAIM, {
			newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested', reasonNote: 'asked for two more weeks',
		}, NOW);
		await reg.markUnpaid(LENDER, CLAIM, { note: 'still waiting on the wire' }, new Date('2026-11-06T09:00:00Z'));

		const status = await reg.getReceivableStatus(RID, new Date('2026-11-06T10:00:00Z'));
		const raw = JSON.stringify(status);
		expect(raw).not.toContain('reasonCode');
		expect(raw).not.toContain('reason_code');
		expect(raw).not.toContain('debtor_requested');
		expect(raw).not.toContain('asked for two more weeks');
		expect(raw).not.toContain('still waiting on the wire');
		// The dated chain itself IS public: kinds and dates, oldest first.
		expect(status!.claims[0].statusEvents.map((e) => e.kind)).toEqual(['extended', 'unpaid']);
	});

	it('events bind to their own claim: a second claim of the same lender stays untouched', async () => {
		seedReceivable();
		seedClaim();
		seedClaim({ id: 'claim-2', amount: 200, created_at: '2026-09-03 10:00:00' });
		await reg.addExtension(LENDER, CLAIM, { newPromisedDate: '2026-12-15', reasonCode: 'other' }, NOW);
		const status = await reg.getReceivableStatus(RID, NOW);
		const byId = new Map(status!.claims.map((c) => [c.id, c]));
		expect(byId.get(CLAIM)!.statusEvents).toHaveLength(1);
		expect(byId.get('claim-2')!.statusEvents).toHaveLength(0);
		expect(byId.get('claim-2')!.promisedDate).toBe('2026-10-01');
	});
});
