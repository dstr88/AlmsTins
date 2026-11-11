import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The owner's "New tenant created" notice names the service the sign-in was headed for and how
 * it signed in. Pinned here: each login door's return path maps to its service; the destination
 * is read from the emailed link's query, a password form's field or Auth.js's callback-url
 * cookie, in that order; a tenant created inside a sign-in sends the notice with both; outside
 * one it reads Unknown; and the auth route wires all of it. Every id and address is invented.
 */

const mem = vi.hoisted(() => ({ sent: [] as any[], activeTenant: null as string | null }));

vi.mock('@/lib/email', () => ({ sendMail: async (m: any) => { mem.sent.push(m); } }));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		if (sql.startsWith('SELECT active_tenant_id')) return { rows: [{ active_tenant_id: mem.activeTenant }], rowsAffected: 0 };
		if (sql === 'SELECT email FROM auth_users WHERE id = ? LIMIT 1') return { rows: [{ email: 'new.person@example.test' }], rowsAffected: 0 };
		if (sql.startsWith('SELECT active_tenant_id FROM auth_users WHERE email')) return { rows: [], rowsAffected: 0 };
		if (sql.startsWith('SELECT tenant_id FROM tenant_memberships')) return { rows: [], rowsAffected: 0 };
		if (sql.startsWith('INSERT INTO tenants') || sql.startsWith('INSERT INTO tenant_memberships')) return { rows: [], rowsAffected: 1 };
		if (sql.startsWith('UPDATE auth_users SET active_tenant_id')) return { rows: [], rowsAffected: 1 };
		if (sql.startsWith('INSERT INTO subscriptions')) return { rows: [], rowsAffected: 1 };
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import {
	callbackUrlFromRequest,
	formCallbackUrl,
	methodLabel,
	noteSignInProvider,
	runWithSignInContext,
	serviceForPath,
} from '../../src/lib/signupService';
import { ensureTenantForUser, tenantAlertMessage } from '../../src/lib/tenants';

beforeEach(() => {
	mem.sent = [];
	mem.activeTenant = null;
});

describe('each login door names its service', () => {
	it.each([
		['/dashboard/vault', 'wallet-watcher'],
		['/dashboard', 'wallet-watcher'],
		['/onboarding', 'wallet-watcher'],
		['/dashboard/verify', 'verify'],
		['/dashboard/verify?tab=keys', 'verify'],
		['/verify', 'verify'],
		['/verify/agent-keys', 'verify'],
		['/verify/desk', 'receivables'],
		['/receivables/desk', 'receivables'],
		['/receivables', 'receivables'],
		['/receivables/milestones', 'receivables'],
		['/verify/cairn/abc', 'receivables'],
		['/verify/confirm/xyz', 'receivables'],
		['/dashboard/agentics', 'agent-vault'],
		['/dashboard/agentics/agents', 'agent-vault'],
		['/agentics', 'agent-vault'],
		['https://almstins.com/dashboard/verify', 'verify'],
		['https://almstins.com/dashboard/agentics', 'agent-vault'],
	])('%s is %s', (p, id) => {
		expect(serviceForPath(p).id).toBe(id);
	});

	it('a path that only starts like a service is not that service', () => {
		expect(serviceForPath('/dashboard/verifyx').id).toBe('wallet-watcher');
		expect(serviceForPath('/agenticsx').id).toBe('wallet-watcher');
	});

	it('no destination, or one that is not a path, is Unknown', () => {
		for (const v of [null, undefined, '', '   ', '//evil.example/dashboard/verify', 'not a url']) {
			expect(serviceForPath(v as any).id).toBe('unknown');
		}
	});

	it('words each method', () => {
		expect(methodLabel('google')).toBe('Google');
		expect(methodLabel('github')).toBe('GitHub');
		expect(methodLabel('email')).toBe('Email link');
		expect(methodLabel('credentials')).toBe('Email and password');
		expect(methodLabel(null)).toBe('Unknown');
	});
});

describe('where the destination is read from', () => {
	it('the emailed link carries it in the query', () => {
		const r = new Request('https://almstins.com/api/auth/callback/email?callbackUrl=%2Fdashboard%2Fverify&token=t&email=e');
		expect(callbackUrlFromRequest(r)).toBe('/dashboard/verify');
	});

	it('Google and GitHub carry it in the callback-url cookie, secure name first', () => {
		const r = new Request('https://almstins.com/api/auth/callback/google?code=c', {
			headers: { cookie: 'a=1; __Secure-authjs.callback-url=https%3A%2F%2Falmstins.com%2Fdashboard%2Fagentics; authjs.callback-url=%2Fdashboard%2Fvault' },
		});
		expect(callbackUrlFromRequest(r)).toBe('https://almstins.com/dashboard/agentics');
		const plain = new Request('https://almstins.com/api/auth/callback/github', { headers: { cookie: 'authjs.callback-url=%2Fdashboard%2Fverify' } });
		expect(callbackUrlFromRequest(plain)).toBe('/dashboard/verify');
	});

	it('a password form carries it in the body, read without consuming the body', async () => {
		const r = new Request('https://almstins.com/api/auth/callback/credentials', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ email: 'a@example.test', password: 'pw', callbackUrl: '/dashboard/verify', csrfToken: 'x' }).toString(),
		});
		const fromForm = await formCallbackUrl(r);
		expect(fromForm).toBe('/dashboard/verify');
		expect(callbackUrlFromRequest(r, fromForm)).toBe('/dashboard/verify');
		// Auth.js still gets the whole form.
		expect((await r.formData()).get('password')).toBe('pw');
	});

	it('a GET or a JSON body has no form destination', async () => {
		expect(await formCallbackUrl(new Request('https://almstins.com/api/auth/csrf'))).toBeNull();
		const json = new Request('https://almstins.com/api/auth/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		expect(await formCallbackUrl(json)).toBeNull();
	});
});

describe('the notice', () => {
	it('names the service in the subject and the service and method in the body', () => {
		const m = tenantAlertMessage({ userId: 'u-1', tenantId: 't-1', email: 'x@example.test', service: 'Verify', method: 'Google' });
		expect(m.subject).toBe('New tenant created: Verify');
		expect(m.text.split('\n')).toEqual([
			'A new tenant was created.',
			'Service: Verify',
			'Sign-in: Google',
			'User: u-1',
			'Email: x@example.test',
			'Tenant: t-1',
		]);
	});

	it('a tenant created inside a sign-in sends both', async () => {
		await runWithSignInContext('/dashboard/agentics', async () => {
			noteSignInProvider('github');
			await ensureTenantForUser('u-new');
		});
		expect(mem.sent).toHaveLength(1);
		expect(mem.sent[0].to).toBe('donnie@titaniumhut.com');
		expect(mem.sent[0].subject).toBe('New tenant created: Agent Vault');
		expect(mem.sent[0].text).toContain('Sign-in: GitHub');
		expect(mem.sent[0].text).toContain('Email: new.person@example.test');
	});

	it('outside a sign-in both read Unknown', async () => {
		await ensureTenantForUser('u-new');
		expect(mem.sent[0].subject).toBe('New tenant created: Unknown');
		expect(mem.sent[0].text).toContain('Sign-in: Unknown');
	});

	it('an account that already has a tenant sends nothing', async () => {
		mem.activeTenant = 't-existing';
		await runWithSignInContext('/dashboard/verify', () => ensureTenantForUser('u-old'));
		expect(mem.sent).toHaveLength(0);
	});
});

describe('the auth route is wired', () => {
	const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/auth/[...auth].ts'), 'utf8');
	it('both handlers run Auth.js inside the sign-in context, and the signIn callback records the method', () => {
		expect(src.match(/runWithSignInContext\(/g)?.length).toBe(2);
		expect(src).toContain('await formCallbackUrl(request)');
		expect(src).toContain('noteSignInProvider(account?.provider)');
	});
	it('the notice no longer builds its own mail connection', () => {
		const tenants = readFileSync(path.resolve(__dirname, '../../src/lib/tenants.ts'), 'utf8');
		expect(tenants).not.toContain('nodemailer');
		expect(tenants).toContain("from './email'");
	});
});
