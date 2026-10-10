import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { classifyAttestation, RESERVED_STATEMENT_PREFIXES } from '../../src/lib/receivables/attestationClass';

/**
 * Attestation provenance (S0a): receivable_attestations.source is written by every writer, the
 * public lookup gains an additive `class` (never the raw source), the diligence gate reads the
 * source first, and addClaim sums headroom by the stored ID.
 *
 * Runs the registry's real SQL against tests/helpers/receivablesDbFake.ts.
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
const FUTURE = '2099-01-01 00:00:00';

beforeEach(async () => {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', is_test: false, manifest_json: '{}', digest: 'd'.repeat(64),
		created_at: '2026-09-01 10:00:00',
	});
});

function invite(token: string, over: Record<string, unknown> = {}) {
	fake.seed('receivable_invites', {
		token, receivable_id: RID, from_tenant: OWNER, role: 'borrower', label: null, email: 'someone@example.test',
		expires_at: FUTURE, accepted_at: null, accepted_by: null, revoked_at: null,
		claim_id: null, offer_id: null, reminded_at: null, lapse_recorded_at: null,
		created_at: '2026-09-03 09:00:00',
		...over,
	});
}

function claimRow() {
	fake.seed('receivable_claims', {
		id: 'claim-1', receivable_id: RID, tenant_id: LENDER, financier: 'Lender Co', amount: 500, currency: 'USD',
		claim_date: '2026-09-02', status: 'active', manifest_json: '{}', digest: 'e'.repeat(64),
		affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
	});
}

function offerRow() {
	fake.seed('receivable_offers', {
		id: 'offer-1', receivable_id: RID, tenant_id: OWNER, financier: 'Lender Co', amount: 800, currency: 'USD',
		price: '2% flat', recourse: 'recourse', repayment: null, expires_at: FUTURE, manifest_json: '{}',
		signature_json: null, digest: 'a'.repeat(64), anchor_json: null, accepted_at: null, accepted_by: null,
		declined_at: null, declined_reason: null, created_at: '2026-09-03 08:00:00',
	});
}

const lastAttestation = () => {
	const rows = fake.rows('receivable_attestations');
	return rows[rows.length - 1];
};

const debtorAnswers = { theirReference: 'PO-77', by: 'Jane Roe', goodsReceived: true, amountCorrect: true, noOffsets: true, notAlreadyPaid: true };

/** Each writer, the row it must leave, and the class that row reads as. */
const WRITERS: Array<{
	name: string;
	run: () => Promise<unknown>;
	source: string; role: string; tenant: string; cls: string; prefix?: string;
}> = [
	{
		name: 'acceptDiligence',
		run: () => reg.acceptDiligence(LENDER, RID, { financier: 'Lender Co', method: 'phone' }),
		source: 'diligence', role: 'other', tenant: LENDER, cls: 'diligence', prefix: 'DILIGENCE —',
	},
	{
		name: 'confirmByToken: confirmed',
		run: () => { invite('tok-b1', { role: 'buyer' }); return reg.confirmByToken('tok-b1', 'confirmed', debtorAnswers); },
		source: 'debtor_confirmation', role: 'buyer', tenant: OWNER, cls: 'consent',
	},
	{
		name: 'confirmByToken: not ours',
		run: () => { invite('tok-b2', { role: 'buyer' }); return reg.confirmByToken('tok-b2', 'not_ours', debtorAnswers); },
		source: 'debtor_dispute', role: 'other', tenant: OWNER, cls: 'party_dispute', prefix: 'DISPUTED —',
	},
	{
		name: 'confirmByToken: amount wrong',
		run: () => { invite('tok-b3', { role: 'buyer' }); return reg.confirmByToken('tok-b3', 'amount_wrong', debtorAnswers); },
		source: 'debtor_dispute', role: 'other', tenant: OWNER, cls: 'party_dispute', prefix: 'DISPUTED —',
	},
	{
		name: 'affirmClaimByToken: received',
		run: () => { claimRow(); invite('tok-c1', { from_tenant: LENDER, claim_id: 'claim-1' }); return reg.affirmClaimByToken('tok-c1', 'received', { by: 'Sam Supplier' }); },
		source: 'receipt_confirmation', role: 'supplier', tenant: LENDER, cls: 'consent',
	},
	{
		name: 'affirmClaimByToken: not received',
		run: () => { claimRow(); invite('tok-c2', { from_tenant: LENDER, claim_id: 'claim-1' }); return reg.affirmClaimByToken('tok-c2', 'not_received', { by: 'Sam Supplier' }); },
		source: 'receipt_dispute', role: 'other', tenant: LENDER, cls: 'party_dispute', prefix: 'DISPUTED —',
	},
	{
		name: 'affirmClaimByToken: amount wrong',
		run: () => { claimRow(); invite('tok-c3', { from_tenant: LENDER, claim_id: 'claim-1' }); return reg.affirmClaimByToken('tok-c3', 'amount_wrong', { by: 'Sam Supplier', amountReceived: 300 }); },
		source: 'receipt_dispute', role: 'other', tenant: LENDER, cls: 'party_dispute', prefix: 'DISPUTED —',
	},
	{
		name: 'confirmRecordByToken: accurate',
		run: () => { invite('tok-r1'); return reg.confirmRecordByToken('tok-r1', 'accurate', { by: 'Sam Supplier' }); },
		source: 'record_confirmation', role: 'supplier', tenant: OWNER, cls: 'consent',
	},
	{
		name: 'confirmRecordByToken: wrong',
		run: () => { invite('tok-r2'); return reg.confirmRecordByToken('tok-r2', 'wrong', { by: 'Sam Supplier', correction: 'Face is 900' }); },
		source: 'record_dispute', role: 'other', tenant: OWNER, cls: 'party_dispute', prefix: 'DISPUTED —',
	},
	{
		name: 'recordLapse',
		run: () => {
			invite('tok-l1', { role: 'buyer', expires_at: '2026-09-10 00:00:00' });
			return reg.recordLapse({
				token: 'tok-l1', receivableId: RID, role: 'buyer', claimId: null, email: null,
				expiresAt: '2026-09-10 00:00:00', createdAt: '2026-09-03 09:00:00', remindedAt: null,
			});
		},
		source: 'unanswered', role: 'other', tenant: OWNER, cls: 'system_note', prefix: 'UNANSWERED —',
	},
	{
		name: 'respondToOffer: accept',
		run: () => { offerRow(); invite('tok-o1', { offer_id: 'offer-1' }); return reg.respondToOffer('tok-o1', 'accept', { by: 'Sam Supplier', initials: 'SS' }); },
		source: 'offer_acceptance', role: 'supplier', tenant: OWNER, cls: 'consent',
	},
	{
		name: 'respondToOffer: decline',
		run: () => { offerRow(); invite('tok-o2', { offer_id: 'offer-1' }); return reg.respondToOffer('tok-o2', 'decline', { by: 'Sam Supplier', reason: 'Too expensive' }); },
		source: 'offer_decline', role: 'other', tenant: OWNER, cls: 'system_note', prefix: 'DECLINED —',
	},
];

describe('every writer records its source', () => {
	for (const w of WRITERS) {
		it(w.name, async () => {
			const result: any = await w.run();
			expect(result === true || result?.ok === true, JSON.stringify(result)).toBe(true);
			const row = lastAttestation();
			expect(row).toMatchObject({ receivable_id: RID, source: w.source, role: w.role, tenant_id: w.tenant });
			expect(classifyAttestation(row.role, row.statement, row.source)).toBe(w.cls);

			// The system prefix and the source agree, so legacy rows (classified by prefix) and new
			// rows (classified by source) read the same. Consent is the one deliberate difference:
			// without a source it is never inferred.
			if (w.prefix) {
				expect(RESERVED_STATEMENT_PREFIXES).toContain(w.prefix);
				expect(String(row.statement).startsWith(w.prefix)).toBe(true);
				expect(classifyAttestation(row.role, row.statement, null)).toBe(w.cls);
			} else {
				for (const p of RESERVED_STATEMENT_PREFIXES) expect(String(row.statement).startsWith(p)).toBe(false);
				expect(classifyAttestation(row.role, row.statement, null)).toBe('party_statement');
			}

			const s = await reg.getReceivableStatus(RID);
			const pub = s!.attestations.find((a) => a.id === row.id)!;
			expect(pub.class).toBe(w.cls);
			expect(pub).not.toHaveProperty('source');
		});
	}

	it('addAttestation itself writes the source it is given', async () => {
		const r = await reg.addAttestation(OWNER, RID, { role: 'inspector', label: 'Surveyor', statement: 'Inspected 400 cartons.', source: 'party_statement' });
		expect(r.ok).toBe(true);
		expect(lastAttestation()).toMatchObject({ role: 'inspector', source: 'party_statement' });
	});
});

describe('lookup: the additive class field', () => {
	it('classifies new rows by source and legacy rows by prefix, never exposing source or tenant', async () => {
		fake.seed('receivable_attestations', {
			id: 'legacy-dispute', receivable_id: RID, tenant_id: OWNER, role: 'other', label: 'Bigco Plc',
			statement: 'DISPUTED — states the amount is wrong.', attested_at: '2026-09-03', manifest_json: '{}',
			digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:00', source: null,
		});
		fake.seed('receivable_attestations', {
			id: 'legacy-buyer', receivable_id: RID, tenant_id: OWNER, role: 'buyer', label: 'Bigco Plc',
			statement: 'Confirms invoice INV-0042.', attested_at: '2026-09-03', manifest_json: '{}',
			digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:01', source: null,
		});
		fake.seed('receivable_attestations', {
			id: 'typed', receivable_id: RID, tenant_id: LENDER, role: 'other', label: 'Lender Co',
			statement: 'DISPUTED — slipped in before the prefix rule.', attested_at: '2026-09-03', manifest_json: '{}',
			digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:02', source: 'party_statement',
		});
		const s = await reg.getReceivableStatus(RID);
		expect(s!.attestations.map((a) => [a.id, a.class])).toEqual([
			['legacy-dispute', 'party_dispute'],
			['legacy-buyer', 'party_statement'],
			['typed', 'party_statement'],
		]);
		const text = JSON.stringify(s);
		expect(text).not.toContain('"source"');
		expect(text).not.toContain('tenant');
	});
});

describe('the diligence gate reads the source first', () => {
	const claim = () => reg.addClaim(LENDER, RID, { financier: 'Lender Co', amount: 100 });

	it('an acceptance written by acceptDiligence satisfies it', async () => {
		await reg.acceptDiligence(LENDER, RID, { financier: 'Lender Co', method: 'relationship' });
		expect(await claim()).toMatchObject({ ok: true });
	});

	it('a party statement wearing the DILIGENCE prefix does not', async () => {
		fake.seed('receivable_attestations', {
			id: 'forged', receivable_id: RID, tenant_id: LENDER, role: 'other', label: 'Lender Co',
			statement: 'DILIGENCE — trust me.', attested_at: '2026-09-03', manifest_json: '{}',
			digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:00', source: 'party_statement',
		});
		expect(await claim()).toMatchObject({ ok: false, error: 'diligence_required' });
	});

	it("another tenant's sourced acceptance does not", async () => {
		await reg.acceptDiligence(OWNER, RID, { financier: 'Owner Co', method: 'phone' });
		expect(await claim()).toMatchObject({ ok: false, error: 'diligence_required' });
	});

	it('a legacy prefix row (source NULL) still does', async () => {
		fake.seed('receivable_attestations', {
			id: 'legacy', receivable_id: RID, tenant_id: LENDER, role: 'other', label: 'Lender Co',
			statement: 'DILIGENCE — accepts responsibility for having personally verified this debtor via a phone call.',
			attested_at: '2026-09-03', manifest_json: '{}', digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:00', source: null,
		});
		expect(await claim()).toMatchObject({ ok: true });
	});
});

describe('addClaim: headroom is summed by the stored ID', () => {
	it('an ID with surrounding whitespace no longer skips the headroom check', async () => {
		fake.rows('receivables')[0].is_test = true;
		claimRow(); // 500 of 1000 already claimed
		for (const padded of [` ${RID} `, `${RID}\n`, `\t${RID}`]) {
			const r = await reg.addClaim(LENDER, padded, { financier: 'Second Lender', amount: 600 });
			expect(r).toMatchObject({ ok: false, error: 'exceeds_headroom', available: 500, claimed: 500, face: 1000 });
		}
		expect(fake.rows('receivable_claims')).toHaveLength(1);
	});

	it('within headroom, a padded ID records against the stored ID', async () => {
		fake.rows('receivables')[0].is_test = true;
		claimRow();
		const r = await reg.addClaim(LENDER, ` ${RID} `, { financier: 'Second Lender', amount: 200 });
		expect(r).toMatchObject({ ok: true, claimed: 700, available: 300 });
		expect(fake.rows('receivable_claims')[1].receivable_id).toBe(RID);
	});
});
