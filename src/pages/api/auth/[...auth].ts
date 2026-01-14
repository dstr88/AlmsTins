import { AstroAuth } from '@auth/astro';
import Email from '@auth/core/providers/email';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { authAdapter } from '../../../lib/authAdapter';
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

export const { GET, POST } = AstroAuth({
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
				await ensureTenantForUser(String(user.id));
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
});
