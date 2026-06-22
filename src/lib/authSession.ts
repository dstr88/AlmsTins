import { getToken } from '@auth/core/jwt';

export type AuthSession = {
	user: {
		id: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	};
	tenantId?: string | null;
};

export async function getAuthSession(request: Request): Promise<AuthSession | null> {
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

			return {
				user: {
					id: String(token.sub),
					name: token.name ? String(token.name) : null,
					email: token.email ? String(token.email) : null,
					image: token.picture ? String(token.picture) : null,
				},
				tenantId: (token as Record<string, any>).tenantId ?? null,
			};
		} catch (error) {
			console.warn('[authSession] getToken failed', {
				cookieName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return null;
}
