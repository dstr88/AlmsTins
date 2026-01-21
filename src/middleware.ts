import { defineMiddleware } from 'astro/middleware';
import { getAuthSession } from './lib/authSession';
import { logEnvStatus } from './lib/envStatus';

const PUBLIC_PATHS = [
	'/healthz',
	'/login',
	'/signup',
	'/api/signup',
	'/api/login',
	'/api/auth',
	'/favicon',
	'/assets',
	'/node_modules',
	'/_astro',
	'/public',
];
const DEV_OPEN_API_PATHS = ['/api/debug-snapshots', '/api/networth'];

const DEV_BYPASS_PATHS = new Set([
	'/api/wallets/sync-all',
	'/api/wallets/value/sync-all',
	'/api/networth/summary',
	'/api/market/aave-key-prices',
]);

const SYNC_PATHS = new Set(['/api/sync/defi']);

export const onRequest = defineMiddleware(async (context, next) => {
	logEnvStatus();
	const url = new URL(context.request.url);
	const path = url.pathname;
	const hostFlag = '__ledgerlense_auth_host_logged__';
	const globalAny = globalThis as typeof globalThis & { [hostFlag]?: boolean };
	if (!globalAny[hostFlag]) {
		globalAny[hostFlag] = true;
		const requestHost = context.request.headers.get('x-forwarded-host') ?? url.host;
		const authUrl = import.meta.env.AUTH_URL ?? '';
		let authUrlHost = 'missing';
		try {
			authUrlHost = authUrl ? new URL(authUrl).host : 'missing';
		} catch {
			authUrlHost = 'invalid';
		}
		const matches = authUrlHost !== 'missing' && authUrlHost !== 'invalid' && requestHost === authUrlHost;
		console.log('[env] auth_url_host_match', { requestHost, authUrlHost, matches });
	}
	if (path === '/api/auth' || path.startsWith('/api/auth/')) {
		return next();
	}
	if (path.startsWith('/.well-known/acme-challenge/')) {
		return next();
	}
	if (!import.meta.env.DEV && context.request.headers.get('x-forwarded-proto') === 'http') {
		return new Response(null, {
			status: 301,
			headers: { Location: `https://${url.host}${url.pathname}${url.search}` },
		});
	}
	const DEV = import.meta.env.DEV;
	const LOCAL_BYPASS = import.meta.env.PUBLIC_LOCAL_DEV_NO_AUTH === 'true';

	console.log('[middleware] path =', path, 'DEV =', DEV, 'LOCAL_BYPASS =', LOCAL_BYPASS);

	// 1) Astro dev server: always bypass
	if (DEV) {
		console.log('[middleware] rule=DEV_BYPASS path=', path);
		return applySecurityHeaders(await next());
	}

	// 2) Built Node server in local dev: explicit bypass
	if (LOCAL_BYPASS) {
		console.log('[middleware] rule=LOCAL_BYPASS path=', path);
		return applySecurityHeaders(await next());
	}

	const syncToken = import.meta.env.SYNC_TOKEN;
	const headerToken = context.request.headers.get('x-sync-token');
	if (SYNC_PATHS.has(path) && syncToken && headerToken === syncToken) {
		console.log('[middleware] rule=SYNC_TOKEN_OK path=', path);
		return applySecurityHeaders(await next());
	}

	const { request, url: ctxUrl } = context;
	const pathname = ctxUrl.pathname;

	if (pathname === '/') {
		console.log('[middleware] rule=ROOT_REDIRECT path=', path);
		return Response.redirect(new URL('/login', request.url), 303);
	}

	if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
		console.log('[middleware] rule=PUBLIC path=', path);
		return applySecurityHeaders(await next());
	}

	if (import.meta.env.AUTH_DISABLED === 'true') {
		console.log('[middleware] rule=AUTH_DISABLED path=', path);
		return applySecurityHeaders(await next());
	}

	const session = await getAuthSession(request);
	if (session) {
		console.log('[middleware] rule=SESSION_OK path=', path);
		return applySecurityHeaders(await next());
	}

	if (pathname.startsWith('/api/')) {
		console.log('[middleware] rule=API_UNAUTHORIZED path=', path);
		return applySecurityHeaders(new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		}));
	}

	const acceptsHTML = request.headers.get('accept')?.includes('text/html');
	if (acceptsHTML) {
		console.log('[middleware] rule=REDIRECT_LOGIN path=', path);
		return Response.redirect(new URL(`/login?error=missing`, request.url), 303);
	}

	console.log('[middleware] rule=UNAUTHORIZED path=', path);
	return applySecurityHeaders(new Response('Unauthorized', { status: 401 }));
});

const CSP_REPORT_ONLY = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"img-src 'self' data: blob: https://images.unsplash.com",
	"connect-src 'self'",
	"font-src 'self' data: https://fonts.gstatic.com",
	"script-src 'self'",
	'upgrade-insecure-requests',
].join('; ');

function applySecurityHeaders(response: Response) {
	response.headers.set('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
	);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	if (!import.meta.env.DEV) {
		response.headers.set('Strict-Transport-Security', 'max-age=86400; includeSubDomains');
	}
	return response;
}
