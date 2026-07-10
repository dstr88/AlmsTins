/**
 * Application Middleware
 *
 * Handles security headers, session enforcement, tenant routing, and analytics.
 *
 * This middleware only receives requests for PROTECTED paths. Auth/public paths
 * are intercepted by src/middleware.ts before this file is ever called, so
 * changes here cannot break login under any circumstances.
 */

import 'dotenv/config';
import { defineMiddleware } from 'astro/middleware';
import { getAuthSession } from '../lib/authSession';
import { logEnvStatus } from '../lib/envStatus';
import { getTenantStateDetails } from '../lib/tenants';
import { db } from '../lib/db';
import { getCountryForIpHash } from '../lib/analytics/geoip';
import { hashWithSalt } from '../lib/analytics/hash';
import { getClientIp } from '../lib/analytics/ip';
import { extractWalletAddress, isDetailedAnalyticsRoute, normalizeRouteKey } from '../lib/analytics/routes';
import { isDemoRequest, DEMO_TENANT_ID, demoCookieClear } from '../lib/demo';
import { runWithDbContext } from '../lib/dbContext';

/**
 * Mutation endpoints that demo users are allowed to call.
 * Wallet add/delete/sync so visitors can explore with their own addresses.
 * Everything else (exchange imports, billing, tax, etc.) stays blocked.
 */
const DEMO_ALLOWED_MUTATION_PATTERNS: RegExp[] = [
	/^\/api\/wallets$/,                       // POST  — add on-chain or custom wallet
	/^\/api\/wallets\/[^/]+$/,                // DELETE — remove a wallet by id
	/^\/api\/wallets\/[^/]+\/sync$/,           // POST  — sync a single wallet
	/^\/api\/wallets\/value\/sync-all$/,       // POST  — sync all wallet values
	/^\/api\/wallets\/[^/]+\/token-basis$/,   // POST  — save manual cost basis / purchase date
	/^\/api\/lifecycle\/rebuild$/,             // POST  — rebuild FIFO after sync
	/^\/api\/demo\/cleanup$/,                  // POST  — wipe demo data on page leave
];

function isEnvProbe(pathname: string) {
	const p = pathname.toLowerCase();
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
		const TRADFI_HOSTS = new Set(['tradifitins.com', 'www.tradifitins.com']);
		const canonicalHost = (() => {
			// TradfiTins uses its own domain for redirects
			if (TRADFI_HOSTS.has(requestHost)) {
				return 'tradifitins.com';
			}
			// All other domains use AUTH_URL
			const authUrl = process.env.AUTH_URL ?? '';
			if (!authUrl) return requestHost;
			try {
				const normalized = /^https?:\/\//i.test(authUrl) ? authUrl : `https://${authUrl}`;
				return new URL(normalized).host;
			} catch {
				return requestHost;
			}
		})();

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
			const ip = getClientIp(request) ?? context.clientAddress ?? 'unknown';
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

		// TradfiTins secondary domain — enforce HTTPS and root redirect, then fall through to normal auth
		if (TRADFI_HOSTS.has(requestHost)) {
			if (!isDev && request.headers.get('x-forwarded-proto') === 'http') {
				return finish(new Response(null, { status: 301, headers: { Location: `https://tradifitins.com${url.pathname}${url.search}` } }));
			}
			if (pathname === '/' || pathname === '') {
				return finish(Response.redirect('https://tradifitins.com/petro-tins', 303));
			}
			// Fall through to normal auth middleware — login redirects will use almstins.com
		}

		if (!isDev && request.headers.get('x-forwarded-proto') === 'http') {
			return finish(
				new Response(null, {
					status: 301,
					headers: { Location: `https://${canonicalHost}${url.pathname}${url.search}` },
				}),
			);
		}

		// ── Auth session check (must happen before demo mode) ───────────────────
		// A signed-in user must never be routed into demo mode — their real
		// session takes priority over any lingering demo cookie.
		const session = await getAuthSession(request);
		const userId = session?.user?.id ? String(session.user.id) : '';
		// A signed-in user must never carry the demo cookie. Clear any lingering one
		// (e.g. from an earlier "Try the demo") so a later expired session drops to
		// /login, never silently back into demo mode.
		const clearDemoCookie = Boolean(userId) && isDemoRequest(request);

			// Per-request RLS context: the Postgres web role is constrained to this
			// tenant's rows via app.tenant_id (set transaction-locally by the db shim).
			// Inert until WEB_DATABASE_URL exists. Background tasks spawned in the
			// handler inherit this context via AsyncLocalStorage.
			const proceedWith = async (tenantId: string | null) => {
				const res = applySecurityHeaders(await runWithDbContext({ tenantId, userId: userId || null }, () => next()));
				if (clearDemoCookie) res.headers.append('Set-Cookie', demoCookieClear());
				return finish(res);
			};

			// Admin pages are a cross-tenant "god view" (platform-owner only, guarded by
			// requireAdminSession inside the handler). They must bypass RLS — run with NO
			// tenant context so the shim uses the owner pool — otherwise RLS filters every
			// count/list to the admin's own tenant (e.g. "1 tenant" instead of all).
			const isAdminPath = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');

		// ── Demo mode ───────────────────────────────────────────────────────────
		// Visitors with the demo cookie bypass the auth check entirely.
		// Wallet add/delete/sync mutations are allowed so visitors can explore
		// with their own addresses. All other mutations remain blocked.
		// Skipped entirely when a real auth session exists.
		if (!userId && isDemoRequest(request)) {
			// Internal/admin/debug/dev endpoints must NEVER be reachable via the demo
			// cookie. The demo bypass exists so visitors can explore the product with
			// the demo tenant — not to open the internal API surface (analytics,
			// debug probes, dev tools) to anyone who fetches /api/demo/start. Let these
			// fall through to the standard unauthenticated 401 below.
			const isSensitiveApi =
				pathname.startsWith('/api/debug') ||
				pathname.startsWith('/api/dev') ||
				pathname.startsWith('/api/admin') ||
				pathname === '/api/analytics.json';
			if (!isSensitiveApi) {
				const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
				if (isMutation && pathname.startsWith('/api/')) {
					const isDemoAllowed = DEMO_ALLOWED_MUTATION_PATTERNS.some((re) => re.test(pathname));
					if (!isDemoAllowed) {
						return finish(
							applySecurityHeaders(
								new Response(
									JSON.stringify({
										error: 'Sign up free to unlock all features.',
										demo: true,
									}),
									{ status: 403, headers: { 'Content-Type': 'application/json' } },
								),
							),
						);
					}
				}
				// Let the route handler render with the demo tenant.
				return proceedWith(DEMO_TENANT_ID);
			}
		}
		// ── End demo mode ────────────────────────────────────────────────────────
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
			// PetroTins dashboard → PetroTins login page
			if (pathname.startsWith('/dashboard/petro-tins')) {
				return finish(Response.redirect(`https://${canonicalHost}/petro-tins`, 303));
			}
			// Preserve the intended destination so sign-in returns there (login.astro
			// sanitizes `next` to an internal path). Otherwise everyone lands on the
			// default /dashboard/vault — e.g. a Verify visitor never reaches their dashboard.
			// No `error=` param: a signed-out visitor isn't an error, just needs to sign in
			// (an "error=missing" in the URL reads as "broken" to a new customer).
			const next = encodeURIComponent(pathname);
			return finish(Response.redirect(`https://${canonicalHost}/login?next=${next}`, 303));
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
				return finish(Response.redirect(`https://${canonicalHost}/dashboard/vault`, 303));
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
			return proceedWith(isAdminPath ? null : (tenantState.activeTenantId ?? null));
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
				return finish(Response.redirect(`https://${canonicalHost}/onboarding/tenant-setup`, 303));
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
		return proceedWith(isAdminPath ? null : (tenantState.activeTenantId ?? null));
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

function applySecurityHeaders(response: Response): Response {
	// Clone into a mutable response — Auth.js uses Response.redirect() which
	// produces immutable headers; calling .set() on those throws TypeError.
	const headers = new Headers(response.headers);
	headers.set('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
	);
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	if (process.env.NODE_ENV === 'production') {
		headers.set('Strict-Transport-Security', 'max-age=86400; includeSubDomains');
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
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
				ms_max = CASE WHEN excluded.ms_max > request_agg_daily.ms_max THEN excluded.ms_max ELSE request_agg_daily.ms_max END
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
