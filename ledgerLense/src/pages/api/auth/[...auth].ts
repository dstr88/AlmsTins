import type { APIRoute } from 'astro';
import { Auth } from '@auth/core';
import Email from '@auth/core/providers/email';
import Credentials from '@auth/core/providers/credentials';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { db } from '../../../lib/db';
import { authAdapter } from '../../../lib/authAdapter';
import { verifyPassword } from '../../../lib/passwords';
import { getPostLoginRedirect } from '../../../lib/postLoginRedirect';
import { ensureTenantForUser, resolveActiveTenantId } from '../../../lib/tenants';

const providers = [];

if (import.meta.env.GOOGLE_ID && import.meta.env.GOOGLE_SECRET) {
	providers.push(
		Google({
			clientId: import.meta.env.GOOGLE_ID,
			clientSecret: import.meta.env.GOOGLE_SECRET,
		}),
	);
}

if (import.meta.env.GITHUB_ID && import.meta.env.GITHUB_SECRET) {
	providers.push(
		GitHub({
			clientId: import.meta.env.GITHUB_ID,
			clientSecret: import.meta.env.GITHUB_SECRET,
		}),
	);
}

if (import.meta.env.EMAIL_SERVER && import.meta.env.EMAIL_FROM) {
	providers.push(
		Email({
			server: import.meta.env.EMAIL_SERVER,
			from: import.meta.env.EMAIL_FROM,
		}),
	);
}

providers.push(
	Credentials({
		name: 'Credentials',
		credentials: {
			email: { label: 'Email', type: 'email' },
			password: { label: 'Password', type: 'password' },
		},
		async authorize(credentials) {
			const email = typeof credentials?.email === 'string' ? credentials.email.toLowerCase() : '';
			const password = typeof credentials?.password === 'string' ? credentials.password : '';
			if (!email || !password) {
				return null;
			}

			const userResult = await db.execute({
				sql: `SELECT u.id, u.name, u.email, c.password_hash
          FROM auth_users u
          JOIN auth_credentials c ON c.user_id = u.id
          WHERE u.email = ? LIMIT 1`,
				args: [email],
			});
			if (!userResult.rows.length) {
				return null;
			}
			const row = userResult.rows[0] as Record<string, any>;
			const ok = await verifyPassword(password, String(row.password_hash ?? ''));
			if (!ok) {
				return null;
			}

			return { id: String(row.id), name: row.name ?? null, email: row.email ?? null };
		},
	}),
);

const authConfig = {
	basePath: '/api/auth',
	providers,
	adapter: authAdapter(),
	secret: import.meta.env.AUTH_SECRET,
	trustHost: true,
	debug: import.meta.env.DEV,
	session: { strategy: 'jwt' },
	pages: {
		signIn: '/login',
	},
	callbacks: {
		async signIn({ user }) {
			if (user?.id) {
				try {
					await ensureTenantForUser(String(user.id));
				} catch (error) {
					console.error('[auth][signIn] ensureTenantForUser failed', {
						userId: String(user.id),
						email: user.email ?? null,
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
			}
			return true;
		},
		async jwt({ token, user }) {
			if (user?.id) {
				token.sub = String(user.id);
				token.tenantId = await ensureTenantForUser(String(user.id));
			} else if (!token.tenantId && token.sub) {
				token.tenantId = await resolveActiveTenantId(String(token.sub));
			}
			return token;
		},
		async session({ session, token }) {
			if (session.user && token.sub) {
				(session.user as Record<string, any>).id = String(token.sub);
			}
			(session as Record<string, any>).tenantId = token.tenantId ?? null;
			return session;
		},
		redirect({ url, baseUrl }) {
			const fallback = getPostLoginRedirect(null);
			if (url === baseUrl || url === `${baseUrl}/`) {
				return new URL(fallback, baseUrl).toString();
			}
			if (url.startsWith('/')) {
				return new URL(url, baseUrl).toString();
			}
			if (url.startsWith(baseUrl)) {
				return url;
			}
			return new URL(fallback, baseUrl).toString();
		},
	},
};

const ensureAbsoluteUrl = (request: Request) => {
	if (request.url.startsWith('http')) return request.url;
	const proto = request.headers.get('x-forwarded-proto') ?? 'http';
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
	return new URL(request.url, `${proto}://${host}`).toString();
};

const buildAuthRequest = (request: Request) => {
	const url = ensureAbsoluteUrl(request);
	const init: RequestInit = {
		method: request.method,
		headers: request.headers,
	};
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = request.body;
		(init as RequestInit & { duplex?: 'half' }).duplex = 'half';
	}
	return new Request(url, init);
};

const logAuthError = (request: Request, error: unknown) => {
	console.error('[auth] request failed', {
		method: request.method,
		url: ensureAbsoluteUrl(request),
		error: error instanceof Error ? error.message : String(error),
	});
};

export const GET: APIRoute = async ({ request }) => {
	try {
		return await Auth(buildAuthRequest(request), authConfig);
	} catch (error) {
		logAuthError(request, error);
		throw error;
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		return await Auth(buildAuthRequest(request), authConfig);
	} catch (error) {
		logAuthError(request, error);
		throw error;
	}
};
