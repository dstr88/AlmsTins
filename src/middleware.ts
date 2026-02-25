import { defineMiddleware } from 'astro/middleware';
import { getAuthSession } from './lib/authSession';
import { logEnvStatus } from './lib/envStatus';
import { getTenantStateDetails } from './lib/tenants';
import { db } from './lib/db';
import { getCountryForIpHash } from './lib/analytics/geoip';
import { hashWithSalt } from './lib/analytics/hash';
import { getClientIp } from './lib/analytics/ip';
import { extractWalletAddress, isDetailedAnalyticsRoute, normalizeRouteKey } from './lib/analytics/routes';

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

function isPublicPath(pathname: string) {
	return (
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname === '/signup' ||
		pathname.startsWith('/signup/') ||
		pathname === '/wallet' ||
		pathname.startsWith('/wallet/') ||
		pathname === '/api/auth' ||
		pathname.startsWith('/api/auth/') ||
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/assets/') ||
		pathname === '/favicon.ico'
	);
}

export const onRequest = defineMiddleware(async (context, next) => {
	const startedAt = Date.now();
	let finalResponse: Response | null = null;
	const finish = (response: Response) => {
		finalResponse = response;
		return response;
	};

	try {
		const isDev = process.env.NODE_ENV !== 'production';
		const request = context.request;
		const url = new URL(request.url);
		const pathname = url.pathname;

		const buildLogFlag = '__ledgerlense_build_logged__';
		const globalAny = globalThis as typeof globalThis & { [buildLogFlag]?: boolean };
		if (!globalAny[buildLogFlag]) {
			globalAny[buildLogFlag] = true;
			console.log('[build]', { BUILD_SHA: process.env.BUILD_SHA ?? 'missing' });
			console.log('[perf] instrumentation enabled');
		}

		logEnvStatus();
		const requestHost = request.headers.get('x-forwarded-host') ?? url.host;
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
			return finish(
				new Response(null, {
					status: 308,
					headers: { Location: redirectUrl.toString() },
				}),
			);
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

		if (!isDev && isEnvProbe(pathname)) {
			console.log('[security] blocked env probe', { requestId, path: pathname });
			return finish(
				applySecurityHeaders(
					new Response('Not Found', {
						status: 404,
						headers: { 'Cache-Control': 'no-store' },
					}),
				),
			);
		}
		if (isWordpressProbe(pathname)) {
			const ip = request.headers.get('x-forwarded-for') ?? context.clientAddress ?? 'unknown';
			const ua = request.headers.get('user-agent') ?? 'unknown';
			console.log('[probe-blocked] path=%s ip=%s ua=%s', pathname, ip, ua);
			return finish(
				applySecurityHeaders(
					new Response('Not Found', {
						status: 404,
						headers: { 'Cache-Control': 'no-store' },
					}),
				),
			);
		}

		if (!isDev && request.headers.get('x-forwarded-proto') === 'http') {
			return finish(
				new Response(null, {
					status: 301,
					headers: { Location: `https://${url.host}${url.pathname}${url.search}` },
				}),
			);
		}

		if (pathname === '/') {
			return finish(Response.redirect(new URL('/login', request.url), 303));
		}

		if (isPublicPath(pathname)) {
			return finish(applySecurityHeaders(await next()));
		}

		const session = await getAuthSession(request);
	const userId = session?.user?.id ? String(session.user.id) : '';
		if (!userId) {
			if (pathname.startsWith('/api/')) {
				return finish(
					applySecurityHeaders(
						new Response(JSON.stringify({ error: 'Unauthorized' }), {
							status: 401,
							headers: { 'Content-Type': 'application/json' },
						}),
					),
				);
			}
			return finish(Response.redirect(new URL('/login?error=missing', request.url), 303));
		}

		const tenantState = await getTenantStateDetails(userId);
		let redirectDecision = 'allow';

		if (pathname.startsWith('/onboarding/')) {
			if (tenantState.onboardingComplete) {
				redirectDecision = 'redirect_dashboard';
				console.log('[tenant-route]', {
					userId,
					activeTenantId: tenantState.activeTenantId,
					hasTenant: tenantState.hasTenant,
					onboardingComplete: tenantState.onboardingComplete,
					pathname,
					redirectDecision,
				});
				return finish(Response.redirect(new URL('/dashboard/vault', request.url), 303));
			}
			redirectDecision = 'allow_onboarding';
			console.log('[tenant-route]', {
				userId,
				activeTenantId: tenantState.activeTenantId,
				hasTenant: tenantState.hasTenant,
				onboardingComplete: tenantState.onboardingComplete,
				pathname,
				redirectDecision,
			});
			return finish(applySecurityHeaders(await next()));
		}

		if (pathname.startsWith('/dashboard/')) {
			if (!tenantState.onboardingComplete) {
				redirectDecision = 'redirect_onboarding';
				console.log('[tenant-route]', {
					userId,
					activeTenantId: tenantState.activeTenantId,
					hasTenant: tenantState.hasTenant,
					onboardingComplete: tenantState.onboardingComplete,
					pathname,
					redirectDecision,
				});
				return finish(Response.redirect(new URL('/onboarding/tenant-setup', request.url), 303));
			}
			redirectDecision = 'allow_dashboard';
		}

		console.log('[tenant-route]', {
			userId,
			activeTenantId: tenantState.activeTenantId,
			hasTenant: tenantState.hasTenant,
			onboardingComplete: tenantState.onboardingComplete,
			pathname,
			redirectDecision,
		});
		return finish(applySecurityHeaders(await next()));
	} finally {
		if (finalResponse) {
			await writeRequestAnalyticsBestEffort(context.request, finalResponse, startedAt);
		}
	}
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

async function writeRequestAnalyticsBestEffort(request: Request, response: Response, startedAt: number) {
	try {
		await writeRequestAnalytics(request, response, startedAt);
	} catch (error) {
		console.warn('[analytics] write failed', error instanceof Error ? error.message : String(error));
	}
}

async function writeRequestAnalytics(request: Request, response: Response, startedAt: number) {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const routeKey = normalizeRouteKey(pathname);
	const method = request.method.toUpperCase();
	const status = response.status;
	const ms = Math.max(0, Date.now() - startedAt);
	const ts = new Date().toISOString();
	const day = ts.slice(0, 10);

	const ipRaw = getClientIp(request);
	const ipHash = hashWithSalt(ipRaw ?? 'no-ip');
	const uaHash = hashWithSalt(request.headers.get('user-agent') ?? 'no-ua');
	const geo = await getCountryForIpHash(ipHash, ipRaw);
	const countryCode = geo.countryCode;

	await db.execute({
		sql: `
			INSERT INTO request_agg_daily (
				day, route_key, method, status, country_code, count, ms_total, ms_max
			) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
			ON CONFLICT(day, route_key, method, status, country_code) DO UPDATE SET
				count = request_agg_daily.count + 1,
				ms_total = request_agg_daily.ms_total + excluded.ms_total,
				ms_max = MAX(request_agg_daily.ms_max, excluded.ms_max)
		`,
		args: [day, routeKey, method, status, countryCode, ms, ms],
	});

	if (!isDetailedAnalyticsRoute(routeKey)) {
		return;
	}

	await db.execute({
		sql: `
			INSERT INTO request_log (
				ts, route, route_key, method, status, ms, ip_hash, ua_hash, country_code, wallet_address, cache_hit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		args: [
			ts,
			pathname,
			routeKey,
			method,
			status,
			ms,
			ipHash,
			uaHash,
			countryCode,
			extractWalletAddress(pathname),
			geo.cacheHit ? 1 : 0,
		],
	});
}
