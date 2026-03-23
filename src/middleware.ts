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
		console.error('[middleware] failed to load app middleware — falling back to next()', err);
		return next();
	}

	return appMiddleware(context, next);
});
