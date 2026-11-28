import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import {
	forecastNext,
	groupLine,
	headLine,
	statementView,
	type EmailEntry,
} from '../../src/lib/receivables/emailStatement';
import { verifySignedRecord } from '../../src/lib/recordProof/signedRecord';
import { signedRecordKindLabel } from '../../src/lib/recordProof/signedRecordText';
import { readStatementRows } from '../../src/components/receivables/ProofDownloads/proofDownloads.client';

/**
 * The email statement (approved 2026-11-28): one statement per claim of the emails Almstins sent
 * about it, in Donnie's format, built from the email logs through the registry's real SQL on the
 * db fake. The format and the forecast, a summary counted once, who may see it (lender and client
 * only), nothing about a person in it, the template version written on each send ("not recorded"
 * for older rows), and the signed download passing /verify-record and the offline script while a
 * changed copy fails. The suite's clock is pinned at 2026-11-05 12:00 UTC. Invented data.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
	db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) },
}));
const mem = vi.hoisted(() => ({ session: null as { tenantId: string; isDemo: boolean } | null }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('@/lib/email', () => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { mail.sent.push(m); } }));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		readonly type = 'opentimestamps';
		async stamp(): Promise<never> { throw new Error('no stamping here'); }
		async upgrade(): Promise<never> { throw new Error('no upgrading here'); }
	},
}));

const SEED = '4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e1e0e6a9a1b2c3d4e5f60';
const OWNER = 'tenant-owner';
const LENDER = 'tenant-lender';
const LENDER_B = 'tenant-lender-b';
const CLIENT = 'tenant-client';
const DEBTOR = 'tenant-debtor';
const STRANGER = 'tenant-stranger';
const RID = 'c6'.repeat(32);
const CLAIM = 'claim-1';
const CLAIM_B = 'claim-b';
const CLIENT_EMAIL = 'client@acme.test';
const LENDER_EMAIL = 'lender@sahel.test';
const NOTE = 'the debtor paid on the 20th, please release';
const NOW = new Date('2026-11-05T12:00:00Z');

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/receivablesRegistry');
let store: typeof import('../../src/lib/receivables/server/emailStatementStore');

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
function seedAccess(tenantId: string, role: string) {
	fake.seed('receivable_access', {
		id: `acc-${tenantId}`, receivable_id: RID, tenant_id: tenantId, counterparty: OWNER,
		role, granted_by: OWNER, granted_at: '2026-09-10 00:00:00', revoked_at: null,
	});
}
const notice = (notice: string, role: string, sent_at: string, template_version: string | null = 'notices/1', claim_id = CLAIM) =>
	fake.seed('receivable_notice_log', { claim_id, notice, recipient_role: role, sent_at, template_version });

/** One claim's email history as log rows: four scheduled notices (two on one day), three daily
 *  summaries, two client requests on one day and one lender action, plus rows that must not count. */
function seedLogs() {
	notice('day9', 'lender', '2026-10-10 06:00:00');
	notice('day15', 'lender', '2026-10-16 06:00:00');
	notice('day15', 'client', '2026-10-16 06:00:00');
	notice('day20', 'lender', '2026-10-21 06:00:00', null); // sent before versions were kept
	for (const day of ['2026-10-04', '2026-10-08', '2026-10-15']) {
		fake.seed('receivable_update_summary_claims', { claim_id: CLAIM, day, lender_tenant_id: LENDER, sent_at: `${day} 07:00:00`, template_version: 'update-requests/1' });
	}
	fake.seed('receivable_update_requests', {
		id: 'req-1', claim_id: CLAIM, receivable_id: RID, lender_tenant_id: LENDER, source: 'client',
		requester_tenant_id: CLIENT, day: '2026-10-05', note: NOTE, clicks: 1,
		first_at: '2026-10-05 09:00:00', last_at: '2026-10-05 09:00:00', emailed_at: '2026-10-05 09:00:01', skipped: null, template_version: 'update-requests/1',
	});
	fake.seed('receivable_update_requests', {
		id: 'req-2', claim_id: CLAIM, receivable_id: RID, lender_tenant_id: LENDER, source: 'client',
		requester_tenant_id: CLIENT, day: '2026-10-05', note: null, clicks: 1,
		first_at: '2026-10-05 15:00:00', last_at: '2026-10-05 15:00:00', emailed_at: '2026-10-05 15:00:01', skipped: null, template_version: null,
	});
	fake.seed('receivable_client_action_notices', {
		event_key: 'extended:ev-1', kind: 'extended', receivable_id: RID, claim_id: CLAIM, actor_tenant_id: LENDER,
		created_at: '2026-11-01 10:00:00', sent_at: '2026-11-01 10:00:02', skipped: null, attempts: 0, template_version: 'client-actions/1',
	});
	// Another claim's email on the same record never counts here.
	fake.seed('receivable_client_action_notices', {
		event_key: 'repaid:claim-b', kind: 'repaid', receivable_id: RID, claim_id: CLAIM_B, actor_tenant_id: LENDER_B,
		created_at: '2026-11-02 10:00:00', sent_at: '2026-11-02 10:00:02', skipped: null, attempts: 0, template_version: 'client-actions/1',
	});
	// The plan-lock email is account mail, never part of a claim's statement.
	notice('free_locked', 'lender', '2026-10-22 06:00:00');
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
async function listRoute(rid = RID) {
	const mod: any = await import('../../src/pages/api/verify/receivables/email-statements');
	return json(await mod.GET({ request: new Request(`https://alms.test/api/verify/receivables/email-statements?receivableId=${rid}`) }));
}
async function fileRoute(claimId = CLAIM) {
	const mod: any = await import('../../src/pages/api/verify/receivables/email-statement-file');
	const res: Response = await mod.GET({ request: new Request(`https://alms.test/api/verify/receivables/email-statement-file?claimId=${claimId}`) });
	return { status: res.status, text: await res.text(), headers: res.headers };
}

beforeEach(async () => {
	vi.resetModules();
	vi.stubEnv('AUTH_URL', 'https://alms.test');
	vi.stubEnv('ALMSTINS_SIGNING_KEY', SEED);
	vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
	vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
	vi.stubEnv('RECEIVABLES_FINGERPRINT_KEY', '');
	fake = createReceivablesDbFake();
	holder.db = fake;
	mail.sent = [];
	mem.session = null;
	reg = await import('../../src/lib/receivablesRegistry');
	store = await import('../../src/lib/receivables/server/emailStatementStore');
	await reg.ensureReceivablesTables();
});
afterEach(() => { vi.unstubAllEnvs(); });

// ── The format ─────────────────────────────────────────────────────────────────

describe('the format (Donnie\'s)', () => {
	const e = (day: string, type = 'day15'): EmailEntry => ({ day, type, to: 'lender', template: 'notices/1' });
	it('label, count, dates; two on one day in brackets', () => {
		expect(groupLine('scheduled', [e('2026-10-05'), e('2026-10-10'), e('2026-10-15'), e('2026-11-03')], '2026'))
			.toBe('Scheduled: 4, on Oct 5, Oct 10, Oct 15 and Nov 3.');
		expect(groupLine('interested', [e('2026-10-04'), e('2026-11-03'), e('2026-10-08'), e('2026-10-15'), e('2026-11-03')], '2026'))
			.toBe('Interested parties: 5, on Oct 4, Oct 8, Oct 15 and Nov 3 (2).');
		expect(groupLine('lender_acted', [e('2026-11-20')], '2026')).toBe('Lender acted: 1, on Nov 20.');
		expect(groupLine('client', [e('2026-10-04'), e('2026-10-05')], '2026')).toBe('Client: 2, on Oct 4 and Oct 5.');
		expect(groupLine('client', [], '2026')).toBe('Client: 0.');
	});
	it('the as-of line, and a year that is not the statement\'s own', () => {
		expect(headLine('2026-11-28 15:00:00')).toBe('Emails about this claim, as of November 28, 2026');
		expect(groupLine('scheduled', [e('2025-12-30'), e('2026-01-04')], '2026')).toBe('Scheduled: 2, on Dec 30, 2025 and Jan 4.');
	});
	it('the forecast is labelled and never counted', () => {
		const groups = { scheduled: [e('2026-10-16')], interested: [], client: [], lender_acted: [] };
		const v = statementView('2026-11-05 12:00:00', groups, { type: 'day20', day: '2026-12-03' }, {
			scheduled: '2026-10-01', interested: '2026-11-28', client: '2026-11-28', lender_acted: '2026-11-28',
		});
		expect(v.next).toBe('Next scheduled: day-20 notice, Dec 3, unless the lender updates the claim first.');
		expect(v.lines[0]).toBe('Scheduled: 1, on Oct 16.');
		expect(v.history).toBe('History starts: scheduled from Oct 1, 2026, interested parties from Nov 28, 2026, client from Nov 28, 2026, lender acted from Nov 28, 2026. Dates are UTC.');
		expect(v.emails).toEqual(['Oct 16: day-15 notice, to the lender. Template notices/1.']);
		expect(JSON.stringify(v)).not.toContain('—');
	});
	it('the forecast follows the notices job\'s own schedule', () => {
		const base = { open: true, promisedDate: '2026-11-01', lastOwnerTouchAt: '2026-10-20 10:00:00' };
		// Promised Nov 1, nothing sent: day 9 on Nov 10.
		expect(forecastNext({ ...base, sent: new Set() }, NOW)).toEqual({ type: 'day9', day: '2026-11-10' });
		// Day 9 and 15 sent: day 20 on Nov 21.
		expect(forecastNext({ ...base, sent: new Set(['day9', 'day15']) }, NOW)).toEqual({ type: 'day20', day: '2026-11-21' });
		// All three sent: the lapse warning, 14 days before the lapse (promised + 180 days).
		expect(forecastNext({ ...base, sent: new Set(['day9', 'day15', 'day20']) }, NOW)).toEqual({ type: 'lapse_warn', day: '2027-04-16' });
		expect(forecastNext({ ...base, open: false, sent: new Set() }, NOW)).toBeNull();
	});
});

// ── From the logs ──────────────────────────────────────────────────────────────

describe('the statement, built from the email logs', () => {
	beforeEach(() => { seedReceivable(); seedClaim(); seedAccess(CLIENT, 'borrower'); seedLogs(); });

	it('counts each group, leaves out the plan lock and another claim\'s email, and forecasts the next notice', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		const r = await listRoute();
		expect(r.status).toBe(200);
		expect(r.body.statements).toHaveLength(1);
		const s = r.body.statements[0];
		expect(s).toMatchObject({ claimId: CLAIM, role: 'lender', financier: 'Sahel Capital' });
		expect(s.head).toBe('Emails about this claim, as of November 5, 2026');
		expect(s.lines).toEqual([
			'Scheduled: 4, on Oct 10, Oct 16 (2) and Oct 21.',
			'Interested parties: 3, on Oct 4, Oct 8 and Oct 15.',
			'Client: 2, on Oct 5 (2).',
			'Lender acted: 1, on Nov 1.',
		]);
		// Day 9, 15, 20 went to the lender: the lapse warning is next (promised Oct 1 + 180 − 14).
		expect(s.next).toBe('Next scheduled: lapse warning, Mar 16, 2027, unless the lender updates the claim first.');
		expect(s.emails).toContain('Oct 21: day-20 notice, to the lender. Template version not recorded.');
		expect(s.emails).toContain('Oct 5: update request from the client, to the lender. Template update-requests/1.');
		expect(s.emails).toContain('Oct 5: update request from the client, to the lender. Template version not recorded.');
		expect(s.emails).toContain('Nov 1: due date extended notice, to the client. Template client-actions/1.');
		expect(readStatementRows(r.body)).toHaveLength(1);
	});

	it('a daily summary that rolled up many requests counts as one email', async () => {
		// Summaries written before the claims table: request rows still marked emailed on Oct 20,
		// confirmed by the lender's digest row, however many there are.
		for (let i = 0; i < 4; i++) {
			fake.seed('receivable_update_requests', {
				id: `pub:${CLAIM}:2026-10-1${6 + (i % 2)}-${i}`, claim_id: CLAIM, receivable_id: RID, lender_tenant_id: LENDER, source: 'public',
				requester_tenant_id: null, day: `2026-10-1${6 + (i % 2)}`, note: null, clicks: 9,
				first_at: '2026-10-16 09:00:00', last_at: '2026-10-17 09:00:00', emailed_at: '2026-10-20 07:00:00', skipped: null, template_version: null,
			});
		}
		fake.seed('receivable_update_request_digests', { lender_tenant_id: LENDER, day: '2026-10-20', sent_at: '2026-10-20 07:00:00', template_version: null });
		const groups = await store.loadEmailGroups(RID, { claimId: CLAIM, lenderTenantId: LENDER });
		expect(groups.interested.map((e) => e.day)).toEqual(['2026-10-04', '2026-10-08', '2026-10-15', '2026-10-20']);
	});

	it('the daily summary job writes one row per claim covered, with its template version', async () => {
		const ur = await import('../../src/lib/receivables/server/updateRequestStore');
		fake.rows('receivable_update_summary_claims').length = 0;
		await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
		await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
		fake.seed('tenant_memberships', { tenant_id: LENDER, user_id: 'u-l', role: 'owner', created_at: '2026-01-01 00:00:00' });
		fake.seed('auth_users', { id: 'u-l', email: LENDER_EMAIL, alert_email: null, lang: 'en' });
		const ctx = (await ur.loadRequestContext(RID, CLAIM, NOW))!;
		for (let i = 0; i < 3; i++) await ur.recordUpdateRequest(ctx, 'public', {}, NOW);
		const counts = await ur.runUpdateRequestSummaries(NOW);
		expect(counts.updateSummariesSent).toBe(1);
		expect(fake.rows('receivable_update_summary_claims')).toEqual([
			expect.objectContaining({ claim_id: CLAIM, day: '2026-11-05', template_version: 'update-requests/1' }),
		]);
		expect(fake.rows('receivable_update_request_digests')[0]).toMatchObject({ template_version: 'update-requests/1' });
		const groups = await store.loadEmailGroups(RID, { claimId: CLAIM, lenderTenantId: LENDER });
		expect(groups.interested.filter((e) => e.day === '2026-11-05')).toHaveLength(1);
	});
});

describe('who sees it', () => {
	beforeEach(() => {
		seedReceivable(); seedClaim(); seedClaim({ id: CLAIM_B, tenant_id: LENDER_B, financier: 'Other Lender', created_at: '2026-09-03 10:00:00' });
		seedAccess(CLIENT, 'borrower'); seedAccess(DEBTOR, 'buyer'); seedLogs();
	});

	it('the lender sees his own claim only; the client sees every claim', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		expect((await listRoute()).body.statements.map((s: any) => s.claimId)).toEqual([CLAIM]);
		mem.session = { tenantId: LENDER_B, isDemo: false };
		expect((await listRoute()).body.statements.map((s: any) => s.claimId)).toEqual([CLAIM_B]);
		mem.session = { tenantId: CLIENT, isDemo: false };
		const c = await listRoute();
		expect(c.body.statements.map((s: any) => [s.claimId, s.role])).toEqual([[CLAIM, 'client'], [CLAIM_B, 'client']]);
	});

	it('the debtor, a stranger and the record\'s owner see nothing; a signed-out visitor gets 401', async () => {
		for (const t of [DEBTOR, STRANGER, OWNER]) {
			mem.session = { tenantId: t, isDemo: false };
			expect((await listRoute()).body.statements).toEqual([]);
			expect((await fileRoute()).status).toBe(404);
		}
		mem.session = null;
		expect((await listRoute()).status).toBe(401);
		expect((await fileRoute()).status).toBe(401);
		// Another lender cannot download this lender's statement.
		mem.session = { tenantId: LENDER_B, isDemo: false };
		expect((await fileRoute(CLAIM)).status).toBe(404);
		expect(fake.rows('receivable_email_statements')).toHaveLength(0);
	});

	it('the demo can read the statement but not make a signed one', async () => {
		mem.session = { tenantId: LENDER, isDemo: true };
		expect((await listRoute()).status).toBe(200);
		expect((await fileRoute()).status).toBe(403);
	});
});

// ── The signed record ──────────────────────────────────────────────────────────

describe('the signed statement', () => {
	beforeEach(() => { seedReceivable(); seedClaim(); seedAccess(CLIENT, 'borrower'); seedLogs(); });

	it('carries no address, no note, no requester and no email text', async () => {
		mem.session = { tenantId: CLIENT, isDemo: false };
		const f = await fileRoute();
		expect(f.status).toBe(200);
		for (const leak of [CLIENT_EMAIL, LENDER_EMAIL, '@', NOTE, CLIENT, LENDER, 'Acme', 'Bigco', 'INV-0042', 'Sign in', 'Check the record']) {
			expect(f.text).not.toContain(leak);
		}
		const file = JSON.parse(f.text);
		expect(file.kind).toBe('email_statement');
		expect(file.manifest).toMatchObject({ kind: 'email_statement', claimId: CLAIM, viewer: 'client', counts: { scheduled: 4, interested: 3, client: 2, lender_acted: 1 } });
		expect(file.manifest.next).toEqual({ type: 'lapse_warn', day: '2027-03-16', forecast: true });
		expect(file.manifest.templates).toEqual({
			'client-actions/1': 'src/lib/receivables/copy/notices.ts',
			'notices/1': 'src/lib/receivables/copy/notices.ts',
			'update-requests/1': 'src/lib/receivables/copy/updateRequests.ts',
		});
		expect(file.manifest.statement[0]).toBe('Emails about this claim, as of November 5, 2026');
		expect(file.manifest.statement.at(-1)).toMatch(/^History starts: scheduled from Oct 10, 2026, /);
		expect(f.headers.get('Content-Disposition')).toMatch(/^attachment; filename="almstins-email_statement-[0-9a-f]{12}\.proof\.json"$/);
		expect(signedRecordKindLabel(file.kind)).toBe('Statement of emails about a claim');
	});

	it('passes /verify-record; a changed copy fails', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		const file = JSON.parse((await fileRoute()).text);
		const { getPublishedKeys } = await import('../../src/lib/recordProof/signing');
		const keys = getPublishedKeys();
		expect(verifySignedRecord(file, keys)).toMatchObject({ verdict: 'verified', code: 'ok' });
		const changed = structuredClone(file);
		changed.manifest.counts.client = 0;
		expect(verifySignedRecord(changed, keys)).toMatchObject({ verdict: 'tampered', code: 'digest_mismatch' });
	});

	it('passes the offline script; a changed copy fails it', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		const file = JSON.parse((await fileRoute()).text);
		const { getPublicKeyHex } = await import('../../src/lib/recordProof/signing');
		const dir = mkdtempSync(join(tmpdir(), 'almstins-email-statement-'));
		const good = join(dir, 'good.json');
		writeFileSync(good, JSON.stringify(file));
		const run = (p: string) => execFileSync('node', ['scripts/verify-record.mjs', p, '--pubkey', getPublicKeyHex()!], { encoding: 'utf8' });
		expect(run(good)).toContain('VERIFIED');
		const bad = join(dir, 'bad.json');
		file.manifest.emails.scheduled.pop();
		writeFileSync(bad, JSON.stringify(file));
		expect(() => run(bad)).toThrow();
	});

	it('is stored under the viewer\'s account, listed in "Your signed records", and a later download makes a new one', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		await fileRoute();
		await fileRoute();
		const rows = fake.rows('receivable_email_statements');
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([LENDER]));
		const own = await reg.listOwnProofRecords(LENDER, RID);
		const st = own.filter((r) => r.kind === 'email_statement');
		expect(st).toHaveLength(2);
		expect(st[0].detail).toMatchObject({ financier: 'Sahel Capital', amount: 15000 });
		// The client's own list does not show the lender's statements.
		expect((await reg.listOwnProofRecords(CLIENT, RID)).filter((r) => r.kind === 'email_statement')).toHaveLength(0);
		// And the proof-file route hands a statement back to its own account only.
		const mod: any = await import('../../src/pages/api/verify/receivables/proof-file');
		const get = async () => (await mod.GET({ request: new Request(`https://alms.test/api/verify/receivables/proof-file?kind=email_statement&id=${rows[0].id}`) })).status;
		expect(await get()).toBe(200);
		mem.session = { tenantId: CLIENT, isDemo: false };
		expect(await get()).toBe(404);
	});

	it('making a statement sends nothing', async () => {
		mem.session = { tenantId: LENDER, isDemo: false };
		await listRoute();
		await fileRoute();
		expect(mail.sent).toHaveLength(0);
	});
});

// ── The template version on each send ─────────────────────────────────────────

describe('each send writes its template version', () => {
	beforeEach(() => { seedReceivable(); seedClaim(); });

	it('the aging notices', async () => {
		await reg.recordNoticeSent(CLAIM, 'day15', 'client', NOW);
		expect(fake.rows('receivable_notice_log')[0]).toMatchObject({ notice: 'day15', template_version: 'notices/1' });
	});

	it('a client request, and a lender action to the client', async () => {
		await holder.db.execute('CREATE TABLE IF NOT EXISTS tenant_memberships (tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)');
		await holder.db.execute('CREATE TABLE IF NOT EXISTS auth_users (id TEXT NOT NULL PRIMARY KEY, email TEXT, alert_email TEXT, lang TEXT)');
		for (const [t, e] of [[LENDER, LENDER_EMAIL], [CLIENT, CLIENT_EMAIL]]) {
			fake.seed('tenant_memberships', { tenant_id: t, user_id: `u-${t}`, role: 'owner', created_at: '2026-01-01 00:00:00' });
			fake.seed('auth_users', { id: `u-${t}`, email: e, alert_email: null, lang: 'en' });
		}
		seedAccess(CLIENT, 'borrower');
		const ur = await import('../../src/lib/receivables/server/updateRequestStore');
		const ctx = (await ur.loadRequestContext(RID, CLAIM, NOW))!;
		const { id } = await ur.recordUpdateRequest(ctx, 'client', { requesterTenantId: CLIENT, note: null }, NOW);
		expect(await ur.emailLenderAboutClientRequest(ctx, id, null, NOW)).toBe('sent');
		expect(fake.rows('receivable_update_requests')[0]).toMatchObject({ template_version: 'update-requests/1' });

		fake.rows('receivable_claims')[0].status = 'discharged';
		const ca = await import('../../src/lib/receivables/server/clientActionDelivery');
		expect(await ca.notifyClientOfAction(LENDER, 'repaid', CLAIM, NOW)).toBe('sent');
		expect(fake.rows('receivable_client_action_notices')[0]).toMatchObject({ kind: 'repaid', template_version: 'client-actions/1' });
	});
});
