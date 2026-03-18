/**
 * Auth Guard Middleware
 *
 * ⚠️  INTENTIONALLY MINIMAL — do not add business logic here.
 *
 * This is the first middleware in the sequence. Its only job is to let
 * auth/public routes through immediately so they can never be broken by
 * changes to the application logic layer (src/middleware/app.ts).
 *
 * Rules:
 *  - Auth callback routes (/api/auth/*) must NEVER be gated or redirected.
 *  - Public pages (login, signup, wallet) must be reachable without a session.
 *  - Static assets must always pass through.
 *
 * If you need to add a new public path, add it to isPublicPath() below.
 * Do NOT add session checks, redirects, DB calls, or env-var reads here.
 */

import { defineMiddleware } from 'astro/middleware';

export function isPublicPath(pathname: string): boolean {
	return (
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname === '/signup' ||
		pathname.startsWith('/signup/') ||
		pathname === '/wallet' ||
		pathname.startsWith('/wallet/') ||
		// All @auth/core routes — callbacks, CSRF, providers, sessions, etc.
		pathname === '/api/auth' ||
		pathname.startsWith('/api/auth/') ||
		// Static assets
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/assets/') ||
		pathname === '/favicon.ico'
	);
}

export const onRequest = defineMiddleware(async (_context, next) => {
	// Auth guard is intentionally a pass-through.
	// Its value is in isPublicPath() being a shared, clearly-owned definition
	// that app.ts imports — so there's only one source of truth.
	return next();
});
