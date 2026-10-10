import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { brightLineViolations } from '../helpers/brightLineWording';
import { deriveKeyId } from '../../src/lib/recordProof/isoSign';
import { ANCHOR_SPEC, ANCHOR_KINDS, isAnchorKind } from '../../src/lib/receivables/anchorSpec';
import {
	ADD_DISCHARGE_SIGNATURE,
	ADD_SETTLEMENT_SIGNATURE,
	CREATE_ANCHOR_ATTEMPTS,
	RECEIVABLE_COLUMN_ADDS,
	RECEIVABLE_TABLE_CREATES,
} from '../../src/lib/receivables/schema';

ed.hashes.sha512 = sha512;

/**
 * Receivables S0b, evidence plumbing, in the registry:
 *   - Verify now's integrity check accepts any published key, current or retired, so a signing-key
 *     rotation no longer fails every record signed before it;
 *   - discharges and settlements keep their signature and full recorded-at time;
 *   - ANCHOR_SPEC drives getRecordForAnchor / setRecordAnchor (tenant-scoped for every kind),
 *     listPendingAnchors takes per-kind turns and rotates stuck receipts through
 *     receivable_anchor_attempts, and listUnanchoredRecords feeds the cron's batch (re-verifications,
 *     and discharges and settlements whose write-time stamp failed), fair by tenant;
 *   - every new column is gated on columnsEnsured, so a failed ALTER degrades instead of failing.
 *
 * The registry's real SQL runs against tests/helpers/receivablesDbFake.ts. Keys are generated
 * in-test. No network: nothing here stamps.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

type Registry = typeof import('../../src/lib/receivablesRegistry');
let fake: ReceivablesDbFake;
let reg: Registry;

const newKey = () => {
	const seed = ed.utils.randomSecretKey();
	return { seedHex: bytesToHex(seed), pub: bytesToHex(ed.getPublicKey(seed)) };
};
let A: ReturnType<typeof newKey>, B: ReturnType<typeof newKey>, C: ReturnType<typeof newKey>;
/** An ALMSTINS_SIGNING_RETIRED_PUBKEYS entry: key_id:public_key_hex, as the well-known document lists it. */
const retiredEntry = (pub: string) => `${deriveKeyId(pub)}:${pub}`;

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD' };
const PENDING = (d: string) => JSON.stringify({ type: 'opentimestamps', digest: d, receipt: 'cA==', anchoredAt: null });
const DONE = (d: string) => JSON.stringify({ type: 'opentimestamps', digest: d, receipt: 'cA==', anchoredAt: '2026-10-01T00:00:00.000Z' });

async function load(options: Parameters<typeof createReceivablesDbFake>[0] = {}) {
	vi.resetModules();
	fake = createReceivablesDbFake(options);
	holder.db = fake;
	reg = await import('../../src/lib/receivablesRegistry');
}

beforeEach(async () => {
	A = newKey(); B = newKey(); C = newKey();
	vi.stubEnv('ALMSTINS_SIGNING_KEY', A.seedHex);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	await load();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function integrityOf(id: string) {
	const r = await reg.reverifyReceivable(LENDER, id, { persist: false });
	if (!r.ok) throw new Error('not found');
	return r.checks.find((c) => c.key === 'integrity')!;
}

describe('Verify now after a signing-key rotation', () => {
	it('a record signed by a retired key still passes once that key is published as retired', async () => {
		const { id } = (await reg.createReceivable(OWNER, INPUT)) as { id: string };
		// Rotate: B signs now, A is retired.
		vi.stubEnv('ALMSTINS_SIGNING_KEY', B.seedHex);
		expect((await integrityOf(id)).state).toBe('fail');
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', retiredEntry(A.pub));
		expect(await integrityOf(id)).toEqual({
			key: 'integrity', label: 'Record integrity', state: 'pass',
			detail: 'Signature verifies and the record is unchanged since it was signed.',
		});
	});

	it('records signed by the new key pass too, and the whole run is recorded with the new key', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', B.seedHex);
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', retiredEntry(A.pub));
		const { id } = (await reg.createReceivable(OWNER, INPUT)) as { id: string };
		expect((await integrityOf(id)).state).toBe('pass');
		const run = await reg.reverifyReceivable(LENDER, id);
		expect(run.ok && run.signed).toBe(true);
		const sig = JSON.parse(fake.rows('receivable_reverifications')[0].signature_json);
		expect(sig.publicKeyHex).toBe(B.pub);
	});

	it('a key that is neither current nor retired still fails, with a plain message', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', C.seedHex); // signs with a key Almstins never published
		const { id } = (await reg.createReceivable(OWNER, INPUT)) as { id: string };
		vi.stubEnv('ALMSTINS_SIGNING_KEY', B.seedHex);
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', retiredEntry(A.pub));
		const c = await integrityOf(id);
		expect(c).toMatchObject({ state: 'fail', detail: 'Signed by a key that is not a published Almstins key.' });
		expect(brightLineViolations(c.detail)).toEqual([]);
	});

	it('a retired key does not excuse tampering', async () => {
		const { id } = (await reg.createReceivable(OWNER, INPUT)) as { id: string };
		vi.stubEnv('ALMSTINS_SIGNING_KEY', B.seedHex);
		vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', retiredEntry(A.pub));
		const row = fake.rows('receivables')[0];
		row.manifest_json = row.manifest_json.replace('"face":1000', '"face":9000');
		expect((await integrityOf(id)).state).toBe('fail');
	});

	it('with no key published at all, an intact record is a caution, never a pass', async () => {
		const { id } = (await reg.createReceivable(OWNER, INPUT)) as { id: string };
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		const c = await integrityOf(id);
		expect(c).toMatchObject({ state: 'warn' });
		expect(c.detail).toMatch(/no Almstins signing key is published/);
		expect(brightLineViolations(c.detail)).toEqual([]);
		const run = await reg.reverifyReceivable(LENDER, id, { persist: false });
		expect(run.ok && run.verdict).toBe('attention');
		// Tampering still reads as tampering, not as a missing key.
		fake.rows('receivables')[0].digest = 'f'.repeat(64);
		expect(await integrityOf(id)).toMatchObject({ state: 'fail', detail: 'The stored record no longer matches its signed fingerprint.' });
	});

	it('during a rotation with the published-key override set, new records are stored under the seed key', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', B.seedHex);
		vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', A.pub);
		const r = await reg.createReceivable(OWNER, INPUT);
		expect(r).toMatchObject({ ok: true, signed: true });
		const sig = JSON.parse(fake.rows('receivables')[0].signature_json);
		expect(sig.publicKeyHex).toBe(B.pub);
		expect(sig.keyId).toBe((r as any).keyId);
		expect((await integrityOf((r as any).id)).state).toBe('pass');
	});
});

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: 'r1'.padEnd(64, '0'), tenant_id: OWNER, supplier: 'Acme', buyer: 'Bigco', invoice_no: 'INV-1', face: 1000,
		currency: 'USD', is_test: false, manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64),
		anchor_json: null, settled_at: null, settlement_digest: null, created_at: '2026-09-01 10:00:00',
		...over,
	});
}
let claimSeq = 0;
function seedClaim(over: Record<string, unknown> = {}) {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: 'r1'.padEnd(64, '0'), tenant_id: LENDER, financier: 'Lender Co',
		amount: 100, currency: 'USD', claim_date: '2026-09-02', status: 'active', manifest_json: '{}',
		signature_json: null, digest: 'e'.repeat(64), anchor_json: null, discharge_digest: null,
		created_at: `2026-09-02 10:${String(Math.floor(claimSeq / 60)).padStart(2, '0')}:${String(claimSeq % 60).padStart(2, '0')}`,
		...over,
	});
}

describe('discharge and settlement keep their evidence', () => {
	beforeEach(async () => { await reg.ensureReceivablesTables(); claimSeq = 0; });

	it('a discharge stores a signature over its manifest and the full recorded-at time', async () => {
		seedReceivable();
		const c = seedClaim();
		const r = await reg.dischargeClaim(LENDER, c.id, 'wire received');
		expect(r.ok && r.signed).toBe(true);
		const row = fake.rows('receivable_claims')[0];
		const sig = JSON.parse(row.discharge_signature_json);
		expect(sig).toMatchObject({ alg: 'Ed25519', publicKeyHex: A.pub });
		const signing = await import('@/lib/recordProof/signing');
		const bytes = signing.canonicalManifestBytes(JSON.parse(row.discharge_json));
		expect(signing.verifyManifestSignature(bytes, sig.signatureHex, sig.publicKeyHex)).toBe(true);
		expect(row.discharge_recorded_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(row.discharge_recorded_at.slice(0, 10)).toBe(row.discharged_at);
		expect(row.discharge_anchor_json ?? null).toBeNull(); // stamped by the route, not here
	});

	it('a settlement stores a signature over its manifest and the full recorded-at time', async () => {
		seedReceivable();
		const r = await reg.settleReceivable(OWNER, 'r1'.padEnd(64, '0'));
		expect(r.ok && r.signed).toBe(true);
		const row = fake.rows('receivables')[0];
		const sig = JSON.parse(row.settlement_signature_json);
		const signing = await import('@/lib/recordProof/signing');
		expect(signing.verifyManifestSignature(signing.canonicalManifestBytes(JSON.parse(row.settlement_json)), sig.signatureHex, sig.publicKeyHex)).toBe(true);
		expect(row.settlement_recorded_at.slice(0, 10)).toBe(row.settled_at);
	});

	it('unsigned when no key is configured, and the recorded-at time is still kept', async () => {
		vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
		seedReceivable();
		const c = seedClaim();
		expect(await reg.dischargeClaim(LENDER, c.id)).toMatchObject({ ok: true, signed: false });
		const row = fake.rows('receivable_claims')[0];
		expect(row.discharge_signature_json).toBeNull();
		expect(row.discharge_recorded_at).toBeTruthy();
	});
});

describe('schema: the new columns and table', () => {
	it('adds the six evidence columns and the attempts table, before any read', async () => {
		for (const sql of RECEIVABLE_COLUMN_ADDS) expect(sql).toMatch(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ /);
		for (const sql of RECEIVABLE_TABLE_CREATES) expect(sql.trim()).toMatch(/^CREATE TABLE IF NOT EXISTS \w+ \(/);
		seedReceivable();
		await reg.getReceivableStatus('r1'.padEnd(64, '0'));
		for (const [table, col] of [
			['receivable_claims', 'discharge_signature_json'], ['receivable_claims', 'discharge_anchor_json'], ['receivable_claims', 'discharge_recorded_at'],
			['receivables', 'settlement_signature_json'], ['receivables', 'settlement_anchor_json'], ['receivables', 'settlement_recorded_at'],
		]) expect(fake.columns.get(table)?.has(col), `${table}.${col}`).toBe(true);
		expect([...fake.columns.get('receivable_anchor_attempts')!]).toEqual(['kind', 'record_id', 'last_attempt_at', 'attempts']);
		const firstRead = fake.log.findIndex((s) => /^(SELECT|INSERT|UPDATE|DELETE)/.test(s.sql));
		const attemptsCreate = fake.log.findIndex((s) => s.sql.startsWith('CREATE TABLE IF NOT EXISTS receivable_anchor_attempts'));
		expect(attemptsCreate).toBeGreaterThanOrEqual(0);
		expect(attemptsCreate).toBeLessThan(firstRead);
	});

	it('the attempts table holds no tenant data', () => {
		expect(CREATE_ANCHOR_ATTEMPTS).not.toMatch(/tenant/i);
	});

	it('a failed attempts-table CREATE rejects the ensure, which is retried', async () => {
		let failing = true;
		await load({ failDdl: (sql) => failing && sql.startsWith('CREATE TABLE IF NOT EXISTS receivable_anchor_attempts') });
		await expect(reg.ensureReceivablesTables()).rejects.toThrow();
		failing = false;
		await reg.ensureReceivablesTables();
		expect(fake.columns.has('receivable_anchor_attempts')).toBe(true);
	});

	it('while a new column is missing, discharge and settle write the old way, and those anchor kinds read as unavailable', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await load({ failDdl: (sql) => sql === ADD_DISCHARGE_SIGNATURE || sql === ADD_SETTLEMENT_SIGNATURE });
		await reg.ensureReceivablesTables();
		expect(reg.receivableColumnsEnsured()).toBe(false);
		seedReceivable();
		const c = seedClaim();
		expect(await reg.dischargeClaim(LENDER, c.id)).toMatchObject({ ok: true });
		expect(fake.rows('receivable_claims')[0].status).toBe('discharged');
		expect(await reg.settleReceivable(OWNER, 'r1'.padEnd(64, '0'))).toMatchObject({ ok: true });
		expect(await reg.getRecordForAnchor(LENDER, 'claim_discharge', c.id)).toBeNull();
		await reg.setRecordAnchor(OWNER, 'settlement', 'r1'.padEnd(64, '0'), PENDING('aa'));
		expect(fake.statements(/settlement_anchor_json|discharge_anchor_json|discharge_signature_json|settlement_signature_json/)
			.filter((s) => !/^ALTER/.test(s.sql))).toEqual([]);
		// The kinds whose columns exist still work.
		expect(await reg.listPendingAnchors()).toEqual([]);
		expect(await reg.getRecordForAnchor(LENDER, 'claim', c.id)).toMatchObject({ digest: 'e'.repeat(64) });
	});
});

describe('ANCHOR_SPEC', () => {
	it('names real tables and columns, and only its own kinds', async () => {
		await reg.ensureReceivablesTables();
		for (const kind of ANCHOR_KINDS) {
			const { table, digestColumn, anchorColumn } = ANCHOR_SPEC[kind];
			const cols = fake.columns.get(table)!;
			for (const c of ['id', 'tenant_id', 'created_at', digestColumn, anchorColumn]) expect(cols.has(c), `${kind}: ${table}.${c}`).toBe(true);
		}
		expect(ANCHOR_KINDS).toEqual(['receivable', 'claim', 'attestation', 'reverification', 'claim_discharge', 'settlement']);
		for (const bad of ['constructor', '__proto__', 'toString', 'receivables', '']) {
			expect(isAnchorKind(bad)).toBe(false);
			expect(await reg.getRecordForAnchor(OWNER, bad as any, 'x')).toBeNull();
		}
	});

	it('every record read and write is scoped by tenant_id, for every kind', async () => {
		await reg.ensureReceivablesTables();
		const before = fake.log.length;
		for (const kind of ANCHOR_KINDS) {
			await reg.getRecordForAnchor(OWNER, kind, 'x');
			await reg.setRecordAnchor(OWNER, kind, 'x', PENDING('aa'));
		}
		const stmts = fake.log.slice(before);
		expect(stmts).toHaveLength(ANCHOR_KINDS.length * 2);
		for (const s of stmts) {
			expect(s.sql).toMatch(/WHERE id = \? AND tenant_id = \?/);
			expect(s.args).toContain(OWNER);
		}
	});

	it('a discharge and a settlement are anchorable only by their owner, and only once they exist', async () => {
		await reg.ensureReceivablesTables();
		const rid = 'r1'.padEnd(64, '0');
		seedReceivable();
		const c = seedClaim();
		expect(await reg.getRecordForAnchor(LENDER, 'claim_discharge', c.id)).toBeNull(); // not discharged yet
		await reg.setRecordAnchor(LENDER, 'claim_discharge', c.id, PENDING('aa'));
		expect(fake.rows('receivable_claims')[0].discharge_anchor_json ?? null).toBeNull();

		await reg.dischargeClaim(LENDER, c.id);
		const digest = fake.rows('receivable_claims')[0].discharge_digest;
		expect(await reg.getRecordForAnchor(OWNER, 'claim_discharge', c.id)).toBeNull();
		expect(await reg.getRecordForAnchor(LENDER, 'claim_discharge', ` ${c.id} `)).toEqual({ digest, anchorJson: null });
		await reg.setRecordAnchor(OWNER, 'claim_discharge', c.id, PENDING(digest));
		expect(fake.rows('receivable_claims')[0].discharge_anchor_json ?? null).toBeNull();
		await reg.setRecordAnchor(LENDER, 'claim_discharge', c.id, PENDING(digest));
		expect(fake.rows('receivable_claims')[0]).toMatchObject({ discharge_anchor_json: PENDING(digest), anchor_json: null });

		expect(await reg.getRecordForAnchor(OWNER, 'settlement', rid)).toBeNull(); // not settled yet
		await reg.settleReceivable(OWNER, rid);
		const sd = fake.rows('receivables')[0].settlement_digest;
		expect(await reg.getRecordForAnchor(LENDER, 'settlement', rid)).toBeNull();
		await reg.setRecordAnchor(OWNER, 'settlement', rid, PENDING(sd));
		expect(fake.rows('receivables')[0]).toMatchObject({ settlement_anchor_json: PENDING(sd), anchor_json: null });
	});
});

describe('listPendingAnchors: per-kind turns and rotation', () => {
	beforeEach(async () => { await reg.ensureReceivablesTables(); claimSeq = 0; });

	it('fifty pending claims cannot starve a pending settlement, discharge or re-verification', async () => {
		seedReceivable({ settlement_digest: 's'.repeat(64), settlement_anchor_json: PENDING('ss'), settled_at: '2026-10-01' });
		for (let i = 0; i < 50; i++) seedClaim({ anchor_json: PENDING(`c${i}`) });
		seedClaim({ status: 'discharged', discharge_digest: 'x'.repeat(64), discharge_anchor_json: PENDING('dd') });
		fake.seed('receivable_reverifications', {
			id: 'rv-1', receivable_id: 'r1'.padEnd(64, '0'), tenant_id: LENDER, verdict: 'attention', checks_json: '[]',
			manifest_json: '{}', signature_json: null, digest: 'v'.repeat(64), anchor_json: PENDING('vv'), created_at: '2026-10-02 00:00:00',
		});
		const out = await reg.listPendingAnchors(10);
		expect(out).toHaveLength(10);
		const kinds = out.map((p) => p.kind);
		expect(kinds).toEqual(expect.arrayContaining(['settlement', 'claim_discharge', 'reverification', 'claim']));
		expect(out.find((p) => p.kind === 'settlement')).toEqual({ kind: 'settlement', id: 'r1'.padEnd(64, '0'), tenantId: OWNER, anchorJson: PENDING('ss') });
		expect(out.find((p) => p.kind === 'claim_discharge')?.anchorJson).toBe(PENDING('dd'));
		expect(kinds.filter((k) => k === 'claim')).toHaveLength(7);
	});

	it('a receipt the cron has asked about rotates behind the ones it has not, oldest attempt first', async () => {
		const c1 = seedClaim({ anchor_json: PENDING('c1') });
		const c2 = seedClaim({ anchor_json: PENDING('c2') });
		const c3 = seedClaim({ anchor_json: PENDING('c3') });
		// Newest first among never-attempted rows.
		expect((await reg.listPendingAnchors()).map((p) => p.id)).toEqual([c3.id, c2.id, c1.id]);
		await reg.recordAnchorAttempt('claim', c3.id);
		fake.rows('receivable_anchor_attempts')[0].last_attempt_at = '2026-10-09 00:00:00';
		await reg.recordAnchorAttempt('claim', c2.id);
		fake.rows('receivable_anchor_attempts')[1].last_attempt_at = '2026-10-08 00:00:00';
		expect((await reg.listPendingAnchors()).map((p) => p.id)).toEqual([c1.id, c2.id, c3.id]);
		expect(await reg.listPendingAnchors(1)).toHaveLength(1);
	});

	it('confirmed receipts are left out, and attempts are bookkeeping by kind and record', async () => {
		seedClaim({ anchor_json: DONE('c1') });
		const c2 = seedClaim({ anchor_json: PENDING('c2') });
		expect((await reg.listPendingAnchors()).map((p) => p.id)).toEqual([c2.id]);
		await reg.recordAnchorAttempt('claim', c2.id);
		await reg.recordAnchorAttempt('claim', c2.id);
		await reg.recordAnchorAttempt('claim_discharge', c2.id);
		expect(fake.rows('receivable_anchor_attempts').map((r) => [r.kind, r.record_id, r.attempts])).toEqual([
			['claim', c2.id, 2], ['claim_discharge', c2.id, 1],
		]);
		await reg.clearAnchorAttempts('claim', c2.id);
		expect(fake.rows('receivable_anchor_attempts').map((r) => r.kind)).toEqual(['claim_discharge']);
	});
});

describe('listUnanchoredRecords: the cron batch', () => {
	beforeEach(async () => { await reg.ensureReceivablesTables(); claimSeq = 0; });

	const seedRun = (id: string, tenant: string, over: Record<string, unknown> = {}) =>
		fake.seed('receivable_reverifications', {
			id, receivable_id: 'r1'.padEnd(64, '0'), tenant_id: tenant, verdict: 'confirmed', checks_json: '[]',
			manifest_json: '{}', signature_json: null, digest: `${id}`.padEnd(64, '0'), anchor_json: null,
			created_at: `2026-10-0${id.slice(-1)} 00:00:00`, ...over,
		});

	it('returns only unstamped re-verifications, with their own tenant, oldest first', async () => {
		seedRun('rv-1', OWNER);
		seedRun('rv-2', LENDER, { anchor_json: PENDING('x') });
		seedRun('rv-3', LENDER);
		seedClaim(); // a claim is stamped through the anchor route, never by the cron
		expect(await reg.listUnanchoredRecords()).toEqual([
			{ kind: 'reverification', id: 'rv-1', tenantId: OWNER },
			{ kind: 'reverification', id: 'rv-3', tenantId: LENDER },
		]);
		await reg.recordAnchorAttempt('reverification', 'rv-1');
		expect((await reg.listUnanchoredRecords()).map((r) => r.id)).toEqual(['rv-3', 'rv-1']);
		expect(await reg.listUnanchoredRecords(1)).toHaveLength(1);
	});

	it('includes a discharge or settlement written without a timestamp, but never a legacy one', async () => {
		const rid = 'r1'.padEnd(64, '0');
		seedReceivable({ settlement_digest: 's'.repeat(64), settled_at: '2026-10-01', settlement_recorded_at: '2026-10-01 09:00:00' });
		seedReceivable({ id: 'r2'.padEnd(64, '0'), settlement_digest: 't'.repeat(64), settled_at: '2026-06-01' }); // legacy: no recorded-at
		const fresh = seedClaim({ status: 'discharged', discharge_digest: 'x'.repeat(64), discharge_recorded_at: '2026-10-02 09:00:00' });
		seedClaim({ status: 'discharged', discharge_digest: 'y'.repeat(64) }); // legacy: no recorded-at
		seedClaim({ status: 'discharged', discharge_digest: 'z'.repeat(64), discharge_recorded_at: '2026-10-02 10:00:00', discharge_anchor_json: PENDING('z') });
		seedClaim(); // never discharged
		expect(await reg.listUnanchoredRecords()).toEqual([
			{ kind: 'claim_discharge', id: fresh.id, tenantId: LENDER },
			{ kind: 'settlement', id: rid, tenantId: OWNER },
		]);
	});

	it('fair by tenant: a tenant adding re-verifications faster than the cron stamps them cannot crowd out another', async () => {
		seedRun('quiet-9', 'tenant-quiet', { created_at: '2026-10-09 12:00:00' }); // newer than all the busy rows
		for (let i = 0; i < 60; i++) {
			seedRun(`busy-${String(i).padStart(2, '0')}`, 'tenant-busy', { created_at: `2026-10-09 10:${String(i).padStart(2, '0')}:00` });
		}
		const batch = await reg.listUnanchoredRecords(20, 10);
		expect(batch).toHaveLength(11);
		expect(batch.slice(0, 2).map((r) => r.tenantId)).toEqual(['tenant-busy', 'tenant-quiet']);
		expect(batch.filter((r) => r.tenantId === 'tenant-busy')).toHaveLength(10);
		// The busy tenant's share is its oldest rows.
		expect(batch.filter((r) => r.tenantId === 'tenant-busy').map((r) => r.id)).toEqual(
			Array.from({ length: 10 }, (_, i) => `busy-${String(i).padStart(2, '0')}`),
		);
	});

	it('with many tenants, each gets one record before any gets a second, up to the batch limit', async () => {
		for (let t = 0; t < 4; t++) {
			for (let i = 0; i < 8; i++) seedRun(`t${t}-${i}`, `tenant-${t}`, { created_at: `2026-10-09 1${t}:0${i}:00` });
		}
		const batch = await reg.listUnanchoredRecords(20, 10);
		expect(batch).toHaveLength(20);
		expect(batch.slice(0, 4).map((r) => r.tenantId)).toEqual(['tenant-0', 'tenant-1', 'tenant-2', 'tenant-3']);
		for (let t = 0; t < 4; t++) expect(batch.filter((r) => r.tenantId === `tenant-${t}`)).toHaveLength(5);
	});

	it('within a tenant the kinds take turns', async () => {
		for (let i = 1; i <= 3; i++) seedRun(`rv-${i}`, LENDER);
		const c1 = seedClaim({ status: 'discharged', discharge_digest: 'x'.repeat(64), discharge_recorded_at: '2026-10-05 09:00:00' });
		const c2 = seedClaim({ status: 'discharged', discharge_digest: 'w'.repeat(64), discharge_recorded_at: '2026-10-06 09:00:00' });
		expect((await reg.listUnanchoredRecords(20, 3)).map((r) => r.id)).toEqual(['rv-1', c1.id, 'rv-2']);
		expect((await reg.listUnanchoredRecords(20, 10)).map((r) => r.id)).toEqual(['rv-1', c1.id, 'rv-2', c2.id, 'rv-3']);
	});
});
