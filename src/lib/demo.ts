/**
 * demo.ts — Demo mode constants and helpers
 *
 * A visitor who clicks "Try Demo" gets a signed cookie (almstins-demo=1)
 * that makes the entire dashboard render with the pre-seeded demo tenant.
 * No auth session required.  All write operations are blocked at middleware.
 */

export const DEMO_TENANT_ID = 'demo-00000000000000000000000000000001';
export const DEMO_COOKIE_NAME = 'almstins-demo';
export const DEMO_COOKIE_VALUE = '1';

/** Returns true when the request carries the demo session cookie. */
export function isDemoRequest(request: Request): boolean {
	const cookie = request.headers.get('cookie') ?? '';
	return cookie.split(';').some(
		(c) => c.trim() === `${DEMO_COOKIE_NAME}=${DEMO_COOKIE_VALUE}`,
	);
}

/** Set-Cookie header value that starts a demo session (1 hour). */
export function demoCookieSet(): string {
	return `${DEMO_COOKIE_NAME}=${DEMO_COOKIE_VALUE}; Path=/; SameSite=Lax; Max-Age=3600`;
}

/** Set-Cookie header value that clears the demo session. */
export function demoCookieClear(): string {
	return `${DEMO_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}
