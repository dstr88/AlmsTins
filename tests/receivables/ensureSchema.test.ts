import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { ADD_ATTESTATION_SOURCE, RECEIVABLE_COLUMN_ADDS } from '../../src/lib/receivables/schema';

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
		for (const sql of RECEIVABLE_COLUMN_ADDS) expect(sql).toMatch(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ /);
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
