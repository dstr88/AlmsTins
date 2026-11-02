import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The A4 routes: the daily cron (secret-gated, counts only), the desk inbox feed
 * (authenticated, tenant-scoped, computed on load), and the public opt-out (token is the
 * capability). The registry's real SQL runs against the db fake. Invented data throughout.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));

const mem = vi.hoisted(() => ({
	session: { tenantId: 'tenant-lender', isDemo: false } as { tenantId: string; isDemo: boolean } | null,
	run: [] as unknown[],
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
vi.mock('@/lib/receivables/server/noticeDelivery', () => ({
	runAgingNotices: async (now: Date) => {
		mem.run.push(now.toISOString());
		return { candidates: 3, due: 1, sent: 1, logged: 1, skippedTest: 0, skippedNoAddress: 0, suppressed: 0, failed: 0 };
	},
}));

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');

const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const RID = 'c5'.repeat(32);
const DAY_MS = 86_400_000;
const promisedPlus = (days: number) => new Date(Date.parse('2026-10-01T12:00:00Z') + days * DAY_MS);

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
		id: 'claim-1', receivable_id: RID, tenant_id: LENDER, financier: 'Sahel Capital',
		amount: 15000, currency: 'USD', claim_date: '2026-09-02', status: 'active',
		manifest_json: '{}', signature_json: null, digest: 'e'.repeat(64), anchor_json: null,
		discharged_at: null, affirmed_at: null, affirmed_by: null, created_at: '2026-09-02 10:00:00',
		...over,
	});
}

async function fresh() {
	vi.resetModules();
	fake = createReceivablesDbFake();
	holder.db = fake;
	mem.run = [];
	reg = await import('../../src/lib/receivablesRegistry');
	await reg.ensureReceivablesTables();
}

beforeEach(async () => {
	vi.stubEnv('CRON_SECRET', 'test-cron-secret');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', '');
	mem.session = { tenantId: LENDER, isDemo: false };
	await fresh();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /api/cron/receivables-notices', () => {
	async function hit(headers: Record<string, string> = {}, qs = '') {
		const mod = await import('../../src/pages/api/cron/receivables-notices.ts');
		const request = new Request(`https://almstins.com/api/cron/receivables-notices${qs}`, { headers });
		const res: Response = await (mod.GET as any)({ request });
		return { status: res.status, body: await res.json() };
	}

	it('401 without the secret, and nothing runs', async () => {
		const { status, body } = await hit();
		expect(status).toBe(401);
		expect(body).toEqual({ ok: false, error: 'unauthorized' });
		expect(mem.run).toEqual([]);
	});

	it('401 on a wrong secret', async () => {
		const { status } = await hit({ 'x-cron-secret': 'nope' });
		expect(status).toBe(401);
		expect(mem.run).toEqual([]);
	});

	it('200 with the header: runs the pass and answers counts only (numbers and booleans)', async () => {
		const { status, body } = await hit({ 'x-cron-secret': 'test-cron-secret' });
		expect(status).toBe(200);
		expect(body).toMatchObject({ ok: true, candidates: 3, sent: 1 });
		expect(mem.run).toHaveLength(1);
		// The workflow prints number/boolean fields into a public log: nothing else may ride along.
		for (const v of Object.values(body)) expect(['number', 'boolean']).toContain(typeof v);
	});

	it('200 with the ?secret= query form the shared curl wrapper uses', async () => {
		const { status } = await hit({}, '?secret=test-cron-secret');
		expect(status).toBe(200);
	});
});

describe('GET /api/verify/receivables/needs-update (the desk inbox, D5)', () => {
	async function hit() {
		const mod = await import('../../src/pages/api/verify/receivables/needs-update.ts');
		const request = new Request('https://almstins.com/api/verify/receivables/needs-update');
		const res: Response = await (mod.GET as any)({ request });
		return { status: res.status, body: await res.json() };
	}

	it('401 signed out', async () => {
		mem.session = null;
		const { status, body } = await hit();
		expect(status).toBe(401);
		expect(body).toEqual({ ok: false, error: 'unauthenticated' });
	});

	it('answers only the caller\'s own grace / past-due claims, with the deal identifiers', async () => {
		seedReceivable();
		seedClaim();
		seedClaim({ id: 'claim-other', tenant_id: 'tenant-someone-else' });
		const { status, body } = await hit();
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.items).toHaveLength(1);
		expect(body.items[0]).toMatchObject({
			claimId: 'claim-1', receivableId: RID, invoiceNo: 'INV-0042', supplier: 'Acme Supplies Ltd',
			face: 18500, currency: 'USD', promisedDate: '2026-10-01', isTest: false,
		});
		expect(['due_in_grace', 'past_due_not_updated']).toContain(body.items[0].aging);
	});
});

describe('listNeedsUpdate: computed on load, cleared by the record itself', () => {
	it('grace and past-due qualify; active, settled, withdrawn and discharged never do', async () => {
		seedReceivable();
		seedClaim();
		// Not yet due: nothing.
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(-5))).toEqual([]);
		// In grace, then past due.
		expect((await reg.listNeedsUpdate(LENDER, promisedPlus(3)))[0]).toMatchObject({ aging: 'due_in_grace' });
		expect((await reg.listNeedsUpdate(LENDER, promisedPlus(15)))[0]).toMatchObject({ aging: 'past_due_not_updated' });
		// Discharged: gone.
		fake.rows('receivable_claims')[0].status = 'discharged';
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(15))).toEqual([]);
		fake.rows('receivable_claims')[0].status = 'active';
		// Settled record: gone.
		fake.rows('receivables')[0].settled_at = '2026-10-03';
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(15))).toEqual([]);
		fake.rows('receivables')[0].settled_at = null;
		// Withdrawn record: gone (discharge stays the lender's remaining action there).
		fake.rows('receivables')[0].deleted_at = '2026-10-04 00:00:00';
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(15))).toEqual([]);
	});

	it('updating the claim clears the item naturally: an extension recomputes the state', async () => {
		seedReceivable();
		seedClaim();
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(15))).toHaveLength(1);
		fake.seed('receivable_status_events', {
			id: 'ev-ext', tenant_id: LENDER, receivable_id: RID, claim_id: 'claim-1', kind: 'extended',
			new_promised_date: '2026-12-01', reason_code: 'debtor_requested', reason_note: null,
			manifest_json: '{}', signature_json: null, digest: 'f'.repeat(64), anchor_json: null,
			created_at: '2026-10-16 09:00:00',
		});
		expect(await reg.listNeedsUpdate(LENDER, promisedPlus(15))).toEqual([]);
	});

	it('past due sorts above grace, oldest promise first', async () => {
		seedReceivable();
		seedReceivable({ id: 'c6'.repeat(32), invoice_no: 'INV-0043', due_date: '2026-10-12' });
		seedClaim({ id: 'claim-a' });
		seedClaim({ id: 'claim-b', receivable_id: 'c6'.repeat(32) });
		const items = await reg.listNeedsUpdate(LENDER, promisedPlus(15));
		expect(items.map((i) => [i.claimId, i.aging])).toEqual([
			['claim-a', 'past_due_not_updated'],
			['claim-b', 'due_in_grace'],
		]);
	});
});

describe('the public opt-out endpoint (token is the capability)', () => {
	async function get(token: string) {
		const mod = await import('../../src/pages/api/verify/receivables/notice-optout.ts');
		const request = new Request(`https://almstins.com/api/verify/receivables/notice-optout?token=${token}`);
		const res: Response = await (mod.GET as any)({ url: new URL(request.url) });
		return { status: res.status, text: await res.text() };
	}

	it('a good token flips the flag and says so; the flag then holds before any send', async () => {
		const { token, suppressed } = await reg.noticeOptoutFor('Client@Acme.Test');
		expect(suppressed).toBe(false);
		expect(token.length).toBeGreaterThanOrEqual(32);
		const { status, text } = await get(encodeURIComponent(token));
		expect(status).toBe(200);
		expect(text).toContain('Notices off');
		expect((await reg.noticeOptoutFor('client@acme.test')).suppressed).toBe(true);
		// The address was stored lowercased, once.
		expect(fake.rows('receivable_notice_optouts')).toHaveLength(1);
		expect(fake.rows('receivable_notice_optouts')[0].email).toBe('client@acme.test');
	});

	it('an unknown token changes nothing and says the link was not recognized', async () => {
		const { status, text } = await get('tok-unknown-very-long');
		expect(status).toBe(200);
		expect(text).toContain('Link not recognized');
	});

	it('POST is the one-click form: 204, flag set', async () => {
		const { token } = await reg.noticeOptoutFor('client@acme.test');
		const mod = await import('../../src/pages/api/verify/receivables/notice-optout.ts');
		const res: Response = await (mod.POST as any)({
			url: new URL(`https://almstins.com/api/verify/receivables/notice-optout?token=${encodeURIComponent(token)}`),
		});
		expect(res.status).toBe(204);
		expect((await reg.noticeOptoutFor('client@acme.test')).suppressed).toBe(true);
	});
});
