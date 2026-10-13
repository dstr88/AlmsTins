import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { randomBytes } from 'node:crypto';
import {
	ADD_ATTESTATION_SOURCE,
	ADD_FINGERPRINT_INV,
	ADD_FINGERPRINT_KID,
	ADD_FINGERPRINT_REF,
	ADD_RECEIVABLE_DELETED_AT,
	CREATE_FP_INV_IDX,
	CREATE_FP_REF_IDX,
	DDL_LOCK_TIMEOUT,
	FINGERPRINT_COLUMN_ADDS,
	RECEIVABLE_COLUMN_ADDS,
	RECEIVABLE_INDEX_CREATES,
} from '../../src/lib/receivables/schema';

/**
 * ensureReceivablesTables: single-flight, cleared on rejection, and columnsEnsured.
 *   - concurrent first callers share one run of the DDL;
 *   - a run whose CREATE throws is forgotten, so the next call retries instead of rethrowing a
 *     cached failure for the life of the process;
 *   - receivableColumnsEnsured() is true only when every ALTER succeeded; while it is false the
 *     readers and writers of receivable_attestations.source fall back to the pre-column SQL, and
 *     the ensure runs again after a minute to heal.
 * The fake throws on a missing relation or column, as Postgres does, so "the CREATEs run before
 * the first read" and "no read touches a column that failed to add" are both enforced by it.
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

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
}

function seedReceivable() {
	fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 1000, currency: 'USD', is_test: false, manifest_json: '{}', digest: 'd'.repeat(64),
		created_at: '2026-09-01 10:00:00',
	});
}

const creates = () => fake.statements(/^CREATE TABLE IF NOT EXISTS receivables \(/).length;
const sourceAlters = () => fake.statements(/ADD COLUMN IF NOT EXISTS source TEXT$/).length;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); vi.restoreAllMocks(); });

describe('schema.ts', () => {
	it('is import-free and only adds columns idempotently', () => {
		const src = fs.readFileSync(fileURLToPath(new URL('../../src/lib/receivables/schema.ts', import.meta.url)), 'utf8');
		expect(src).not.toMatch(/^\s*import\s/m);
		expect(RECEIVABLE_COLUMN_ADDS).toContain(ADD_ATTESTATION_SOURCE);
		expect(RECEIVABLE_COLUMN_ADDS).toContain(ADD_RECEIVABLE_DELETED_AT);
		for (const sql of RECEIVABLE_COLUMN_ADDS) expect(sql).toMatch(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ /);
	});

	it('S3: three nullable fingerprint columns with no default, and two partial indexes', () => {
		expect(FINGERPRINT_COLUMN_ADDS).toEqual([ADD_FINGERPRINT_REF, ADD_FINGERPRINT_INV, ADD_FINGERPRINT_KID]);
		for (const sql of FINGERPRINT_COLUMN_ADDS) {
			expect(RECEIVABLE_COLUMN_ADDS).toContain(sql);
			expect(sql).toMatch(/^ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_(ref|inv|kid) TEXT$/);
		}
		expect(RECEIVABLE_INDEX_CREATES).toEqual([CREATE_FP_REF_IDX, CREATE_FP_INV_IDX]);
		for (const sql of RECEIVABLE_INDEX_CREATES) {
			expect(sql).toMatch(/^CREATE INDEX IF NOT EXISTS receivables_fp_(ref|inv) ON receivables \(fingerprint_(ref|inv)\) WHERE fingerprint_\2 IS NOT NULL$/);
		}
	});
});

describe('ensureReceivablesTables: single flight', () => {
	it('concurrent first callers share one run', async () => {
		await load();
		await Promise.all([reg.ensureReceivablesTables(), reg.ensureReceivablesTables(), reg.ensureReceivablesTables()]);
		expect(creates()).toBe(1);
		expect(reg.receivableColumnsEnsured()).toBe(true);
		const before = fake.log.length;
		await reg.ensureReceivablesTables();
		expect(fake.log.length).toBe(before);
	});

	it('runs every CREATE and ALTER before the first read', async () => {
		await load();
		seedReceivable();
		await reg.getReceivableStatus(RID);
		const firstRead = fake.log.findIndex((s) => /^(SELECT|INSERT|UPDATE)/.test(s.sql));
		const lastDdl = fake.log.map((s) => /^(CREATE|ALTER)/.test(s.sql)).lastIndexOf(true);
		expect(firstRead).toBeGreaterThan(lastDdl);
		expect(sourceAlters()).toBe(1);
		// S3: the fingerprint columns and their indexes are part of that DDL.
		for (const sql of [...FINGERPRINT_COLUMN_ADDS, ...RECEIVABLE_INDEX_CREATES]) {
			const at = fake.log.findIndex((x) => x.sql === sql);
			expect(at, sql).toBeGreaterThanOrEqual(0);
			expect(at, sql).toBeLessThan(firstRead);
		}
	});

	it('a run that throws is cleared, so the next call retries', async () => {
		let failing = true;
		await load({ failDdl: (sql) => failing && /^CREATE TABLE IF NOT EXISTS receivable_claims/.test(sql) });
		const results = await Promise.allSettled([reg.ensureReceivablesTables(), reg.ensureReceivablesTables()]);
		expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
		expect(creates()).toBe(1);
		expect(reg.receivableColumnsEnsured()).toBe(false);

		failing = false;
		await reg.ensureReceivablesTables();
		expect(creates()).toBe(2);
		expect(reg.receivableColumnsEnsured()).toBe(true);
		seedReceivable();
		expect((await reg.getReceivableStatus(RID))?.id).toBe(RID);
	});
});

describe('columnsEnsured: a failed ALTER degrades, then heals', () => {
	let failSource = true;
	beforeEach(async () => {
		failSource = true;
		await load({ failDdl: (sql) => failSource && sql === ADD_ATTESTATION_SOURCE });
		seedReceivable();
	});

	it('is false while the source column is missing, and reads still work without it', async () => {
		fake.seed('receivable_attestations', {
			id: 'att-legacy', receivable_id: RID, tenant_id: OWNER, role: 'other', label: 'Bigco Plc',
			statement: 'DISPUTED — states this invoice is not theirs.', attested_at: '2026-09-03',
			manifest_json: '{}', digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:00',
		});
		const s = await reg.getReceivableStatus(RID);
		expect(reg.receivableColumnsEnsured()).toBe(false);
		expect(fake.columns.get('receivable_attestations')?.has('source')).toBe(false);
		expect(s!.attestations[0].class).toBe('party_dispute');
		expect(errSpy).toHaveBeenCalled();
	});

	it('writes attestations without the column, and they never read as consent', async () => {
		fake.seed('receivable_invites', {
			token: 'tok-buyer', receivable_id: RID, from_tenant: OWNER, role: 'buyer', email: 'ap@bigco.test',
			expires_at: '2099-01-01 00:00:00', accepted_at: null, revoked_at: null,
		});
		const r = await reg.confirmByToken('tok-buyer', 'confirmed', {
			theirReference: 'PO-77', by: 'Jane Roe', goodsReceived: true, amountCorrect: true, noOffsets: true, notAlreadyPaid: true,
		});
		expect(r.ok).toBe(true);
		const row = fake.rows('receivable_attestations')[0];
		expect(row).not.toHaveProperty('source');
		const s = await reg.getReceivableStatus(RID);
		expect(s!.attestations[0]).toMatchObject({ role: 'buyer', class: 'party_statement' });
	});

	it('the diligence gate keeps the legacy prefix rule', async () => {
		fake.seed('receivable_attestations', {
			id: 'att-dil', receivable_id: RID, tenant_id: LENDER, role: 'other', label: 'Lender Co',
			statement: 'DILIGENCE — accepts responsibility for having personally verified this debtor via a phone call.',
			attested_at: '2026-09-03', manifest_json: '{}', digest: 'f'.repeat(64), created_at: '2026-09-03 10:00:00',
		});
		expect(await reg.addClaim(LENDER, RID, { financier: 'Lender Co', amount: 100 })).toMatchObject({ ok: true });
	});

	it('does not rerun the DDL inside the retry window', async () => {
		await reg.ensureReceivablesTables();
		const n = creates();
		await reg.ensureReceivablesTables();
		await reg.getReceivableStatus(RID);
		expect(creates()).toBe(n);
	});

	it('reruns after a minute and, once the ALTER lands, reads and writes source', async () => {
		await reg.ensureReceivablesTables();
		expect(reg.receivableColumnsEnsured()).toBe(false);
		const n = creates();

		failSource = false;
		const now = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
		await reg.ensureReceivablesTables();
		expect(creates()).toBe(n + 1);
		expect(reg.receivableColumnsEnsured()).toBe(true);

		await reg.acceptDiligence(LENDER, RID, { financier: 'Lender Co', method: 'phone' });
		expect(fake.rows('receivable_attestations')[0].source).toBe('diligence');
		const s = await reg.getReceivableStatus(RID);
		expect(s!.attestations[0].class).toBe('diligence');
		expect(fake.statements(/^SELECT id, role, label, statement, attested_at, source, /)).toHaveLength(1);
	});
});

describe('S3: the fingerprint columns have their own readiness', () => {
	const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-7', face: 2500, currency: 'USD', isTest: true };
	beforeEach(() => { vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', randomBytes(32).toString('hex')); vi.stubEnv('ALMSTINS_SIGNING_KEY', ''); });
	afterEach(() => { vi.unstubAllEnvs(); });

	it('a failed fingerprint ALTER leaves the check unavailable while soft delete and source keep working', async () => {
		await load({ failDdl: (sql) => sql === ADD_FINGERPRINT_KID });
		seedReceivable();
		const created = await reg.createReceivable(OWNER, INPUT);
		expect(created).toMatchObject({ ok: true, duplicateCheck: { state: 'unavailable' } });
		expect(fake.columns.get('receivables')?.has('fingerprint_kid')).toBe(false);
		// No write or read named a fingerprint column the process has not confirmed.
		expect(fake.statements(/fingerprint_kid/).filter((x) => !/^(ALTER|SELECT fingerprint_ref, fingerprint_inv, fingerprint_kid FROM receivables LIMIT 0)/.test(x.sql))).toEqual([]);
		expect((await reg.getReceivableStatus(RID))?.duplicateCheck).toEqual({ state: 'unavailable', hasDebtorReference: false });
		expect(await reg.deleteReceivable(OWNER, RID)).toMatchObject({ ok: true });
		// The other S0a/S0b columns were added; their readers degrade on columnsEnsured as before.
		expect(fake.columns.get('receivable_attestations')?.has('source')).toBe(true);
		expect(await reg.acceptDiligence(LENDER, (created as { id: string }).id, { financier: 'Lender Co', method: 'phone' })).toMatchObject({ ok: true });
		expect((await reg.startFingerprintBackfill()).state).toBe('failed');
	});

	it('an unrelated failed ALTER never makes the check read clear or unavailable on its own', async () => {
		await load({ failDdl: (sql) => sql === ADD_ATTESTATION_SOURCE });
		const first = await reg.createReceivable(OWNER, INPUT);
		const twin = await reg.createReceivable(OWNER, { ...INPUT, invoiceNo: 'inv 7', terms: 'Net 30' });
		expect(reg.receivableColumnsEnsured()).toBe(false);
		expect(twin).toMatchObject({ ok: true, duplicateCheck: { state: 'possible_duplicate', basis: 'invoice_number' } });
		expect((twin as { ownMatches?: unknown[] }).ownMatches).toEqual([{ id: (first as { id: string }).id, invoiceNo: 'INV-7', withdrawn: false }]);
	});

	it('an ALTER that times out on columns already there is confirmed by a zero-row read', async () => {
		// An earlier deploy added the columns (here: as soon as the table exists, before the adds' own
		// transactions, which roll back when an add fails).
		await load({
			failDdl: (sql) => {
				if (/^CREATE INDEX IF NOT EXISTS receivables_tenant /.test(sql)) {
					for (const add of FINGERPRINT_COLUMN_ADDS) fake.columns.get('receivables')!.add(add.split(' ')[8]);
				}
				return FINGERPRINT_COLUMN_ADDS.includes(sql);
			},
		});
		await reg.ensureReceivablesTables();
		expect(fake.statements(/^SELECT fingerprint_ref, fingerprint_inv, fingerprint_kid FROM receivables LIMIT 0$/)).toHaveLength(1);
		const first = await reg.createReceivable(OWNER, INPUT);
		expect(first).toMatchObject({ ok: true, duplicateCheck: { state: 'no_match' } });
	});

	it('a failed index is logged and retried on its own clock, without re-running the column adds, and gates nothing', async () => {
		let failIndex = true;
		await load({ failDdl: (sql) => failIndex && sql === CREATE_FP_REF_IDX });
		await reg.ensureReceivablesTables();
		expect(reg.receivableColumnsEnsured()).toBe(true);
		expect(errSpy).toHaveBeenCalledWith('[receivables] index not applied:', expect.anything());
		const created = await reg.createReceivable(OWNER, INPUT);
		expect(created).toMatchObject({ ok: true, duplicateCheck: { state: 'no_match' } });

		const fpRefIdx = () => fake.statements(/^CREATE INDEX IF NOT EXISTS receivables_fp_ref /).length;
		const alters = () => fake.statements(/^ALTER TABLE /).length;
		const [n, a, i] = [creates(), alters(), fpRefIdx()];
		// Inside the window: nothing runs again.
		await reg.ensureReceivablesTables();
		expect([creates(), alters(), fpRefIdx()]).toEqual([n, a, i]);

		// Still failing a minute later: the indexes alone run again, never a CREATE TABLE or an ALTER.
		const now = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
		await reg.ensureReceivablesTables();
		expect([creates(), alters(), fpRefIdx()]).toEqual([n, a, i + 1]);

		failIndex = false;
		vi.spyOn(Date, 'now').mockReturnValue(now + 122_000);
		await reg.ensureReceivablesTables();
		expect([creates(), alters(), fpRefIdx()]).toEqual([n, a, i + 2]);
		// Created: no further retries.
		vi.spyOn(Date, 'now').mockReturnValue(now + 183_000);
		await reg.ensureReceivablesTables();
		expect(fpRefIdx()).toBe(i + 2);
	});

	it('every column add and index runs under a short lock timeout, in its own transaction', async () => {
		await load();
		await reg.ensureReceivablesTables();
		const ddl = [...RECEIVABLE_COLUMN_ADDS, ...RECEIVABLE_INDEX_CREATES];
		for (const sql of ddl) {
			const batch = fake.batches.find((b) => b.at(-1)?.sql === sql);
			expect(batch?.map((x) => x.sql), sql).toEqual([DDL_LOCK_TIMEOUT, sql]);
		}
		expect(DDL_LOCK_TIMEOUT).toBe(`SET LOCAL lock_timeout = '3s'`);
	});

	it('a lock timeout ends the column adds for this run; every column stays fail closed and the next run heals', async () => {
		const lockTimeout = () => Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
		let locked = true;
		await load({ failDdl: (sql) => (locked && sql === ADD_ATTESTATION_SOURCE ? lockTimeout() : false) });
		await reg.ensureReceivablesTables();
		// The adds after the timed-out one were not tried, and no index ran while the table was locked.
		expect(fake.statements(/^ALTER TABLE receivables ADD COLUMN IF NOT EXISTS deleted_at /)).toHaveLength(0);
		for (const sql of [...FINGERPRINT_COLUMN_ADDS, ...RECEIVABLE_INDEX_CREATES]) expect(fake.log.filter((x) => x.sql === sql), sql).toHaveLength(0);
		expect(reg.receivableColumnsEnsured()).toBe(false);
		const created = await reg.createReceivable(OWNER, INPUT);
		expect(created).toMatchObject({ ok: true, duplicateCheck: { state: 'unavailable' } });
		// Fail closed: neither soft delete nor a fingerprint column is used before it is confirmed.
		expect(await reg.deleteReceivable(OWNER, (created as { id: string }).id)).toMatchObject({ ok: false });
		expect(fake.rows('receivables')[0]).not.toHaveProperty('fingerprint_kid');

		locked = false;
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
		await reg.ensureReceivablesTables();
		expect(reg.receivableColumnsEnsured()).toBe(true);
		for (const sql of RECEIVABLE_INDEX_CREATES) expect(fake.log.some((x) => x.sql === sql), sql).toBe(true);
		await reg.startFingerprintBackfill();
		expect((await reg.createReceivable(OWNER, { ...INPUT, invoiceNo: 'inv 7' }))).toMatchObject({ ok: true, duplicateCheck: { state: 'possible_duplicate' } });
	});
});
