/**
 * Send a failed form sign-in back to the page the form was on.
 *
 * Auth.js redirects every sign-in error to pages.signIn (/login), in English, whichever
 * page the form was posted from. The password and magic-link forms also live on /es, /fr,
 * /verify/login (and /petro-tins while PetroTins is public), so an error there would drop
 * the visitor on a different page, possibly in a different language. This rewrites such a
 * redirect's Location to the same-origin page named by the Referer (the site's
 * Referrer-Policy keeps the path on same-origin requests), keeping `error` and `code`. /verify/login and /receivables/login
 * (served as a rewrite of /verify/login, so the Referer names it) also keep a `next` that
 * passes safeNextPath. Anything else (no Referer, another page, another host) keeps the
 * Auth.js /login redirect, which still shows the message.
 */
import { safeNextPath } from './safeNext';
import type { SessionCutReason } from './sessionGate';
import { PETRO_TINS_PUBLIC } from './petroTinsFlag.mjs';

// /petro-tins only while PetroTins is public: while it is owner-only that page is a 404 to a
// signed-out visitor, so its sign-in errors fall back to /login.
const LOGIN_FORM_PAGES = new Set([
	'/es',
	'/fr',
	'/verify/login',
	'/receivables/login',
	...(PETRO_TINS_PUBLIC ? ['/petro-tins'] : []),
]);
const PAGES_KEEPING_NEXT = new Set(['/verify/login', '/receivables/login']);

/**
 * The sign-in page query that explains a cut session (see sessionGate), or '' when the
 * visitor just needs to sign in again (revoked, deleted user) and no message helps.
 */
export function cutSignInQuery(reason: SessionCutReason | null | undefined): string {
	if (reason === 'unverified_password') return 'error=CredentialsSignin&code=verify_required';
	if (reason === 'password_needs_provider') return 'error=CredentialsSignin&code=use_provider';
	return '';
}

/** The general sign-in page for a stored account language. */
export function loginPathForLang(lang: string | null | undefined): string {
	return lang === 'es' ? '/es' : lang === 'fr' ? '/fr' : '/login';
}

export function routeSignInError(request: Request, response: Response): Response {
	if (response.status < 300 || response.status >= 400) return response;
	const location = response.headers.get('Location');
	if (!location) return response;

	let target: URL;
	let from: URL;
	try {
		target = new URL(location);
		from = new URL(request.headers.get('referer') ?? '');
	} catch {
		return response;
	}
	if (target.pathname !== '/login' || !target.searchParams.get('error')) return response;
	if (from.host !== target.host) return response;

	const page = from.pathname.replace(/\/+$/, '');
	if (!LOGIN_FORM_PAGES.has(page)) return response;

	const dest = new URL(page, target.origin);
	dest.searchParams.set('error', target.searchParams.get('error') ?? '');
	const code = target.searchParams.get('code');
	if (code) dest.searchParams.set('code', code);
	if (PAGES_KEEPING_NEXT.has(page)) {
		const next = safeNextPath(from.searchParams.get('next'));
		if (next) dest.searchParams.set('next', next);
	}

	const headers = new Headers(response.headers);
	headers.set('Location', dest.toString());
	return new Response(null, { status: response.status, headers });
}
