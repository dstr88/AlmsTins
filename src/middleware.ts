/**
 * Middleware entry point
 *
 * Auth/public paths short-circuit here with a pure next() before any app
 * logic is even imported. app.ts (and its dependencies like db.ts) are loaded
 * lazily via dynamic import, so a module-level throw in any dependency
 * (e.g. missing TURSO_DATABASE_URL) cannot crash the login route.
 *
 *   isPublicPath?  → next()                    (route handler only)
 *   else           → dynamic import(app.ts)()  (session, tenant, headers)
 */

import { defineMiddleware } from 'astro/middleware';
import { isPublicPath } from './middleware/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = new URL(context.request.url);

	// ── Origin lock + sanctions geo-block ─────────────────────────────────────
	// Run before everything else, for every route except static assets.
	const isStaticAsset =
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/assets/') ||
		pathname === '/favicon.ico' ||
		pathname === '/favicon.webp';

	if (!isStaticAsset) {
		// Origin lock (opt-in): when EDGE_SHARED_SECRET is set, every request must
		// carry the matching `x-almstins-edge` header. A Cloudflare Transform Rule
		// adds it; a request that hits the Render origin directly (bypassing
		// Cloudflare — and thus the trustworthy CF-Connecting-IP the geo-block relies
		// on) cannot forge it, so it is refused. OFF until the secret is set, so it
		// can never break a deploy before Cloudflare is configured.
		// NOTE: before enabling, confirm the Render health check is TCP (or add its
		// path to isStaticAsset above) — a health check that bypasses Cloudflare will
		// lack the header.
		const edgeSecret =
			(process.env as Record<string, string | undefined>).EDGE_SHARED_SECRET ??
			(import.meta.env.EDGE_SHARED_SECRET as string | undefined);
		if (edgeSecret && context.request.headers.get('x-almstins-edge') !== edgeSecret) {
			return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
		}

		// Sanctions geo-block — FAIL-CLOSED: if the check can't run, refuse rather
		// than serve an unverified request. The geo stack is dynamically imported
		// (kept out of the static graph).
		try {
			const { getGeoblockResponse } = await import('./middleware/geoblock');
			const blocked = await getGeoblockResponse(context.request);
			if (blocked) return blocked;
		} catch (err) {
			console.error('[geoblock] check failed — refusing (fail-closed)', err);
			try {
				const { geoblockedResponse } = await import('./middleware/geoblock');
				return geoblockedResponse();
			} catch {
				return new Response('Unavailable For Legal Reasons', {
					status: 451,
					headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
				});
			}
		}
	}

	// Auth + public paths: pure pass-through.
	// app.ts is never even imported — nothing it does can break login.
	if (isPublicPath(pathname)) {
		return next();
	}

	// Lazy import: if app.ts or any of its dependencies (db, tenants, …) throw
	// during module init, the error is caught here and we fall back to next()
	// rather than crashing the server process.
	let appMiddleware: typeof import('./middleware/app').onRequest;
	try {
		const mod = await import('./middleware/app');
		appMiddleware = mod.onRequest;
	} catch (err) {
		console.error('[middleware] failed to load app middleware — redirecting to /login', err);
		const loginUrl = new URL('/login', context.request.url);
		return Response.redirect(loginUrl.toString(), 302);
	}

	return appMiddleware(context, next) as Promise<Response>;
});
