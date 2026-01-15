import { AstroAuth } from '@auth/astro';
import Email from '@auth/core/providers/email';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { authAdapter } from '../../../lib/authAdapter';
import { getPostLoginRedirect } from '../../../lib/postLoginRedirect';

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
