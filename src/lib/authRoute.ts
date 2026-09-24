/**
 * Request-level guards and the jwt callback for the Auth.js route
 * (src/pages/api/auth/[...auth].ts), kept here so they can be tested without Auth.js.
 *
 * Every path decision parses the action the way @auth/core does (parseActionAndProviderId:
 * the pathname after basePath, split on '/', empty segments dropped). A substring or
 * endsWith test on the raw path is not enough: Astro routes /api/auth//callback/github and
 * /api/auth/callback/credentials/ to the same handler, and Auth.js reads both as the plain
 * action, so a raw-path test would miss them.
 */
import { db } from './db';
import { ensureTenantForUser, resolveActiveTenantId } from './tenants';
import { checkSessionCut } from './sessionGate';
import { markProvenAddressVerified } from './authLinkGuard';
import { getAuthSessionState, withoutSessionCookies, type AuthSessionState } from './authSession';
import { routeSignInError } from './authErrorRedirect';
import { clientIpKey, createFixedWindowLimiter } from './rateLimit';

export const AUTH_BASE_PATH = '/api/auth';

/** The Auth.js action and provider id for a pathname under /api/auth, or null. */
export function parseAuthAction(pathname: string): { action: string; providerId: string | null } | null {
	if (!pathname.startsWith(AUTH_BASE_PATH)) return null;
	const rest = pathname.slice(AUTH_BASE_PATH.length);
	if (rest && !rest.startsWith('/')) return null;
	const segments = rest.split('/').filter(Boolean);
	if (segments.length < 1 || segments.length > 2) return null;
	return { action: segments[0], providerId: segments[1] ?? null };
}

// Actions that may see a cut session's cookie: 'session' clears it (the jwt callback
// returns null for a cut session) and 'signout' deletes it. Nothing else needs it.
const ACTIONS_KEEPING_A_CUT_SESSION = new Set(['session', 'signout']);

/**
 * The headers to forward to Auth.js. On a callback, Auth.js links a new Google/GitHub
 * account to whoever the request's session cookie says is signed in. A cut session (see
 * sessionGate) must not be able to do that: it would let the holder of an unverified
 * password, or of a session revoked when the owner took the address back, attach their own
 * Google/GitHub account and walk straight back in. So a cut session's cookies are dropped
 * on every action except 'session' and 'signout' (including paths that don't parse, which
 * Auth.js rejects anyway).
 */
export async function callbackHeaders(
	request: Request,
	getState: (r: Request) => Promise<AuthSessionState> = getAuthSessionState,
): Promise<Headers> {
	const cookie = request.headers.get('cookie') ?? '';
	if (!cookie.includes('authjs.session-token')) return request.headers;
	const parsed = parseAuthAction(new URL(request.url).pathname);
	if (parsed && ACTIONS_KEEPING_A_CUT_SESSION.has(parsed.action)) return request.headers;
	const { cutReason } = await getState(request);
	if (!cutReason) return request.headers;
	const headers = new Headers(request.headers);
	const kept = withoutSessionCookies(cookie);
	if (kept) headers.set('cookie', kept);
	else headers.delete('cookie');
	return headers;
}

/** Public origin for sign-in redirects: AUTH_URL when set (behind Render's proxy the request origin is localhost). */
export function loginOrigin(request: Request): string {
	const authUrl = process.env.AUTH_URL ?? '';
	if (authUrl) return /^https?:\/\//i.test(authUrl) ? authUrl.replace(/\/$/, '') : `https://${authUrl}`;
	return new URL(request.url).origin;
}

// Per-client brakes on the two unauthenticated form posts that cost something: the password
// callback (password spraying) and the magic-link request (it emails any address typed in;
// authLinkGuard also throttles it per address). Keyed per IP, an IPv6 client by its /64.
const credentialsLimiter = createFixedWindowLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const emailLinkLimiter = createFixedWindowLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

/** A redirect to the sign-in page when this POST is over its per-client limit, else null. */
export function rateLimitedRedirect(request: Request, now = Date.now()): Response | null {
	const parsed = parseAuthAction(new URL(request.url).pathname);
	const isCredentials = parsed?.action === 'callback' && parsed.providerId === 'credentials';
	const isEmailLink = parsed?.action === 'signin' && parsed.providerId === 'email';
	if (!isCredentials && !isEmailLink) return null;
	const key = clientIpKey(request);
	const limited = isCredentials ? credentialsLimiter.hit(key, now) : emailLinkLimiter.hit(key, now);
	if (!limited) return null;
	const params = isCredentials ? 'error=CredentialsSignin&code=rate_limited' : 'error=rate_limited';
	return routeSignInError(request, Response.redirect(`${loginOrigin(request)}/login?${params}`, 302));
}

type JwtParams = { token: Record<string, any>; user?: Record<string, any> | null; account?: Record<string, any> | null };

/**
 * The Auth.js jwt callback.
 *   - First sign-in (user present): carry the user's fields, record how the session was
 *     minted (`via`, the provider id: the session gate needs it to tell a password session
 *     from a Google/GitHub one on the same account), mark a just-created row's address
 *     verified when the sign-in proved it, and resolve the tenant.
 *   - Refresh (GET /api/auth/session re-signs the token with a fresh iat): re-check the
 *     session gate first, or a cut session (unverified password, revoked, deleted user)
 *     could launder itself into a new token. null clears the cookie. Fail-open on a
 *     database error, like getAuthSession (see sessionGate).
 */
export async function jwtCallback({ token, user, account }: JwtParams): Promise<Record<string, any> | null> {
	if (user?.id) {
		token.sub = String(user.id);
		// Explicitly carry fields: Auth.js defaults are unreliable with a custom adapter +
		// JWT strategy combination.
		if (user.email) token.email = String(user.email);
		if (user.name) token.name = String(user.name);
		if (user.image) token.picture = String(user.image);
		token.via = String(account?.provider ?? '');
		await markProvenAddressVerified(user.id, account);
		token.tenantId = await ensureTenantForUser(String(user.id));
	} else if (token.sub) {
		if (await checkSessionCut(String(token.sub), token.iat, token.via)) {
			return null;
		}
		if (!token.tenantId) {
			token.tenantId = await resolveActiveTenantId(String(token.sub));
		}
		// Backfill email from DB on every refresh so sessions issued before explicit
		// email-setting still pick it up without requiring re-login.
		if (!token.email) {
			try {
				const row = await db.execute({
					sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1',
					args: [String(token.sub)],
				});
				const email = row.rows[0] ? String((row.rows[0] as Record<string, any>).email ?? '') : '';
				if (email) token.email = email;
			} catch { /* non-fatal */ }
		}
	}
	return token;
}

/** Test hook: clear the per-client limiters. */
export function __resetAuthRouteLimitsForTests(): void {
	credentialsLimiter.reset();
	emailLinkLimiter.reset();
}
