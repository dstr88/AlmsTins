import type { APIRoute, AstroCookies } from 'astro';
import { safeNextPath } from '@/lib/safeNext';

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

// Where to land after signing out: a same-origin path from `next`, else the sign-in page.
// No /api remap here: logout legitimately hops to /api/demo/start.
const landing = (next: unknown) => safeNextPath(next) ?? '/login';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
	clearAuthCookies(cookies);
	// LogoutButton.astro posts `next` as a form field. Any other caller sends no readable form
	// body and lands on the sign-in page.
	let next: FormDataEntryValue | null = null;
	try {
		next = (await request.formData()).get('next');
	} catch { /* no form body */ }
	return redirect(landing(next), 303);
};

// Kept for links that already exist (old bookmarks, cached pages). Nothing in the app links here.
export const GET: APIRoute = async ({ request, cookies, redirect }) => {
	clearAuthCookies(cookies);
	return redirect(landing(new URL(request.url).searchParams.get('next')), 303);
};
