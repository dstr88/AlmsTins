import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addMonths, answerReadWindow, dayOf } from '../../src/lib/receivables/answerWindow';

/**
 * Receivables downloads, Part B: an emailed request that has been answered hands the person who
 * answered their own answer and the receivable it is about, read-only, until six months after the
 * due date (an extension by the sender moves it; no due date counts from the link's expiry). The
 * link can't answer twice, revoking closes it, a withdrawn receivable does not. Records are made
 * by the registry over its real SQL (tests/helpers/receivablesDbFake.ts). All values invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
vi.mock('@/lib/receivables/server/fingerprintBackfill', () => ({
	kickFingerprintBackfill: () => {},
	backfillWithin: async () => ({ fingerprints: 'off' }),
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('no stamping here'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading here'); }
	},
}));

const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const OWNER = 'tenant-owner';
const debtorAnswers = { theirReference: 'PO-77', by: 'Jane Roe', goodsReceived: true, amountCorrect: true, noOffsets: true, notAlreadyPaid: true };

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

beforeEach(async () => {
	vi.resetModules();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	fake = createReceivablesDbFake();
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
});
afterEach(() => { vi.unstubAllEnvs(); });

/** A receivable, a debtor request for it, and the debtor's answer. */
async function answered(dueDate: string | null = '2027-01-31') {
	const r = await reg.createReceivable(OWNER, {
		supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-0091', face: 1000, currency: 'USD',
		isTest: true, ...(dueDate ? { dueDate } : {}),
	} as any);
	if (!r.ok) throw new Error(JSON.stringify(r));
	const inv = await reg.createInvite(OWNER, { role: 'buyer', receivableId: r.id, email: 'ap@example.test' } as any);
	const token = (inv as any).token as string;
	const ans = await reg.confirmByToken(token, 'confirmed', debtorAnswers);
	if (!ans.ok) throw new Error(JSON.stringify(ans));
	return { rid: r.id, token, attestationId: ans.attestationId };
}

async function download(token: string, which: string) {
	const mod: any = await import('../../src/pages/api/verify/receivables/answer-proof.ts');
	const res: Response = await mod.GET({ request: new Request(`https://almstins.com/api/verify/receivables/answer-proof?t=${encodeURIComponent(token)}&which=${which}`) });
	return { status: res.status, headers: res.headers, body: await res.json() };
}

describe('the answer window', () => {
	it('six calendar months after the due date, held to the end of a short month', () => {
		expect(addMonths('2027-01-31', 6)).toBe('2027-07-31');
		expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
		expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
	});
	it('a later extension wins; an earlier one does not', () => {
		expect(answerReadWindow({ dueDate: '2027-01-31', latestExtension: '2027-03-15', linkExpiresAt: '2026-12-05 10:00:00' }))
			.toEqual({ readUntil: '2027-09-15', basis: 'extension' });
		expect(answerReadWindow({ dueDate: '2027-01-31', latestExtension: '2027-01-10', linkExpiresAt: '2026-12-05 10:00:00' }))
			.toEqual({ readUntil: '2027-07-31', basis: 'due_date' });
	});
	it('no due date: six months after the link stopped taking answers', () => {
		expect(answerReadWindow({ dueDate: null, latestExtension: null, linkExpiresAt: '2026-12-05 10:00:00' }))
			.toEqual({ readUntil: '2027-06-05', basis: 'link_expiry' });
	});
	it('reads only real dates', () => {
		expect(dayOf('2027-02-30')).toBeNull();
		expect(dayOf('soon')).toBeNull();
		expect(dayOf('2026-12-05 10:00:00')).toBe('2026-12-05');
	});
});

describe('an answered link', () => {
	it('hands back the answer and the receivable, each a proof file that names the right record', async () => {
		const a = await answered();
		const ans = await download(a.token, 'answer');
		expect(ans.status).toBe(200);
		expect(ans.headers.get('content-disposition')).toMatch(/^attachment; filename="almstins-attestation-[0-9a-f]{12}\.proof\.json"$/);
		expect(ans.body.proof_format).toBe('almstins-signed-record/v1');
		expect(ans.body.kind).toBe('attestation');
		expect(ans.body.record_id).toBe(a.attestationId);
		const rcv = await download(a.token, 'receivable');
		expect(rcv.status).toBe(200);
		expect(rcv.body.kind).toBe('receivable');
		expect(rcv.body.record_id).toBe(a.rid);
	});

	it('each file passes the public checker', async () => {
		const a = await answered();
		const { verifySignedRecord } = await import('../../src/lib/recordProof/signedRecord');
		const { getPublishedKeys } = await import('../../src/lib/recordProof/signing');
		const keys = getPublishedKeys().map((k) => ({ key_id: k.key_id, public_key_hex: k.public_key_hex }));
		for (const which of ['answer', 'receivable']) {
			expect(verifySignedRecord((await download(a.token, which)).body, keys).verdict).toBe('verified');
		}
	});

	it('still can\'t answer a second time', async () => {
		const a = await answered();
		expect(await reg.confirmByToken(a.token, 'confirmed', debtorAnswers)).toEqual({ ok: false, error: 'used' });
	});

	it('reads until six months after the due date, then closes', async () => {
		const a = await answered('2027-01-31');
		expect(await reg.readAnswerProofByToken(a.token, new Date('2027-07-31T23:00:00Z'))).toMatchObject({ ok: true, readUntil: '2027-07-31', basis: 'due_date' });
		expect(await reg.readAnswerProofByToken(a.token, new Date('2027-08-01T00:00:00Z'))).toEqual({ ok: false, error: 'closed', readUntil: '2027-07-31' });
	});

	it('an extension by the sender moves the window', async () => {
		const a = await answered('2027-01-31');
		fake.seed('receivable_status_events', {
			id: 'ev-1', tenant_id: OWNER, receivable_id: a.rid, claim_id: 'claim-x', kind: 'extended',
			new_promised_date: '2027-04-30', reason_code: null, reason_note: null, manifest_json: '{}', signature_json: null,
			digest: 'e'.repeat(64), anchor_json: null, created_at: '2027-01-20 10:00:00',
		});
		expect(await reg.readAnswerProofByToken(a.token, new Date('2027-09-01T00:00:00Z'))).toMatchObject({ ok: true, readUntil: '2027-10-30', basis: 'extension' });
	});

	it('another tenant\'s extension does not', async () => {
		const a = await answered('2027-01-31');
		fake.seed('receivable_status_events', {
			id: 'ev-2', tenant_id: 'tenant-someone-else', receivable_id: a.rid, claim_id: 'claim-y', kind: 'extended',
			new_promised_date: '2027-12-31', reason_code: null, reason_note: null, manifest_json: '{}', signature_json: null,
			digest: 'f'.repeat(64), anchor_json: null, created_at: '2027-01-20 10:00:00',
		});
		expect(await reg.readAnswerProofByToken(a.token, new Date('2027-03-01T00:00:00Z'))).toMatchObject({ readUntil: '2027-07-31', basis: 'due_date' });
	});

	it('with no due date, reads until six months after the link expired', async () => {
		const a = await answered(null);
		const expires = String(fake.rows('receivable_invites').find((x) => x.token === a.token)!.expires_at).slice(0, 10);
		const read = await reg.readAnswerProofByToken(a.token);
		expect(read).toMatchObject({ ok: true, basis: 'link_expiry', readUntil: addMonths(expires, 6) });
	});

	it('a revoked link hands out nothing', async () => {
		// The desk revokes only unanswered links today (revokeInvite), so this sets revoked_at
		// directly: the read must honor it whenever it is set.
		const a = await answered();
		fake.rows('receivable_invites').find((x) => x.token === a.token)!.revoked_at = '2026-12-01 10:00:00';
		expect((await download(a.token, 'answer')).status).toBe(404);
		expect((await download(a.token, 'receivable')).status).toBe(404);
	});

	it('a withdrawn receivable still hands back the answer and the receivable', async () => {
		const a = await answered();
		const del = await reg.deleteReceivable(OWNER, a.rid);
		expect(del.ok).toBe(true);
		expect((await download(a.token, 'answer')).status).toBe(200);
		expect((await download(a.token, 'receivable')).status).toBe(200);
	});

	it('an unanswered, unknown or pre-existing link hands out nothing', async () => {
		const r = await reg.createReceivable(OWNER, { supplier: 'Example Supplier Co', buyer: 'Example Buyer Co', invoiceNo: 'TEST-0092', face: 10, currency: 'USD', isTest: true } as any);
		const inv = await reg.createInvite(OWNER, { role: 'buyer', receivableId: (r as any).id } as any);
		expect((await download((inv as any).token, 'answer')).status).toBe(404);
		expect((await download('no-such-token', 'answer')).status).toBe(404);
		// Answered before links remembered their answer: answer_id is empty.
		const a = await answered();
		fake.rows('receivable_invites').find((x) => x.token === a.token)!.answer_id = null;
		expect((await download(a.token, 'answer')).body).toEqual({ ok: false, error: 'no_record' });
	});

	it('refuses a bad request shape', async () => {
		const a = await answered();
		expect((await download(a.token, 'everything')).status).toBe(400);
		expect((await download('', 'answer')).status).toBe(400);
	});
});
