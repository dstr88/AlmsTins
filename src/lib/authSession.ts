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
	const authUrl = import.meta.env.AUTH_URL ?? '';
	const forwardedProto = request.headers.get('x-forwarded-proto') ?? '';
	const secureCookie = authUrl.startsWith('https://') || forwardedProto === 'https';
	const salt = import.meta.env.AUTH_SALT ?? import.meta.env.AUTH_SECRET;
	const token = await getToken({
		req: request,
		secret: import.meta.env.AUTH_SECRET,
		secureCookie,
		salt,
	});

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
