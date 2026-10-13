import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, normalizeSql, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { ADD_ATTESTATION_SOURCE, ADD_FINGERPRINT_REF, ADD_RECEIVABLE_DELETED_AT } from '../../src/lib/receivables/schema';
import type { SeenBeforeInput, SeenBeforeRow } from '../../src/lib/receivables/seenBefore';

/**
 * The "Seen before?" store (S5, src/lib/receivables/server/seenBeforeStore.ts): its one SELECT run
 * over tests/helpers/receivablesDbFake.ts, against records the registry itself creates. Fingerprint
 * keys are generated here; nothing is signed.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
type Store = typeof import('../../src/lib/receivables/server/seenBeforeStore');
let fake: ReceivablesDbFake;
let reg: Registry;
let store: Store;

const OWNER = 'tenant-owner';
const RIVAL = 'tenant-rival-supplier';
const LENDER = 'tenant-lender';

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
	store = await import('../../src/lib/receivables/server/seenBeforeStore');
}

const INVOICE = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };
const CHECK: SeenBeforeInput = { ...INVOICE, buyerRef: null };
const STORE_SQL = /^SELECT r\.face, /;

type Created = Extract<Awaited<ReturnType<Registry['createReceivable']>>, { ok: true }>;
async function create(tenant: string, input: Record<string, unknown>, createdAt?: string): Promise<Created> {
	const r = await reg.createReceivable(tenant, input as any);
	if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r)}`);
	if (createdAt) rowOf(r.id).created_at = createdAt;
	return r;
}
const rowOf = (id: string) => fake.rows('receivables').find((x) => x.id === id)!;

/** The rows of a check that ran. */
async function rows(over: Partial<SeenBeforeInput> = {}): Promise<SeenBeforeRow[]> {
	const r = await store.readSeenBefore({ ...CHECK, ...over });
	if (r.state !== 'ok') throw new Error('the check was unavailable');
	return r.rows;
}

let claimSeq = 0;
function seedClaim(receivableId: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: `claim-${++claimSeq}`, receivable_id: receivableId, tenant_id: LENDER, financier: 'Lender Co',
		amount: 400, currency: 'USD', claim_date: '2026-10-02', status: 'active', manifest_json: '{}', signature_json: null,
		digest: 'e'.repeat(64), anchor_json: null, affirmed_at: null, created_at: '2026-10-02 10:00:00', ...over,
	});
}
let attSeq = 0;
function seedAttestation(receivableId: string, over: Record<string, unknown>) {
	return fake.seed('receivable_attestations', {
		id: `att-${++attSeq}`, receivable_id: receivableId, tenant_id: OWNER, role: 'other', label: 'Bigco Plc',
		statement: 'A note.', attested_at: '2026-10-03', manifest_json: '{}', signature_json: null,
		digest: 'f'.repeat(64), anchor_json: null, created_at: '2026-10-03 10:00:00', source: null, ...over,
	});
}

beforeEach(async () => {
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex'));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('the one SELECT', () => {
	it('matches on the invoice key only, never names tenant_id, binds is_test as a boolean and every string, LIMIT 50', async () => {
		await create(OWNER, INVOICE);
		await store.readSeenBefore({ ...CHECK, buyerRef: 'PO-00123' });
		const ran = fake.statements(STORE_SQL);
		expect(ran).toHaveLength(1);
		const { sql, args } = ran[0];
		expect(sql).not.toMatch(/tenant_id/);
		expect(sql).toMatch(/ WHERE r\.fingerprint_kid = \? AND r\.is_test = \? AND r\.fingerprint_inv = \? ORDER BY /);
		expect(sql).not.toMatch(/fingerprint_ref = /);
		expect(sql).toMatch(/ LIMIT 50$/);
		// No ID, account, invoice text or hash other than the reference hash (compared in TS) is selected.
		expect(sql).toMatch(/^SELECT r\.face, r\.created_at, r\.settled_at, r\.fingerprint_ref, r\.deleted_at, \(/);
		// The only inline string is the claim status shared with ENCUMBRANCE_SQL.
		expect(new Set(sql.match(/'[^']*'/g))).toEqual(new Set(["'active'"]));
		expect(args.filter((a) => typeof a === 'boolean')).toEqual([true]);
		// The kid and the invoice hash are bound; no plaintext field is.
		const stored = fake.rows('receivables')[0];
		expect(args.slice(-3)).toEqual([stored.fingerprint_kid, true, stored.fingerprint_inv]);
		expect(JSON.stringify(args)).not.toMatch(/Acme|Bigco|INV|PO-/);
		expect(args).not.toContain(stored.fingerprint_ref);
		// Kept apart from the twin query's shape, which other tests pin.
		expect(sql).not.toMatch(/^SELECT r\.id/);
	});

	it('runs on the owner pool, outside the request\'s tenant context', async () => {
		const dbContext = await import('../../src/lib/dbContext');
		await create(OWNER, INVOICE);
		const contexts: Array<{ sql: string; ctx: unknown }> = [];
		const inner = fake;
		holder.db = {
			execute: (st: any) => { contexts.push({ sql: normalizeSql(String(st?.sql ?? st)), ctx: dbContext.getDbContext() }); return inner.execute(st); },
			batch: (st: any) => inner.batch(st),
		};
		const ctx = { tenantId: LENDER, userId: 'user-lender' };
		const read = await dbContext.runWithDbContext(ctx, () => store.readSeenBefore(CHECK));
		expect(read).toMatchObject({ state: 'ok' });
		const select = contexts.filter((c) => STORE_SQL.test(c.sql));
		expect(select).toHaveLength(1);
		expect(select[0].ctx).toBeUndefined();
	});

	it('importing the store runs nothing (no backfill, no ensure)', async () => {
		await new Promise((r) => setTimeout(r, 5));
		expect(fake.log).toEqual([]);
	});
});

describe('what matches', () => {
	it('another account\'s record, typed differently', async () => {
		await create(OWNER, INVOICE);
		expect(await rows({ supplier: 'ACME SUPPLIES LIMITED', invoiceNo: 'inv 42', currency: 'usd' })).toHaveLength(1);
		await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' });
		expect(await rows()).toHaveLength(2);
	});

	it('the invoice key only: a twin on the debtor reference alone is not found', async () => {
		await create(OWNER, { ...INVOICE, details: { buyerRef: 'PO-00123' } });
		const probe = { supplier: 'Other Supplier Co', invoiceNo: 'INV-9999', buyerRef: 'PO 123' };
		// The duplicate check does see it, on the reference alone.
		const dup = await reg.previewDuplicateCheck({
			supplier: probe.supplier, buyer: INVOICE.buyer, invoiceNo: probe.invoiceNo, face: INVOICE.face,
			currency: INVOICE.currency, details: { buyerRef: probe.buyerRef }, isTest: true,
		}, LENDER);
		expect(dup).toMatchObject({ ok: true, duplicateCheck: { state: 'possible_duplicate', basis: 'debtor_reference_only' } });
		expect(await store.readSeenBefore({ ...CHECK, ...probe })).toEqual({ state: 'ok', rows: [], refChecked: true });
	});

	it('refMatch only when the reference matches too, on a record the invoice key found', async () => {
		await create(OWNER, { ...INVOICE, details: { buyerRef: 'PO-00123' } });
		expect((await store.readSeenBefore({ ...CHECK, buyerRef: 'po 123' }))).toMatchObject({ state: 'ok', refChecked: true, rows: [{ refMatch: true }] });
		expect((await store.readSeenBefore({ ...CHECK, buyerRef: 'PO-00999' }))).toMatchObject({ state: 'ok', refChecked: true, rows: [{ refMatch: false }] });
		expect((await store.readSeenBefore(CHECK))).toMatchObject({ state: 'ok', refChecked: false, rows: [{ refMatch: false }] });
	});

	it('a record without a reference never reads as a reference match', async () => {
		await create(OWNER, INVOICE);
		expect((await store.readSeenBefore({ ...CHECK, buyerRef: 'PO-00123' }))).toMatchObject({ state: 'ok', refChecked: true, rows: [{ refMatch: false }] });
		// Neither side has one: two missing references are not a match.
		expect((await store.readSeenBefore(CHECK))).toMatchObject({ state: 'ok', refChecked: false, rows: [{ refMatch: false }] });
	});

	it('test records never match real ones, and real never match test', async () => {
		await create(OWNER, INVOICE);
		expect(await rows({ isTest: false })).toEqual([]);
		await create(OWNER, { ...INVOICE, isTest: false });
		expect(await rows({ isTest: false })).toHaveLength(1);
		expect(await rows({ isTest: true })).toHaveLength(1);
		expect(fake.statements(STORE_SQL).map((s) => s.args.filter((a) => typeof a === 'boolean'))).toEqual([[false], [false], [true]]);
	});

	it('a different amount or currency never matches', async () => {
		await create(OWNER, INVOICE);
		expect(await rows({ face: 1000.01 })).toEqual([]);
		expect(await rows({ face: 100 })).toEqual([]);
		expect(await rows({ currency: 'EUR' })).toEqual([]);
		expect(await rows({ currency: 'NGN' })).toEqual([]);
		expect(await rows({ supplier: 'Another Supplier Ltd' })).toEqual([]);
		expect(await rows({ buyer: 'Another Debtor Plc' })).toEqual([]);
		expect(await rows({ invoiceNo: 'INV-0043' })).toEqual([]);
		expect(await rows({ face: 1000.0, currency: ' usd ' })).toHaveLength(1);
	});

	// S5 review: createReceivable clamps the currency, then fingerprintTuples clamps it again. A clamp
	// is not idempotent when uppercasing lengthens the text, so the check must clamp twice as well.
	it('a currency that grows when uppercased matches the record created with it', async () => {
		for (const currency of ['\u00df\u00df\u00df\u00df\u00df', '\ufb03\ufb03\ufb03']) {
			await load();
			await create(OWNER, { ...INVOICE, currency });
			expect(await rows({ currency })).toHaveLength(1);
		}
	});

	it('the window is 50 rows, financed records first', async () => {
		const a = await create(OWNER, INVOICE);
		const base = rowOf(a.id);
		for (let i = 0; i < 59; i++) fake.seed('receivables', { ...base, id: `zz${String(i).padStart(2, '0')}`, created_at: '2026-01-01 00:00:00' });
		// The financed one is the newest and sorts last by ID.
		const last = fake.seed('receivables', { ...base, id: 'zzzz', created_at: '2026-12-31 00:00:00' });
		seedClaim(last.id);
		const got = await rows();
		expect(got).toHaveLength(50);
		expect(got[0]).toMatchObject({ encumbered: true, claimed: 400 });
		expect(got.slice(1).every((r) => !r.encumbered)).toBe(true);
	});
});

describe('what each row carries', () => {
	it('exactly the ID-free fields: no ID, account, invoice text or hash', async () => {
		const a = await create(OWNER, { ...INVOICE, details: { buyerRef: 'PO-00123' } });
		const got = await rows({ buyerRef: 'PO-00123' });
		expect(Object.keys(got[0]).sort()).toEqual([
			'anyAffirmed', 'anyUnaffirmed', 'claimed', 'createdDay', 'debtorConfirmed', 'debtorDisputed',
			'encumbered', 'face', 'refMatch', 'settled', 'withdrawn',
		]);
		const text = JSON.stringify(got);
		const stored = rowOf(a.id);
		for (const secret of [a.id, OWNER, stored.fingerprint_inv, stored.fingerprint_ref, stored.fingerprint_kid, 'Acme', 'Bigco', 'INV-0042']) {
			expect(text).not.toContain(secret);
		}
	});

	it('claims: the active sum, financed, and the affirmed flags; discharged claims count for nothing', async () => {
		const financed = await create(OWNER, INVOICE, '2026-09-01 09:00:00');
		const released = await create(RIVAL, { ...INVOICE, invoiceNo: 'INV 42' }, '2026-09-02 09:00:00');
		seedClaim(financed.id, { amount: 400, affirmed_at: '2026-10-04 10:00:00' });
		seedClaim(financed.id, { amount: 350.5 });
		seedClaim(financed.id, { amount: 200, status: 'discharged', affirmed_at: '2026-10-04 10:00:00' });
		seedClaim(released.id, { amount: 1000, status: 'discharged', affirmed_at: '2026-10-04 10:00:00' });
		const [a, b] = await rows();
		expect(a).toMatchObject({ face: 1000, claimed: 750.5, encumbered: true, anyAffirmed: true, anyUnaffirmed: true, createdDay: '2026-09-01' });
		expect(b).toMatchObject({ face: 1000, claimed: 0, encumbered: false, anyAffirmed: false, anyUnaffirmed: false, createdDay: '2026-09-02' });
	});

	it('only affirmed, or only unaffirmed, active claims', async () => {
		const a = await create(OWNER, INVOICE);
		const claim = seedClaim(a.id, { affirmed_at: '2026-10-04 10:00:00' });
		expect((await rows())[0]).toMatchObject({ anyAffirmed: true, anyUnaffirmed: false });
		claim.affirmed_at = null;
		expect((await rows())[0]).toMatchObject({ anyAffirmed: false, anyUnaffirmed: true });
	});

	it('settled', async () => {
		const a = await create(OWNER, INVOICE);
		expect((await rows())[0].settled).toBe(false);
		rowOf(a.id).settled_at = '2026-10-05';
		expect((await rows())[0].settled).toBe(true);
	});

	it('a withdrawn record is still found, marked withdrawn', async () => {
		const a = await create(OWNER, INVOICE);
		seedClaim(a.id);
		expect(await reg.deleteReceivable(OWNER, a.id)).toMatchObject({ ok: true });
		expect(await rows()).toMatchObject([{ withdrawn: true, encumbered: true }]);
	});

	it('withdrawn follows soft delete\'s own flag: an unrelated failed ALTER keeps it', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_ATTESTATION_SOURCE });
		const a = await create(OWNER, INVOICE);
		expect(await reg.deleteReceivable(OWNER, a.id)).toMatchObject({ ok: true });
		expect(await rows()).toMatchObject([{ withdrawn: true }]);
	});

	it('without deleted_at, the column is never read and nothing reads withdrawn', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_RECEIVABLE_DELETED_AT });
		const a = await create(OWNER, INVOICE);
		rowOf(a.id).deleted_at = '2026-10-05 10:00:00';
		expect(await rows()).toMatchObject([{ withdrawn: false }]);
		expect(fake.statements(STORE_SQL)[0].sql).not.toContain('deleted_at');
	});
});

describe('the debtor: confirmed or disputed', () => {
	let rid: string;
	beforeEach(async () => { rid = (await create(OWNER, INVOICE)).id; });
	const debtor = async () => {
		const [r] = await rows();
		return { confirmed: r.debtorConfirmed, disputed: r.debtorDisputed };
	};
	const only = async (over: Record<string, unknown>) => {
		fake.rows('receivable_attestations').splice(0);
		seedAttestation(rid, over);
		return debtor();
	};

	it('nothing recorded', async () => {
		expect(await debtor()).toEqual({ confirmed: false, disputed: false });
	});

	it('a confirmation counts only from the debtor confirmation source, under the buyer role', async () => {
		expect(await only({ source: 'debtor_confirmation', role: 'buyer', statement: 'Confirms invoice INV-0042.' })).toEqual({ confirmed: true, disputed: false });
		expect(await only({ source: 'debtor_confirmation', role: 'other', statement: 'Confirms invoice INV-0042.' })).toEqual({ confirmed: false, disputed: false });
		// A legacy row with no source is never consent.
		expect(await only({ source: null, role: 'buyer', statement: 'Confirms invoice INV-0042.' })).toEqual({ confirmed: false, disputed: false });
		expect(await only({ source: 'record_confirmation', role: 'supplier' })).toEqual({ confirmed: false, disputed: false });
		expect(await only({ source: 'receipt_confirmation', role: 'supplier' })).toEqual({ confirmed: false, disputed: false });
	});

	it('a debtor dispute: the debtor_dispute source, or a legacy row in confirmByToken\'s exact wording', async () => {
		expect(await only({ source: 'debtor_dispute', statement: 'DISPUTED — states this invoice is not theirs. Invoice INV-0042.' })).toEqual({ confirmed: false, disputed: true });
		expect(await only({ source: null, statement: 'DISPUTED — states this invoice is not theirs. Invoice INV-0042. Answered by the debtor via a single-use link.' })).toEqual({ confirmed: false, disputed: true });
		expect(await only({ source: '', statement: 'DISPUTED — states the amount is wrong. Invoice INV-0042, their reference: PO-1.' })).toEqual({ confirmed: false, disputed: true });
	});

	it('the client\'s disputes of a receipt or of the record are not debtor disputes', async () => {
		for (const over of [
			{ source: 'receipt_dispute', statement: 'DISPUTED — states no money was received from Lender Co against invoice INV-0042.' },
			{ source: 'record_dispute', statement: 'DISPUTED — states the record is wrong. Invoice INV-0042 to Bigco Plc for USD 1,000.00.' },
			{ source: null, statement: 'DISPUTED — states no money was received from Lender Co against invoice INV-0042.' },
			{ source: null, statement: 'DISPUTED — states the amount received was USD 300.00, not the USD 400.00 registered by Lender Co against invoice INV-0042.' },
			{ source: null, statement: 'DISPUTED — states the record is wrong. Invoice INV-0042 to Bigco Plc for USD 1,000.00.' },
			// A recorded source wins over the words, as in classifyAttestation.
			{ source: 'party_statement', statement: 'DISPUTED — states this invoice is not theirs.' },
		]) {
			expect(await only(over), JSON.stringify(over)).toEqual({ confirmed: false, disputed: false });
		}
	});

	it('a dispute on another record does not count here', async () => {
		seedAttestation('another-receivable', { source: 'debtor_dispute' });
		seedAttestation('another-receivable', { source: 'debtor_confirmation', role: 'buyer' });
		expect(await debtor()).toEqual({ confirmed: false, disputed: false });
	});

	it('without the source column: legacy disputes still count, and no confirmation is read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_ATTESTATION_SOURCE });
		rid = (await create(OWNER, INVOICE)).id;
		seedAttestation(rid, { role: 'buyer', statement: 'Confirms invoice INV-0042.', source: 'debtor_confirmation' });
		expect(await debtor()).toEqual({ confirmed: false, disputed: false });
		seedAttestation(rid, { statement: 'DISPUTED — states no money was received from Lender Co against invoice INV-0042.' });
		expect(await debtor()).toEqual({ confirmed: false, disputed: false });
		seedAttestation(rid, { statement: 'DISPUTED — states the amount is wrong. Invoice INV-0042.' });
		expect(await debtor()).toEqual({ confirmed: false, disputed: true });
		for (const s of fake.statements(STORE_SQL)) expect(s.sql).not.toMatch(/\bsource\b/);
	});

	it('the legacy wording is the wording confirmByToken writes', () => {
		const src = fs.readFileSync(fileURLToPath(new URL('../../src/lib/receivablesRegistry.ts', import.meta.url)), 'utf8');
		expect(src).toContain("const why = outcome === 'not_ours' ? 'states this invoice is not theirs' : 'states the amount is wrong';");
		expect(src).toContain('statement = `DISPUTED — ${why}.');
	});
});

describe('values come back as numbers and booleans, whatever the driver returns', () => {
	it('coerces strings and 1/0, t/f', async () => {
		const inner = fake;
		holder.db = {
			execute: (st: any) => (STORE_SQL.test(normalizeSql(String(st?.sql ?? st)))
				? Promise.resolve({
					rows: [
						{ face: '1000.50', claimed: '250.25', encumbered: 't', any_affirmed: 'true', any_unaffirmed: 1, debtor_confirmed: 'f', debtor_disputed: 0, settled_at: '2026-10-05', fingerprint_ref: null, deleted_at: '2026-10-06 10:00:00', created_at: '2026-09-30 08:00:00' },
						{ face: 2000, claimed: '0', encumbered: false, any_affirmed: 'false', any_unaffirmed: 'f', debtor_confirmed: true, debtor_disputed: 't', settled_at: null, fingerprint_ref: null, deleted_at: null, created_at: '2026-10-01 08:00:00' },
					],
					rowsAffected: 0,
				})
				: inner.execute(st)),
			batch: (st: any) => inner.batch(st),
		};
		const got = await rows();
		expect(got).toEqual([
			{ face: 1000.5, claimed: 250.25, encumbered: true, anyAffirmed: true, anyUnaffirmed: true, debtorConfirmed: false, debtorDisputed: false, settled: true, withdrawn: true, refMatch: false, createdDay: '2026-09-30' },
			{ face: 2000, claimed: 0, encumbered: false, anyAffirmed: false, anyUnaffirmed: false, debtorConfirmed: true, debtorDisputed: true, settled: false, withdrawn: false, refMatch: false, createdDay: '2026-10-01' },
		]);
	});
});

describe('fail closed: unavailable, never an empty answer', () => {
	const UNAVAILABLE = { state: 'unavailable' };

	it('without a key', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
		await load();
		expect(await store.readSeenBefore(CHECK)).toEqual(UNAVAILABLE);
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});

	it('with a malformed key', async () => {
		vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', 'not-a-key');
		await load();
		expect(await store.readSeenBefore(CHECK)).toEqual(UNAVAILABLE);
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});

	it('while any row still waits for the backfill (coverage fails)', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await create(OWNER, INVOICE);
		fake.seed('receivables', {
			id: 'ab'.repeat(32), tenant_id: RIVAL, supplier: 'x', buyer: 'y', invoice_no: 'z', face: 1, currency: 'USD', is_test: false,
			manifest_json: '{}', digest: 'd'.repeat(64), created_at: '2026-09-01 10:00:00',
		});
		// The create's own count (0) is trusted for a minute, as in the duplicate check.
		const t0 = Date.now();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(t0 + 61_000);
		expect(await store.readSeenBefore(CHECK)).toEqual(UNAVAILABLE);
		expect(fake.statements(STORE_SQL)).toEqual([]);
		await reg.startFingerprintBackfill();
		clock.mockReturnValue(t0 + 122_000);
		expect(await store.readSeenBefore(CHECK)).toMatchObject({ state: 'ok', rows: [{ face: 1000 }] });
	});

	it('when a fingerprint ALTER failed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_FINGERPRINT_REF });
		await create(OWNER, INVOICE);
		expect(await store.readSeenBefore(CHECK)).toEqual(UNAVAILABLE);
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});

	it('when the input has no invoice key (a caller that skipped the parse)', async () => {
		await create(OWNER, INVOICE);
		expect(await store.readSeenBefore({ ...CHECK, supplier: '...' })).toEqual(UNAVAILABLE);
		expect(fake.statements(STORE_SQL)).toEqual([]);
	});

	it('a store error propagates, and nothing is logged on either path', async () => {
		const logs: unknown[][] = [];
		for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
			vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push([level, ...a]); });
		}
		await create(OWNER, INVOICE);
		expect(await rows({ buyerRef: 'PO-00123' })).toHaveLength(1);
		fake.options.failDml = (sql) => STORE_SQL.test(sql);
		await expect(store.readSeenBefore({ ...CHECK, buyerRef: 'PO-00123' })).rejects.toThrow();
		expect(logs).toEqual([]);
	});
});
