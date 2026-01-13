import { defineMiddleware } from 'astro/middleware';
import { isValidSession, SESSION_COOKIE_NAME } from './lib/auth';

const PUBLIC_PATHS = ['/login', '/api/login', '/favicon', '/assets', '/node_modules', '/_astro', '/public'];
const DEV_OPEN_API_PATHS = ['/api/debug-snapshots', '/api/networth'];

const DEV_BYPASS_PATHS = new Set([
	'/api/wallets/sync-all',
	'/api/wallets/value/sync-all',
	'/api/networth/summary',
	'/api/market/aave-key-prices',
]);

const SYNC_PATHS = new Set(['/api/sync/defi']);

export const onRequest = defineMiddleware(async (context, next) => {
	const url = new URL(context.request.url);
	const path = url.pathname;
	if (path.startsWith('/.well-known/acme-challenge/')) {
		return next();
	}
	const DEV = import.meta.env.DEV;
	const LOCAL_BYPASS = import.meta.env.PUBLIC_LOCAL_DEV_NO_AUTH === 'true';

	console.log('[middleware] path =', path, 'DEV =', DEV, 'LOCAL_BYPASS =', LOCAL_BYPASS);

	// 1) Astro dev server: always bypass
	if (DEV) {
		console.log('[middleware] rule=DEV_BYPASS path=', path);
		return next();
	}

	// 2) Built Node server in local dev: explicit bypass
	if (LOCAL_BYPASS) {
		console.log('[middleware] rule=LOCAL_BYPASS path=', path);
		return next();
	}

	const syncToken = import.meta.env.SYNC_TOKEN;
	const headerToken = context.request.headers.get('x-sync-token');
	if (SYNC_PATHS.has(path) && syncToken && headerToken === syncToken) {
		console.log('[middleware] rule=SYNC_TOKEN_OK path=', path);
		return next();
	}

	const { request, cookies, url: ctxUrl } = context;
	const pathname = ctxUrl.pathname;

	if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
		console.log('[middleware] rule=PUBLIC path=', path);
		return next();
	}

	const token = cookies.get(SESSION_COOKIE_NAME)?.value;
	if (isValidSession(token)) {
		console.log('[middleware] rule=SESSION_OK path=', path);
		return next();
	}

	const acceptsHTML = request.headers.get('accept')?.includes('text/html');
	if (acceptsHTML) {
		console.log('[middleware] rule=REDIRECT_LOGIN path=', path);
		return Response.redirect(new URL(`/login?error=missing`, request.url), 303);
	}

	console.log('[middleware] rule=UNAUTHORIZED path=', path);
	return new Response('Unauthorized', { status: 401 });
});
