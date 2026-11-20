import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every sign-in is recorded, whatever the method.
 *
 * The stamp used to sit in the Auth.js signIn callback, which runs before the adapter creates a
 * new account and hands every emailed link a placeholder user. So a first Google or GitHub
 * sign-in and every emailed-link sign-in were never recorded, and the admin page read "Never"
 * for accounts that had signed in. It now runs from the jwt callback's first-sign-in branch,
 * which every method reaches with the account row in place (src/lib/authRoute.ts, stampSignIn in
 * src/lib/accountActivity.ts).
 *
 * Pinned here: a first Google sign-in, an emailed-link sign-in and a password sign-in each
 * record the time, the product, the country and the active day; a failed stamp never fails the
 * sign-in; an address is written onto an account only when the sign-in proved it; and the route
 * no longer stamps in the signIn callback. Every id and address is invented.
 */
vi.mock('@/lib/db', async () => (await import('../helpers/authUsersFake')).dbModule());
vi.mock('@/lib/tenants', () => ({
	ensureTenantForUser: async (id: string) => `tenant-of-${id}`,
	resolveActiveTenantId: async (id: string) => `tenant-of-${id}`,
}));

import { authUsers } from '../helpers/authUsersFake';
import { jwtCallback } from '../../src/lib/authRoute';
import { guardSignIn } from '../../src/lib/authLinkGuard';
import { runWithSignInContext } from '../../src/lib/signupService';
import { __resetAccountActivityForTests } from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** The suite's pinned clock (tests/setup/pinnedClock.ts). */
const NOW_ISO = '2026-11-05T12:00:00.000Z';
const TODAY = '2026-11-05';

beforeEach(() => {
	authUsers.reset();
	__resetAccountActivityForTests();
});
afterEach(() => {
	vi.restoreAllMocks();
});

/** One sign-in as the auth route runs it: inside the request's context (door and country). */
const signIn = (door: string, country: string | null, params: Parameters<typeof jwtCallback>[0]) =>
	runWithSignInContext(door, () => jwtCallback(params), country);

describe('a first Google sign-in records a sign-in', () => {
	it('stamps the time, the product, the country and the active day on the row the adapter just made', async () => {
		// What the adapter's createUser leaves: a row with an address and nothing else.
		authUsers.add({ id: 'u-new', email: 'first.visit@example.test', last_login: null, last_login_service: null, last_login_country: null, last_active_on: null });
		const token = await signIn('/dashboard/verify', 'SG', {
			token: {},
			user: { id: 'u-new', email: 'first.visit@example.test' },
			account: { provider: 'google', type: 'oidc', providerAccountId: 'g-100' },
		});
		expect(token).toMatchObject({ sub: 'u-new', via: 'google', tenantId: 'tenant-of-u-new' });
		expect(authUsers.get('u-new')).toMatchObject({
			last_login: NOW_ISO,
			last_login_service: 'verify',
			last_login_country: 'SG',
			last_active_on: TODAY,
		});
	});

	it('a first GitHub sign-in is recorded the same way', async () => {
		authUsers.add({ id: 'u-gh', email: 'dev@example.test', last_login: null });
		await signIn('/dashboard/agentics', 'FR', { token: {}, user: { id: 'u-gh' }, account: { provider: 'github', type: 'oauth', providerAccountId: '42' } });
		expect(authUsers.get('u-gh')).toMatchObject({ last_login: NOW_ISO, last_login_service: 'agent-vault', last_login_country: 'FR' });
	});
});

describe('an emailed-link sign-in records a sign-in', () => {
	it('a new account made by the link', async () => {
		authUsers.add({ id: 'u-link', email: 'link.person@example.test', email_verified: NOW_ISO, last_login: null, last_active_on: null });
		await signIn('/dashboard/vault', 'US', {
			token: {},
			user: { id: 'u-link', email: 'link.person@example.test' },
			account: { provider: 'email', type: 'email', providerAccountId: 'link.person@example.test' },
		});
		expect(authUsers.get('u-link')).toMatchObject({ last_login: NOW_ISO, last_login_service: 'wallet-watcher', last_login_country: 'US', last_active_on: TODAY });
	});

	it('a returning account, which the signIn callback only ever saw as a placeholder', async () => {
		authUsers.add({ id: 'u-back', email: 'back.again@example.test', email_verified: '2026-10-01 09:00:00', last_login: '2026-10-01T09:00:00.000Z', last_login_service: 'verify', last_login_country: 'DE', last_active_on: '2026-10-01' });
		await signIn('/dashboard/verify', 'ES', {
			token: {},
			user: { id: 'u-back', email: 'back.again@example.test' },
			account: { provider: 'email', type: 'email', providerAccountId: 'back.again@example.test' },
		});
		expect(authUsers.get('u-back')).toMatchObject({ last_login: NOW_ISO, last_login_service: 'verify', last_login_country: 'ES', last_active_on: TODAY });
	});
});

describe('a password sign-in is still recorded', () => {
	it('stamps the same four facts', async () => {
		authUsers.add({ id: 'u-pw', email: 'pw.person@example.test', email_verified: '2026-10-20 10:00:00', last_login: null });
		await signIn('/receivables/desk', null, { token: {}, user: { id: 'u-pw', email: 'pw.person@example.test' }, account: { provider: 'credentials', type: 'credentials' } });
		expect(authUsers.get('u-pw')).toMatchObject({ last_login: NOW_ISO, last_login_service: 'receivables', last_login_country: null, last_active_on: TODAY });
	});
});

describe('a failed stamp never fails a sign-in', () => {
	it('the session is still minted when every stamp write throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		authUsers.add({ id: 'u-ok', email: 'ok@example.test', last_login: null });
		authUsers.failOn = /^UPDATE auth_users SET (last_login|last_active_on)/;
		const token = await signIn('/dashboard/verify', 'US', { token: {}, user: { id: 'u-ok', email: 'ok@example.test' }, account: { provider: 'google', type: 'oidc', providerAccountId: 'g-1' } });
		expect(token).toMatchObject({ sub: 'u-ok', via: 'google', tenantId: 'tenant-of-u-ok' });
		expect(authUsers.get('u-ok').last_login).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it('a database without the product and country columns still records the time', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		authUsers.add({ id: 'u-old-db', email: 'old.db@example.test', last_login: null });
		authUsers.failOn = /last_login_service/;
		await signIn('/dashboard/verify', 'US', { token: {}, user: { id: 'u-old-db' }, account: { provider: 'google', type: 'oidc', providerAccountId: 'g-2' } });
		expect(authUsers.get('u-old-db').last_login).toBe(NOW_ISO);
	});
});

describe('an address is written onto an account only when the sign-in proved it', () => {
	// The guard's lookup for a provider account that is linked to an account with no address,
	// while no account holds the address the provider reports (accounts made before GitHub
	// shared private emails).
	const linkedToAnAccountWithNoAddress = (sql: string) =>
		sql.startsWith('SELECT u.id, u.email_verified, EXISTS (SELECT 1 FROM auth_accounts a')
			? { rows: [{ id: null, email_verified: null, linked_here: false, linked_any: true, linked_email: '' }], rowsAffected: 0 }
			: undefined;

	it('a Google sign-in whose address Google verified fills an account that has none, and marks it verified', async () => {
		authUsers.add({ id: 'u-blank', email: '', email_verified: null, last_login: null });
		authUsers.extra = linkedToAnAccountWithNoAddress;
		const account = { provider: 'google', type: 'oidc', providerAccountId: 'g-7' };
		const guard = await guardSignIn({ user: { id: 'u-blank', email: '' }, account, profile: { email: 'Proven.Owner@Example.test', email_verified: true } });
		expect(guard).toEqual({ allow: true, providerLinked: true, addressProven: true });
		await signIn('/dashboard/vault', 'US', { token: {}, user: { id: 'u-blank' }, account });
		expect(authUsers.get('u-blank')).toMatchObject({ email: 'proven.owner@example.test', last_login: NOW_ISO });
		expect(authUsers.get('u-blank').email_verified).toBeTruthy();
	});

	it('an address the provider did not verify is never written', async () => {
		authUsers.add({ id: 'u-blank2', email: '', email_verified: null, last_login: null });
		authUsers.extra = linkedToAnAccountWithNoAddress;
		const account = { provider: 'google', type: 'oidc', providerAccountId: 'g-8' };
		const guard = await guardSignIn({ user: { id: 'u-blank2', email: '' }, account, profile: { email: 'typed.by.anyone@example.test', email_verified: false } });
		expect(guard).toEqual({ allow: true, providerLinked: true, addressProven: false });
		await signIn('/dashboard/vault', 'US', { token: {}, user: { id: 'u-blank2' }, account });
		// The sign-in is recorded; the address is not.
		expect(authUsers.get('u-blank2')).toMatchObject({ email: '', email_verified: null, last_login: NOW_ISO });
	});

	it('an account that already has an address keeps it', async () => {
		authUsers.add({ id: 'u-has', email: 'kept@example.test', email_verified: null, last_login: null });
		authUsers.extra = linkedToAnAccountWithNoAddress;
		const account = { provider: 'google', type: 'oidc', providerAccountId: 'g-9' };
		await guardSignIn({ user: { id: 'u-has', email: '' }, account, profile: { email: 'other@example.test', email_verified: true } });
		await signIn('/dashboard/vault', 'US', { token: {}, user: { id: 'u-has' }, account });
		expect(authUsers.get('u-has').email).toBe('kept@example.test');
	});

	it('a sign-in the guard never saw (a password, an emailed link) writes no address', async () => {
		authUsers.add({ id: 'u-none', email: '', last_login: null });
		await signIn('/dashboard/vault', 'US', { token: {}, user: { id: 'u-none', email: 'claimed@example.test' }, account: { provider: 'credentials', type: 'credentials' } });
		expect(authUsers.get('u-none').email).toBe('');
		expect(authUsers.writes().some((sql) => sql.includes('SET email = ?'))).toBe(false);
	});
});

describe('where the stamp lives', () => {
	const route = read('src/pages/api/auth/[...auth].ts');
	const authRoute = read('src/lib/authRoute.ts');

	it('the signIn callback no longer writes last_login or an address: it runs before the account exists', () => {
		expect(route).not.toMatch(/UPDATE auth_users\s+SET last_login/);
		expect(route).not.toContain('last_login_service = ?');
		expect(route).not.toMatch(/email = CASE/);
		expect(route).not.toContain('getSignInContext');
	});

	it('the jwt callback fills a proven address, marks it verified, resolves the tenant, then records the sign-in', () => {
		const firstSignIn = authRoute.slice(authRoute.indexOf('if (user?.id) {'), authRoute.indexOf('} else if (token.sub) {'));
		const order = ['await fillProvenAddress(user.id, account);', 'await markProvenAddressVerified(user.id, account);', 'token.tenantId = await ensureTenantForUser(String(user.id));', 'await stampSignIn(String(user.id));']
			.map((line) => firstSignIn.indexOf(line));
		expect(order.every((at) => at > -1)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it('a refresh of a live session records no sign-in', async () => {
		authUsers.add({ id: 'u-live', email: 'live@example.test', email_verified: '2026-10-01 09:00:00', last_login: '2026-10-01T09:00:00.000Z' });
		authUsers.extra = (sql) =>
			sql.startsWith('SELECT u.email_verified, u.sessions_valid_after')
				? { rows: [{ email_verified: '2026-10-01 09:00:00', sessions_valid_after: null, has_password: false, has_account: true }], rowsAffected: 0 }
				: undefined;
		const token = await jwtCallback({ token: { sub: 'u-live', iat: 100, via: 'google', email: 'live@example.test', tenantId: 't-1' } });
		expect(token).toMatchObject({ sub: 'u-live' });
		expect(authUsers.get('u-live').last_login).toBe('2026-10-01T09:00:00.000Z');
	});
});
