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
	const authCookieName = cookieHeader.includes('__Host-authjs.session-token=')
		? '__Host-authjs.session-token'
		: secureCookie
			? '__Secure-authjs.session-token'
			: 'authjs.session-token';
	console.log('[authSession] env check', {
		hasSecret: Boolean(secret),
		secretLen: secret.length,
		authUrl,
		forwardedProto: request.headers.get('x-forwarded-proto'),
		authCookieName,
	});
	const token = await getToken({
		req: request,
		secret,
		secureCookie,
		cookieName: authCookieName,
		salt: authCookieName,
	});
	console.log('[authSession] token present', { ok: Boolean(token?.sub) });

	if (!token || !token.sub) {
		return null;
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
}
