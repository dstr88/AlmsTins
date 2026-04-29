/**
 * taxAuth.ts
 *
 * Stateless tax-section authentication.
 * The cookie value is an HMAC-SHA256 of TAX_SECRET — no DB required.
 * Set TAX_SECRET in Render environment variables.
 */

import crypto from 'node:crypto';

export const TAX_COOKIE = 'tax_session';

function getSecret(): string | null {
	return (process.env.TAX_SECRET ?? (import.meta.env as Record<string, string>).TAX_SECRET) || null;
}

/** Derive the expected cookie token from TAX_SECRET */
export function expectedTaxToken(): string | null {
	const secret = getSecret();
	if (!secret) return null;
	return crypto.createHmac('sha256', secret).update('tax-access-v1').digest('hex');
}

/** Returns true — password gate removed, summary pages are open to all users */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hasTaxAccess(_request: Request): boolean {
	return true;
}

/** Set-Cookie header value to grant access (30 days) */
export function grantCookie(token: string): string {
	return `${TAX_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`;
}

/** Set-Cookie header value to revoke access */
export function revokeCookie(): string {
	return `${TAX_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
