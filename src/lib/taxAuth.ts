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

/** Returns true if the request carries a valid tax_session cookie */
export function hasTaxAccess(request: Request): boolean {
	const secret = getSecret();
	if (!secret) return false;                    // env var not set → deny all

	const cookieHeader = request.headers.get('cookie') ?? '';
	const match = cookieHeader.match(
		new RegExp(`(?:^|;)\\s*${TAX_COOKIE}=([^;]+)`)
	);
	if (!match) return false;

	const provided = match[1];
	const expected = expectedTaxToken();
	if (!expected) return false;

	// Constant-time compare — both are 64-char hex strings
	if (provided.length !== expected.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
	} catch {
		return false;
	}
}

/** Set-Cookie header value to grant access (30 days) */
export function grantCookie(token: string): string {
	return `${TAX_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`;
}

/** Set-Cookie header value to revoke access */
export function revokeCookie(): string {
	return `${TAX_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
