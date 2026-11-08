import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { NOTICE_SUBJECT_FREE_LOCKED } from '../../src/lib/receivables/copy/notices';

/**
 * Tier T2, end to end through the daily aging pass against the db fake: the cron's own signed
 * `lapsed` status event on every claim whose record lapsed (once, dated at the lapse, never an
 * owner touch), the free plan's lock after two such lapses within a year (D11), and the one lender
 * email it draws (D16). The registry's real SQL runs; the mail transport is recorded; the signing
 * seed is set so the events come out signed. Every `now` is explicit. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }>, failNext: 0 }));
vi.mock('@/lib/email', () => ({
	sendMail: async (m: { to: string; subject: string; text: string }) => {
		if (mail.failNext > 0) { mail.failNext--; throw new Error('transport down'); }
		mail.sent.push(m);
	},
}));
vi.mock('@/lib/owner', () => ({
	OWNER_TENANT_ID: 'tenant-owner',
	isOwner: (t: unknown) => String(t ?? '').toLowerCase() === 'tenant-owner',
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');
let delivery: typeof import('../../src/lib/receivables/server/noticeDelivery');
let ent: typeof import('../../src/lib/receivables/server/entitlements');

const SUPPLIER = 'tenant-supplier';
const LENDER = 'tenant-lender';
const OTHER = 'tenant-other-lender';
const R1 = 'c4'.repeat(32);
const R2 = 'c5'.repeat(32);
const R3 = 'c6'.repeat(32);
const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const DAY_MS = 86_400_000;
const at = (ymd: string, time = '12:00:00') => new Date(`${ymd}T${time}Z`);
/** The run: every undated claim registered on or before 2026-05-01 has lapsed by now. */
const RUN = at('2026-11-01');

function seedReceivable(id: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id, tenant_id: SUPPLIER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: `INV-${id.slice(0, 4)}`,
		face: 1000, currency: 'USD', terms: null, due_date: null, acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null, deleted_at: null,
		created_at: '2025-12-01 10:00:00', updated_at: null,
		...over,
	});
}

let claimSeq = 0;
/** A claim registered at `createdAt` and never touched since: undated, so it lapses 180 days later. */
function seedClaim(tenantId: string, receivableId: string, createdAt: string, over: Record<string, unknown> = {}) {
	claimSeq++;
	return fake.seed('receivable_claims', {
		id: `claim-${claimSeq}`, receivable_id: receivableId, tenant_id: tenantId, financier: `Lender ${claimSeq}`,
		amount: 100, currency: 'USD', claim_date: createdAt.slice(0, 10), status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: createdAt,
		...over,
	});
}

async function seedLenderAccount(tenantId = LENDER, email = 'lender@sahel.test') {
	await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
	await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
	const userId = `user-${tenantId}`;
	fake.seed('tenant_memberships', { tenant_id: tenantId, user_id: userId, role: 'owner', created_at: '2026-01-01 00:00:00' });
	fake.seed('auth_users', { id: userId, email, alert_email: null, lang: 'en' });
}

function seedSubscription(tenantId: string, over: Record<string, unknown> = {}) {
	return fake.seed('receivables_subscriptions', {
		tenant_id: tenantId, plan: 'free', status: 'active', stripe_customer_id: null, stripe_subscription_id: null,
		stripe_price_id: null, current_period_end: null, free_locked_at: null, free_locked_reason_json: null,
		created_at: '2026-01-01 10:00:00', updated_at: null,
		...over,
	});
}

const lapsedEvents = () => fake.rows('receivable_status_events').filter((e) => e.kind === 'lapsed');
const subscription = (tenantId: string) => fake.rows('receivables_subscriptions').find((r) => r.tenant_id === tenantId);
const lockMails = () => mail.sent.filter((m) => m.subject === NOTICE_SUBJECT_FREE_LOCKED);

beforeEach(async () => {
	vi.stubEnv('AUTH_URL', 'https://alms.test');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	mail.sent = [];
	mail.failNext = 0;
	claimSeq = 0;
	reg = await import('../../src/lib/receivablesRegistry');
	delivery = await import('../../src/lib/receivables/server/noticeDelivery');
	ent = await import('../../src/lib/receivables/server/entitlements');
	await reg.ensureReceivablesTables();
	seedReceivable(R1);
	seedReceivable(R2);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('the lapsed event on the chain', () => {
	it('is written once per lapsed claim, signed, dated at the lapse instant and not at the run', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00'); // lapses 2026-06-30 10:00:00
		seedClaim(LENDER, R2, '2026-09-01 10:00:00'); // not lapsed by the run
		const first = await delivery.runAgingNotices(RUN);
		expect(first.lapsesRecorded).toBe(1);
		const [ev] = lapsedEvents();
		expect(lapsedEvents()).toHaveLength(1);
		expect(ev).toMatchObject({ tenant_id: LENDER, receivable_id: R1, claim_id: 'claim-1', kind: 'lapsed', created_at: '2026-06-30 10:00:00', new_promised_date: null, reason_code: null, reason_note: null });
		expect(ev.signature_json).toBeTruthy();
		const manifest = JSON.parse(ev.manifest_json);
		expect(manifest).toEqual({
			v: 1, kind: 'claim_lapsed', receivableId: R1, claimId: 'claim-1',
			lapsedAt: '2026-06-30 10:00:00', recordedAt: '2026-11-01 12:00:00', by: 'system', lastTouchAt: '2026-01-01 10:00:00',
		});
		const second = await delivery.runAgingNotices(RUN);
		expect(second.lapsesRecorded).toBe(0);
		expect(lapsedEvents()).toHaveLength(1);
	});

	it('for a dated record the event sits at the later of the two clocks (D7′)', async () => {
		seedReceivable(R3, { due_date: '2026-02-01' });
		seedClaim(LENDER, R3, '2026-01-01 10:00:00'); // silence runs out 2026-06-30; the promised-date clock 2026-07-31
		await delivery.runAgingNotices(RUN);
		const ev = lapsedEvents().find((e) => e.receivable_id === R3)!;
		expect(ev.created_at).toBe('2026-07-31 00:00:00');
		expect(JSON.parse(ev.manifest_json)).toMatchObject({ lapsedAt: '2026-07-31 00:00:00', promisedDate: '2026-02-01' });
	});

	it('is never an owner touch: the claim stays lapsed, its headroom stays freed, and the chain names it', async () => {
		fake.rows('receivables').find((r) => r.id === R1)!.is_test = true; // a practice record skips the claim gates
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		await delivery.runAgingNotices(RUN);
		const status = await reg.getReceivableStatus(R1, RUN);
		const claim = (status as any).claims.find((c: any) => c.id === 'claim-1');
		expect(claim.aging).toBe('lapsed');
		expect(claim.lastOwnerTouchAt).toBe('2026-01-01 10:00:00');
		expect(claim.statusEvents.map((e: any) => e.kind)).toEqual(['lapsed']);
		expect(claim.statusEvents[0]).toMatchObject({ date: '2026-06-30 10:00:00', signed: true, newPromisedDate: null });
		expect((status as any).available).toBe(1000);
		const full = await reg.addClaim(OTHER, R1, { financier: 'Other Lender', amount: 1000 }, { now: RUN });
		expect(full.ok).toBe(true);
		const own = await reg.listOwnClaimStatusEvents(LENDER, 'claim-1');
		expect(own.ok && own.events.map((e) => e.kind)).toEqual(['lapsed']);
	});

	it('a kind this build does not know is left out of the chain and the touch set', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		fake.seed('receivable_status_events', {
			id: 'ev-weird', tenant_id: LENDER, receivable_id: R1, claim_id: 'claim-1', kind: 'weird', new_promised_date: null,
			reason_code: null, reason_note: null, manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-10-30 10:00:00',
		});
		const status = await reg.getReceivableStatus(R1, RUN);
		const claim = (status as any).claims[0];
		expect(claim.statusEvents).toEqual([]);
		expect(claim.aging).toBe('lapsed');
	});

	it('an unpaid flag inside the window keeps the record maintained, so nothing is recorded (the honest banker never lapses)', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		fake.seed('receivable_status_events', {
			id: 'ev-unpaid', tenant_id: LENDER, receivable_id: R1, claim_id: 'claim-1', kind: 'unpaid', new_promised_date: null,
			reason_code: null, reason_note: null, manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-06-20 10:00:00',
		});
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.lapsesRecorded).toBe(0);
		expect(lapsedEvents()).toHaveLength(0);
	});
});

describe('the free plan lock (D11) and its one email (D16)', () => {
	it('two lapses within a year lock the plan with both dates, email the lender once, and log it against the second claim', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00'); // lapses 2026-06-30
		seedClaim(LENDER, R2, '2026-03-01 10:00:00'); // lapses 2026-08-28
		await seedLenderAccount();

		const first = await delivery.runAgingNotices(RUN);
		expect(first).toMatchObject({ lapsesRecorded: 2, locked: 1, lockNotices: 1 });
		const row = subscription(LENDER)!;
		expect(row).toMatchObject({ plan: 'free', status: 'active', free_locked_at: '2026-11-01 12:00:00' });
		expect(JSON.parse(row.free_locked_reason_json)).toEqual({
			claimIds: ['claim-1', 'claim-2'], lapsedAts: ['2026-06-30 10:00:00', '2026-08-28 10:00:00'],
		});
		expect(lockMails()).toHaveLength(1);
		expect(lockMails()[0].to).toBe('lender@sahel.test');
		expect(lockMails()[0].text).toContain('(2026-06-30, 2026-08-28)');
		expect(fake.rows('receivable_notice_log').some((r) => r.claim_id === 'claim-2' && r.notice === 'free_locked' && r.recipient_role === 'lender')).toBe(true);

		const gate = await ent.gateNewContract(LENDER);
		expect(gate).toMatchObject({ ok: false, error: 'free_plan_locked', lockedAt: '2026-11-01 12:00:00' });
		expect((gate as any).message).toContain('(2026-06-30, 2026-08-28)');

		mail.sent = [];
		const second = await delivery.runAgingNotices(new Date(RUN.getTime() + DAY_MS));
		expect(second).toMatchObject({ lapsesRecorded: 0, locked: 0, lockNotices: 0 });
		expect(lockMails()).toHaveLength(0);
		expect(subscription(LENDER)!.free_locked_at).toBe('2026-11-01 12:00:00');
	});

	it('two lapses more than a year apart do not lock', async () => {
		seedClaim(LENDER, R1, '2024-06-01 10:00:00'); // lapsed 2024-11-28
		seedClaim(LENDER, R2, '2026-01-01 10:00:00'); // lapsed 2026-06-30
		await seedLenderAccount();
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.lapsesRecorded).toBe(2);
		expect(counts.locked).toBe(0);
		expect(subscription(LENDER)).toBeUndefined();
		expect(lockMails()).toHaveLength(0);
	});

	it('counts only this account: another lender\'s lapse is not mine', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		seedClaim(OTHER, R2, '2026-01-01 10:00:00');
		await seedLenderAccount();
		await seedLenderAccount(OTHER, 'other@lender.test');
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.lapsesRecorded).toBe(2);
		expect(counts.locked).toBe(0);
		expect(subscription(LENDER)).toBeUndefined();
		expect(subscription(OTHER)).toBeUndefined();
	});

	it('a live Standard plan is never locked', async () => {
		seedSubscription(LENDER, { plan: 'standard', status: 'active' });
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		seedClaim(LENDER, R2, '2026-03-01 10:00:00');
		await seedLenderAccount();
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.locked).toBe(0);
		expect(subscription(LENDER)!.free_locked_at).toBeNull();
		expect(lockMails()).toHaveLength(0);
	});

	it("the owner's account is never locked", async () => {
		seedClaim('tenant-owner', R1, '2026-01-01 10:00:00');
		seedClaim('tenant-owner', R2, '2026-03-01 10:00:00');
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.lapsesRecorded).toBe(2);
		expect(counts.locked).toBe(0);
		expect(subscription('tenant-owner')).toBeUndefined();
	});

	it('practice records: the lapse is recorded on the chain but never counts toward a lock', async () => {
		for (const id of [R1, R2]) fake.rows('receivables').find((r) => r.id === id)!.is_test = true;
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		seedClaim(LENDER, R2, '2026-03-01 10:00:00');
		const counts = await delivery.runAgingNotices(RUN);
		expect(counts.lapsesRecorded).toBe(2);
		expect(counts.locked).toBe(0);
		expect(subscription(LENDER)).toBeUndefined();
	});

	it('a lock email whose send fails is retried on the next run; the lock itself stands', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		seedClaim(LENDER, R2, '2026-03-01 10:00:00');
		await seedLenderAccount();
		mail.failNext = 3; // the two lapsed digests and the lock email all fail this run
		const first = await delivery.runAgingNotices(RUN);
		expect(first.locked).toBe(1);
		expect(first.lockNotices).toBe(0);
		expect(first.failed).toBeGreaterThanOrEqual(1);
		expect(subscription(LENDER)!.free_locked_at).toBe('2026-11-01 12:00:00');
		expect(fake.rows('receivable_notice_log').some((r) => r.notice === 'free_locked')).toBe(false);

		mail.failNext = 0;
		const second = await delivery.runAgingNotices(new Date(RUN.getTime() + DAY_MS));
		expect(second.lockNotices).toBe(1);
		expect(lockMails()).toHaveLength(1);
	});

	it('the lock is account state: no public answer carries it', async () => {
		seedClaim(LENDER, R1, '2026-01-01 10:00:00');
		seedClaim(LENDER, R2, '2026-03-01 10:00:00');
		await seedLenderAccount();
		await delivery.runAgingNotices(RUN);
		const status = JSON.stringify(await reg.getReceivableStatus(R1, RUN));
		expect(status).not.toMatch(/free_locked|freeLocked|plan/);
		const own = JSON.stringify(await reg.listOwnClaimStatusEvents(LENDER, 'claim-1'));
		expect(own).not.toMatch(/free_locked|freeLocked/);
		const ROOT = fileURLToPath(new URL('../../', import.meta.url));
		for (const route of ['check', 'lookup', 'seen', 'status-events']) {
			const src = fs.readFileSync(path.join(ROOT, `src/pages/api/verify/receivables/${route}.ts`), 'utf8');
			expect(src, route).not.toMatch(/free_locked|freeLocked|receivables_subscriptions|entitlements/);
		}
	});
});
