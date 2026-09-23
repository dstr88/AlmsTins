/**
 * Security headers. Import-free (no db, no env beyond NODE_ENV) so the public-path branch
 * of src/middleware.ts can use it without loading app.ts.
 *
 * applySecurityHeaders is moved here from app.ts, which imports it back. One deliberate change:
 * camera and geolocation are allowed for this origin (self) instead of nobody. The Verify
 * dashboard's QR scanner (getUserMedia) and the milestone attestation's geotag need them; with
 * camera=() the browser refused before ever asking. The browser still prompts the user, and no
 * embedded third party can use either. Microphone, payment and USB stay off.
 *
 * public helpers below add it to the financing pages and their /receivables aliases,
 * which skip app.ts because they are public paths.
 */
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

export function applySecurityHeaders(response: Response): Response {
	// Clone into a mutable response — Auth.js uses Response.redirect() which
	// produces immutable headers; calling .set() on those throws TypeError.
	const headers = new Headers(response.headers);
	headers.set('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set(
		'Permissions-Policy',
		'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
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

const FINANCING_PAGES = [
	'registry', 'desk', 'client', 'confirm', 'invite', 'offer', 'countersign', 'attest',
	'authenticate', 'runsheet', 'guide', 'changelog', 'thanks', 'cairn', 'cairn-attest',
] as const;
const FINANCING_VERIFY_PATHS = new Set<string>(FINANCING_PAGES.map((p) => `/verify/${p}`));

const strip = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

/** A financing page (old /verify/<name> or any /receivables/<name>), not the /receivables landing. */
function isFinancingPage(pathname: string): boolean {
	const p = strip(pathname);
	return FINANCING_VERIFY_PATHS.has(p) || p.startsWith('/receivables/');
}

/** Public pages that get the full security headers even though they skip app.ts. */
export function needsPublicHeaders(pathname: string): boolean {
	const p = strip(pathname);
	return (
		p === '/receivables' ||
		isFinancingPage(p) ||
		p === '/verify/login' ||
		p === '/verify/agent-keys'
	);
}

/**
 * applySecurityHeaders, plus for financing pages: never index them, and never send their
 * URL (which can carry a single-use token or a receivable ID) to another site. same-origin
 * rather than no-referrer, so same-origin POSTs keep a real Origin header.
 */
export function withPublicHeaders(response: Response, pathname: string): Response {
	const res = applySecurityHeaders(response);
	if (isFinancingPage(pathname)) {
		res.headers.set('Referrer-Policy', 'same-origin');
		res.headers.set('X-Robots-Tag', 'noindex, nofollow');
	}
	return res;
}
