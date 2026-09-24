import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * The request-level guards in front of Auth.js and the jwt callback (src/lib/authRoute.ts),
 * plus getAuthSessionState, the session gate's enforcement point for every tenant route.
 * Pinned here:
 *   - the action is parsed the way @auth/core parses it, so '//' and a trailing slash can't
 *     dodge a guard (cross-checked against Auth.js's own parser);
 *   - a cut session's cookie never reaches a callback (where Auth.js would link a provider
 *     account to it), on any path spelling; 'session' and 'signout' still see it;
 *   - the password and magic-link brakes count every spelling of their path, and an IPv6
 *     client by its /64;
 *   - getAuthSessionState: a cut user gets no session and a cut reason; a Google user and a
 *     provider-minted session on a mixed account pass;
 *   - jwtCallback stamps `via` at sign-in and returns null (clears the cookie) for a cut
 *     session on refresh.
 */
const mem = vi.hoisted(() => ({
	users: new Map<string, Record<string, any>>(),
	token: null as Record<string, any> | null,
	verifiedUpdates: [] as any[][],
}));

vi.mock('@auth/core/jwt', () => ({ getToken: async () => mem.token }));
vi.mock('@/lib/tenants', () => ({
	ensureTenantForUser: async (id: string) => `tenant-of-${id}`,
	resolveActiveTenantId: async (id: string) => `tenant-of-${id}`,
}));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			return { rows: [{ column_name: 'sessions_valid_after' }, { column_name: 'alert_email' }], rowsAffected: 0 };
		}
		if (sql.startsWith('SELECT u.email_verified, u.sessions_valid_after, EXISTS (SELECT 1 FROM auth_credentials c')) {
			const u = mem.users.get(String(args[0]));
			return { rows: u ? [u] : [], rowsAffected: 0 };
		}
		if (sql.startsWith("UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND email = ?")) {
			mem.verifiedUpdates.push(args);
			return { rows: [], rowsAffected: 1 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { parseAuthAction, callbackHeaders, rateLimitedRedirect, jwtCallback, __resetAuthRouteLimitsForTests } from '../../src/lib/authRoute';
import { getAuthSessionState } from '../../src/lib/authSession';
import { __resetSessionGateForTests } from '../../src/lib/sessionGate';
// Auth.js's own parser, to prove we agree with it. It is internal (not in the package's
// exports or its public types), so it is loaded by file path.
type AuthJsParse = (pathname: string, base: string) => { action: string; providerId?: string };
const AUTH_JS_WEB_UTILS = '../../node_modules/@auth/core/lib/utils/web.js';
let parseActionAndProviderId: AuthJsParse;
beforeAll(async () => {
	({ parseActionAndProviderId } = await import(/* @vite-ignore */ AUTH_JS_WEB_UTILS));
});

const PW_ONLY = { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false };
const GOOGLE = { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true };
const MIXED = { email_verified: null, sessions_valid_after: null, has_password: true, has_account: true };

beforeEach(() => {
	mem.users.clear();
	mem.users.set('u-pw', PW_ONLY);
	mem.users.set('u-google', GOOGLE);
	mem.users.set('u-mixed', MIXED);
	mem.token = null;
	mem.verifiedUpdates = [];
	__resetSessionGateForTests();
	__resetAuthRouteLimitsForTests();
	process.env.AUTH_SECRET = 'test-secret-at-least-16-chars';
	delete process.env.AUTH_URL;
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('parseAuthAction agrees with @auth/core', () => {
	const paths = [
		'/api/auth/callback/github',
		'/api/auth//callback/github',
		'/api/auth/callback//github',
		'/api/auth/callback/github/',
		'/api/auth///callback/credentials//',
		'/api/auth/signin/email',
		'/api/auth//signin/email/',
		'/api/auth/session',
		'/api/auth/signout/',
		'/api/auth/csrf',
	];
	for (const p of paths) {
		it(p, () => {
			const ours = parseAuthAction(p);
			const theirs = parseActionAndProviderId(p, '/api/auth');
			expect(ours).toEqual({ action: theirs.action, providerId: theirs.providerId ?? null });
		});
	}

	it('is null for paths Auth.js would reject for their shape', () => {
		expect(parseAuthAction('/api/auth')).toBeNull();
		expect(parseAuthAction('/api/auth/')).toBeNull();
		expect(parseAuthAction('/api/auth/a/b/c')).toBeNull();
		expect(parseAuthAction('/api/authx/callback')).toBeNull();
		expect(parseAuthAction('/other')).toBeNull();
	});
});

const authReq = (path: string, cookie = 'authjs.session-token=tok; almstins-lang=es', init: RequestInit = {}) =>
	new Request(`http://localhost:4321${path}`, { ...init, headers: { cookie, ...(init.headers as Record<string, string> | undefined) } });

describe('callbackHeaders: a cut session never reaches a callback', () => {
	it('strips the cut session cookie on every spelling of a callback path', async () => {
		mem.token = { sub: 'u-pw', iat: 100 };
		for (const p of ['/api/auth/callback/github', '/api/auth//callback/github', '/api/auth/callback/github/', '/api/auth/callback//google']) {
			const h = await callbackHeaders(authReq(p));
			expect(h.get('cookie')).toBe('almstins-lang=es');
		}
		// Nothing else left: the header goes away entirely.
		expect((await callbackHeaders(authReq('/api/auth//callback/github', 'authjs.session-token=tok'))).get('cookie')).toBeNull();
	});

	it("keeps it for 'session' (which clears it) and 'signout' (which deletes it)", async () => {
		mem.token = { sub: 'u-pw', iat: 100 };
		expect((await callbackHeaders(authReq('/api/auth/session'))).get('cookie')).toContain('authjs.session-token=tok');
		expect((await callbackHeaders(authReq('/api/auth//signout/'))).get('cookie')).toContain('authjs.session-token=tok');
	});

	it('keeps a session that is not cut', async () => {
		mem.token = { sub: 'u-google', iat: 100 };
		expect((await callbackHeaders(authReq('/api/auth//callback/github'))).get('cookie')).toContain('authjs.session-token=tok');
	});

	it('does not look at the session when there is no session cookie', async () => {
		const getState = vi.fn();
		const r = authReq('/api/auth/callback/github', 'almstins-lang=es');
		expect(await callbackHeaders(r, getState)).toBe(r.headers);
		expect(getState).not.toHaveBeenCalled();
	});
});

const post = (path: string, ip: string) =>
	new Request(`https://almstins.com${path}`, { method: 'POST', headers: { 'cf-connecting-ip': ip, referer: 'https://almstins.com/login' } });

describe('rateLimitedRedirect', () => {
	it('password posts: 20 per 15 minutes per client, whatever the path spelling', async () => {
		const spellings = ['/api/auth/callback/credentials', '/api/auth/callback/credentials/', '/api/auth//callback/credentials', '/api/auth/callback//credentials/'];
		for (let i = 0; i < 20; i++) expect(rateLimitedRedirect(post(spellings[i % 4], '203.0.113.9'))).toBeNull();
		const res = rateLimitedRedirect(post('/api/auth//callback/credentials/', '203.0.113.9'))!;
		expect(res.status).toBe(302);
		const loc = new URL(res.headers.get('Location')!);
		expect(loc.pathname).toBe('/login');
		expect(loc.searchParams.get('error')).toBe('CredentialsSignin');
		expect(loc.searchParams.get('code')).toBe('rate_limited');
		expect(rateLimitedRedirect(post('/api/auth/callback/credentials', '203.0.113.10'))).toBeNull();
	});

	it('magic-link requests: 10 per hour per client, and an IPv6 client by its /64', async () => {
		for (let i = 0; i < 10; i++) expect(rateLimitedRedirect(post(i % 2 ? '/api/auth//signin/email/' : '/api/auth/signin/email', `2001:db8:5:6::${i + 1}`))).toBeNull();
		const res = rateLimitedRedirect(post('/api/auth/signin/email/', '2001:db8:5:6:ffff::1'))!;
		expect(new URL(res.headers.get('Location')!).searchParams.get('error')).toBe('rate_limited');
		expect(rateLimitedRedirect(post('/api/auth/signin/email', '2001:db8:5:7::1'))).toBeNull();
	});

	it('ignores every other auth path', () => {
		for (let i = 0; i < 30; i++) {
			expect(rateLimitedRedirect(post('/api/auth/signin/google', '203.0.113.11'))).toBeNull();
			expect(rateLimitedRedirect(post('/api/auth/callback/github', '203.0.113.11'))).toBeNull();
		}
	});
});

describe('getAuthSessionState (the gate for every tenant route)', () => {
	const page = () => new Request('http://localhost:4321/dashboard/vault', { headers: { cookie: 'authjs.session-token=tok' } });

	it('a password-only unverified user: no session, cut reason, and who was cut', async () => {
		mem.token = { sub: 'u-pw', iat: 100, email: 'x@company.dev' };
		expect(await getAuthSessionState(page())).toEqual({ session: null, cutReason: 'unverified_password', cutUserId: 'u-pw' });
	});

	it('a Google user with NULL email_verified passes', async () => {
		mem.token = { sub: 'u-google', iat: 100, email: 'g@company.dev', tenantId: 't-g', via: 'google' };
		const s = await getAuthSessionState(page());
		expect(s.cutReason).toBeNull();
		expect(s.session?.user.id).toBe('u-google');
		expect(s.session?.tenantId).toBe('t-g');
	});

	it('a mixed account: a Google-minted session passes, a password or pre-`via` one is cut', async () => {
		mem.token = { sub: 'u-mixed', iat: 100, via: 'google' };
		expect((await getAuthSessionState(page())).session?.user.id).toBe('u-mixed');
		mem.token = { sub: 'u-mixed', iat: 100 };
		expect((await getAuthSessionState(page())).cutReason).toBe('password_needs_provider');
		mem.token = { sub: 'u-mixed', iat: 100, via: 'credentials' };
		expect((await getAuthSessionState(page())).cutReason).toBe('password_needs_provider');
	});

	it('a deleted user is cut; no token means signed out, not cut', async () => {
		mem.token = { sub: 'u-gone', iat: 100 };
		expect((await getAuthSessionState(page())).cutReason).toBe('missing_user');
		mem.token = null;
		expect(await getAuthSessionState(page())).toEqual({ session: null, cutReason: null });
	});
});

describe('jwtCallback', () => {
	it('first sign-in stamps how the session was minted and resolves the tenant', async () => {
		const pw = await jwtCallback({ token: {}, user: { id: 'u-verified', email: 'v@company.dev' }, account: { provider: 'credentials', type: 'credentials' } });
		expect(pw).toMatchObject({ sub: 'u-verified', email: 'v@company.dev', via: 'credentials', tenantId: 'tenant-of-u-verified' });
		const g = await jwtCallback({ token: {}, user: { id: 'u-google' }, account: { provider: 'google', type: 'oidc' } });
		expect(g).toMatchObject({ via: 'google' });
	});

	it('refresh: a cut session returns null (Auth.js clears the cookie); an honored one is kept', async () => {
		expect(await jwtCallback({ token: { sub: 'u-pw', iat: 100 } })).toBeNull();
		expect(await jwtCallback({ token: { sub: 'u-mixed', iat: 100 } })).toBeNull();
		const kept = await jwtCallback({ token: { sub: 'u-mixed', iat: 100, via: 'github', email: 'm@company.dev' } });
		expect(kept).toMatchObject({ sub: 'u-mixed', via: 'github', tenantId: 'tenant-of-u-mixed' });
	});
});
