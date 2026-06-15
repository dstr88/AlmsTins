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
		// Homepage — public marketing surface (merged with the login page 2026-06-15).
		pathname === '/' ||
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname === '/es' ||
		pathname === '/fr' ||
		// Trust & discovery pages — must be reachable without a session
		pathname === '/about' ||
		pathname === '/about/es' ||
		pathname === '/about/fr' ||
		pathname === '/security-and-privacy' ||
		pathname === '/security-and-privacy/es' ||
		pathname === '/security-and-privacy/fr' ||
		pathname === '/signup' ||
		pathname.startsWith('/signup/') ||
		// Credentials signup endpoint — must be reachable without a session
		pathname === '/api/signup' ||
		pathname === '/wallet' ||
		pathname.startsWith('/wallet/') ||
		pathname === '/wallet-checker' ||
		pathname.startsWith('/wallet-checker/') ||
		// All @auth/core routes — callbacks, CSRF, providers, sessions, etc.
		pathname === '/api/auth' ||
		pathname.startsWith('/api/auth/') ||
		// Logout — must be public so the session cookie can be cleared even when expired
		pathname === '/api/logout' ||
		// Demo mode — set/clear cookie without requiring an auth session
		pathname === '/api/demo/start' ||
		pathname === '/api/demo/end' ||
		// AaveAlisis — public liquidity dashboard (admin-linked but no auth wall)
		pathname === '/aave-alisis' ||
		// PetroTins standalone login page — must be reachable without a session
		pathname === '/petro-tins' ||
		// PetroTins demo — clears session cookie then starts demo, no auth needed
		pathname === '/petro-tins/demo' ||
		// PetroTins docs — public documentation page
		pathname === '/petro-tins/docs' ||
		// PetroTins legal pages — public Terms & Privacy
		pathname === '/petro-tins/terms' ||
		pathname === '/petro-tins/privacy' ||
		// Wallet + dApp safety checkers — public APIs backing the wallet-checker page
		pathname === '/api/wallet-check' ||
		pathname === '/api/dapp-check' ||
		// Static assets
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/assets/') ||
		pathname === '/favicon.ico'
	);
}
