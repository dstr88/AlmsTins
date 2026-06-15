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

	// ── Sanctions geo-block ───────────────────────────────────────────────────
	// Runs before everything else, for every route except static assets. The geo
	// stack is dynamically imported (kept out of the static graph) and the check
	// is FAIL-OPEN: any error lets the request through, so a geo/db outage can
	// never take the site — or the login page — offline.
	if (
		!pathname.startsWith('/_astro/') &&
		!pathname.startsWith('/assets/') &&
		pathname !== '/favicon.ico' &&
		pathname !== '/favicon.webp'
	) {
		try {
			const { getGeoblockResponse } = await import('./middleware/geoblock');
			const blocked = await getGeoblockResponse(context.request);
			if (blocked) return blocked;
		} catch (err) {
			console.error('[geoblock] check failed — allowing through (fail-open)', err);
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

	return appMiddleware(context, next);
});
