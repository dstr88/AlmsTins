import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The product an account signed up for is saved once, when the account gets its first tenant.
 *
 * The owner's "New tenant created" notice has always known it (the sign-in's own context,
 * src/lib/signupService.ts); it was just never kept. It is now written to
 * auth_users.signup_service by saveSignupService (src/lib/accountActivity.ts), called where
 * ensureTenantForUser attaches a first tenant (src/lib/tenants.ts).
 *
 * Pinned here: a first tenant made inside a sign-in saves that sign-in's product; a later
 * sign-in through another product's door never overwrites it; outside a sign-in nothing is
 * written; a failed write never fails the tenant; and the migration holds the same two
 * statements the runtime runs. Every id and address is invented.
 */
const mem = vi.hoisted(() => ({ sent: [] as any[] }));

vi.mock('@/lib/email', () => ({ sendMail: async (m: any) => { mem.sent.push(m); } }));
vi.mock('@/lib/db', async () => (await import('../helpers/authUsersFake')).dbModule());

import { authUsers } from '../helpers/authUsersFake';
import { ensureTenantForUser } from '../../src/lib/tenants';
import { runWithSignInContext, noteSignInProvider } from '../../src/lib/signupService';
import {
	ACCOUNT_ACTIVITY_COLUMNS,
	ACCOUNT_ACTIVITY_DDL,
	ensureAccountActivityColumns,
	saveSignupService,
	__resetAccountActivityForTests,
} from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** The statements ensureTenantForUser runs, answered from the fake's own rows. */
const tenantSql = (sql: string, args: unknown[]) => {
	const ok = (rows: unknown[] = [], rowsAffected = 0) => ({ rows, rowsAffected });
	if (sql.startsWith('SELECT active_tenant_id, is_onboarded, setup_completed_at FROM auth_users WHERE id = ?')) {
		const u = authUsers.rows.get(String(args[0]));
		return ok(u ? [{ active_tenant_id: u.active_tenant_id ?? null, is_onboarded: null, setup_completed_at: null }] : []);
	}
	if (sql === 'SELECT email FROM auth_users WHERE id = ? LIMIT 1') {
		const u = authUsers.rows.get(String(args[0]));
		return ok(u ? [{ email: u.email }] : []);
	}
	if (sql.startsWith('SELECT active_tenant_id FROM auth_users WHERE email = ?')) return ok();
	if (sql.startsWith('SELECT tenant_id FROM tenant_memberships')) return ok();
	if (sql.startsWith('INSERT INTO tenants') || sql.startsWith('INSERT INTO tenant_memberships')) return ok([], 1);
	if (sql.startsWith('INSERT INTO subscriptions')) return ok([], 1);
	if (sql === 'UPDATE auth_users SET active_tenant_id = ? WHERE id = ? AND active_tenant_id IS NULL') {
		const u = authUsers.rows.get(String(args[1]));
		if (!u || u.active_tenant_id) return ok();
		u.active_tenant_id = args[0];
		return ok([], 1);
	}
	return undefined;
};

beforeEach(() => {
	authUsers.reset();
	authUsers.extra = tenantSql;
	mem.sent = [];
	__resetAccountActivityForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('the product signed up for is saved with the first tenant', () => {
	it('a Verify sign-up is saved as verify', async () => {
		authUsers.add({ id: 'u-new', email: 'new.person@example.test', active_tenant_id: null, signup_service: null });
		await runWithSignInContext('/dashboard/verify', async () => {
			noteSignInProvider('google');
			await ensureTenantForUser('u-new');
		}, 'SG');
		expect(authUsers.get('u-new').signup_service).toBe('verify');
		expect(authUsers.get('u-new').active_tenant_id).toBeTruthy();
		// The owner's notice names the same product.
		expect(mem.sent).toHaveLength(1);
		expect(mem.sent[0].subject).toBe('New tenant created: Verify, Singapore');
	});

	it.each([
		['/dashboard/vault', 'wallet-watcher'],
		['/dashboard/agentics', 'agent-vault'],
		['/receivables/desk', 'receivables'],
		['', 'unknown'],
	])('a sign-up through %s is saved as %s', async (door, id) => {
		authUsers.add({ id: 'u-door', email: 'door@example.test', active_tenant_id: null, signup_service: null });
		await runWithSignInContext(door, () => ensureTenantForUser('u-door'));
		expect(authUsers.get('u-door').signup_service).toBe(id);
	});
});

describe('it is saved once and never overwritten', () => {
	it('a later sign-in through another door leaves it alone', async () => {
		authUsers.add({ id: 'u-keep', email: 'keep@example.test', active_tenant_id: null, signup_service: null });
		await runWithSignInContext('/dashboard/verify', () => ensureTenantForUser('u-keep'));
		const tenant = authUsers.get('u-keep').active_tenant_id;
		await runWithSignInContext('/dashboard/agentics', () => ensureTenantForUser('u-keep'));
		expect(authUsers.get('u-keep')).toMatchObject({ signup_service: 'verify', active_tenant_id: tenant });
		expect(mem.sent).toHaveLength(1);
	});

	it('the write itself refuses a row that already holds a product', async () => {
		authUsers.add({ id: 'u-set', email: 'set@example.test', signup_service: 'receivables' });
		await runWithSignInContext('/dashboard/verify', () => saveSignupService('u-set'));
		expect(authUsers.get('u-set').signup_service).toBe('receivables');
		expect(read('src/lib/accountActivity.ts')).toContain('UPDATE auth_users SET signup_service = ? WHERE id = ? AND signup_service IS NULL');
	});

	it('an account that already has a tenant gets nothing written', async () => {
		authUsers.add({ id: 'u-old', email: 'old@example.test', active_tenant_id: 't-existing', signup_service: null });
		await runWithSignInContext('/dashboard/verify', () => ensureTenantForUser('u-old'));
		expect(authUsers.get('u-old').signup_service).toBeNull();
		expect(authUsers.writes()).toEqual([]);
	});
});

describe('outside a sign-in there is no product to save', () => {
	it('a tenant made from the onboarding page writes none', async () => {
		authUsers.add({ id: 'u-onb', email: 'onb@example.test', active_tenant_id: null, signup_service: null });
		await ensureTenantForUser('u-onb', 'Primary');
		expect(authUsers.get('u-onb').signup_service).toBeNull();
		expect(authUsers.get('u-onb').active_tenant_id).toBeTruthy();
	});
});

describe('a failed write never fails the tenant', () => {
	it('the tenant is made and the notice is sent', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		authUsers.add({ id: 'u-fail', email: 'fail@example.test', active_tenant_id: null, signup_service: null });
		authUsers.failOn = /signup_service/;
		const tenantId = await runWithSignInContext('/dashboard/verify', () => ensureTenantForUser('u-fail'));
		expect(tenantId).toBeTruthy();
		expect(authUsers.get('u-fail').active_tenant_id).toBe(tenantId);
		expect(mem.sent).toHaveLength(1);
		expect(warn).toHaveBeenCalled();
	});
});

describe('the two columns', () => {
	it('are added only when missing: the ensure looks before it alters', async () => {
		await ensureAccountActivityColumns();
		expect(authUsers.statements.map((s) => s.sql).filter((sql) => sql.startsWith('ALTER'))).toEqual([]);
		// Memoized: a second call asks nothing.
		const asked = authUsers.statements.length;
		await ensureAccountActivityColumns();
		expect(authUsers.statements.length).toBe(asked);
	});

	it('a database without them gets both, under a lock timeout', async () => {
		authUsers.columns = new Set();
		await ensureAccountActivityColumns();
		const run = authUsers.statements.map((s) => s.sql);
		expect(run.slice(1)).toEqual(["SET LOCAL lock_timeout = '2s'", ...ACCOUNT_ACTIVITY_DDL]);
		expect([...authUsers.columns].sort()).toEqual([...ACCOUNT_ACTIVITY_COLUMNS].sort());
	});

	it('a database with one of them gets only the other', async () => {
		authUsers.columns = new Set(['signup_service']);
		await ensureAccountActivityColumns();
		expect(authUsers.statements.map((s) => s.sql).filter((sql) => sql.startsWith('ALTER'))).toEqual([ACCOUNT_ACTIVITY_DDL[1]]);
	});

	it('a failed ensure is tried again', async () => {
		authUsers.failOn = /information_schema/;
		await expect(ensureAccountActivityColumns()).rejects.toThrow();
		authUsers.failOn = null;
		await expect(ensureAccountActivityColumns()).resolves.toBeUndefined();
	});

	it('migrations-pg/0077 holds exactly the statements the runtime runs, in order', () => {
		const statements = read('migrations-pg/0077_auth_signup_service_last_active.sql')
			.replace(/--[^\n]*/g, '')
			.split(';')
			.map((s) => s.replace(/\s+/g, ' ').trim())
			.filter(Boolean);
		expect(statements).toEqual([...ACCOUNT_ACTIVITY_DDL]);
		expect(ACCOUNT_ACTIVITY_DDL.map((sql) => sql.match(/IF NOT EXISTS (\w+) TEXT$/)?.[1])).toEqual([...ACCOUNT_ACTIVITY_COLUMNS]);
	});
});

describe('tenants.ts is wired', () => {
	const tenants = read('src/lib/tenants.ts');
	it('saves the product on each path that attaches a first tenant, before the notice', () => {
		expect(tenants.match(/await saveSignupService\(userId\);/g)?.length).toBe(3);
		expect(tenants.match(/await saveSignupService\(userId\);\n\t\tawait sendTenantAlert\(userId, tenantId\);/g)?.length).toBe(2);
	});
});
