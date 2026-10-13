import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake, type Row } from '../helpers/receivablesDbFake';
import { ADD_DISCHARGE_SIGNATURE, ADD_RECEIVABLE_DELETED_AT } from '../../src/lib/receivables/schema';

/**
 * Receivables S2: soft delete, through the registry's real SQL on tests/helpers/receivablesDbFake.ts.
 *
 *   - the delete batch: deleted_at set, every row kept, the owner's open requests revoked, pending
 *     offers ended, files reduced to their tombstones, one transaction, idempotent, owner only,
 *     never a hard delete (unavailable while the column is missing);
 *   - the reader and writer table: every new write answers withdrawn; discharge, anchor stamping
 *     and the anchor cron still see the record; the public status keeps answering only while
 *     another tenant has evidence on it; ownsReceivable and the owner's list drop it;
 *   - request links after the withdrawal (the owner's are revoked; another party's receipt link on
 *     its own claim stays answerable, confirm or dispute), the document tombstone, the same-tenant
 *     restore and the permanent cross-tenant collision;
 *   - soft delete keeps working while an unrelated column add fails (its own sticky flag), and
 *     when its own add times out on a column that is already there.
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
const OTHER = 'tenant-third';
const RID = 'c0'.repeat(32);
const OTHER_RID = 'c1'.repeat(32);
const SEED_A = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const FAR = '2099-01-01 00:00:00';
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const PENDING_ANCHOR = '{"type":"opentimestamps","receipt":"pending"}';

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
}

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

function seedClaim(id: string, tenant: string, amount: number, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id, receivable_id: RID, tenant_id: tenant, financier: `${tenant} financier`,
		amount, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
		...over,
	});
}

function seedAttestation(id: string, tenant: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_attestations', {
		id, receivable_id: RID, tenant_id: tenant, role: 'supplier', label: 'Someone',
		statement: 'A statement.', attested_at: '2026-09-03', manifest_json: '{}', signature_json: null,
		digest: 'f'.repeat(64), anchor_json: null, created_at: '2026-09-03 10:00:00',
		...over,
	});
}

function seedInvite(token: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_invites', {
		token, receivable_id: RID, from_tenant: OWNER, role: 'buyer', label: null, email: 'ap@debtor.test',
		expires_at: FAR, accepted_at: null, accepted_by: null, revoked_at: null,
		claim_id: null, offer_id: null, created_at: '2026-09-04 10:00:00',
		...over,
	});
}

function seedOffer(id: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_offers', {
		id, receivable_id: RID, tenant_id: OWNER, financier: 'Owner Capital', amount: 500, currency: 'USD',
		price: null, recourse: 'recourse', repayment: null, expires_at: FAR,
		manifest_json: '{}', signature_json: null, digest: 'a'.repeat(64), anchor_json: null,
		accepted_at: null, accepted_by: null, declined_at: null, declined_reason: null,
		created_at: '2026-09-05 10:00:00',
		...over,
	});
}

function seedDocument(id: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_documents', {
		id, receivable_id: RID, tenant_id: OWNER, filename: 'promissory-note.pdf', mime_type: 'application/pdf',
		file_size: 5, sha256: 'b'.repeat(64), data: Buffer.from('hello').toString('base64'),
		uploaded_at: '2026-09-06 10:00:00', purged_at: null,
		...over,
	});
}

/** The full scene: a financed record with requests, offers, files and every kind of child row. */
function seedScene() {
	seedReceivable({ anchor_json: PENDING_ANCHOR });
	seedReceivable({ id: OTHER_RID, invoice_no: 'INV-0099', created_at: '2026-09-01 11:00:00' });
	seedClaim('claim-lender', LENDER, 400);
	seedClaim('claim-owner', OWNER, 100);
	seedAttestation('att-owner', OWNER, { role: 'buyer', statement: 'Confirms invoice INV-0042 via a single-use link.' });
	seedAttestation('att-lender', LENDER, { statement: 'Inspected the goods.' });
	fake.seed('receivable_reverifications', {
		id: 'rv-lender', receivable_id: RID, tenant_id: LENDER, verdict: 'attention', checks_json: '[]',
		manifest_json: '{}', signature_json: null, digest: '9'.repeat(64), anchor_json: null, created_at: '2026-09-07 10:00:00',
	});
	seedInvite('tok-buyer-open');
	seedInvite('tok-borrower-open', { role: 'borrower' });
	seedInvite('tok-role-open', { role: 'financier' });
	seedInvite('tok-buyer-answered', { accepted_at: '2026-09-08 10:00:00', accepted_by: 'Jane Roe' });
	seedInvite('tok-already-revoked', { revoked_at: '2026-09-08 11:00:00' });
	seedInvite('tok-owner-claimbound', { receivable_id: null, role: 'borrower', claim_id: 'claim-owner' });
	seedInvite('tok-offer-open', { role: 'borrower', offer_id: 'offer-pending' });
	seedInvite('tok-lender-claimbound', { receivable_id: null, from_tenant: LENDER, role: 'borrower', claim_id: 'claim-lender' });
	seedInvite('tok-other-record', { receivable_id: OTHER_RID });
	seedOffer('offer-pending');
	seedOffer('offer-accepted', { accepted_at: '2026-09-09 10:00:00', accepted_by: 'Client' });
	seedOffer('offer-declined', { declined_at: '2026-09-09 11:00:00' });
	seedOffer('offer-expired', { expires_at: '2020-01-01 00:00:00' });
	seedDocument('doc-held');
	seedDocument('doc-purged', { data: null, purged_at: '2026-09-10 10:00:00', sha256: 'c'.repeat(64) });
	seedDocument('doc-other', { receivable_id: OTHER_RID });
	fake.seed('receivable_access', { id: 'acc-1', receivable_id: RID, tenant_id: LENDER, counterparty: OWNER, role: 'financier', granted_by: OWNER, granted_at: '2026-09-04 12:00:00', revoked_at: null });
	fake.seed('receivable_seen', { tenant_id: OWNER, receivable_id: RID, seen_at: '2026-09-11 10:00:00' });
	fake.seed('receivable_seen', { tenant_id: LENDER, receivable_id: RID, seen_at: '2026-09-11 10:00:00' });
}

const TABLES = [
	'receivables', 'receivable_claims', 'receivable_attestations', 'receivable_reverifications',
	'receivable_invites', 'receivable_offers', 'receivable_documents', 'receivable_access', 'receivable_seen',
];
const counts = () => Object.fromEntries(TABLES.map((t) => [t, fake.rows(t).length]));
const row = (table: string, key: string, id: string): Row => fake.rows(table).find((r) => r[key] === id)!;
const invite = (token: string) => row('receivable_invites', 'token', token);

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED_A);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('deleteReceivable: the soft-delete batch', () => {
	it('sets deleted_at, bumps updated_at, and keeps every row', async () => {
		seedScene();
		const before = counts();
		const r = await reg.deleteReceivable(OWNER, RID);
		expect(r).toEqual({ ok: true, withdrawnAt: expect.stringMatching(STAMP) });
		const at = (r as { withdrawnAt: string }).withdrawnAt;
		const rcv = row('receivables', 'id', RID);
		expect(rcv.deleted_at).toBe(at);
		expect(rcv.updated_at).toBe(at);
		expect(row('receivables', 'id', OTHER_RID).deleted_at ?? null).toBeNull();
		expect(counts()).toEqual(before);
		expect(fake.statements(/^DELETE /)).toEqual([]);
	});

	it('runs as one db.batch', async () => {
		seedScene();
		await reg.deleteReceivable(OWNER, RID);
		expect(fake.dataBatches()).toHaveLength(1);
		const sqls = fake.dataBatches()[0].map((s) => s.sql);
		expect(sqls[0]).toMatch(/^UPDATE receivables SET deleted_at = \?, updated_at = \? WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL$/);
		// The record's requests, plus one statement per owner claim (claim-owner); none for the lender's claim.
		expect(sqls.filter((s) => s.startsWith('UPDATE receivable_invites'))).toHaveLength(2);
		expect(sqls.some((s) => s.startsWith('UPDATE receivable_offers SET expires_at'))).toBe(true);
		expect(sqls.some((s) => s.startsWith('UPDATE receivable_documents SET data = NULL'))).toBe(true);
		// Every statement in the batch is scoped to the owner.
		for (const s of fake.dataBatches()[0]) expect(s.args).toContain(OWNER);
	});

	it("revokes only the owner's open requests for the record", async () => {
		seedScene();
		const r = await reg.deleteReceivable(OWNER, RID);
		const at = (r as { withdrawnAt: string }).withdrawnAt;
		for (const t of ['tok-buyer-open', 'tok-borrower-open', 'tok-role-open', 'tok-owner-claimbound', 'tok-offer-open']) {
			expect(invite(t).revoked_at, t).toBe(at);
		}
		expect(invite('tok-buyer-answered').revoked_at).toBeNull();
		expect(invite('tok-buyer-answered').accepted_at).toBe('2026-09-08 10:00:00');
		expect(invite('tok-already-revoked').revoked_at).toBe('2026-09-08 11:00:00');
		// Another tenant's request, and the owner's request on another record, stay open.
		expect(invite('tok-lender-claimbound').revoked_at).toBeNull();
		expect(invite('tok-other-record').revoked_at).toBeNull();
	});

	it('ends pending offers now, and leaves answered and expired ones alone', async () => {
		seedScene();
		const r = await reg.deleteReceivable(OWNER, RID);
		const at = (r as { withdrawnAt: string }).withdrawnAt;
		expect(row('receivable_offers', 'id', 'offer-pending')).toMatchObject({ expires_at: at, accepted_at: null, declined_at: null });
		expect(row('receivable_offers', 'id', 'offer-accepted').expires_at).toBe(FAR);
		expect(row('receivable_offers', 'id', 'offer-declined').expires_at).toBe(FAR);
		expect(row('receivable_offers', 'id', 'offer-expired').expires_at).toBe('2020-01-01 00:00:00');
	});

	it('drops file bytes to the tombstone, and only on this record', async () => {
		seedScene();
		const r = await reg.deleteReceivable(OWNER, RID);
		const at = (r as { withdrawnAt: string }).withdrawnAt;
		expect(row('receivable_documents', 'id', 'doc-held')).toMatchObject({
			data: null, purged_at: at, filename: 'promissory-note.pdf', mime_type: 'application/pdf', file_size: 5, sha256: 'b'.repeat(64),
			uploaded_at: '2026-09-06 10:00:00',
		});
		expect(row('receivable_documents', 'id', 'doc-purged').purged_at).toBe('2026-09-10 10:00:00');
		expect(row('receivable_documents', 'id', 'doc-other').data).not.toBeNull();
	});

	it('a second delete answers ok with the first time and writes nothing', async () => {
		seedScene();
		const first = await reg.deleteReceivable(OWNER, RID);
		const writes = fake.log.length;
		const second = await reg.deleteReceivable(OWNER, RID);
		expect(second).toEqual(first);
		expect(fake.dataBatches()).toHaveLength(1);
		expect(fake.log.slice(writes).filter((s) => !s.sql.startsWith('SELECT'))).toEqual([]);
	});

	it('another tenant, or an unknown ID, gets not_found and changes nothing', async () => {
		seedScene();
		expect(await reg.deleteReceivable(LENDER, RID)).toEqual({ ok: false, error: 'not_found' });
		expect(await reg.deleteReceivable(OWNER, 'ff'.repeat(32))).toEqual({ ok: false, error: 'not_found' });
		expect(fake.dataBatches()).toEqual([]);
		expect(row('receivables', 'id', RID).deleted_at ?? null).toBeNull();
		expect(invite('tok-buyer-open').revoked_at).toBeNull();
	});

	it('the batch is atomic: a failure part-way leaves everything as it was', async () => {
		await load({ failDml: (sql) => sql.startsWith('UPDATE receivable_documents SET data = NULL') });
		seedScene();
		await expect(reg.deleteReceivable(OWNER, RID)).rejects.toThrow(/failed on purpose/);
		expect(row('receivables', 'id', RID).deleted_at ?? null).toBeNull();
		expect(invite('tok-buyer-open').revoked_at).toBeNull();
		expect(row('receivable_offers', 'id', 'offer-pending').expires_at).toBe(FAR);
		expect(row('receivable_documents', 'id', 'doc-held').data).not.toBeNull();
	});

	it('without the deleted_at column: unavailable, and never a hard delete', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_RECEIVABLE_DELETED_AT });
		seedScene();
		const before = counts();
		expect(await reg.deleteReceivable(OWNER, RID)).toEqual({ ok: false, error: 'unavailable' });
		expect(reg.receivableColumnsEnsured()).toBe(false);
		expect(counts()).toEqual(before);
		expect(fake.statements(/^(DELETE|UPDATE) /)).toEqual([]);
		expect(fake.dataBatches()).toEqual([]);
		expect(err).toHaveBeenCalled();
	});
});

describe('the reader and writer table on a withdrawn record', () => {
	let withdrawnAt: string;
	beforeEach(async () => {
		seedScene();
		withdrawnAt = ((await reg.deleteReceivable(OWNER, RID)) as { withdrawnAt: string }).withdrawnAt;
	});

	const WITHDRAWN = () => ({
		ok: false, error: 'withdrawn', withdrawnAt,
		message: `This receivable was withdrawn on ${withdrawnAt.slice(0, 10)} by whoever recorded it. Almstins no longer records new claims, statements, requests or files on it. Everything already on file stays there.`,
	});

	it('every new write answers withdrawn and records nothing', async () => {
		const before = counts();
		expect(await reg.addClaim(LENDER, RID, { financier: 'Lender Co', amount: 100 })).toEqual(WITHDRAWN());
		expect(await reg.addClaim(OTHER, ` ${RID} `, { financier: 'Third Co', amount: 100, force: true })).toEqual(WITHDRAWN());
		expect(await reg.addAttestation(LENDER, RID, { role: 'supplier', label: 'Lender Co', statement: 'A note.', source: 'party_statement' })).toEqual(WITHDRAWN());
		expect(await reg.acceptDiligence(LENDER, RID, { financier: 'Lender Co', method: 'phone' })).toEqual(WITHDRAWN());
		expect(await reg.createInvite(OWNER, { role: 'buyer', receivableId: RID, email: 'ap@debtor.test' })).toEqual(WITHDRAWN());
		expect(await reg.createInvite(LENDER, { role: 'borrower', claimId: 'claim-lender' })).toEqual(WITHDRAWN());
		expect(await reg.createInvite(OWNER, { role: 'borrower', offerId: 'offer-accepted' })).toEqual(WITHDRAWN());
		expect(await reg.createOffer(OWNER, RID, { financier: 'Owner Capital', amount: 100, recourse: 'recourse' })).toEqual(WITHDRAWN());
		expect(await reg.addDocument(OWNER, RID, { filename: 'x.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x') })).toEqual(WITHDRAWN());
		expect(await reg.reverifyReceivable(LENDER, RID)).toEqual(WITHDRAWN());
		expect(await reg.settleReceivable(OWNER, RID)).toEqual(WITHDRAWN());
		expect(counts()).toEqual(before);
		expect(row('receivables', 'id', RID).settled_at).toBeNull();
	});

	it('owner-only writes by anyone else keep their plain not_found', async () => {
		expect(await reg.createInvite(LENDER, { role: 'buyer', receivableId: RID })).toEqual({ ok: false, error: 'not_found' });
		expect(await reg.createOffer(LENDER, RID, { financier: 'Lender Co', amount: 100, recourse: 'recourse' })).toEqual({ ok: false, error: 'not_found' });
		expect(await reg.addDocument(LENDER, RID, { filename: 'x.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x') })).toEqual({ ok: false, error: 'not_found' });
		expect(await reg.settleReceivable(LENDER, RID)).toEqual({ ok: false, error: 'not_found', message: 'No receivable of yours found for that ID.' });
	});

	it('Verify now answers withdrawn even when the public status would answer null', async () => {
		fake.rows('receivable_claims').splice(0);
		fake.rows('receivable_attestations').splice(0);
		expect(await reg.getReceivableStatus(RID)).toBeNull();
		expect(await reg.reverifyReceivable(OTHER, RID)).toEqual(WITHDRAWN());
	});

	it('a party can still release its own claim, against the real face value', async () => {
		const r = await reg.dischargeClaim(LENDER, 'claim-lender', 'repaid');
		expect(r).toMatchObject({ ok: true, face: 1000, claimed: 100, available: 900 });
		expect(row('receivable_claims', 'id', 'claim-lender').status).toBe('discharged');
	});

	it('ownsReceivable is false for the owner', async () => {
		expect(await reg.ownsReceivable(OWNER, RID)).toBe(false);
		expect(await reg.ownsReceivable(OWNER, OTHER_RID)).toBe(true);
	});

	it("the public status still answers, marked withdrawn, while another tenant's claim is on it", async () => {
		const s = await reg.getReceivableStatus(RID);
		expect(s).toMatchObject({ id: RID, withdrawn: true, withdrawnAt, lifecycle: 'financed', status: 'partially_financed', claimed: 500, available: 500 });
		expect(s!.claims.map((c) => c.id)).toEqual(['claim-lender', 'claim-owner']);
		expect(Object.keys(s!).slice(-2)).toEqual(['withdrawn', 'withdrawnAt']);
	});

	it("another tenant's statement alone keeps it answering", async () => {
		fake.rows('receivable_claims').splice(0);
		const s = await reg.getReceivableStatus(RID);
		expect(s).toMatchObject({ withdrawn: true, withdrawnAt, lifecycle: 'created' });
	});

	it("only the owner's own evidence (and answers stored under the owner): null, as if never recorded", async () => {
		const claims = fake.rows('receivable_claims');
		claims.splice(0, claims.length, ...claims.filter((c) => c.tenant_id === OWNER));
		const atts = fake.rows('receivable_attestations');
		atts.splice(0, atts.length, ...atts.filter((a) => a.tenant_id === OWNER));
		expect(await reg.getReceivableStatus(RID)).toBeNull();
	});

	it("listReceivables: hidden from the owner (who also claimed it), kept for the claimant, marked withdrawn", async () => {
		const mine = await reg.listReceivables(OWNER);
		expect(mine.map((r) => r.id)).toEqual([OTHER_RID]);
		expect(mine[0]).toMatchObject({ withdrawn: false, withdrawnAt: null, mine: true });
		const lender = await reg.listReceivables(LENDER);
		expect(lender).toEqual([expect.objectContaining({ id: RID, mine: false, withdrawn: true, withdrawnAt })]);
		// The bump makes it an unseen update for the claimant.
		expect(lender[0].updated).toBe(true);
	});

	it('anchor stamping and the anchor cron still see it', async () => {
		const pending = await reg.listPendingAnchors(100);
		expect(pending).toContainEqual({ kind: 'receivable', id: RID, tenantId: OWNER, anchorJson: PENDING_ANCHOR });
		const unanchored = await reg.listUnanchoredRecords(20, 10);
		expect(unanchored).toContainEqual({ kind: 'reverification', id: 'rv-lender', tenantId: LENDER });
		expect(await reg.getRecordForAnchor(OWNER, 'receivable', RID)).toEqual({ digest: 'd'.repeat(64), anchorJson: PENDING_ANCHOR });
		await reg.setRecordAnchor(OWNER, 'receivable', RID, '{"anchoredAt":"2026-10-12T00:00:00Z"}');
		expect(row('receivables', 'id', RID).anchor_json).toBe('{"anchoredAt":"2026-10-12T00:00:00Z"}');
	});
});

describe('request links after the withdrawal', () => {
	beforeEach(async () => {
		seedScene();
		await reg.deleteReceivable(OWNER, RID);
	});

	it("the owner's links read revoked and spend nothing", async () => {
		expect(await reg.readInvite('tok-buyer-open')).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.acceptInvite('tok-role-open', LENDER)).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.confirmByToken('tok-buyer-open', 'confirmed', {
			theirReference: 'PO-77', by: 'Jane Roe', goodsReceived: true, amountCorrect: true, noOffsets: true, notAlreadyPaid: true,
		})).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.readConfirmRequest('tok-buyer-open')).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.readRecordRequest('tok-borrower-open')).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.readCountersignRequest('tok-owner-claimbound')).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.readOfferRequest('tok-offer-open')).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.respondToOffer('tok-offer-open', 'accept', { by: 'Client', initials: 'CL' })).toEqual({ ok: false, error: 'revoked' });
		expect(await reg.readDocumentByToken('tok-buyer-open', 'doc-held')).toBeNull();
		for (const t of ['tok-buyer-open', 'tok-role-open', 'tok-borrower-open', 'tok-owner-claimbound', 'tok-offer-open']) {
			expect(invite(t).accepted_at, t).toBeNull();
		}
		expect(fake.rows('receivable_access')).toHaveLength(1);
	});

	it("a claimant's own receipt link still reads the record: it asks about a claim already on it", async () => {
		expect(await reg.readCountersignRequest('tok-lender-claimbound')).toMatchObject({
			ok: true, receivableId: RID, claimId: 'claim-lender', amount: 400, invoiceNo: 'INV-0042', alreadyAffirmed: false,
		});
	});

	it('the client can still confirm that advance: recorded under the claimant, claim affirmed, link spent', async () => {
		const r = await reg.affirmClaimByToken('tok-lender-claimbound', 'received', { by: 'Client' });
		expect(r).toMatchObject({ ok: true, claimId: 'claim-lender', receivableId: RID });
		expect(invite('tok-lender-claimbound').accepted_at).toMatch(STAMP);
		expect(row('receivable_claims', 'id', 'claim-lender').affirmed_at).toMatch(STAMP);
		const stored = row('receivable_attestations', 'id', (r as { attestationId: string }).attestationId);
		expect(stored).toMatchObject({ receivable_id: RID, tenant_id: LENDER, role: 'supplier', source: 'receipt_confirmation' });
	});

	it('the client can still dispute it, and the public check shows the dispute', async () => {
		const r = await reg.affirmClaimByToken('tok-lender-claimbound', 'not_received', { by: 'Client' });
		expect(r).toMatchObject({ ok: true, claimId: 'claim-lender' });
		expect(row('receivable_claims', 'id', 'claim-lender').affirmed_at).toBeNull();
		const stored = row('receivable_attestations', 'id', (r as { attestationId: string }).attestationId);
		expect(stored).toMatchObject({ tenant_id: LENDER, role: 'other', source: 'receipt_dispute' });
		const s = await reg.getReceivableStatus(RID);
		expect(s).toMatchObject({ withdrawn: true });
		expect(s!.attestations.some((a) => a.statement.startsWith('DISPUTED'))).toBe(true);
	});

	it('only the receipt answer gets through: the same claimant still cannot add a free-form statement', async () => {
		expect(await reg.addAttestation(LENDER, RID, { role: 'supplier', label: 'Lender Co', statement: 'Received.', source: 'receipt_confirmation' }))
			.toMatchObject({ ok: false, error: 'withdrawn' });
		expect(await reg.createInvite(LENDER, { role: 'borrower', claimId: 'claim-lender' })).toMatchObject({ ok: false, error: 'withdrawn' });
	});

	it('the outstanding list and the lapse pass leave the withdrawn record out', async () => {
		expect(await reg.listOutstandingForTenant(OWNER)).toEqual([expect.objectContaining({ receivableId: OTHER_RID })]);
		expect((await reg.listLapsedRequests()).map((r) => r.token)).toEqual([]);
	});
});

describe('documents on a withdrawn record are tombstones', () => {
	it('listDocuments keeps the metadata with purgedAt; readDocument has no bytes to give', async () => {
		seedScene();
		const r = await reg.deleteReceivable(OWNER, RID);
		const at = (r as { withdrawnAt: string }).withdrawnAt;
		const docs = await reg.listDocuments(RID);
		expect(docs.find((d) => d.id === 'doc-held')).toEqual({
			id: 'doc-held', filename: 'promissory-note.pdf', mimeType: 'application/pdf', fileSize: 5,
			sha256: 'b'.repeat(64), uploadedAt: '2026-09-06 10:00:00', purgedAt: at,
		});
		expect(await reg.readDocument('doc-held', RID)).toBeNull();
		expect(await reg.readDocument('doc-other', OTHER_RID)).not.toBeNull();
	});
});

const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-7', face: 2500, currency: 'USD', isTest: true };

describe('same-tenant restore', () => {
	it('recording the same details again clears deleted_at; revoked requests and purged files stay closed', async () => {
		const created = await reg.createReceivable(OWNER, INPUT);
		expect(created.ok).toBe(true);
		expect(created).not.toHaveProperty('restored');
		const id = (created as { id: string }).id;
		seedInvite('tok-new', { receivable_id: id });
		seedDocument('doc-new', { receivable_id: id });
		await reg.deleteReceivable(OWNER, id);
		expect(await reg.listReceivables(OWNER)).toEqual([]);

		const again = await reg.createReceivable(OWNER, INPUT);
		expect(again).toMatchObject({ ok: true, id, restored: true });
		// S3 adds duplicateCheck at the end; the S2 keys keep their order.
		expect(Object.keys(again)).toEqual(['ok', 'id', 'digest', 'signed', 'keyId', 'restored', 'duplicateCheck']);
		expect(row('receivables', 'id', id).deleted_at).toBeNull();
		expect(fake.rows('receivables')).toHaveLength(1);
		expect((await reg.listReceivables(OWNER)).map((r) => r.id)).toEqual([id]);
		expect(await reg.ownsReceivable(OWNER, id)).toBe(true);
		expect(invite('tok-new').revoked_at).toMatch(STAMP);
		expect(row('receivable_documents', 'id', 'doc-new').data).toBeNull();

		// A third recording of a live record is the old idempotent answer, with no restored key.
		const third = await reg.createReceivable(OWNER, INPUT);
		expect(Object.keys(third)).toEqual(['ok', 'id', 'digest', 'signed', 'keyId', 'duplicateCheck']);
	});
});

describe('cross-tenant collision is permanent', () => {
	it('another tenant gets id_collision before and after the original is withdrawn', async () => {
		const created = await reg.createReceivable(OWNER, INPUT);
		const id = (created as { id: string }).id;
		const collision = await reg.createReceivable(LENDER, INPUT);
		expect(collision).toMatchObject({ ok: false, error: 'id_collision' });

		await reg.deleteReceivable(OWNER, id);
		expect(await reg.createReceivable(LENDER, INPUT)).toEqual(collision);
		const stored = row('receivables', 'id', id);
		expect(stored.tenant_id).toBe(OWNER);
		expect(stored.deleted_at).toMatch(STAMP);
		expect(fake.rows('receivables')).toHaveLength(1);
	});
});

describe('before the deleted_at column is confirmed, every read behaves as before S2', () => {
	beforeEach(async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_RECEIVABLE_DELETED_AT });
	});

	it('status, list, claims and creation run without the column', async () => {
		seedScene();
		// The fake throws on any read of a column that was never added, so these passing means no
		// query named deleted_at.
		const s = await reg.getReceivableStatus(RID);
		expect(s).not.toHaveProperty('withdrawn');
		expect((await reg.listReceivables(LENDER))[0]).toMatchObject({ id: RID, withdrawn: false, withdrawnAt: null });
		expect(await reg.ownsReceivable(OWNER, RID)).toBe(true);
		expect(await reg.addClaim(OTHER, RID, { financier: 'Third Co', amount: 10 })).toMatchObject({ ok: true });
		expect((await reg.createReceivable(OWNER, INPUT)).ok).toBe(true);
		expect((await reg.createInvite(OWNER, { role: 'buyer', receivableId: RID })).ok).toBe(true);
		expect((await reg.settleReceivable(OWNER, RID)).ok).toBe(true);
		expect(fake.columns.get('receivables')?.has('deleted_at')).toBe(false);
	});
});

describe('soft delete does not depend on every other column add', () => {
	beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

	/** The scene, withdrawn by an earlier process: the row already carries deleted_at. */
	function seedWithdrawn(at = '2026-10-01 08:00:00') {
		seedScene();
		row('receivables', 'id', RID).deleted_at = at;
		return at;
	}

	it('an unrelated ALTER failing leaves withdrawn records withdrawn', async () => {
		await load({ failDdl: (sql) => sql === ADD_DISCHARGE_SIGNATURE });
		const at = seedWithdrawn();
		const gone = { ok: false, error: 'withdrawn', withdrawnAt: at };
		expect(await reg.addClaim(OTHER, RID, { financier: 'Third Co', amount: 10, force: true })).toMatchObject(gone);
		expect(await reg.settleReceivable(OWNER, RID)).toMatchObject(gone);
		expect(await reg.addDocument(OWNER, RID, { filename: 'x.pdf', mimeType: 'application/pdf', bytes: Buffer.from('x') })).toMatchObject(gone);
		expect(await reg.createInvite(OWNER, { role: 'buyer', receivableId: RID })).toMatchObject(gone);
		expect(await reg.ownsReceivable(OWNER, RID)).toBe(false);
		expect((await reg.listReceivables(OWNER)).map((r) => r.id)).toEqual([OTHER_RID]);
		expect(await reg.getReceivableStatus(RID)).toMatchObject({ withdrawn: true, withdrawnAt: at });
		// The column add that failed is still reported, and the ensure still retries it.
		expect(reg.receivableColumnsEnsured()).toBe(false);
	});

	it('in that window a withdrawn record with only the owner\'s evidence still answers found: false', async () => {
		await load({ failDdl: (sql) => sql === ADD_DISCHARGE_SIGNATURE });
		seedWithdrawn();
		const claims = fake.rows('receivable_claims');
		claims.splice(0, claims.length, ...claims.filter((c) => c.tenant_id === OWNER));
		const atts = fake.rows('receivable_attestations');
		atts.splice(0, atts.length, ...atts.filter((a) => a.tenant_id === OWNER));
		expect(await reg.getReceivableStatus(RID)).toBeNull();
	});

	it('and the owner can still withdraw a record in that window', async () => {
		await load({ failDdl: (sql) => sql === ADD_DISCHARGE_SIGNATURE });
		seedScene();
		expect(await reg.deleteReceivable(OWNER, RID)).toEqual({ ok: true, withdrawnAt: expect.stringMatching(STAMP) });
		expect(await reg.ownsReceivable(OWNER, RID)).toBe(false);
	});

	it('its own ADD COLUMN timing out on a column that is already there: a read of the column confirms it', async () => {
		// The lock times out, but an earlier deploy added the column (here: as soon as the table
		// exists, before the add's own transaction, which rolls back when the add fails).
		await load({
			failDdl: (sql) => {
				if (/^CREATE INDEX IF NOT EXISTS receivables_tenant /.test(sql)) fake.columns.get('receivables')!.add('deleted_at');
				return sql === ADD_RECEIVABLE_DELETED_AT;
			},
		});
		const at = seedWithdrawn();
		expect(await reg.addClaim(OTHER, RID, { financier: 'Third Co', amount: 10, force: true })).toMatchObject({ ok: false, error: 'withdrawn', withdrawnAt: at });
		expect(await reg.ownsReceivable(OWNER, RID)).toBe(false);
		expect(fake.statements(/^SELECT deleted_at FROM receivables LIMIT 0$/)).toHaveLength(1);
		expect(reg.receivableColumnsEnsured()).toBe(false);
	});
});
