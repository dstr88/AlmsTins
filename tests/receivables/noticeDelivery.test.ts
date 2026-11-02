import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The daily aging-notice pass (A4 / D8), end to end through the registry against the db fake,
 * with the mail transport recorded: idempotency (one email per claim per notice per
 * recipient, ever), the digest rule, day-9 lender-only, silent skips without a client address,
 * suppression honored before send, practice records excluded from real email, and the
 * send-then-log order that makes a failed send retry. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mail = vi.hoisted(() => ({
	sent: [] as Array<{ to: string; subject: string; text: string }>,
	failNext: 0,
}));
vi.mock('@/lib/email', () => ({
	sendMail: async (m: { to: string; subject: string; text: string }) => {
		if (mail.failNext > 0) { mail.failNext--; throw new Error('transport down'); }
		mail.sent.push(m);
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');
let delivery: typeof import('../../src/lib/receivables/server/noticeDelivery');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c4'.repeat(32);
const CLAIM = 'claim-1';
const PROMISED = '2026-10-01';
const DAY_MS = 86_400_000;
const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const promisedPlus = (days: number) => new Date(at(PROMISED).getTime() + days * DAY_MS);

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 18500, currency: 'USD', terms: null, due_date: PROMISED, acknowledged_at: null,
		rtype: 'invoice', payment_method: null, details_json: null, is_test: false,
		manifest_json: '{}', signature_json: null, digest: 'd'.repeat(64), anchor_json: null,
		settled_at: null, settlement_json: null, settlement_digest: null, deleted_at: null,
		created_at: '2026-09-01 10:00:00', updated_at: null,
		...over,
	});
}

function seedClaim(over: Record<string, unknown> = {}) {
	return fake.seed('receivable_claims', {
		id: CLAIM, receivable_id: RID, tenant_id: LENDER, financier: 'Sahel Capital',
		amount: 15000, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
		...over,
	});
}

/** The account tables resolveAlertRecipient reads; the registry's ensure does not create them. */
async function seedLenderAccount(tenantId = LENDER, email = 'lender@sahel.test') {
	await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
	await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
	const userId = `user-${tenantId}`;
	fake.seed('tenant_memberships', { tenant_id: tenantId, user_id: userId, role: 'owner', created_at: '2026-01-01 00:00:00' });
	fake.seed('auth_users', { id: userId, email, alert_email: null, lang: 'en' });
}

function seedClientInvite(email = 'client@acme.test') {
	fake.seed('receivable_invites', {
		token: `tok-${email}`, receivable_id: RID, from_tenant: OWNER, role: 'borrower', label: null,
		email, expires_at: '2026-09-20 00:00:00', accepted_at: null, accepted_by: null, revoked_at: null,
		claim_id: null, offer_id: null, reminded_at: null, lapse_recorded_at: null, created_at: '2026-09-03 10:00:00',
	});
}

async function fresh() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	mail.sent = [];
	mail.failNext = 0;
	reg = await import('../../src/lib/receivablesRegistry');
	delivery = await import('../../src/lib/receivables/server/noticeDelivery');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('AUTH_URL', 'https://alms.test');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	await fresh();
});
afterEach(() => { vi.unstubAllEnvs(); });

const texts = () => mail.sent.map((m) => m.text).join('\n====\n');
const logRows = () => fake.rows('receivable_notice_log').map((r) => `${r.claim_id}|${r.notice}|${r.recipient_role}`).sort();

describe('day 15: both sides, the identifier block, and nothing beyond the public record', () => {
	beforeEach(async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		seedClientInvite();
		// A reason on the chain, to prove no email ever carries it (D3). Dated before the
		// promise so the sequence still runs.
		fake.seed('receivable_status_events', {
			id: 'ev-1', tenant_id: LENDER, receivable_id: RID, claim_id: CLAIM, kind: 'extended',
			new_promised_date: PROMISED, reason_code: 'renegotiated_terms', reason_note: 'kept-off-every-email',
			manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-09-05 10:00:00',
		});
	});

	it('sends one lender and one client email, logs both, and repeats neither', async () => {
		const counts = await delivery.runAgingNotices(promisedPlus(15));
		expect(counts).toMatchObject({ candidates: 1, due: 2, sent: 2, logged: 2, failed: 0, suppressed: 0 });
		expect(mail.sent.map((m) => m.to).sort()).toEqual(['client@acme.test', 'lender@sahel.test']);
		expect(logRows()).toEqual([`${CLAIM}|day15|client`, `${CLAIM}|day15|lender`]);

		const client = mail.sent.find((m) => m.to === 'client@acme.test')!;
		expect(client.subject).toBe('A notice about a financing record on one of your invoices');
		expect(client.text).toContain(
			'The claim recorded 2026-09-02 against your invoice INV-0042 (USD 18,500.00, payment promised 2026-10-01) has not been updated by its lender in 15 days.',
		);
		expect(client.text).toContain(`https://alms.test/verify/registry?id=${RID}`);
		expect(client.text).toContain('/api/verify/receivables/notice-optout?token=');

		const lender = mail.sent.find((m) => m.to === 'lender@sahel.test')!;
		expect(lender.subject).toBe('Your financing desk: a record needs your update');
		expect(lender.text).toContain(`https://alms.test/verify/desk?id=${RID}`);
		expect(lender.text).not.toContain('notice-optout');

		// Never in any email: a party name, or the extension reasons and notes (D3).
		expect(texts()).not.toContain('Bigco Plc');
		expect(texts()).not.toContain('Acme Supplies Ltd');
		expect(texts()).not.toContain('Sahel Capital');
		expect(texts()).not.toContain('kept-off-every-email');
		expect(texts()).not.toContain('renegotiated_terms');

		// The notice log prevents resends: the same day asked again sends nothing.
		const again = await delivery.runAgingNotices(promisedPlus(15));
		expect(again).toMatchObject({ due: 0, sent: 0 });
		expect(mail.sent).toHaveLength(2);
	});

	it('a failed send logs nothing, so the next run retries it', async () => {
		mail.failNext = 2;
		const first = await delivery.runAgingNotices(promisedPlus(15));
		expect(first).toMatchObject({ sent: 0, logged: 0, failed: 2 });
		expect(logRows()).toEqual([]);
		const second = await delivery.runAgingNotices(promisedPlus(15));
		expect(second).toMatchObject({ sent: 2, logged: 2, failed: 0 });
	});
});

describe('day 9 is lender-only: the record still publicly reads in-grace', () => {
	it('emails the lender alone even though a client address is on file', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		seedClientInvite();
		const counts = await delivery.runAgingNotices(promisedPlus(9));
		expect(counts).toMatchObject({ due: 1, sent: 1 });
		expect(mail.sent.map((m) => m.to)).toEqual(['lender@sahel.test']);
		expect(mail.sent[0].text).toContain('Grace ends tomorrow');
		expect(logRows()).toEqual([`${CLAIM}|day9|lender`]);
	});
});

describe('the sequence stops and restarts with the record', () => {
	it('an owner update after the promise stops it (an unpaid flag is one)', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		seedClientInvite();
		fake.seed('receivable_status_events', {
			id: 'ev-flag', tenant_id: LENDER, receivable_id: RID, claim_id: CLAIM, kind: 'unpaid',
			new_promised_date: null, reason_code: null, reason_note: null,
			manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-10-05 09:00:00',
		});
		const counts = await delivery.runAgingNotices(promisedPlus(16));
		expect(counts).toMatchObject({ due: 0, sent: 0 });
		expect(mail.sent).toEqual([]);
	});

	it('an extension restarts the clock at the new date; a notice already sent is never repeated (ever-once rule)', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		// Cycle 1 already drew day 9 (the log remembers), then the lender extended.
		fake.seed('receivable_notice_log', { claim_id: CLAIM, notice: 'day9', recipient_role: 'lender', sent_at: '2026-10-10 09:40:00' });
		fake.seed('receivable_status_events', {
			id: 'ev-ext', tenant_id: LENDER, receivable_id: RID, claim_id: CLAIM, kind: 'extended',
			new_promised_date: '2026-11-20', reason_code: 'debtor_requested', reason_note: null,
			manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-10-12 09:00:00',
		});
		// Old clock's day 16: nothing (the new promised date governs).
		expect(await delivery.runAgingNotices(promisedPlus(16))).toMatchObject({ due: 0, sent: 0 });
		// New clock's day 9: due again, but day9|lender was sent once already — the ever-once
		// rule holds it back (judgment call stated in the PR; the desk inbox still shows it).
		const day9Again = await delivery.runAgingNotices(new Date(at('2026-11-20').getTime() + 9 * DAY_MS));
		expect(day9Again).toMatchObject({ due: 0, sent: 0 });
		// New clock's day 15 was never sent, so the second cycle still draws it.
		const day15 = await delivery.runAgingNotices(new Date(at('2026-11-20').getTime() + 15 * DAY_MS));
		expect(day15).toMatchObject({ sent: 1 });
		expect(mail.sent.map((m) => m.to)).toEqual(['lender@sahel.test']);
	});
});

describe('addresses and suppression', () => {
	it('no client address on the record: the client side skips silently, the lender still hears', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		const counts = await delivery.runAgingNotices(promisedPlus(15));
		expect(counts).toMatchObject({ due: 2, sent: 1, skippedNoAddress: 1 });
		expect(mail.sent.map((m) => m.to)).toEqual(['lender@sahel.test']);
	});

	it('an opted-out client address gets nothing, checked before the send', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		seedClientInvite();
		fake.seed('receivable_notice_optouts', {
			email: 'client@acme.test', token: 'tok-opted-out', suppressed_at: '2026-10-02 00:00:00', created_at: '2026-10-02 00:00:00',
		});
		const counts = await delivery.runAgingNotices(promisedPlus(15));
		expect(counts).toMatchObject({ suppressed: 1, sent: 1 });
		expect(mail.sent.map((m) => m.to)).toEqual(['lender@sahel.test']);
	});

	it('the client account wins over the banker-typed address when a borrower accepted an invite', async () => {
		seedReceivable();
		seedClaim();
		await seedLenderAccount();
		seedClientInvite('typed@acme.test');
		fake.seed('receivable_access', {
			id: 'acc-1', receivable_id: RID, tenant_id: 'tenant-client', counterparty: OWNER,
			role: 'borrower', granted_by: OWNER, granted_at: '2026-09-10 00:00:00', revoked_at: null,
		});
		await seedLenderAccount('tenant-client', 'account@acme.test');
		await delivery.runAgingNotices(promisedPlus(15));
		expect(mail.sent.map((m) => m.to).sort()).toEqual(['account@acme.test', 'lender@sahel.test']);
	});
});

describe('digest: one email per recipient per run', () => {
	it('two stale claims on one record become one client email with two blocks', async () => {
		seedReceivable();
		seedClaim({ id: 'claim-1', tenant_id: 'tenant-lender-1', created_at: '2026-09-02 10:00:00' });
		seedClaim({ id: 'claim-2', tenant_id: 'tenant-lender-2', created_at: '2026-09-03 10:00:00' });
		await seedLenderAccount('tenant-lender-1', 'one@lenders.test');
		await seedLenderAccount('tenant-lender-2', 'two@lenders.test');
		seedClientInvite();
		const counts = await delivery.runAgingNotices(promisedPlus(15));
		expect(counts).toMatchObject({ due: 4, sent: 3, logged: 4 });
		const client = mail.sent.filter((m) => m.to === 'client@acme.test');
		expect(client).toHaveLength(1);
		expect(client[0].text.match(/The claim recorded /g)).toHaveLength(2);
		expect(logRows()).toEqual([
			'claim-1|day15|client', 'claim-1|day15|lender',
			'claim-2|day15|client', 'claim-2|day15|lender',
		]);
	});
});

describe('practice records and closed records', () => {
	it('an isTest claim emails nobody, while the desk inbox still shows it marked TEST', async () => {
		seedReceivable({ is_test: true });
		seedClaim();
		await seedLenderAccount();
		seedClientInvite();
		const counts = await delivery.runAgingNotices(promisedPlus(15));
		expect(counts).toMatchObject({ due: 2, skippedTest: 2, sent: 0 });
		expect(mail.sent).toEqual([]);
		const inbox = await reg.listNeedsUpdate(LENDER, promisedPlus(15));
		expect(inbox).toHaveLength(1);
		expect(inbox[0]).toMatchObject({ claimId: CLAIM, aging: 'past_due_not_updated', isTest: true });
	});

	it('settled and withdrawn records are never candidates', async () => {
		seedReceivable({ settled_at: '2026-10-02' });
		seedClaim();
		expect(await delivery.runAgingNotices(promisedPlus(15))).toMatchObject({ candidates: 0 });
		fake.rows('receivables').length = 0;
		seedReceivable({ deleted_at: '2026-10-03 00:00:00' });
		expect(await delivery.runAgingNotices(promisedPlus(15))).toMatchObject({ candidates: 0 });
	});
});

describe('the lapse pair', () => {
	it('warns the lender two weeks out, then tells both sides at lapse', async () => {
		seedReceivable({ due_date: null });
		seedClaim({ created_at: '2026-04-01 10:00:00' });
		await seedLenderAccount();
		seedClientInvite();

		const warnAt = new Date(at('2026-04-01').getTime() + 170 * DAY_MS);
		const warned = await delivery.runAgingNotices(warnAt);
		expect(warned).toMatchObject({ sent: 1 });
		expect(mail.sent.map((m) => m.to)).toEqual(['lender@sahel.test']);
		expect(mail.sent[0].text).toContain('It lapses on ');
		expect(logRows()).toEqual([`${CLAIM}|lapse_warn|lender`]);

		mail.sent = [];
		const lapsedAt = new Date(at('2026-04-01').getTime() + 185 * DAY_MS);
		const lapsed = await delivery.runAgingNotices(lapsedAt);
		expect(lapsed).toMatchObject({ sent: 2 });
		expect(mail.sent.map((m) => m.to).sort()).toEqual(['client@acme.test', 'lender@sahel.test']);
		expect(mail.sent.find((m) => m.to === 'client@acme.test')!.text).toContain('lapsed — record not maintained');
	});
});
