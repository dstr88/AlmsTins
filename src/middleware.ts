import { defineMiddleware } from 'astro/middleware';
import { isAuthDisabled, isValidSession, SESSION_COOKIE_NAME } from './lib/auth';

const AUTH_API_PREFIX = '/api/auth';
const PUBLIC_ROUTES = new Set(['/login', '/favicon.ico']);
const PUBLIC_PREFIXES = ['/_astro/', '/assets/'];

export const onRequest = defineMiddleware(async (context, next) => {
	const url = new URL(context.request.url);
	const path = url.pathname;
	console.log('[middleware] path =', path);

	// 1) Auth endpoints bypass immediately (no cookie/header mutation).
	if (path === AUTH_API_PREFIX || path.startsWith(`${AUTH_API_PREFIX}/`)) {
		console.log('[middleware] rule=AUTH_API_BYPASS path=', path);
		return next();
	}

	// 2) Public routes/static assets.
	if (
		PUBLIC_ROUTES.has(path) ||
		path.startsWith('/login/') ||
		PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))
	) {
		console.log('[middleware] rule=PUBLIC path=', path);
		return next();
	}

	if (isAuthDisabled()) {
		console.log('[middleware] rule=AUTH_NOT_CONFIGURED path=', path);
		return new Response('Authentication is not configured.', { status: 503 });
	}

	const { request, cookies, url: ctxUrl } = context;
	const pathname = ctxUrl.pathname;

	const token = cookies.get(SESSION_COOKIE_NAME)?.value;
	if (isValidSession(token)) {
		console.log('[middleware] rule=SESSION_OK path=', path);
		return next();
	}

	if (pathname.startsWith('/api/')) {
		console.log('[middleware] rule=UNAUTHORIZED_API path=', path);
		return new Response('Unauthorized', { status: 401 });
	}

	const acceptsHTML = request.headers.get('accept')?.includes('text/html');
	if (acceptsHTML) {
		const loginUrl = new URL('/login', request.url);
		loginUrl.searchParams.set('next', `${pathname}${ctxUrl.search}`);
		loginUrl.searchParams.set('error', 'missing');
		console.log('[middleware] rule=REDIRECT_LOGIN path=', path);
		return Response.redirect(loginUrl, 303);
	}

	console.log('[middleware] rule=UNAUTHORIZED path=', path);
	return new Response('Unauthorized', { status: 401 });
});
