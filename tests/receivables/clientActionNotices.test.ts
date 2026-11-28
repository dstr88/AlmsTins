import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Part B: the client is emailed when the lender acts (repaid / extended / unpaid / settled),
 * end to end through the four action routes, the registry's real SQL on the db fake, and the
 * daily retry. Pinned: one email per action, the identifier block and nothing beyond the public
 * record (never a reason, a note or a party name), no action buttons, the opt-out honoured and
 * linked, test and withdrawn records email nobody, a client who acted itself is not told, the
 * actor scoping, and a failed send retried by the daily job. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(digestHex: string) {
			return { type: 'opentimestamps', digestHex, otsProofBase64: 'ZmFrZS1wcm9vZg==', anchoredAt: null };
		}
		async upgrade(): Promise<never> { throw new Error('never upgraded here'); }
	},
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
let delivery: typeof import('../../src/lib/receivables/server/clientActionDelivery');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c5'.repeat(32);
const CLAIM = 'claim-1';
const CLIENT = 'client@acme.test';

function seedReceivable(over: Record<string, unknown> = {}) {
	return fake.seed('receivables', {
		id: RID, tenant_id: OWNER, supplier: 'Acme Supplies Ltd', buyer: 'Bigco Plc', invoice_no: 'INV-0042',
		face: 18500, currency: 'USD', terms: null, due_date: '2026-10-01', acknowledged_at: null,
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
function seedClientInvite(email = CLIENT) {
	fake.seed('receivable_invites', {
		token: `tok-${email}`, receivable_id: RID, from_tenant: OWNER, role: 'borrower', label: null,
		email, expires_at: '2026-09-20 00:00:00', accepted_at: null, accepted_by: null, revoked_at: null,
		claim_id: null, offer_id: null, reminded_at: null, lapse_recorded_at: null, created_at: '2026-09-03 10:00:00',
	});
}
async function seedAccount(tenantId: string, email: string) {
	await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
	await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
	fake.seed('tenant_memberships', { tenant_id: tenantId, user_id: `user-${tenantId}`, role: 'owner', created_at: '2026-01-01 00:00:00' });
	fake.seed('auth_users', { id: `user-${tenantId}`, email, alert_email: null, lang: 'en' });
}

const post = async (route: string, body: unknown) => {
	const mod = await import(`../../src/pages/api/verify/receivables/${route}.ts`);
	const res: Response = await mod.POST({ request: new Request(`https://alms.test/api/verify/receivables/${route}`, { method: 'POST', body: JSON.stringify(body) }) } as any);
	return { status: res.status, body: await res.json() };
};
const outbox = () => fake.rows('receivable_client_action_notices');

beforeEach(async () => {
	vi.stubEnv('AUTH_URL', 'https://alms.test');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	mail.sent = [];
	mail.failNext = 0;
	mem.session = { tenantId: LENDER, isDemo: false };
	reg = await import('../../src/lib/receivablesRegistry');
	delivery = await import('../../src/lib/receivables/server/clientActionDelivery');
	await reg.ensureReceivablesTables();
	seedReceivable();
	seedClaim();
	seedClientInvite();
});
afterEach(() => { vi.unstubAllEnvs(); });

/** Every email must stay inside the public record and carry no button. */
function expectPublicOnly(text: string) {
	for (const hidden of ['Bigco Plc', 'Acme Supplies Ltd', 'Sahel Capital', 'kept-off-every-email', 'renegotiated', 'wire-note-secret']) {
		expect(text).not.toContain(hidden);
	}
	expect(text).not.toMatch(/<a |<button|href=/i);
	expect(text).toContain(`https://alms.test/verify/registry?id=${RID}`);
	expect(text).toContain('/api/verify/receivables/notice-optout?token=');
	expect(text).not.toMatch(/—/);
}

describe('each lender action emails the client once', () => {
	it('repaid (discharge): one email, the identifier block, logged sent', async () => {
		const r = await post('discharge', { claimId: CLAIM, reason: 'wire-note-secret' });
		expect(r.status).toBe(200);
		expect(mail.sent).toHaveLength(1);
		const m = mail.sent[0];
		expect(m.to).toBe(CLIENT);
		expect(m.subject).toBe('An update on a financing record for one of your invoices');
		expect(m.text).toContain('The lender released its claim recorded 2026-09-02 against your invoice INV-0042 (USD 18,500.00).');
		expectPublicOnly(m.text);
		expect(outbox()).toHaveLength(1);
		expect(outbox()[0]).toMatchObject({ event_key: `repaid:${CLAIM}`, kind: 'repaid', receivable_id: RID });
		expect(outbox()[0].sent_at).not.toBeNull();

		// Running the daily job afterwards sends nothing more.
		const counts = await delivery.runClientActionNotices(new Date());
		expect(counts.clientActionsPending).toBe(0);
		expect(mail.sent).toHaveLength(1);
	});

	it('extended: the new date, never the reason or note', async () => {
		const r = await post('extend', { claimId: CLAIM, newPromisedDate: '2026-12-15', reasonCode: 'renegotiated_terms', reasonNote: 'kept-off-every-email' });
		expect(r.status).toBe(200);
		expect(mail.sent).toHaveLength(1);
		const text = mail.sent[0].text;
		expect(text).toContain('extended the promised payment date of its claim recorded 2026-09-02 against your invoice INV-0042 (USD 18,500.00) to 2026-12-15.');
		expect(text).toContain("The reason the lender gave stays off the public record.");
		expectPublicOnly(text);

		// A second extension is its own news.
		await post('extend', { claimId: CLAIM, newPromisedDate: '2027-01-15', reasonCode: 'other' });
		expect(mail.sent).toHaveLength(2);
		expect(mail.sent[1].text).toContain('to 2027-01-15.');
	});

	it('marked unpaid', async () => {
		const r = await post('unpaid', { claimId: CLAIM, note: 'wire-note-secret' });
		expect(r.status).toBe(200);
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0].text).toContain('as unpaid.');
		expectPublicOnly(mail.sent[0].text);
	});

	it('settled, by the receivable owner', async () => {
		mem.session = { tenantId: OWNER, isDemo: false };
		const r = await post('settle', { receivableId: RID });
		expect(r.status).toBe(200);
		expect(mail.sent).toHaveLength(1);
		expect(mail.sent[0].text).toContain('Your invoice INV-0042 (USD 18,500.00), recorded 2026-09-01, is marked paid and the record is closed.');
		expectPublicOnly(mail.sent[0].text);
	});
});

describe('who is never emailed', () => {
	it('a test record emails nobody, and is marked skipped so the job never retries it', async () => {
		fake.rows('receivables')[0].is_test = true;
		await post('discharge', { claimId: CLAIM });
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].skipped).toBe('test');
		await delivery.runClientActionNotices(new Date());
		expect(mail.sent).toHaveLength(0);
	});

	it('a withdrawn record emails nobody (discharge still works there)', async () => {
		fake.rows('receivables')[0].deleted_at = '2026-11-01 00:00:00';
		const r = await post('discharge', { claimId: CLAIM });
		expect(r.status).toBe(200);
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].skipped).toBe('withdrawn');
	});

	it('an opted-out client address gets nothing', async () => {
		const o = await reg.noticeOptoutFor(CLIENT);
		await reg.suppressNoticesByToken(o.token);
		await post('unpaid', { claimId: CLAIM });
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].skipped).toBe('suppressed');
	});

	it('no client address on the record: silently skipped', async () => {
		fake.tables.set('receivable_invites', []);
		await post('unpaid', { claimId: CLAIM });
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].skipped).toBe('no_address');
	});

	it('a client who settled the record itself is not told about it', async () => {
		fake.seed('receivable_access', {
			id: 'acc-1', receivable_id: RID, tenant_id: OWNER, counterparty: LENDER,
			role: 'borrower', granted_by: LENDER, granted_at: '2026-09-10 00:00:00', revoked_at: null,
		});
		await seedAccount(OWNER, 'owner@acme.test');
		mem.session = { tenantId: OWNER, isDemo: false };
		await post('settle', { receivableId: RID });
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].skipped).toBe('self');
	});

	it('the demo writes nothing and emails nobody', async () => {
		mem.session = { tenantId: LENDER, isDemo: true };
		const r = await post('discharge', { claimId: CLAIM });
		expect(r.status).toBe(403);
		expect(mail.sent).toHaveLength(0);
	});

	it('the queue is scoped to the actor: another tenant cannot queue a notice about this claim', async () => {
		await reg.dischargeClaim(LENDER, CLAIM);
		const key = await delivery.queueClientActionNotice('tenant-stranger', 'repaid', CLAIM);
		expect(key).toBeNull();
		expect(fake.tables.get('receivable_client_action_notices') ?? []).toHaveLength(0);
		// And a ref that is not yet the stated state queues nothing either (an active claim is not repaid).
		expect(await delivery.queueClientActionNotice(LENDER, 'settled', RID)).toBeNull();
	});
});

describe('decision B1: right away, and the daily job retries a failure', () => {
	it('a failed send stays pending, the job sends it once, then never again', async () => {
		mail.failNext = 1;
		const r = await post('discharge', { claimId: CLAIM });
		expect(r.status).toBe(200); // the discharge stands
		expect(mail.sent).toHaveLength(0);
		expect(outbox()[0].sent_at ?? null).toBeNull();
		expect(outbox()[0].skipped ?? null).toBeNull();
		expect(outbox()[0].attempts).toBe(1);

		const counts = await delivery.runClientActionNotices(new Date());
		expect(counts).toMatchObject({ clientActionsPending: 1, clientActionsSent: 1, clientActionsFailed: 0 });
		expect(mail.sent).toHaveLength(1);
		const again = await delivery.runClientActionNotices(new Date());
		expect(again.clientActionsPending).toBe(0);
		expect(mail.sent).toHaveLength(1);
	});

	it('stops retrying after the retry window', async () => {
		mail.failNext = 1;
		await post('discharge', { claimId: CLAIM });
		const later = new Date(Date.now() + 5 * 86_400_000);
		const counts = await delivery.runClientActionNotices(later);
		expect(counts.clientActionsPending).toBe(0);
		expect(mail.sent).toHaveLength(0);
	});

	it('the cron route reports the retry counts as numbers only', async () => {
		vi.stubEnv('CRON_SECRET', 'cron-secret-test');
		mail.failNext = 1;
		await post('discharge', { claimId: CLAIM });
		const mod = await import('../../src/pages/api/cron/receivables-notices');
		const res: Response = await mod.GET({ request: new Request('https://alms.test/api/cron/receivables-notices', { headers: { 'x-cron-secret': 'cron-secret-test' } }) } as any);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.clientActionsSent).toBe(1);
		for (const v of Object.values(body)) expect(['number', 'boolean']).toContain(typeof v);
	});
});
