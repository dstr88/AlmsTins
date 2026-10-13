import { getToken } from '@auth/core/jwt';
import type { SessionCutReason } from './sessionGate';

export type AuthSession = {
	user: {
		id: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	};
	tenantId?: string | null;
};

export type AuthSessionState = {
	session: AuthSession | null;
	/** Set when a valid token was presented but the session gate refused it (see sessionGate). */
	cutReason: SessionCutReason | null;
	/** The refused token's subject, when cutReason is set (to localize the sign-in page). */
	cutUserId?: string | null;
};

// Dynamic import: this module must not pull db.ts into the static graph (the public and
// login paths in src/middleware.ts never import it, and db.ts throws at import without
// DATABASE_URL). FAIL-OPEN: if the gate can't load, can't reach the database or the
// database is slow, the session is honored; see sessionGate for why.
async function sessionCutReason(userId: string, iat: unknown, via: unknown): Promise<SessionCutReason | null> {
	try {
		const { checkSessionCut } = await import('./sessionGate');
		return await checkSessionCut(userId, iat, via);
	} catch (error) {
		console.warn('[authSession] session gate unavailable; honoring the session (fail-open)', {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

const SESSION_COOKIE_RE = /^(?:__Host-|__Secure-)?authjs\.session-token(?:\.\d+)?=/;

/** A Cookie header with every Auth.js session cookie (and chunk) removed; '' if nothing is left. */
export function withoutSessionCookies(cookieHeader: string): string {
	return cookieHeader
		.split(';')
		.map((c) => c.trim())
		.filter((c) => c && !SESSION_COOKIE_RE.test(c))
		.join('; ');
}

export async function getAuthSession(request: Request): Promise<AuthSession | null> {
	return (await getAuthSessionState(request)).session;
}

/** The session, plus why it was refused when a valid token was presented but cut. */
export async function getAuthSessionState(request: Request): Promise<AuthSessionState> {
	const authUrl = process.env.AUTH_URL ?? '';
	const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
	const secureCookie = authUrl.startsWith('https://') || forwardedProto === 'https';
	const secret = process.env.AUTH_SECRET ?? '';
	const cookieHeader = request.headers.get('cookie') ?? '';

	const cookieCandidates = [
		'__Host-authjs.session-token',
		'__Secure-authjs.session-token',
		'authjs.session-token',
	].filter((name) => {
		if (cookieHeader.includes(`${name}=`)) return true;
		if (name === '__Secure-authjs.session-token' && secureCookie) return true;
		if (name === 'authjs.session-token' && !secureCookie) return true;
		return false;
	});

	if (cookieCandidates.length === 0) {
		cookieCandidates.push(secureCookie ? '__Secure-authjs.session-token' : 'authjs.session-token');
	}

	const authDebug = (import.meta.env.AUTH_DEBUG ?? process.env.AUTH_DEBUG) === '1';
	if (authDebug) {
		console.log('[authSession] env check', {
			hasSecret: Boolean(secret),
			secretLen: secret.length,
			authUrl,
			forwardedProto: request.headers.get('x-forwarded-proto'),
			cookieCandidates,
		});
	}

	for (const cookieName of cookieCandidates) {
		try {
			const token = await getToken({
				req: request,
				secret,
				secureCookie: cookieName !== 'authjs.session-token',
				cookieName,
				salt: cookieName,
			});
			if (authDebug) console.log('[authSession] token present', { ok: Boolean(token?.sub), cookieName });
			if (!token || !token.sub) {
				continue;
			}

			// A signed, unexpired token can still be one that must no longer be honored
			// (an unverified password session, a revoked one, a deleted user).
			const cutReason = await sessionCutReason(String(token.sub), token.iat, (token as Record<string, unknown>).via);
			if (cutReason) {
				if (authDebug) console.log('[authSession] session cut', { cutReason, cookieName });
				return { session: null, cutReason, cutUserId: String(token.sub) };
			}

			return {
				session: {
					user: {
						id: String(token.sub),
						name: token.name ? String(token.name) : null,
						email: token.email ? String(token.email) : null,
						image: token.picture ? String(token.picture) : null,
					},
					tenantId: (token as Record<string, any>).tenantId ?? null,
				},
				cutReason: null,
			};
		} catch (error) {
			console.warn('[authSession] getToken failed', {
				cookieName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { session: null, cutReason: null };
}
