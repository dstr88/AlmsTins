import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import {
	OWN_MATCHES_MAX,
	financedDuplicate,
	stateOnly,
	summarizeTwins,
	type TwinRow,
} from '../../src/lib/receivables/duplicateCheck';
import { ADD_ATTESTATION_SOURCE, ADD_FINGERPRINT_REF } from '../../src/lib/receivables/schema';

/**
 * The duplicate check (S3): the pure summary (src/lib/receivables/duplicateCheck.ts), then the
 * registry's real SQL over tests/helpers/receivablesDbFake.ts: create, the public status, the
 * book, and the fail-closed rule. Fingerprint keys are generated here; nothing is signed.
 */

const twin = (over: Partial<TwinRow>): TwinRow => ({
	id: 'x', tenantId: 't', invoiceNo: 'INV-1', matchedRef: false, matchedInv: true,
	encumbered: false, settled: false, withdrawn: false, ...over,
});

describe('summarizeTwins (pure)', () => {
	it('no rows: no_match, with no financed boolean that could read as anything but false', () => {
		expect(summarizeTwins([], { hasDebtorReference: true })).toEqual({
			check: { state: 'no_match', basis: null, encumbered: false, anySettled: false, hasDebtorReference: true },
			ownMatches: [],
		});
	});

	it('the basis is the strongest across the rows', () => {
		const ref = twin({ matchedRef: true, matchedInv: false });
		const inv = twin({ matchedInv: true });
		const both = twin({ matchedRef: true, matchedInv: true });
		expect(summarizeTwins([ref], { hasDebtorReference: true }).check).toMatchObject({ state: 'possible_duplicate', basis: 'debtor_reference_only' });
		expect(summarizeTwins([ref, inv], { hasDebtorReference: true }).check).toMatchObject({ basis: 'invoice_number' });
		expect(summarizeTwins([inv, both, ref], { hasDebtorReference: true }).check).toMatchObject({ basis: 'invoice_and_reference' });
	});

	it('financed and settled are any-of, and never depend on the viewer', () => {
		const rows = [twin({ id: 'a', tenantId: 'other' }), twin({ id: 'b', tenantId: 'other', encumbered: true, settled: true })];
		const anon = summarizeTwins(rows, { hasDebtorReference: false });
		const viewer = summarizeTwins(rows, { viewerTenantId: 'me', hasDebtorReference: false });
		expect(anon.check).toEqual({ state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: true, hasDebtorReference: false });
		expect(viewer.check).toEqual(anon.check);
		expect(financedDuplicate(anon.check)).toBe(true);
		expect(financedDuplicate(summarizeTwins([twin({})], { hasDebtorReference: false }).check)).toBe(false);
	});

	it('ownMatches lists only the viewer\'s rows, at most ten', () => {
		const rows = [
			twin({ id: 'other-1', tenantId: 'other' }),
			...Array.from({ length: 12 }, (_, i) => twin({ id: `mine-${i}`, tenantId: 'me', invoiceNo: `INV-${i}`, withdrawn: i === 0 })),
		];
		const { ownMatches } = summarizeTwins(rows, { viewerTenantId: 'me', hasDebtorReference: true });
		expect(ownMatches).toHaveLength(OWN_MATCHES_MAX);
		expect(ownMatches[0]).toEqual({ id: 'mine-0', invoiceNo: 'INV-0', withdrawn: true });
		expect(ownMatches.every((m) => m.id.startsWith('mine-'))).toBe(true);
		expect(summarizeTwins(rows, { hasDebtorReference: true }).ownMatches).toEqual([]);
	});

	it('stateOnly keeps the state alone', () => {
		expect(stateOnly({ state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: true })).toEqual({ state: 'possible_duplicate' });
		expect(stateOnly({ state: 'unavailable', hasDebtorReference: false })).toEqual({ state: 'unavailable' });
	});
});

// ── The registry over the fake ──────────────────────────────────────────────

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
let fake: ReceivablesDbFake;
let reg: Registry;

const OWNER = 'tenant-owner';
const RIVAL = 'tenant-rival-supplier';
const LENDER = 'tenant-lender';

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
}

const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };
const withRef = (ref: string, over: Record<string, unknown> = {}) => ({ ...INVOICE, details: { buyerRef: ref }, ...over });

type Created = Extract<Awaited<ReturnType<Registry['createReceivable']>>, { ok: true }>;
async function create(tenant: string, input: Record<string, unknown>): Promise<Created> {
	const r = await reg.createReceivable(tenant, input as any);
	if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
	return r;
}

function seedClaim(receivableId: string, tenant = LENDER, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: `claim-${receivableId.slice(0, 8)}-${tenant}`, receivable_id: receivableId, tenant_id: tenant, financier: 'Lender Co',
		amount: 400, currency: 'USD', claim_date: '2026-10-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, created_at: '2026-10-02 10:00:00', ...over,
	});
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('createReceivable: the duplicate check', () => {
	it('stores keyed fingerprints, never the plaintext, and a first record matches nothing', async () => {
		const a = await create(OWNER, withRef('PO-00123'));
		expect(a.duplicateCheck).toEqual({ state: 'no_match', basis: null, encumbered: false, anySettled: false, hasDebtorReference: true });
		expect(a).not.toHaveProperty('ownMatches');
		const row = fake.rows('receivables')[0];
		expect(row.fingerprint_ref).toMatch(/^[0-9a-f]{64}$/);
		expect(row.fingerprint_inv).toMatch(/^[0-9a-f]{64}$/);
		expect(row.fingerprint_kid).toMatch(/^fp1-[0-9a-f]{12}$/);
		expect(JSON.stringify(row)).not.toMatch(/bigco\|/i);
	});

	it('the receivable ID does not change with the key: the manifest is untouched', async () => {
		const keyed = await create(OWNER, INVOICE);
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		const plain = await create(OWNER, INVOICE);
		expect(plain.id).toBe(keyed.id);
		expect(plain.digest).toBe(keyed.digest);
		expect(JSON.parse(fake.rows('receivables')[0].manifest_json)).not.toHaveProperty('fingerprint');
	});

	it('same tenant, typed differently: possible_duplicate on the invoice number, listed in ownMatches', async () => {
		const a = await create(OWNER, INVOICE);
		const b = await create(OWNER, { ...INVOICE, supplier: 'ACME SUPPLIES LIMITED', buyer: 'BIGCO P.L.C.', invoiceNo: 'inv 42' });
		expect(b.id).not.toBe(a.id);
		expect(b.duplicateCheck).toEqual({ state: 'possible_duplicate', basis: 'invoice_number', encumbered: false, anySettled: false, hasDebtorReference: false });
		expect(b.ownMatches).toEqual([{ id: a.id, invoiceNo: 'INV-0042', withdrawn: false }]);
	});

	it('another tenant\'s record: the same facts, no ownMatches, and financed once a claim stands on it', async () => {
		const a = await create(OWNER, withRef('PO-77'));
		seedClaim(a.id);
		const b = await create(RIVAL, withRef('po 77', { invoiceNo: 'INV 42', terms: 'Net 60' }));
		expect(b.duplicateCheck).toEqual({ state: 'possible_duplicate', basis: 'invoice_and_reference', encumbered: true, anySettled: false, hasDebtorReference: true });
		expect(b).not.toHaveProperty('ownMatches');
	});

	it('an installment under one order matches on the debtor reference only', async () => {
		await create(OWNER, withRef('PO-500', { invoiceNo: 'INV-1' }));
		const second = await create(OWNER, withRef('PO-500', { invoiceNo: 'INV-2' }));
		expect(second.duplicateCheck).toMatchObject({ state: 'possible_duplicate', basis: 'debtor_reference_only' });
	});

	it('a different supplier with the same invoice number, debtor and amount does not collide', async () => {
		await create(OWNER, INVOICE);
		const other = await create(RIVAL, { ...INVOICE, supplier: 'Zenith Foods Ltd' });
		expect(other.duplicateCheck).toMatchObject({ state: 'no_match' });
	});

	it('a different amount or currency never matches', async () => {
		await create(OWNER, INVOICE);
		expect((await create(OWNER, { ...INVOICE, face: 1000.5 })).duplicateCheck.state).toBe('no_match');
		expect((await create(OWNER, { ...INVOICE, currency: 'NGN' })).duplicateCheck.state).toBe('no_match');
	});

	it('a test record never matches a real one', async () => {
		await create(OWNER, INVOICE);
		const real = await create(OWNER, { ...INVOICE, isTest: false });
		expect(real.duplicateCheck.state).toBe('no_match');
	});

	it('id_collision carries the submitted details\' check, the original included', async () => {
		const a = await create(OWNER, INVOICE);
		seedClaim(a.id);
		const r = await reg.createReceivable(RIVAL, INVOICE);
		expect(r).toEqual({
			ok: false, error: 'id_collision',
			message: 'A receivable with these exact details is already on record at Almstins under another account.',
			duplicateCheck: { state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: false },
		});
		expect(fake.rows('receivables')).toHaveLength(1);
	});

	it('a withdrawn record still counts, financed, when it is recorded again typed differently', async () => {
		const a = await create(OWNER, INVOICE);
		seedClaim(a.id);
		expect(await reg.deleteReceivable(OWNER, a.id)).toMatchObject({ ok: true });
		const again = await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' });
		expect(again.duplicateCheck).toMatchObject({ state: 'possible_duplicate', encumbered: true });
		expect(again.ownMatches).toEqual([{ id: a.id, invoiceNo: 'INV-0042', withdrawn: true }]);
	});

	it('fifty matches with no claim cannot push the financed one out of the window', async () => {
		const ids: string[] = [];
		for (let d = 1; d <= 51; d++) {
			ids.push((await create(OWNER, { ...INVOICE, dueDate: `2026-12-${String(Math.min(d, 28)).padStart(2, '0')}`, terms: `T${d}` })).id);
		}
		// The financed one sorts last by ID, so only the encumbrance ordering keeps it in.
		const last = [...ids].sort().at(-1)!;
		seedClaim(last);
		const probe = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		expect(probe.duplicateCheck).toMatchObject({ state: 'possible_duplicate', encumbered: true });
		const twinQueries = fake.statements(/^SELECT r\.id, r\.tenant_id, r\.invoice_no/);
		expect(twinQueries.at(-1)!.sql).toMatch(/ LIMIT 50$/);
	});

	it('settled matches set anySettled', async () => {
		const a = await create(OWNER, INVOICE);
		fake.rows('receivables').find((r) => r.id === a.id)!.settled_at = '2026-10-05';
		const b = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 0042' });
		expect(b.duplicateCheck).toMatchObject({ state: 'possible_duplicate', encumbered: false, anySettled: true });
	});
});

describe('fail closed: unavailable, never a clear', () => {
	it('without a key: unavailable, creation still succeeds, and no fingerprint is stored', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		const a = await create(OWNER, withRef('PO-1'));
		expect(a.duplicateCheck).toEqual({ state: 'unavailable', hasDebtorReference: true });
		expect(fake.rows('receivables')[0]).toMatchObject({ fingerprint_ref: null, fingerprint_inv: null, fingerprint_kid: null });
		expect(Object.keys(a.duplicateCheck)).toEqual(['state', 'hasDebtorReference']);
	});

	it('a row with no fingerprint (recorded before S3) keeps every check unavailable until the backfill', async () => {
		await create(OWNER, INVOICE);
		fake.seed('receivables', {
			id: 'ab'.repeat(32), tenant_id: RIVAL, supplier: 'x', buyer: 'y', invoice_no: 'z', face: 1, currency: 'USD', is_test: false,
			manifest_json: '{}', digest: 'd'.repeat(64), created_at: '2026-09-01 10:00:00',
		});
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
		expect((await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' })).duplicateCheck.state).toBe('unavailable');
		await reg.startFingerprintBackfill();
		expect((await create(OWNER, { ...INVOICE, invoiceNo: 'INV-42' })).duplicateCheck.state).toBe('possible_duplicate');
	});

	it('a failed fingerprint ALTER: unavailable, while soft delete and other columns work', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_FINGERPRINT_REF });
		const a = await create(OWNER, INVOICE);
		expect(a.duplicateCheck.state).toBe('unavailable');
		expect((await reg.getReceivableStatus(a.id))!.duplicateCheck.state).toBe('unavailable');
		expect(await reg.deleteReceivable(OWNER, a.id)).toMatchObject({ ok: true });
		expect((await reg.listReceivables(OWNER))).toEqual([]);
	});

	it('an unrelated failed ALTER does not switch the check off', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_ATTESTATION_SOURCE });
		await create(OWNER, INVOICE);
		expect((await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' })).duplicateCheck.state).toBe('possible_duplicate');
	});

	it('a store error reads unavailable and is logged without the fields', async () => {
		const errors: unknown[][] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); });
		await load({ failDml: (sql) => /^SELECT r\.id, r\.tenant_id, r\.invoice_no/.test(sql) });
		const a = await create(OWNER, INVOICE);
		expect(a.duplicateCheck.state).toBe('unavailable');
		expect(JSON.stringify(errors)).not.toMatch(/Bigco|Acme|INV-0042/);
	});
});

describe('the public status and Verify now', () => {
	it('getReceivableStatus carries the public check (state and hasDebtorReference only), before the withdrawn keys, with no IDs', async () => {
		const a = await create(OWNER, withRef('PO-9'));
		seedClaim(a.id);
		const b = await create(RIVAL, withRef('PO 9', { invoiceNo: 'INV 0042' }));
		const s = (await reg.getReceivableStatus(b.id))!;
		// Owner decision 9: the status is public, so no basis and no financed or settled boolean.
		expect(s.duplicateCheck).toEqual({ state: 'possible_duplicate', hasDebtorReference: true });
		expect(Object.keys(s).at(-1)).toBe('duplicateCheck');
		expect(JSON.stringify(s)).not.toContain(a.id);
		expect(JSON.stringify(s)).not.toMatch(/"(basis|encumbered|anySettled)"/);
		// The same answer when nothing matched it is financed: a reader cannot tell the two apart.
		const c = await create(RIVAL, withRef('PO-77', { invoiceNo: 'INV-77' }));
		await create(OWNER, withRef('PO 77', { invoiceNo: 'INV 77' }));
		expect((await reg.getReceivableStatus(c.id))!.duplicateCheck).toEqual(s.duplicateCheck);

		await reg.deleteReceivable(OWNER, a.id);
		seedClaim(a.id, RIVAL, { id: 'claim-rival-on-a' });
		const withdrawn = (await reg.getReceivableStatus(a.id))!;
		expect(Object.keys(withdrawn).slice(-3)).toEqual(['duplicateCheck', 'withdrawn', 'withdrawnAt']);
	});

	it('Verify now: one duplicate row per state (a verified caller\'s wording)', async () => {
		const row = async (id: string) => {
			const r = await reg.reverifyReceivable(LENDER, id, { persist: false, verifiedViewer: true });
			if (!r.ok) throw new Error('not found');
			return r.checks.find((c) => c.key === 'duplicate')!;
		};
		const pass = await create(OWNER, withRef('PO-1', { invoiceNo: 'INV-1' }));
		expect(await row(pass.id)).toEqual({ key: 'duplicate', label: 'Duplicate check', state: 'pass',
			detail: 'No other record at Almstins matches this invoice, on the debtor’s reference or on the invoice number.' });

		const noRef = await create(OWNER, { ...INVOICE, invoiceNo: 'INV-2' });
		expect(await row(noRef.id)).toMatchObject({ state: 'warn', detail: expect.stringMatching(/^No debtor reference/) });

		const match = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 2' });
		expect(await row(match.id)).toMatchObject({ state: 'warn', detail: expect.stringMatching(/^Another record at Almstins matches this invoice\. It is not recorded as financed/) });

		seedClaim(noRef.id);
		expect(await row(match.id)).toMatchObject({ state: 'warn', detail: expect.stringMatching(/is recorded as financed\. Check with the debtor/) });

		const installment = await create(RIVAL, withRef('PO-1', { invoiceNo: 'INV-9' }));
		expect((await row(installment.id)).detail).toMatch(/another installment under the same order\.$/);

		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		expect(await row(pass.id)).toMatchObject({ state: 'warn', detail: 'The duplicate check is not available right now, so it is treated as unproven.' });
		const all = await reg.reverifyReceivable(LENDER, pass.id, { persist: false });
		expect(all.ok && all.verdict).toBe('attention');
		expect(all.ok && all.checks.map((c) => c.key)).toEqual(['integrity', 'headroom', 'duplicate', 'acknowledged', 'anchor']);
	});

	it('Verify now for any other caller (the default): a match reads only as a match, financed or not, whatever matched', async () => {
		const plain = async (id: string) => {
			const r = await reg.reverifyReceivable(LENDER, id, { persist: false });
			if (!r.ok) throw new Error('not found');
			return r.checks.find((c) => c.key === 'duplicate')!;
		};
		const ANY = { key: 'duplicate', label: 'Duplicate check', state: 'warn', detail: 'Another record at Almstins matches this invoice. Check with the debtor before you advance.' };
		const first = await create(OWNER, { ...INVOICE, invoiceNo: 'INV-2' });
		const match = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 2' });
		expect(await plain(match.id)).toEqual(ANY);
		seedClaim(first.id);
		expect(await plain(match.id)).toEqual(ANY);
		const installment = await create(RIVAL, withRef('PO-1', { invoiceNo: 'INV-9' }));
		await create(OWNER, withRef('PO-1', { invoiceNo: 'INV-8' }));
		expect(await plain(installment.id)).toEqual(ANY);
		// The rows that say nothing about another record read the same in both tiers.
		const pass = await create(OWNER, withRef('PO-55', { invoiceNo: 'INV-55' }));
		expect((await plain(pass.id)).state).toBe('pass');
	});

	it('the stored re-verification keeps the plain wording, even from a verified caller, and the state and verdict match', async () => {
		const first = await create(OWNER, INVOICE);
		seedClaim(first.id);
		const second = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		const answered = await reg.reverifyReceivable(LENDER, second.id, { verifiedViewer: true });
		if (!answered.ok) throw new Error('not found');
		expect(answered.checks.find((c) => c.key === 'duplicate')!.detail).toMatch(/is recorded as financed/);
		const stored = (await reg.getReceivableStatus(second.id))!.reverifications.at(-1)!;
		expect(stored.verdict).toBe(answered.verdict);
		expect(stored.checks.map((c) => [c.key, c.state])).toEqual(answered.checks.map((c) => [c.key, c.state]));
		expect(stored.checks.find((c) => c.key === 'duplicate')).toEqual({
			key: 'duplicate', label: 'Duplicate check', state: 'warn', detail: 'Another record at Almstins matches this invoice. Check with the debtor before you advance.',
		});
		expect(JSON.stringify(stored)).not.toMatch(/recorded as financed|not recorded as financed/);
	});
});

describe('the book', () => {
	it('relation says owner or claimant; possibleDuplicate is a boolean, or null while unavailable', async () => {
		const mine = await create(OWNER, INVOICE);
		const theirs = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		const lone = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV-77' });
		seedClaim(theirs.id, OWNER, { id: 'claim-owner-on-theirs' });
		const book = await reg.listReceivables(OWNER);
		const byId = Object.fromEntries(book.map((r) => [r.id, r]));
		expect(byId[mine.id]).toMatchObject({ mine: true, relation: 'owner', possibleDuplicate: true });
		expect(byId[theirs.id]).toMatchObject({ mine: false, relation: 'claimant', possibleDuplicate: true });
		expect(byId[lone.id]).toBeUndefined();
		const rivalBook = await reg.listReceivables(RIVAL);
		expect(rivalBook.find((r) => r.id === lone.id)).toMatchObject({ relation: 'owner', possibleDuplicate: false });

		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		expect((await reg.listReceivables(OWNER)).every((r) => r.possibleDuplicate === null)).toBe(true);
	});
});

describe('no foreign detail reaches any answer', () => {
	it('sentinel scan: no other record\'s ID, tenant, invoice number or supplier text', async () => {
		const FOREIGN_TENANT = 'tenant-sentinel-foreign';
		const foreign = await create(FOREIGN_TENANT, withRef('P.O. #000918', { supplier: 'ACME SUPPLIES LIMITED', invoiceNo: 'Inv. 00042/SENT' }));
		const foreignFinanced = await create(FOREIGN_TENANT, withRef('PO-918', { supplier: 'Acme Supplies Ltd.', invoiceNo: 'INV:42' }));
		seedClaim(foreignFinanced.id, 'tenant-sentinel-lender');
		const mine = await create(OWNER, withRef('PO 918'));
		const outputs = [
			mine,
			await reg.getReceivableStatus(mine.id),
			await reg.listReceivables(OWNER),
			await reg.reverifyReceivable(OWNER, mine.id, { persist: false }),
			await reg.previewDuplicateCheck({ buyer: 'Bigco Plc', supplier: 'Acme Supplies Ltd', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', details: { buyerRef: 'PO-918' }, isTest: true }, OWNER),
			await reg.createReceivable('tenant-third', withRef('PO 918')),
		];
		expect(mine.duplicateCheck).toMatchObject({ state: 'possible_duplicate', encumbered: true });
		const text = JSON.stringify(outputs);
		for (const sentinel of [foreign.id, foreignFinanced.id, FOREIGN_TENANT, 'tenant-sentinel-lender', 'Inv. 00042/SENT', 'INV:42', 'ACME SUPPLIES LIMITED', 'Acme Supplies Ltd.', 'P.O. #000918', 'tenant_id', 'tenantId']) {
			expect(text, sentinel).not.toContain(sentinel);
		}
		// Nothing that looks like a count of matches.
		expect(text).not.toMatch(/"(count|matches|twins|n)":/);
	});
});

describe('previewDuplicateCheck', () => {
	it('writes nothing and answers what the create of the same fields answers, own matches included', async () => {
		await create(OWNER, withRef('PO-31'));
		const other = await create(RIVAL, withRef('PO-31', { invoiceNo: 'INV-5' }));
		seedClaim(other.id);
		const fields = { supplier: 'Acme Supplies Ltd', buyer: 'BIGCO PLC', invoiceNo: 'inv 42', face: 1000, currency: 'usd', details: { buyerRef: 'PO 31' }, isTest: true };
		const before = fake.log.length;
		const preview = await reg.previewDuplicateCheck(fields, OWNER);
		expect(fake.log.slice(before).filter((s) => !/^(SELECT|CREATE|ALTER)/.test(s.sql))).toEqual([]);
		expect(preview.ok).toBe(true);
		const created = await create(OWNER, fields);
		expect(preview).toEqual({ ok: true, duplicateCheck: created.duplicateCheck, ownMatches: created.ownMatches });
		expect(created.duplicateCheck).toMatchObject({ state: 'possible_duplicate', basis: 'invoice_and_reference', encumbered: true });
	});

	it('needs a debtor, a positive face, a currency, and an invoice number or a reference', async () => {
		const ok = { buyer: 'Bigco', face: 10, currency: 'USD', invoiceNo: '1' };
		expect((await reg.previewDuplicateCheck(ok, OWNER)).ok).toBe(true);
		expect((await reg.previewDuplicateCheck({ ...ok, invoiceNo: '', details: { buyerRef: 'PO-1' } }, OWNER)).ok).toBe(true);
		for (const bad of [{ ...ok, buyer: '' }, { ...ok, currency: '' }, { ...ok, invoiceNo: '' }, { ...ok, face: 0 }, { ...ok, face: Number.NaN }]) {
			expect(await reg.previewDuplicateCheck(bad, OWNER)).toMatchObject({ ok: false, error: 'invalid' });
		}
	});
});

describe('the claim warning and the earlier financier\'s book', () => {
	const VERIFIED = { verifiedViewer: true };

	it('a verified caller: possible_duplicate only for a financed match, and the matching records are bumped', async () => {
		const first = await create(OWNER, INVOICE);
		const second = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		const quiet = await reg.addClaim(LENDER, second.id, { financier: 'L', amount: 10, acceptsWarnings: true }, VERIFIED);
		expect(quiet).toMatchObject({ ok: true });
		expect(quiet).not.toHaveProperty('notices');

		seedClaim(first.id, 'tenant-first-lender');
		const firstRow = fake.rows('receivables').find((r) => r.id === first.id)!;
		firstRow.updated_at = '2026-01-01 00:00:00';
		const warned = await reg.addClaim(LENDER, second.id, { financier: 'L', amount: 10, acceptsWarnings: true }, VERIFIED);
		expect(warned).toMatchObject({ ok: false, error: 'possible_duplicate', warnings: ['possible_duplicate'], duplicateCheck: { state: 'possible_duplicate', encumbered: true } });
		expect(firstRow.updated_at).toBe('2026-01-01 00:00:00');

		const legacy = await reg.addClaim(LENDER, second.id, { financier: 'L', amount: 10 }, VERIFIED);
		expect(legacy).toMatchObject({ ok: true, notices: ['possible_duplicate'] });
		expect(firstRow.updated_at).not.toBe('2026-01-01 00:00:00');
	});

	it('any other caller (the default): warned on any match with the state alone, so financed and not financed read the same', async () => {
		const first = await create(OWNER, INVOICE);
		const second = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		const lone = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV-77' });
		const answers = async () => ({
			warned: await reg.addClaim(LENDER, second.id, { financier: 'L', amount: 10, acceptsWarnings: true }),
			legacy: await reg.addClaim(LENDER, second.id, { financier: 'L', amount: 10 }),
		});
		const unfinanced = await answers();
		expect(unfinanced.warned).toEqual({
			ok: false, error: 'possible_duplicate', warnings: ['possible_duplicate'], duplicateCheck: { state: 'possible_duplicate' },
			message: 'Another record at Almstins matches this invoice. Check with the debtor before you advance. To record your claim anyway, send it again acknowledging possible_duplicate.',
		});
		expect(unfinanced.legacy).toMatchObject({ ok: true, notices: ['possible_duplicate'] });

		seedClaim(first.id, 'tenant-first-lender');
		const financed = await answers();
		expect(financed.warned).toEqual(unfinanced.warned);
		expect(financed.legacy).toMatchObject({ ok: true, notices: ['possible_duplicate'] });

		// No match: nothing raised, the same as for a verified caller.
		const none = await reg.addClaim(LENDER, lone.id, { financier: 'L', amount: 10, acceptsWarnings: true });
		expect(none).toMatchObject({ ok: true });
		expect(none).not.toHaveProperty('notices');
	});
});

describe('the cross-tenant reads run on the owner pool', () => {
	it('the coverage count, the twin query and the book\'s flags run outside the request\'s tenant context', async () => {
		const dbContext = await import('../../src/lib/dbContext');
		const contexts: Array<{ sql: string; ctx: unknown }> = [];
		const inner = fake;
		holder.db = {
			execute: (st: any) => { contexts.push({ sql: String(st?.sql ?? st).replace(/\s+/g, ' ').trim(), ctx: dbContext.getDbContext() }); return inner.execute(st); },
			batch: (st: any) => inner.batch(st),
		};
		const ctx = { tenantId: OWNER, userId: 'user-owner' };
		await dbContext.runWithDbContext(ctx, async () => {
			await create(OWNER, INVOICE);
			await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' });
			await reg.listReceivables(OWNER);
			await reg.getReceivableStatus(fake.rows('receivables')[0].id);
		});
		const ran = (re: RegExp) => contexts.filter((c) => re.test(c.sql));
		const cross = [
			...ran(/^SELECT COUNT\(\*\) AS n FROM receivables WHERE fingerprint_kid IS NULL/),
			...ran(/^SELECT r\.id, r\.tenant_id, r\.invoice_no, r\.fingerprint_ref/),
			...ran(/^SELECT r\.id FROM receivables r WHERE r\.id IN \(/),
		];
		expect(ran(/^SELECT r\.id, r\.tenant_id, r\.invoice_no, r\.fingerprint_ref/).length).toBeGreaterThan(0);
		expect(ran(/^SELECT r\.id FROM receivables r WHERE r\.id IN \(/)).toHaveLength(1);
		expect(cross.every((c) => c.ctx === undefined)).toBe(true);
		// The request's own reads keep its context.
		expect(ran(/^INSERT INTO receivables /).every((c) => c.ctx === ctx)).toBe(true);
		expect(ran(/^SELECT r\.id, r\.supplier, r\.buyer/).every((c) => c.ctx === ctx)).toBe(true);
	});

	it('the book\'s flags read null, never false, when their query fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDml: (sql) => /^SELECT r\.id FROM receivables r WHERE r\.id IN \(/.test(sql) });
		await create(OWNER, INVOICE);
		await create(OWNER, { ...INVOICE, invoiceNo: 'INV 42' });
		const book = await reg.listReceivables(OWNER);
		expect(book).toHaveLength(2);
		expect(book.every((r) => r.possibleDuplicate === null)).toBe(true);
	});
});

describe('coverage', () => {
	it('a cached count is trusted for a minute, then recounted', async () => {
		await create(OWNER, INVOICE);
		expect(await reg.fingerprintCoverageOk()).toBe(true);
		fake.rows('receivables')[0].fingerprint_kid = null;
		expect(await reg.fingerprintCoverageOk()).toBe(true);
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
		expect(await reg.fingerprintCoverageOk()).toBe(false);
	});
});
