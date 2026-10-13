import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Two per-account brakes that sit behind the tenant session. Pinned here:
 *   - POST /api/verify/receivables/anchor: 30 stamps per tenant per hour (each is a request to
 *     the public OpenTimestamps calendars); upgrades have their own, larger budget; another
 *     tenant is unaffected;
 *   - POST /api/account/alert-email: pointing alerts at an address (Almstins then mails it on
 *     a schedule) needs a verified account; clearing it never does.
 */
const mem = vi.hoisted(() => ({
	tenant: 't-1',
	stamps: 0,
	upgrades: 0,
	facts: new Map<string, Record<string, any>>(),
	alertWrites: [] as any[][],
	session: { user: { id: 'u-1' } } as any,
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: mem.tenant }) }));
vi.mock('@/lib/authSession', () => ({ getAuthSession: async () => mem.session }));
vi.mock('@/lib/receivablesRegistry', () => ({
	getRecordForAnchor: async () => ({ digest: 'AB'.repeat(32), anchorJson: '{"pending":true}' }),
	setRecordAnchor: async () => {},
}));
vi.mock('@/lib/rwaProof/anchorOpenTimestamps', () => ({
	OpenTimestampsAnchor: class {
		async stamp() { mem.stamps += 1; return { pending: true }; }
		async upgrade() { mem.upgrades += 1; return { pending: false }; }
	},
}));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			return { rows: [{ column_name: 'sessions_valid_after' }, { column_name: 'alert_email' }], rowsAffected: 0 };
		}
		if (sql.startsWith('SELECT u.email_verified, u.sessions_valid_after, EXISTS (SELECT 1 FROM auth_credentials c')) {
			const f = mem.facts.get(String(args[0]));
			return { rows: f ? [f] : [], rowsAffected: 0 };
		}
		if (sql === 'UPDATE auth_users SET alert_email = ? WHERE id = ?') {
			mem.alertWrites.push(args);
			return { rows: [], rowsAffected: 1 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { POST as ANCHOR } from '../../src/pages/api/verify/receivables/anchor';
import { POST as ALERT_EMAIL } from '../../src/pages/api/account/alert-email';
import { __resetSessionGateForTests } from '../../src/lib/sessionGate';

const anchor = async (body: Record<string, unknown>) => {
	const request = new Request('https://almstins.com/api/verify/receivables/anchor', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
	});
	const res: Response = await (ANCHOR as any)({ request });
	return res.status;
};
const setAlert = async (alertEmail: string) => {
	const request = new Request('https://almstins.com/api/account/alert-email', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alertEmail }),
	});
	const res: Response = await (ALERT_EMAIL as any)({ request });
	return { status: res.status, body: await res.json() };
};

beforeEach(() => {
	mem.stamps = 0;
	mem.upgrades = 0;
	mem.facts.clear();
	mem.alertWrites = [];
	mem.session = { user: { id: 'u-1' } };
	__resetSessionGateForTests();
});

describe('POST /api/verify/receivables/anchor per-tenant limit', () => {
	it('30 stamps an hour, then 429 without calling the calendars; upgrades keep their own budget; other tenants unaffected', async () => {
		mem.tenant = 't-stamp';
		for (let i = 0; i < 30; i++) expect(await anchor({ kind: 'receivable', id: `r-${i}` })).toBe(200);
		expect(await anchor({ kind: 'receivable', id: 'r-31' })).toBe(429);
		expect(mem.stamps).toBe(30);

		expect(await anchor({ kind: 'receivable', id: 'r-1', upgrade: true })).toBe(200);
		expect(mem.upgrades).toBe(1);

		mem.tenant = 't-other';
		expect(await anchor({ kind: 'receivable', id: 'r-1' })).toBe(200);
	});

	it('upgrades: 240 an hour per tenant', async () => {
		mem.tenant = 't-upgrade';
		for (let i = 0; i < 240; i++) expect(await anchor({ kind: 'claim', id: 'c-1', upgrade: true })).toBe(200);
		expect(await anchor({ kind: 'claim', id: 'c-1', upgrade: true })).toBe(429);
		expect(mem.upgrades).toBe(240);
	});
});

describe('POST /api/account/alert-email', () => {
	it('refuses to point alerts anywhere for an unverified password account', async () => {
		mem.facts.set('u-1', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		const r = await setAlert('elsewhere@company.dev');
		expect(r.status).toBe(403);
		expect(mem.alertWrites).toHaveLength(0);
	});

	it('allows a verified account or a Google/GitHub account, lowercased', async () => {
		mem.facts.set('u-1', { email_verified: '2026-09-01', sessions_valid_after: null, has_password: true, has_account: false });
		expect((await setAlert('Alerts@Company.dev')).status).toBe(200);
		mem.facts.set('u-2', { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true });
		mem.session = { user: { id: 'u-2' } };
		expect((await setAlert('alerts@company.dev')).status).toBe(200);
		expect(mem.alertWrites).toEqual([['alerts@company.dev', 'u-1'], ['alerts@company.dev', 'u-2']]);
	});

	it('refuses a scanner-shaped address before anything else', async () => {
		mem.facts.set('u-1', { email_verified: '2026-09-01', sessions_valid_after: null, has_password: true, has_account: false });
		expect((await setAlert(`testing@example.com'"`)).status).toBe(400);
		expect(mem.alertWrites).toHaveLength(0);
	});

	it('clearing it never needs verification', async () => {
		mem.facts.set('u-1', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		expect((await setAlert('')).status).toBe(200);
		expect(mem.alertWrites).toEqual([[null, 'u-1']]);
	});
});
