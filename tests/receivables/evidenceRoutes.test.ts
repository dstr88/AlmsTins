import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

ed.hashes.sha512 = sha512;

/**
 * Receivables S0b at the routes:
 *   - POST /discharge and /settle sign, keep the signature, and stamp in the same request (a test
 *     discharge is signed and anchored), sharing the per-tenant evidence budget with
 *     /diligence-accept; a failed or rate-limited stamp never fails the write;
 *   - the tenant always comes from the session, never from the body;
 *   - a discharge or settle that loses a race to a concurrent one reports "already" (409) instead
 *     of a digest that was never stored;
 *   - GET /api/cron/upgrade-anchors upgrades the new kinds into their own columns, rotates stuck
 *     receipts through receivable_anchor_attempts, and batch-stamps re-verifications plus any
 *     discharge or settlement whose write-time stamp failed, within a per-run cap, a per-run
 *     per-tenant budget with the tenants taking turns, and a time budget;
 *   - Verify now still passes integrity on records written before and after.
 *
 * The OpenTimestamps client and the session are stubbed; the registry runs its real SQL against
 * tests/helpers/receivablesDbFake.ts. Keys are generated in-test. No network.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: null as { tenantId: string; isDemo: boolean } | null,
	stamps: [] as string[],
	upgrades: [] as string[],
	failStamp: false,
	failUpgradeFor: new Set<string>(),
	confirm: new Set<string>(),
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(digest: string) {
			if (mem.failStamp) throw new Error('calendar unreachable');
			mem.stamps.push(digest);
			return { type: 'opentimestamps', digest, receipt: 'cGVuZGluZw==', anchoredAt: null };
		}
		async upgrade(receipt: any) {
			mem.upgrades.push(receipt.digest);
			if (mem.failUpgradeFor.has(receipt.digest)) throw new Error('calendar unreachable');
			return mem.confirm.has(receipt.digest) ? { ...receipt, anchoredAt: '2026-10-10T13:00:00.000Z' } : receipt;
		}
	},
}));

let fake: ReceivablesDbFake;
type Registry = typeof import('../../src/lib/receivablesRegistry');
let reg: Registry;

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const INPUT = { supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoiceNo: 'INV-0042', face: 1000, currency: 'USD', isTest: true };
let seedA: string, pubA: string;

beforeEach(async () => {
	vi.resetModules();
	const seed = ed.utils.randomSecretKey();
	seedA = bytesToHex(seed);
	pubA = bytesToHex(ed.getPublicKey(seed));
	vi.stubEnv('ALMSTINS_SIGNING_KEY', seedA);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.stubEnv('CRON_SECRET', 'test-cron-secret');
	fake = createReceivablesDbFake();
	holder.db = fake;
	mem.session = { tenantId: OWNER, isDemo: false };
	mem.stamps = [];
	mem.upgrades = [];
	mem.failStamp = false;
	mem.failUpgradeFor = new Set();
	mem.confirm = new Set();
	reg = await import('../../src/lib/receivablesRegistry');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function post(path: string, body: unknown) {
	const mod = await import(`../../src/pages/api/verify/receivables/${path}.ts`);
	const request = new Request(`https://almstins.com/api/verify/receivables/${path}`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await mod.POST({ request });
	return { status: res.status, body: await res.json() };
}

/** A practice receivable owned by OWNER, with one claim by LENDER. */
async function setup() {
	const created = await reg.createReceivable(OWNER, INPUT);
	if (!created.ok) throw new Error('create failed');
	const claim = await reg.addClaim(LENDER, created.id, { financier: 'Lender Co', amount: 400 });
	if (!claim.ok) throw new Error('claim failed');
	return { rid: created.id, claimId: claim.claimId };
}

describe('POST /discharge: a test discharge is signed and anchored', () => {
	it('signs, keeps the signature, stamps the discharge digest and stores the receipt in its own column', async () => {
		const { claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		const { status, body } = await post('discharge', { claimId, reason: 'wire received Oct 9', tenantId: OWNER });
		expect(status).toBe(200);
		const row = fake.rows('receivable_claims')[0];
		expect(body).toEqual({
			ok: true, digest: row.discharge_digest, signed: true, claimed: 0, available: 1000, face: 1000,
			anchored: true, anchor: { type: 'opentimestamps', digest: row.discharge_digest, receipt: 'cGVuZGluZw==', anchoredAt: null },
		});
		expect(mem.stamps).toEqual([row.discharge_digest]);
		expect(JSON.parse(row.discharge_anchor_json)).toEqual(body.anchor);
		expect(JSON.parse(row.discharge_signature_json).publicKeyHex).toBe(pubA);
		expect(row.anchor_json ?? null).toBeNull(); // the claim's own receipt is untouched
		expect(row.tenant_id).toBe(LENDER);
	});

	it('a stamp failure still answers 200 with the discharge recorded', async () => {
		const { claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		mem.failStamp = true;
		const { status, body } = await post('discharge', { claimId });
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, signed: true, anchored: false, anchorError: 'calendar unreachable' });
		expect(fake.rows('receivable_claims')[0].status).toBe('discharged');
	});

	it("the body's tenantId is ignored: the owner cannot discharge the lender's claim by naming the lender", async () => {
		const { claimId } = await setup();
		mem.session = { tenantId: OWNER, isDemo: false };
		const { status } = await post('discharge', { claimId, tenantId: LENDER });
		expect(status).toBe(404);
		expect(mem.stamps).toEqual([]);
	});
});

describe('a discharge or settle that loses a race to a concurrent one', () => {
	/** Let a competing write land between the registry's read and its UPDATE. */
	function raceOn(match: RegExp, competitor: () => void) {
		let raced = false;
		holder.db = {
			execute: async (stmt: any) => {
				const sql = typeof stmt === 'string' ? stmt : stmt.sql;
				if (!raced && match.test(sql.replace(/\s+/g, ' '))) { raced = true; competitor(); }
				return fake.execute(stmt);
			},
			batch: (x: any) => fake.batch(x),
		};
	}

	it('discharge: 409 already_discharged, nothing stamped, and the winner stays on record', async () => {
		const { claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		raceOn(/^UPDATE receivable_claims SET status = 'discharged'/, () => {
			Object.assign(fake.rows('receivable_claims')[0], { status: 'discharged', discharge_digest: 'w'.repeat(64), discharge_reason: 'winner' });
		});
		const { status, body } = await post('discharge', { claimId, reason: 'loser' });
		expect(status).toBe(409);
		expect(body).toEqual({ ok: false, error: 'already_discharged', message: 'That claim is already discharged.' });
		expect(mem.stamps).toEqual([]);
		expect(fake.rows('receivable_claims')[0]).toMatchObject({ discharge_digest: 'w'.repeat(64), discharge_reason: 'winner' });
	});

	it('settle: 409 already_settled, nothing stamped', async () => {
		const { rid } = await setup();
		raceOn(/^UPDATE receivables SET settled_at = \?/, () => {
			Object.assign(fake.rows('receivables')[0], { settled_at: '2026-10-10', settlement_digest: 'w'.repeat(64) });
		});
		const { status, body } = await post('settle', { receivableId: rid });
		expect(status).toBe(409);
		expect(body).toEqual({ ok: false, error: 'already_settled', message: 'That receivable is already settled.' });
		expect(mem.stamps).toEqual([]);
		expect(fake.rows('receivables')[0].settlement_digest).toBe('w'.repeat(64));
	});
});

describe('POST /settle: signed and anchored', () => {
	it('signs, keeps the signature, stamps the settlement digest into settlement_anchor_json', async () => {
		const { rid } = await setup();
		const before = fake.rows('receivables')[0].anchor_json ?? null;
		const { status, body } = await post('settle', { receivableId: rid });
		expect(status).toBe(200);
		const row = fake.rows('receivables')[0];
		expect(body).toMatchObject({ ok: true, digest: row.settlement_digest, signed: true, anchored: true });
		expect(JSON.parse(row.settlement_anchor_json).digest).toBe(row.settlement_digest);
		expect(JSON.parse(row.settlement_signature_json).publicKeyHex).toBe(pubA);
		expect(row.anchor_json ?? null).toBe(before);
	});
});

describe('one evidence budget per tenant', () => {
	it('diligence-accept, discharge and settle share 30 stamps an hour; the writes still land after that', async () => {
		const created = await reg.createReceivable(OWNER, { ...INPUT, isTest: false });
		if (!created.ok) throw new Error('create failed');
		mem.session = { tenantId: LENDER, isDemo: false };
		for (let i = 0; i < 29; i++) {
			const r = await post('diligence-accept', { receivableId: created.id, financier: 'Lender Co', method: 'phone' });
			expect(r.body.anchored).toBe(true);
		}
		const claim = await reg.addClaim(LENDER, created.id, { financier: 'Lender Co', amount: 100 });
		if (!claim.ok) throw new Error('claim failed');
		expect((await post('discharge', { claimId: claim.claimId })).body.anchored).toBe(true); // the 30th
		const claim2 = await reg.addClaim(LENDER, created.id, { financier: 'Lender Co', amount: 100 });
		if (!claim2.ok) throw new Error('claim failed');
		const limited = await post('discharge', { claimId: claim2.claimId });
		expect(limited.status).toBe(200);
		expect(limited.body).toMatchObject({ ok: true, anchored: false, anchorError: 'rate_limited' });
		expect(mem.stamps).toHaveLength(30);
		// Another tenant has its own budget.
		mem.session = { tenantId: OWNER, isDemo: false };
		expect((await post('settle', { receivableId: created.id })).body.anchored).toBe(true);
	});
});

describe('Verify now still passes integrity on existing records', () => {
	it('a record created, claimed, discharged and settled re-verifies with integrity pass', async () => {
		const { rid, claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		await post('discharge', { claimId });
		mem.session = { tenantId: OWNER, isDemo: false };
		await post('settle', { receivableId: rid });
		const r = await reg.reverifyReceivable(LENDER, rid);
		expect(r.ok && r.checks.find((c) => c.key === 'integrity')?.state).toBe('pass');
	});
});

describe('GET /api/cron/upgrade-anchors', () => {
	async function cron() {
		const { GET } = await import('../../src/pages/api/cron/upgrade-anchors');
		const res: Response = await (GET as any)({
			request: new Request('https://almstins.com/api/cron/upgrade-anchors', { headers: { 'x-cron-secret': 'test-cron-secret' } }),
		});
		return { status: res.status, body: await res.json() };
	}

	const seedRun = (i: number, tenant: string) =>
		fake.seed('receivable_reverifications', {
			id: `rv-${String(i).padStart(3, '0')}`, receivable_id: 'r', tenant_id: tenant, verdict: 'confirmed', checks_json: '[]',
			manifest_json: '{}', signature_json: null, digest: `${i}`.padStart(64, 'a'), anchor_json: null,
			created_at: `2026-10-09 10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
		});

	it('confirms a pending discharge and settlement receipt into their own columns', async () => {
		const { rid, claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		await post('discharge', { claimId });
		mem.session = { tenantId: OWNER, isDemo: false };
		await post('settle', { receivableId: rid });
		const claim = fake.rows('receivable_claims')[0];
		const rcv = fake.rows('receivables')[0];
		mem.confirm.add(claim.discharge_digest);
		mem.confirm.add(rcv.settlement_digest);
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, checked: 2, confirmed: 2, failed: 0, pending: 2, stamped: 0 });
		expect(JSON.parse(claim.discharge_anchor_json).anchoredAt).toBe('2026-10-10T13:00:00.000Z');
		expect(JSON.parse(rcv.settlement_anchor_json).anchoredAt).toBe('2026-10-10T13:00:00.000Z');
		expect(fake.rows('receivable_anchor_attempts')).toEqual([]);
	});

	it('a receipt that does not confirm is noted, and rotates behind one that was never asked about', async () => {
		await reg.ensureReceivablesTables();
		const PENDING = (d: string) => JSON.stringify({ type: 'opentimestamps', digest: d, receipt: 'cA==', anchoredAt: null });
		fake.seed('receivable_attestations', {
			id: 'att-stuck', receivable_id: 'r', tenant_id: OWNER, role: 'buyer', label: 'B', statement: 'S', attested_at: '2026-09-03',
			manifest_json: '{}', digest: 'f'.repeat(64), anchor_json: PENDING('stuck'), created_at: '2026-09-03 10:00:00',
		});
		mem.failUpgradeFor.add('stuck');
		expect((await cron()).body).toMatchObject({ checked: 1, failed: 1 });
		expect(fake.rows('receivable_anchor_attempts')).toMatchObject([{ kind: 'attestation', record_id: 'att-stuck', attempts: 1 }]);
		await cron();
		expect(fake.rows('receivable_anchor_attempts')[0].attempts).toBe(2);
		fake.seed('receivable_attestations', {
			id: 'att-new', receivable_id: 'r', tenant_id: OWNER, role: 'buyer', label: 'B', statement: 'S', attested_at: '2026-09-02',
			manifest_json: '{}', digest: 'e'.repeat(64), anchor_json: PENDING('new'), created_at: '2026-09-02 10:00:00',
		});
		expect((await reg.listPendingAnchors()).map((p) => p.id)).toEqual(['att-new', 'att-stuck']);
	});

	it('batch-stamps unstamped re-verifications, at most 10 per tenant a run, skipping stamped ones', async () => {
		await reg.ensureReceivablesTables();
		for (let i = 0; i < 15; i++) seedRun(100 + i, 'tenant-busy');
		for (let i = 0; i < 3; i++) seedRun(i, 'tenant-quiet');
		const done = seedRun(999, 'tenant-quiet');
		done.anchor_json = JSON.stringify({ type: 'opentimestamps', digest: done.digest, receipt: 'cA==', anchoredAt: null });
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, stamped: 13, stampLimited: 0, stampFailed: 0 });
		const runs = fake.rows('receivable_reverifications');
		const stampedBy = (t: string) => runs.filter((r) => r.tenant_id === t && r.anchor_json && r.id !== 'rv-999');
		expect(stampedBy('tenant-busy')).toHaveLength(10);
		expect(stampedBy('tenant-busy').map((r) => r.id)).toEqual(Array.from({ length: 10 }, (_, i) => `rv-${100 + i}`)); // oldest first
		expect(stampedBy('tenant-quiet')).toHaveLength(3);
		expect(mem.stamps).toHaveLength(13);
		expect(mem.stamps).not.toContain(done.digest);
		// The busy tenant's other 5 simply wait for the next run; nothing was sent for them, so
		// nothing is noted. Only rv-999 is, by the upgrade pass (asked about, not yet confirmed).
		expect(fake.rows('receivable_anchor_attempts').map((a) => a.record_id)).toEqual(['rv-999']);
		expect(mem.upgrades).toEqual([done.digest]);
		// The next run, however soon, has a fresh budget and stamps the rest.
		expect((await cron()).body).toMatchObject({ stamped: 5, stampLimited: 0 });
	});

	it('never more than 20 stamps a run, with the tenants taking turns', async () => {
		await reg.ensureReceivablesTables();
		for (let t = 0; t < 4; t++) for (let i = 0; i < 8; i++) seedRun(t * 100 + i, `tenant-${t}`);
		const { body } = await cron();
		expect(body.stamped + body.stampFailed + body.stampLimited).toBeLessThanOrEqual(20);
		expect(body).toMatchObject({ stamped: 20, stampFailed: 0, stampLimited: 0 });
		const runs = fake.rows('receivable_reverifications');
		for (let t = 0; t < 4; t++) expect(runs.filter((r) => r.tenant_id === `tenant-${t}` && r.anchor_json)).toHaveLength(5);
	});

	it('no new stamp starts once the run has used its time budget', async () => {
		await reg.ensureReceivablesTables();
		for (let i = 0; i < 5; i++) seedRun(i, OWNER);
		const base = Date.now();
		vi.spyOn(Date, 'now').mockImplementation(() => base + (mem.stamps.length >= 1 ? 300_001 : 0));
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, stamped: 1, stampFailed: 0 });
		expect(mem.stamps).toHaveLength(1);
	});

	it('a quiet tenant is not starved by one that adds 20 re-verifications before every run', async () => {
		await reg.ensureReceivablesTables();
		let n = 0;
		const addBusy = () => { for (let i = 0; i < 20; i++, n++) seedRun(n, 'tenant-busy'); };
		addBusy();
		const quiet = seedRun(900, 'tenant-quiet'); // newer than the busy tenant's first 20
		for (let run = 1; run <= 3; run++) {
			const { body } = await cron();
			expect(body).toMatchObject({ stampLimited: 0, stampFailed: 0 });
			if (run === 1) expect(quiet.anchor_json).toBeTruthy();
			addBusy();
		}
		// The busy tenant got its 10 a run, oldest first.
		const busy = fake.rows('receivable_reverifications').filter((r) => r.tenant_id === 'tenant-busy' && r.anchor_json);
		expect(busy.map((r) => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => `rv-${String(i).padStart(3, '0')}`));
	});

	it('a discharge whose stamp failed when it was recorded is stamped by the next run, then confirmed', async () => {
		const { claimId } = await setup();
		mem.session = { tenantId: LENDER, isDemo: false };
		mem.failStamp = true;
		expect((await post('discharge', { claimId })).body).toMatchObject({ ok: true, anchored: false, anchorError: 'calendar unreachable' });
		mem.failStamp = false;
		const row = fake.rows('receivable_claims')[0];
		expect(row.discharge_anchor_json ?? null).toBeNull();
		expect((await cron()).body).toMatchObject({ ok: true, stamped: 1, stampFailed: 0 });
		expect(JSON.parse(row.discharge_anchor_json).digest).toBe(row.discharge_digest);
		expect(row.anchor_json ?? null).toBeNull(); // the claim's own receipt is untouched
		mem.confirm.add(row.discharge_digest);
		expect((await cron()).body).toMatchObject({ confirmed: 1, stamped: 0 });
		expect(JSON.parse(row.discharge_anchor_json).anchoredAt).toBe('2026-10-10T13:00:00.000Z');
	});

	it('a settlement that was over the evidence budget when it was recorded is stamped by the next run', async () => {
		const { rid } = await setup();
		const { evidenceStampLimiter } = await import('../../src/lib/receivables/server/anchorNow');
		for (let i = 0; i < 30; i++) evidenceStampLimiter.hit(`tenant:${OWNER}`);
		expect((await post('settle', { receivableId: rid })).body).toMatchObject({ ok: true, anchored: false, anchorError: 'rate_limited' });
		expect((await cron()).body).toMatchObject({ stamped: 1 });
		const row = fake.rows('receivables')[0];
		expect(JSON.parse(row.settlement_anchor_json).digest).toBe(row.settlement_digest);
	});

	it('a discharge recorded before S0b kept its time is never stamped by the cron', async () => {
		await reg.ensureReceivablesTables();
		fake.seed('receivable_claims', {
			id: 'legacy-claim', receivable_id: 'r', tenant_id: LENDER, financier: 'L', amount: 1, currency: 'USD',
			claim_date: '2026-06-01', status: 'discharged', manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64),
			anchor_json: null, discharge_digest: 'f'.repeat(64), discharged_at: '2026-06-02', created_at: '2026-06-01 10:00:00',
		});
		expect((await cron()).body).toMatchObject({ stamped: 0, stampFailed: 0 });
		expect(mem.stamps).toEqual([]);
	});

	it('a stamping failure is counted and retried later; it never fails the run', async () => {
		await reg.ensureReceivablesTables();
		seedRun(1, OWNER);
		mem.failStamp = true;
		const { status, body } = await cron();
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, stamped: 0, stampFailed: 1 });
		expect(fake.rows('receivable_reverifications')[0].anchor_json).toBeNull();
		mem.failStamp = false;
		expect((await cron()).body).toMatchObject({ stamped: 1 });
		expect(fake.rows('receivable_anchor_attempts')).toEqual([]);
	});

	it('a re-verification stamped by the cron is confirmed by a later run', async () => {
		const { rid } = await setup();
		const run = await reg.reverifyReceivable(LENDER, rid);
		if (!run.ok) throw new Error('reverify failed');
		expect((await cron()).body).toMatchObject({ stamped: 1 });
		const row = fake.rows('receivable_reverifications')[0];
		expect(JSON.parse(row.anchor_json).digest).toBe(run.digest);
		mem.confirm.add(run.digest);
		expect((await cron()).body).toMatchObject({ confirmed: 1, stamped: 0 });
		const status = await reg.getReceivableStatus(rid);
		expect(status!.reverifications[0]).toMatchObject({ anchored: true, anchoredAt: '2026-10-10T13:00:00.000Z' });
	});
});
