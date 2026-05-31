import type { APIRoute, AstroCookies } from 'astro';

const COOKIE_NAMES = [
	'authjs.session-token',
	'__Secure-authjs.session-token',
	'__Host-authjs.session-token',
	'authjs.csrf-token',
	'__Host-authjs.csrf-token',
	'authjs.callback-url',
	'authjs.pkce.code_verifier',
	'authjs.state',
];

const clearAuthCookies = (cookies: AstroCookies) => {
	for (const name of COOKIE_NAMES) {
		cookies.delete(name, { path: '/' });
		cookies.delete(name, { path: '/', secure: true });
	}
};

export const POST: APIRoute = async ({ cookies, redirect }) => {
	clearAuthCookies(cookies);
	return redirect('/login', 303);
};

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
	clearAuthCookies(cookies);
	const next = new URL(request.url).searchParams.get('next');
	const destination = next && next.startsWith('/') ? next : '/login';
	return redirect(destination, 303);
};
