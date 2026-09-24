/**
 * Middleware entry point
 *
 * Auth/public paths short-circuit here with a pure next() before any app
 * logic is even imported. app.ts (and its dependencies like db.ts) are loaded
 * lazily via dynamic import, so a module-level throw in any dependency
 * (e.g. missing TURSO_DATABASE_URL) cannot crash the login route.
 *
 *   PetroTins path, not the owner? → Astro's 404 page, as for a path that does not exist
 *                                    (petroTinsAccess; owner-only while private)
 *   /receivables/<name>? → rewrite to its /verify page (legacyRedirects, alias phase)
 *   isPublicPath?  → next()                    (route handler only)
 *   else           → dynamic import(app.ts)()  (session, tenant, headers)
 *
 * Every 404 leaves no-store and noindex; the owner's PetroTins responses leave private.
 */

import { defineMiddleware } from 'astro/middleware';
import type { APIContext, MiddlewareNext } from 'astro';
import { isPublicPath } from './middleware/auth';
import { routeLegacy } from './middleware/legacyRedirects';
import {
	applySecurityHeaders,
	needsPublicHeaders,
	withNotFoundHeaders,
	withPublicHeaders,
} from './middleware/securityHeaders';
import {
	petroTinsGate,
	petroTinsRefusal,
	withPetroTinsOwnerHeaders,
	withoutRerouteMarker,
} from './lib/petroTinsAccess';

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

	// PetroTins is owner-only while PETRO_TINS_PUBLIC is false (src/lib/petroTinsFlag.mjs).
	// Checked before the legacy rewrites, the public-path pass-through and app.ts, so nothing
	// can bypass it. Anyone but the owner gets what a path that does not exist gets, and the
	// PetroTins page or endpoint never runs: the first pass answers a bodiless 404, and Astro
	// then renders its 404 page for the same request, running this middleware again
	// ('not-found-page'). A viewer with a session or the demo cookie goes through app.ts on both
	// passes like any unknown path (same redirects, demo write block, headers); a signed-out
	// visitor skips it, so never gets a sign-in redirect. The session is only resolved for
	// PetroTins paths.
	const petro = await petroTinsGate(context.request, pathname, context.routePattern);
	let res: Response;
	if (petro.kind === 'hidden') {
		const refuse = async () => petroTinsRefusal(context.request, petro.hasSession);
		res = petro.hasSession ? await runApp(context, refuse) : applySecurityHeaders(await refuse());
	} else if (petro.kind === 'not-found-page') {
		res = petro.hasSession ? await runApp(context, next) : applySecurityHeaders(await next());
		res = withoutRerouteMarker(res);
	} else {
		res = await route(context, next, pathname);
	}

	if (res.status === 404) res = withNotFoundHeaders(res);
	if (petro.kind === 'owner') res = withPetroTinsOwnerHeaders(res);
	return res;
});

async function route(context: APIContext, next: MiddlewareNext, pathname: string): Promise<Response> {
	// Financing pages moving to /receivables (pure; exact paths only; query kept verbatim).
	const legacy = routeLegacy(new URL(context.request.url));
	if (legacy?.kind === 'respond') return legacy.response;
	if (legacy?.kind === 'rewrite') return withPublicHeaders(await next(legacy.to), pathname);

	// Auth + public paths: pure pass-through.
	// app.ts is never even imported — nothing it does can break login.
	if (isPublicPath(pathname)) {
		const res = await next();
		return needsPublicHeaders(pathname) ? withPublicHeaders(res, pathname) : res;
	}

	return runApp(context, next);
}

async function runApp(context: APIContext, next: MiddlewareNext): Promise<Response> {
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

	return (await appMiddleware(context, next)) as Response;
}
