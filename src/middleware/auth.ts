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
		// Astro internal asset + on-demand image-optimization endpoints — must be
		// public so optimized images render on public pages for logged-out visitors.
		pathname.startsWith('/_image') ||
		pathname.startsWith('/_astro/') ||
		pathname === '/es' ||
		pathname === '/fr' ||
		// Trust & discovery pages — must be reachable without a session
		pathname === '/about' ||
		pathname === '/about/es' ||
		pathname === '/about/fr' ||
		// Privacy Policy — public, crawlable canonical URL (same source as the footer modal)
		pathname === '/privacy' ||
		// Pricing — public marketing page (EN + /prices/es + /prices/fr)
		pathname === '/prices' ||
		pathname.startsWith('/prices/') ||
		// Changelog — public "What's new" page, linked from the login/marketing page
		pathname === '/changelog' ||
		pathname === '/signup' ||
		pathname.startsWith('/signup/') ||
		// Credentials signup endpoint — must be reachable without a session
		pathname === '/api/signup' ||
		pathname === '/wallet' ||
		pathname.startsWith('/wallet/') ||
		pathname === '/wallet-checker' ||
		pathname.startsWith('/wallet-checker/') ||
		// Almstins Verify — public merchant landing (canonical /verify; /verify/es, /verify/fr;
		// /marchand is the Francophone-Africa promo URL that redirects to /verify/fr)
		pathname === '/verify' ||
		pathname.startsWith('/verify/') ||
		pathname === '/marchand' ||
		// Artifacts — public static demos served from public/artifacts (e.g. /artifacts/demo)
		pathname === '/artifacts' ||
		pathname.startsWith('/artifacts/') ||
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
		pathname === '/api/petro-tins/demo' ||
		// PetroTins docs — public documentation page
		pathname === '/petro-tins/docs' ||
		// PetroTins legal pages — public Terms & Privacy
		pathname === '/petro-tins/terms' ||
		pathname === '/petro-tins/privacy' ||
		// Wallet + dApp safety checkers — public APIs backing the wallet-checker page
		pathname === '/api/wallet-check' ||
		pathname === '/api/dapp-check' ||
		// Verified-publisher lookup — public, login-free; address → publishing domain
		// (reads the global mirror, never exposes tenant_id/identity)
		pathname === '/api/verify/lookup' ||
		// Bitcoin-anchor endpoint — public; anchors a caller-supplied SHA-256 digest to
		// Bitcoin via OpenTimestamps (no key, no identity, no signing). Backs /artifacts/sandbox.
		pathname === '/api/verify/anchor' ||
		// Receivables financing-status check — public, login-free; receivable ID → its
		// financing status + claims (self-chosen labels only, never tenant_id/identity).
		// The write endpoints (/api/verify/receivables, …/claim) stay behind the auth gate.
		pathname === '/api/verify/receivables/lookup' ||
		// Buyer confirmation — public, login-free. The single-use token IS the capability:
		// the debtor being asked to confirm has no account and must never need one.
		pathname === '/api/verify/receivables/confirm' ||
		// Supplier counter-signature — same reasoning: the client confirming that a
		// lender's advance actually reached him need not hold an account to say so.
		pathname === '/api/verify/receivables/countersign' ||
		// The client confirming his own deal was recorded correctly — same reasoning again.
		pathname === '/api/verify/receivables/attest-record' ||
		// Onboarding-email unsubscribe — public one-click opt-out (token-based)
		pathname === '/api/email/unsubscribe' ||
		// Record-proof signing public key — published so anyone can verify a record proof
		pathname === '/.well-known/almstins-signing-key.json' ||
		// Public record verification — verify a proof bundle without an account
		pathname === '/verify-record' ||
		pathname === '/api/verify-record' ||
		// Deploy probe — public so the live commit SHA can be verified with one curl
		// (no session). Returns only RENDER_GIT_COMMIT/branch/engine, no secrets.
		pathname === '/api/version' ||
		// Machine endpoints — authenticated by their own secret/signature, not a
		// user session. They must skip the session gate (app.ts), which 401s any
		// /api/* without a logged-in user before the handler's own auth can run.
		// Cron handlers check x-cron-secret; the billing webhook verifies its
		// Stripe signature. (Regression since 2026-03-18 — crons + webhook were 401'd.)
		pathname.startsWith('/api/cron/') ||
		pathname === '/api/billing/webhook' ||
		// Static assets
		pathname.startsWith('/_astro/') ||
		pathname.startsWith('/assets/') ||
		pathname === '/favicon.ico'
	);
}
