/**
 * Auth path registry
 *
 * ⚠️  INTENTIONALLY MINIMAL — do not add business logic here.
 *
 * isPublicPath() is the single source of truth for which paths bypass app
 * logic entirely. It is imported by src/middleware.ts, which routes auth/public
 * requests directly to the route handler — app.ts never runs for these paths.
 *
 * Rules:
 *  - Auth callback routes (/api/auth/*) must NEVER be gated or redirected.
 *  - Public pages (login, signup, wallet) must be reachable without a session.
 *  - Static assets must always pass through.
 *
 * To add a new public path: add it here. Do NOT add session checks, redirects,
 * DB calls, or env-var reads to this file.
 */

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
