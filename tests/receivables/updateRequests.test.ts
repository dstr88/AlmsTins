import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { canAskUpdate, cleanRequestNote, requestDaysOf, requestedLine } from '../../src/lib/receivables/updateRequests';
import { askedLine, rowShows, whenText } from '../../src/components/receivables/UpdateRequest/updateRequest.client';

/**
 * Part A: "Ask the lender to update". The pure rules (who may ask in each aging state, days not
 * clicks, the honest line), then the route and the daily summary end to end through the
 * registry's real SQL on the db fake: anonymous requests stored once per claim per day and rolled
 * into one summary email per lender per day, client requests emailed at once every time with the
 * lender-only note, test and withdrawn records, the demo, rate limits, and what each viewer is
 * shown (tenant isolation). The suite's clock is pinned at 2026-11-05 12:00 UTC. Invented data.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({
	session: null as { tenantId: string; isDemo: boolean } | null,
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
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
let store: typeof import('../../src/lib/receivables/server/updateRequestStore');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const LENDER_B = 'tenant-lender-b';
const CLIENT = 'tenant-client';
const STRANGER = 'tenant-stranger';
const RID = 'c6'.repeat(32);
const RID2 = 'c7'.repeat(32);
const CLAIM = 'claim-1';
const NOW = new Date('2026-11-05T12:00:00Z');
const DAY_MS = 86_400_000;
const daysLater = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

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
function seedClientAccess(rid = RID) {
	fake.seed('receivable_access', {
		id: `acc-${rid.slice(0, 4)}`, receivable_id: rid, tenant_id: CLIENT, counterparty: OWNER,
		role: 'borrower', granted_by: OWNER, granted_at: '2026-09-10 00:00:00', revoked_at: null,
	});
}
let accountsReady = false;
async function seedAccount(tenantId: string, email: string) {
	if (!accountsReady) {
		await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
		await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
		accountsReady = true;
	}
	fake.seed('tenant_memberships', { tenant_id: tenantId, user_id: `user-${tenantId}`, role: 'owner', created_at: '2026-01-01 00:00:00' });
	fake.seed('auth_users', { id: `user-${tenantId}`, email, alert_email: null, lang: 'en' });
}

let route: any;
const post = async (body: unknown) => {
	const res: Response = await route.POST({ request: new Request('https://alms.test/api/verify/receivables/update-request', { method: 'POST', body: JSON.stringify(body) }) } as any);
	return { status: res.status, body: await res.json() };
};
const get = async (rid = RID) => {
	const url = new URL(`https://alms.test/api/verify/receivables/update-request?receivableId=${rid}`);
	const res: Response = await route.GET({ request: new Request(url), url } as any);
	return { status: res.status, body: await res.json() };
};
const ask = (over: Record<string, unknown> = {}) => post({ receivableId: RID, claimId: CLAIM, ...over });
const requests = () => fake.rows('receivable_update_requests');

beforeEach(async () => {
	vi.stubEnv('AUTH_URL', 'https://alms.test');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	accountsReady = false;
	mail.sent = [];
	mail.failNext = 0;
	mem.session = null;
	reg = await import('../../src/lib/receivablesRegistry');
	store = await import('../../src/lib/receivables/server/updateRequestStore');
	route = await import('../../src/pages/api/verify/receivables/update-request');
	await reg.ensureReceivablesTables();
	await seedAccount(LENDER, 'lender@sahel.test');
	await seedAccount(CLIENT, 'client@acme.test');
});
afterEach(() => { vi.unstubAllEnvs(); });

// ── The pure rules ─────────────────────────────────────────────────────────────

describe('who may ask, in each aging state (A1)', () => {
	const open = { settled: false };
	const states = ['active', 'due_in_grace', 'past_due_not_updated', 'no_promised_date', 'lapsed', 'settled'] as const;
	it('anyone: only past due not updated, or lapsed', () => {
		const askable = states.filter((aging) => canAskUpdate('public', open, { status: 'active', aging }));
		expect(askable).toEqual(['past_due_not_updated', 'lapsed']);
	});
	it('the client: any time the claim is open', () => {
		const askable = states.filter((aging) => canAskUpdate('client', open, { status: 'active', aging }));
		expect(askable).toEqual(['active', 'due_in_grace', 'past_due_not_updated', 'no_promised_date', 'lapsed']);
	});
	it('never the lender, never a released claim, a settled or a withdrawn record', () => {
		expect(canAskUpdate('lender', open, { status: 'active', aging: 'lapsed' })).toBe(false);
		expect(canAskUpdate('client', open, { status: 'discharged', aging: 'settled' })).toBe(false);
		expect(canAskUpdate('client', { settled: true }, { status: 'active', aging: 'active' })).toBe(false);
		expect(canAskUpdate('public', { settled: false, withdrawn: true }, { status: 'active', aging: 'lapsed' })).toBe(false);
	});
});

describe('the public line counts days, not clicks', () => {
	it('distinct days, first and last', () => {
		const r = requestDaysOf(['2026-11-26', '2026-11-26', '2026-11-27', '2026-11-28 09:00:00', '2026-11-30']);
		expect(r).toEqual({ days: 4, first: '2026-11-26', last: '2026-11-30' });
		expect(requestedLine(r, 2026)).toBe('Update requested on 4 days since Nov 26; last Nov 30.');
		expect(requestedLine(requestDaysOf(['2026-11-26', '2026-11-26']), 2026)).toBe('Update requested on Nov 26.');
		expect(requestedLine(requestDaysOf([]))).toBe('');
	});
	it('the note is optional and capped at 280 characters', () => {
		expect(cleanRequestNote('  the buyer paid  ')).toBe('the buyer paid');
		expect(cleanRequestNote('')).toBeNull();
		expect(cleanRequestNote(42)).toBeNull();
		expect(cleanRequestNote('x'.repeat(280))).toBe('x'.repeat(280));
		expect(cleanRequestNote('x'.repeat(281))).toBe('too_long');
	});
	it('the honest line is the same for every clicker and never says an email went out', () => {
		const now = new Date('2026-11-28T15:00:00Z');
		const line = askedLine('2026-11-28 14:14:00', now);
		expect(line).toMatch(/^The lender has been asked to update this record\. Last asked: today, \d{1,2}:14 [AP]M\.$/);
		expect(line).not.toMatch(/email|sent/i);
		expect(whenText('2026-11-20 14:14:00', now)).toMatch(/^Nov 20, 2026, /);
	});
});

// ── The route ──────────────────────────────────────────────────────────────────

describe('anonymous requests', () => {
	beforeEach(() => { seedReceivable(); seedClaim(); });

	it('a past-due claim takes a request; repeats the same day are one row, and no email goes out at once', async () => {
		for (let i = 0; i < 3; i++) {
			const r = await ask({ note: 'ignored-anonymous-note' });
			expect(r.status).toBe(200);
			expect(r.body.ok).toBe(true);
			expect(typeof r.body.askedAt).toBe('string');
			// The answer carries no address and nothing about the lender.
			expect(JSON.stringify(r.body)).not.toMatch(/@|tenant-|Sahel/);
		}
		expect(requests()).toHaveLength(1);
		expect(requests()[0]).toMatchObject({ source: 'public', clicks: 3, day: '2026-11-05', note: null, requester_tenant_id: null });
		expect(mail.sent).toHaveLength(0);
		const g = await get();
		expect(g.body.claims[0]).toMatchObject({ claimId: CLAIM, canAsk: true, requested: { days: 1, first: '2026-11-05', last: '2026-11-05' } });
		expect(g.body.claims[0].clientRequests).toBeUndefined();
	});

	it('refused while the claim is active or in grace, and on a record with no promised date (client only)', async () => {
		fake.rows('receivables')[0].due_date = '2026-12-01';
		expect((await ask()).body.error).toBe('not_open');
		fake.rows('receivables')[0].due_date = '2026-10-30';
		expect((await ask()).status).toBe(409);
		fake.rows('receivables')[0].due_date = null;
		expect((await ask()).status).toBe(409);
		expect(requests()).toHaveLength(0);
	});

	it('a lapsed claim takes a request, an undated one included', async () => {
		fake.rows('receivables')[0].due_date = null;
		fake.rows('receivable_claims')[0].created_at = '2026-01-02 10:00:00';
		expect((await ask()).status).toBe(200);
	});

	it('refused on a released claim and a settled record', async () => {
		fake.rows('receivable_claims')[0].status = 'discharged';
		expect((await ask()).status).toBe(409);
		fake.rows('receivable_claims')[0].status = 'active';
		fake.rows('receivables')[0].settled_at = '2026-11-01';
		expect((await ask()).status).toBe(409);
	});

	it('a withdrawn record refuses with 410', async () => {
		fake.rows('receivables')[0].deleted_at = '2026-11-01 00:00:00';
		const r = await ask();
		expect(r.status).toBe(410);
		expect(r.body.error).toBe('withdrawn');
	});

	it('the demo writes nothing; a lender cannot ask himself', async () => {
		mem.session = { tenantId: 'demo-tenant', isDemo: true };
		expect((await ask()).status).toBe(403);
		mem.session = { tenantId: LENDER, isDemo: false };
		expect((await ask()).body.error).toBe('own_claim');
		expect(requests()).toHaveLength(0);
	});

	it('rate-limited per network like the public lookup', async () => {
		let last = 0;
		for (let i = 0; i < 31; i++) last = (await ask()).status;
		expect(last).toBe(429);
		expect(requests()[0].clicks).toBe(30);
	});

	it('bad input is refused before any work', async () => {
		expect((await post({ receivableId: 'nope', claimId: CLAIM })).status).toBe(400);
		expect((await post({ receivableId: RID, claimId: 'no-such-claim' })).status).toBe(404);
	});
});

describe('client requests (A2)', () => {
	beforeEach(() => {
		seedReceivable({ due_date: '2026-12-01' }); // active: only the client may ask
		seedClaim();
		seedClientAccess();
		mem.session = { tenantId: CLIENT, isDemo: false };
	});

	it('sent to the lender at once, every time, naming the client and carrying the note', async () => {
		for (let i = 0; i < 3; i++) expect((await ask({ note: 'The buyer paid on Nov 20, please release' })).status).toBe(200);
		expect(mail.sent).toHaveLength(3);
		const m = mail.sent[0];
		expect(m.to).toBe('lender@sahel.test');
		expect(m.subject).toBe('Your financing desk: your client asked for an update');
		expect(m.text).toContain('Your client asked you to update your claim against invoice INV-0042 (USD 18,500.00, payment promised 2026-12-01, claim recorded 2026-09-02). The record reads: Active.');
		expect(m.text).toContain('Their note: "The buyer paid on Nov 20, please release"');
		expect(m.text).toContain(`https://alms.test/verify/desk?id=${RID}`);
		expect(m.text).not.toMatch(/<a |<button|href=/i);
		for (const name of ['Bigco Plc', 'Acme Supplies Ltd', 'client@acme.test']) expect(m.text).not.toContain(name);
		expect(requests()).toHaveLength(3);
		expect(requests().every((r) => r.source === 'client' && r.requester_tenant_id === CLIENT && r.emailed_at)).toBe(true);
	});

	it('a note over 280 characters is refused; without a note the email has no note line', async () => {
		expect((await ask({ note: 'x'.repeat(281) })).body.error).toBe('note_too_long');
		expect(mail.sent).toHaveLength(0);
		await ask();
		expect(mail.sent[0].text).not.toContain('Their note');
	});

	it('a test record stores the request and emails nobody', async () => {
		fake.rows('receivables')[0].is_test = true;
		expect((await ask()).status).toBe(200);
		expect(mail.sent).toHaveLength(0);
		expect(requests()[0].skipped).toBe('test');
	});

	it('the client gets its own budget on top of the network one', async () => {
		let last = 0;
		for (let i = 0; i < 11; i++) last = (await ask()).status;
		expect(last).toBe(429);
		expect(mail.sent).toHaveLength(10);
	});
});

describe('what each viewer is shown (tenant isolation)', () => {
	beforeEach(async () => {
		seedReceivable();
		seedClaim();
		seedClaim({ id: 'claim-b', tenant_id: LENDER_B, financier: 'Delta Funding', created_at: '2026-09-03 10:00:00' });
		seedClientAccess();
		mem.session = { tenantId: CLIENT, isDemo: false };
		await ask({ note: 'lender-only-note' });
		await post({ receivableId: RID, claimId: 'claim-b', note: 'note-for-b' });
		mem.session = null;
		await ask();
	});

	it('signed out: day counts only, no client lines, no notes', async () => {
		const g = await get();
		expect(g.body.viewer).toBe('public');
		expect(JSON.stringify(g.body)).not.toMatch(/note|tenant-/);
		expect(g.body.claims.find((c: any) => c.claimId === CLAIM).requested.days).toBe(1);
	});

	it('another signed-in account sees what the public sees', async () => {
		mem.session = { tenantId: STRANGER, isDemo: false };
		const g = await get();
		expect(g.body.viewer).toBe('public');
		expect(JSON.stringify(g.body)).not.toContain('lender-only-note');
	});

	it('the client sees its own dated requests, never a note', async () => {
		mem.session = { tenantId: CLIENT, isDemo: false };
		const g = await get();
		expect(g.body.viewer).toBe('client');
		const c = g.body.claims.find((x: any) => x.claimId === CLAIM);
		expect(c.clientRequests).toHaveLength(1);
		expect(c.clientRequests[0].note).toBeNull();
		expect(c.canAsk).toBe(true);
	});

	it("a lender sees the client's notes on his own claims only", async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		const g = await get();
		expect(g.body.viewer).toBe('lender');
		const own = g.body.claims.find((x: any) => x.claimId === CLAIM);
		const other = g.body.claims.find((x: any) => x.claimId === 'claim-b');
		expect(own).toMatchObject({ own: true, canAsk: false });
		expect(own.clientRequests.map((r: any) => r.note)).toEqual(['lender-only-note']);
		expect(other.own).toBe(false);
		expect(other.clientRequests).toBeUndefined();
		expect(JSON.stringify(g.body)).not.toContain('note-for-b');
		expect(rowShows(g.body, other)).toBe(false);
	});

	it('the demo can read but is offered no button', async () => {
		mem.session = { tenantId: 'demo-tenant', isDemo: true };
		const g = await get();
		expect(g.body.claims.every((c: any) => c.canAsk === false)).toBe(true);
	});
});

// ── The daily summary ──────────────────────────────────────────────────────────

describe('one summary email per lender per day', () => {
	async function seedTwoRecords() {
		seedReceivable();
		seedClaim();
		seedReceivable({ id: RID2, invoice_no: 'INV-0077', face: 9000 });
		seedClaim({ id: 'claim-2', receivable_id: RID2 });
	}
	const askOn = async (rid: string, claimId: string, when: Date) => {
		const ctx = await store.loadRequestContext(rid, claimId, when);
		await store.recordUpdateRequest(ctx!, 'public', {}, when);
	};

	it('many clicks on two claims over two days: one email, both claims, the day counts', async () => {
		await seedTwoRecords();
		for (let i = 0; i < 5; i++) await askOn(RID, CLAIM, NOW);
		await askOn(RID, CLAIM, daysLater(1));
		await askOn(RID2, 'claim-2', daysLater(1));
		const counts = await store.runUpdateRequestSummaries(daysLater(1));
		expect(counts).toMatchObject({ updateRequestsPending: 3, updateSummariesSent: 1 });
		expect(mail.sent).toHaveLength(1);
		const m = mail.sent[0];
		expect(m.to).toBe('lender@sahel.test');
		expect(m.subject).toBe('Your financing desk: updates requested');
		expect(m.text).toContain('Someone holding the receivable ID asked you to update these claims.');
		expect(m.text).toContain('invoice INV-0042');
		expect(m.text).toContain('An update was asked for on 2 days (2026-11-05, 2026-11-06).');
		expect(m.text).toContain('invoice INV-0077');
		expect(m.text).toContain('An update was asked for on 1 day (2026-11-06).');
		expect(m.text).toContain(`https://alms.test/verify/desk?id=${RID}`);
		expect(m.text).not.toMatch(/<a |<button|Bigco|Acme|notice-optout/);

		// Again the same day, even with a new click: nothing more until tomorrow.
		await askOn(RID, CLAIM, daysLater(1));
		expect((await store.runUpdateRequestSummaries(daysLater(1))).updateSummariesSent).toBe(0);
		expect(mail.sent).toHaveLength(1);
		// The next day the new click goes out, alone.
		await store.runUpdateRequestSummaries(daysLater(2));
		expect(mail.sent).toHaveLength(2);
		expect(mail.sent[1].text).not.toContain('INV-0077');
	});

	it('client requests never ride the summary (they went out at once)', async () => {
		await seedTwoRecords();
		seedClientAccess();
		mem.session = { tenantId: CLIENT, isDemo: false };
		await ask();
		expect(mail.sent).toHaveLength(1);
		const counts = await store.runUpdateRequestSummaries(NOW);
		expect(counts.updateRequestsPending).toBe(0);
		expect(mail.sent).toHaveLength(1);
	});

	it('test records email nobody; a claim the lender answered since is dropped', async () => {
		await seedTwoRecords();
		fake.rows('receivables').find((r) => r.id === RID2)!.is_test = true;
		await askOn(RID, CLAIM, NOW);
		await askOn(RID2, 'claim-2', NOW);
		fake.rows('receivable_claims').find((c) => c.id === CLAIM)!.status = 'discharged';
		const counts = await store.runUpdateRequestSummaries(NOW);
		expect(counts).toMatchObject({ updateSummariesSent: 0, updateRequestsSkipped: 2 });
		expect(mail.sent).toHaveLength(0);
		expect(requests().map((r) => r.skipped).sort()).toEqual(['answered', 'test']);
	});

	it('a failed send marks nothing and is retried by the next run', async () => {
		await seedTwoRecords();
		await askOn(RID, CLAIM, NOW);
		mail.failNext = 1;
		expect((await store.runUpdateRequestSummaries(NOW)).updateSummariesFailed).toBe(1);
		expect((await store.runUpdateRequestSummaries(NOW)).updateSummariesSent).toBe(1);
		expect(mail.sent).toHaveLength(1);
	});
});
