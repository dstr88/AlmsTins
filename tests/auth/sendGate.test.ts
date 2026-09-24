import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Almstins emails an address a tenant typed in (receivables and milestone requests) only for an
 * accountable account, and only up to a durable per-tenant daily cap. Pinned here:
 *   - the quota claim is a single conditional INSERT: rowsAffected 0 means refused;
 *   - POST /api/verify/receivables/send refuses an unverified account (403) before doing
 *     anything, refuses over the cap (429) without sending, sends otherwise, and gives the
 *     claim back when the mail server fails;
 *   - POST /api/verify/cairn/send applies the same gate and the same shared cap.
 */
const mem = vi.hoisted(() => ({
	claims: [] as { id: string; tenant_id: string; channel: string; sent_at: string }[],
	cap: 100,
	facts: new Map<string, Record<string, any>>(),
	failQuota: false,
}));
const sendMail = vi.hoisted(() => vi.fn(async (_m: any) => {}));
const session = vi.hoisted(() => ({ tenant: { tenantId: 't-1' } as any, auth: { user: { id: 'u-1', email: 'desk@company.dev' } } as any }));

vi.mock('@/lib/email', () => ({ sendMail }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => session.tenant }));
vi.mock('@/lib/authSession', () => ({ getAuthSession: async () => session.auth }));
vi.mock('@/lib/receivablesRegistry', () => ({
	countRecentInvites: async () => 0,
	getSendableRequest: async (tenantId: string, token: string) =>
		tenantId === 't-1' && token === 'tok'
			? {
					token: 'tok', kind: 'debtor', sentTo: 'buyer@client.dev', expiresAt: '2026-10-01T00:00:00Z',
					amount: 1000, currency: 'USD', invoiceNo: 'INV-1', supplier: 'Supplier', buyer: 'Buyer',
					label: null, buyerName: null, recourse: null, price: null,
				}
			: null,
}));
vi.mock('@/lib/cairnRegistry', () => ({
	countRecentCairnInvites: async () => 0,
	getSendableCairnRequest: async (tenantId: string, token: string) =>
		tenantId === 't-1' && token === 'tok'
			? {
					token: 'tok', sentTo: 'inspector@site.dev', projectName: 'Bridge', counterparty: 'Builder Co',
					milestoneTitle: 'Foundations', seq: 1, targetDate: null, expiresAt: '2026-10-01T00:00:00Z', isTest: false,
				}
			: null,
}));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (/^CREATE (TABLE|INDEX) IF NOT EXISTS tenant_outbound_emails/.test(sql)) return { rows: [], rowsAffected: 0 };
		if (sql.startsWith('INSERT INTO tenant_outbound_emails (id, tenant_id, channel, sent_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM tenant_outbound_emails WHERE tenant_id = ? AND sent_at >= ?) < ?')) {
			if (mem.failQuota) throw new Error('connection refused');
			const [id, tenant, channel, sentAt, tenant2, since, cap] = args;
			const used = mem.claims.filter((c) => c.tenant_id === tenant2 && c.sent_at >= since).length;
			if (used >= cap) return { rows: [], rowsAffected: 0 };
			mem.claims.push({ id, tenant_id: tenant, channel, sent_at: sentAt });
			return { rows: [], rowsAffected: 1 };
		}
		if (sql === 'DELETE FROM tenant_outbound_emails WHERE id = ? AND tenant_id = ?') {
			const before = mem.claims.length;
			mem.claims = mem.claims.filter((c) => !(c.id === args[0] && c.tenant_id === args[1]));
			return { rows: [], rowsAffected: before - mem.claims.length };
		}
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			return { rows: [{ column_name: 'sessions_valid_after' }, { column_name: 'alert_email' }], rowsAffected: 0 };
		}
		if (sql.startsWith('SELECT u.email_verified, u.sessions_valid_after')) {
			const f = mem.facts.get(String(args[0]));
			return { rows: f ? [f] : [], rowsAffected: 0 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { claimOutboundEmail, OUTBOUND_EMAILS_PER_TENANT_PER_DAY } from '../../src/lib/outboundEmailQuota';
import { __resetSessionGateForTests } from '../../src/lib/sessionGate';
import { POST } from '../../src/pages/api/verify/receivables/send';
import { POST as CAIRN_POST } from '../../src/pages/api/verify/cairn/send';

const ORIGINAL_EMAIL_SERVER = process.env.EMAIL_SERVER;
afterAll(() => {
	if (ORIGINAL_EMAIL_SERVER === undefined) delete process.env.EMAIL_SERVER;
	else process.env.EMAIL_SERVER = ORIGINAL_EMAIL_SERVER;
});

const VERIFIED = { email_verified: '2026-09-01 10:00:00', sessions_valid_after: null, has_password: true, has_account: false };
const UNVERIFIED = { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false };

const call = async (handler: any = POST, path = '/api/verify/receivables/send') => {
	const request = new Request(`https://almstins.com${path}`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'tok' }),
	});
	const res = await handler({ request });
	return { status: res.status as number, body: await res.json() };
};
const callCairn = () => call(CAIRN_POST, '/api/verify/cairn/send');

beforeEach(() => {
	mem.claims = [];
	mem.facts.clear();
	mem.failQuota = false;
	sendMail.mockReset();
	sendMail.mockImplementation(async () => {});
	session.tenant = { tenantId: 't-1' };
	session.auth = { user: { id: 'u-1', email: 'desk@company.dev' } };
	__resetSessionGateForTests();
	process.env.EMAIL_SERVER = 'smtp://test.invalid';
});

describe('claimOutboundEmail', () => {
	it('grants up to the cap in a rolling 24h window, then refuses', async () => {
		const now = Date.UTC(2026, 8, 23);
		for (let i = 0; i < 3; i++) expect(await claimOutboundEmail('t-9', 'receivables', now + i, 3)).toBeTypeOf('string');
		expect(await claimOutboundEmail('t-9', 'cairn', now + 10, 3)).toBeNull();
		// Another tenant is unaffected.
		expect(await claimOutboundEmail('t-8', 'receivables', now + 10, 3)).toBeTypeOf('string');
		// A day later the window has moved on.
		expect(await claimOutboundEmail('t-9', 'receivables', now + 24 * 3600_000 + 5, 3)).toBeTypeOf('string');
	});

	it('uses the default cap', async () => {
		expect(OUTBOUND_EMAILS_PER_TENANT_PER_DAY).toBe(100);
	});
});

describe('POST /api/verify/receivables/send', () => {
	it('refuses an unverified password account before doing anything', async () => {
		mem.facts.set('u-1', UNVERIFIED);
		const r = await call();
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('email_unverified');
		expect(typeof r.body.detail).toBe('string');
		expect(sendMail).not.toHaveBeenCalled();
		expect(mem.claims).toHaveLength(0);
	});

	it('refuses when the session has no user (fail closed)', async () => {
		session.auth = null;
		const r = await call();
		expect(r.status).toBe(403);
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('sends for a verified account and records the claim', async () => {
		mem.facts.set('u-1', VERIFIED);
		const r = await call();
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ ok: true, sentTo: 'buyer@client.dev' });
		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(mem.claims).toHaveLength(1);
		expect(mem.claims[0]).toMatchObject({ tenant_id: 't-1', channel: 'receivables' });
	});

	it('a Google/GitHub account counts as verified', async () => {
		mem.facts.set('u-1', { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true });
		expect((await call()).status).toBe(200);
	});

	it('refuses over the daily cap without sending', async () => {
		mem.facts.set('u-1', VERIFIED);
		const now = new Date().toISOString();
		for (let i = 0; i < OUTBOUND_EMAILS_PER_TENANT_PER_DAY; i++) mem.claims.push({ id: `c${i}`, tenant_id: 't-1', channel: 'cairn', sent_at: now });
		const r = await call();
		expect(r.status).toBe(429);
		expect(r.body.error).toBe('daily_limit');
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('refuses (503) when the quota cannot be checked', async () => {
		mem.facts.set('u-1', VERIFIED);
		mem.failQuota = true;
		const r = await call();
		expect(r.status).toBe(503);
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('gives the claim back when the mail server refuses', async () => {
		mem.facts.set('u-1', VERIFIED);
		sendMail.mockImplementation(async () => { throw Object.assign(new Error('550 rejected'), { code: 'EENVELOPE' }); });
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await call();
		err.mockRestore();
		expect(r.status).toBe(502);
		expect(mem.claims).toHaveLength(0);
	});
});

describe('POST /api/verify/cairn/send', () => {
	it('refuses an unverified password account before doing anything', async () => {
		mem.facts.set('u-1', UNVERIFIED);
		const r = await callCairn();
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('email_unverified');
		expect(sendMail).not.toHaveBeenCalled();
		expect(mem.claims).toHaveLength(0);
	});

	it('refuses when the session has no user (fail closed)', async () => {
		session.auth = null;
		expect((await callCairn()).status).toBe(403);
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('sends for a verified account and records a cairn claim', async () => {
		mem.facts.set('u-1', VERIFIED);
		const r = await callCairn();
		expect(r.status).toBe(200);
		expect(r.body).toEqual({ ok: true, sentTo: 'inspector@site.dev' });
		expect(sendMail).toHaveBeenCalledTimes(1);
		expect(mem.claims[0]).toMatchObject({ tenant_id: 't-1', channel: 'cairn' });
	});

	it('shares the daily cap with receivables: a tenant at its cap cannot send here either', async () => {
		mem.facts.set('u-1', VERIFIED);
		const now = new Date().toISOString();
		for (let i = 0; i < OUTBOUND_EMAILS_PER_TENANT_PER_DAY; i++) mem.claims.push({ id: `c${i}`, tenant_id: 't-1', channel: 'receivables', sent_at: now });
		const r = await callCairn();
		expect(r.status).toBe(429);
		expect(r.body.error).toBe('daily_limit');
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('gives the claim back when the mail server refuses', async () => {
		mem.facts.set('u-1', VERIFIED);
		sendMail.mockImplementation(async () => { throw new Error('550 rejected'); });
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await callCairn();
		err.mockRestore();
		expect(r.status).toBe(502);
		expect(mem.claims).toHaveLength(0);
	});
});
