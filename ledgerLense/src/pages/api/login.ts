import type { APIRoute } from 'astro';
import { generateSessionToken, SESSION_COOKIE_NAME } from '../../lib/auth';

const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	const passphrase = import.meta.env.DASHBOARD_PASS;
	if (!passphrase) {
		return new Response('Dashboard passphrase is not configured.', { status: 500 });
	}

	const formData = await request.formData();
	const candidate = formData.get('passphrase');
	if (typeof candidate !== 'string' || candidate.length === 0) {
		return redirect('/login?error=missing');
	}

	if (candidate !== passphrase) {
		return redirect('/login?error=invalid');
	}

	const token = generateSessionToken(passphrase);
	cookies.set(SESSION_COOKIE_NAME, token, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		path: '/',
		maxAge: COOKIE_TTL_SECONDS,
		sameSite: 'lax',
	});

	return redirect('/');
};
