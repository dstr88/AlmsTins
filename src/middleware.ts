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
	'/api/market/coinpaprika-prices',
	'/api/market/coingecko-prices',
	'/api/market/coingecko-prices-by-id',
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

function isEnvProbe(pathname: string) {
	const p = pathname.toLowerCase();
	// catch segment '/.env' anywhere, or ends with '.env', or has '.env.' (env.local etc)
	return p.includes('/.env') || p.endsWith('.env') || p.includes('.env.');
}

function isWordpressProbe(pathname: string) {
	const p = pathname.toLowerCase();
	return (
		p.startsWith('/wp-admin') ||
		p.startsWith('/wp-login.php') ||
		p.startsWith('/wordpress/wp-admin') ||
		p.startsWith('/xmlrpc.php')
	);
}

export const onRequest = defineMiddleware(async (context, next) => {
	const isDev = process.env.NODE_ENV !== 'production';
	const buildLogFlag = '__ledgerlense_build_logged__';
	const globalAny = globalThis as typeof globalThis & { [buildLogFlag]?: boolean };
	if (!globalAny[buildLogFlag]) {
		globalAny[buildLogFlag] = true;
		console.log('[build]', { BUILD_SHA: process.env.BUILD_SHA ?? 'missing' });
		console.log('[perf] instrumentation enabled');
	}

	logEnvStatus();
	const url = new URL(context.request.url);
	const path = url.pathname;
	const requestHost = context.request.headers.get('x-forwarded-host') ?? url.host;
	const canonicalHost = (() => {
		const authUrl = process.env.AUTH_URL ?? '';
		if (!authUrl) return 'almstins.com';
		try {
			const normalized = /^https?:\/\//i.test(authUrl) ? authUrl : `https://${authUrl}`;
			return new URL(normalized).host;
		} catch {
			return 'almstins.com';
		}
	})();
	if (!isDev && requestHost !== canonicalHost) {
		const redirectUrl = new URL(url.toString());
		redirectUrl.protocol = 'https:';
		redirectUrl.host = canonicalHost;
		return new Response(null, {
			status: 308,
			headers: { Location: redirectUrl.toString() },
		});
	}

	const hostFlag = '__ledgerlense_auth_host_logged__';
	const globalHostAny = globalThis as typeof globalThis & { [hostFlag]?: boolean };
	if (!globalHostAny[hostFlag]) {
		globalHostAny[hostFlag] = true;
		const authUrl = process.env.AUTH_URL ?? '';
		let authUrlHost = 'missing';
		let authUrlNormalized = authUrl;
		try {
			if (authUrl && !/^https?:\/\//i.test(authUrl)) {
				authUrlNormalized = `https://${authUrl}`;
			}
			authUrlHost = authUrlNormalized ? new URL(authUrlNormalized).host : 'missing';
		} catch {
			authUrlHost = 'invalid';
		}
		const matches = authUrlHost !== 'missing' && authUrlHost !== 'invalid' && requestHost === authUrlHost;
		console.log('[env] auth_url_host_match', {
			requestHost,
			authUrlHost,
			authUrlNormalized,
			matches,
		});
	}
	const requestId =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	(context.locals as Record<string, unknown>).requestId = requestId;
	if (
		path === '/api/market/coinpaprika-prices' ||
		path === '/api/market/coingecko-prices' ||
		path === '/api/aave/health' ||
		path === '/api/networth/summary' ||
		(path.startsWith('/api/wallets/') && (path.endsWith('/holdings') || path.endsWith('/nfts')))
	) {
		console.log('[req]', { requestId, path });
	}
	if (!isDev && isEnvProbe(path)) {
		console.log('[security] blocked env probe', { requestId, path });
		return applySecurityHeaders(
			new Response('Not Found', {
				status: 404,
				headers: { 'Cache-Control': 'no-store' },
			}),
		);
	}
	if (isWordpressProbe(path)) {
		const ip = context.request.headers.get('x-forwarded-for') ?? context.clientAddress ?? 'unknown';
		const ua = context.request.headers.get('user-agent') ?? 'unknown';
		console.log('[probe-blocked] path=%s ip=%s ua=%s', path, ip, ua);
		return applySecurityHeaders(
			new Response('Not Found', {
				status: 404,
				headers: { 'Cache-Control': 'no-store' },
			}),
		);
	}
	if (path === '/api/auth' || path.startsWith('/api/auth/')) {
		return next();
	}
	if (path.startsWith('/.well-known/acme-challenge/')) {
		return next();
	}
	if (!isDev && context.request.headers.get('x-forwarded-proto') === 'http') {
		return new Response(null, {
			status: 301,
			headers: { Location: `https://${url.host}${url.pathname}${url.search}` },
		});
	}
	const DEV = isDev;
	const LOCAL_BYPASS = process.env.PUBLIC_LOCAL_DEV_NO_AUTH === 'true';

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

	const syncToken = process.env.SYNC_TOKEN;
	const headerToken = context.request.headers.get('x-sync-token');
	if (SYNC_PATHS.has(path) && syncToken && headerToken === syncToken) {
		console.log('[middleware] rule=SYNC_TOKEN_OK path=', path);
		return applySecurityHeaders(await next());
	}

	const { request, url: ctxUrl } = context;
	const pathname = ctxUrl.pathname;
	if (pathname === '/api/import/crypto-com' || pathname === '/api/exchanges/crypto-com/accounts/update') {
		const cookie = request.headers.get('cookie') ?? '';
		const host = request.headers.get('host');
		const forwardedHost = request.headers.get('x-forwarded-host');
		const forwardedProto = request.headers.get('x-forwarded-proto');
		console.log('[middleware][crypto-com] cookie-check', {
			path: pathname,
			cookieLen: cookie.length,
			hasAuthJsSecureSession: cookie.includes('__Secure-authjs.session-token='),
			hasAuthJsSession: cookie.includes('authjs.session-token='),
			hasNextAuthSession: cookie.includes('next-auth.session-token='),
			hasCsrfToken: cookie.includes('csrf-token'),
			hasCallbackUrl: cookie.includes('callback-url'),
			host,
			forwardedHost,
			forwardedProto,
		});
		try {
			const session = await getAuthSession(request);
			console.log('[middleware][crypto-com] session-check', {
				ok: !!session,
				userId: session?.user?.id ?? null,
			});
		} catch (error) {
			console.log('[middleware][crypto-com] session-check error', error);
		}
	}

	if (pathname === '/') {
		console.log('[middleware] rule=ROOT_REDIRECT path=', path);
		return Response.redirect(new URL('/login', request.url), 303);
	}

	if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
		console.log('[middleware] rule=PUBLIC path=', path);
		return applySecurityHeaders(await next());
	}

	if (process.env.AUTH_DISABLED === 'true') {
		console.log('[middleware] rule=AUTH_DISABLED path=', path);
		return applySecurityHeaders(await next());
	}

	const session = await getAuthSession(request);
	if (session?.user?.id) {
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
	if (process.env.NODE_ENV === 'production') {
		response.headers.set('Strict-Transport-Security', 'max-age=86400; includeSubDomains');
	}
	return response;
}
