/**
 * taxAuth.ts
 *
 * Stateless tax-section authentication.
 * The cookie value is an HMAC-SHA256 of TAX_SECRET — no DB required.
 * Set TAX_SECRET in Render environment variables.
 */

import crypto from 'node:crypto';
import { requireTenantSession } from './requireTenantSession';
import { OWNER_TENANT_ID } from './owner';

export const TAX_COOKIE = 'tax_session';

/**
 * Tenants allowed into the tax section (yearEnd/* + /year-summary).
 * Restricted to the owner while those pages are not yet demo-ready /
 * de-gamified — keeps them out of the public demo and out of the
 * professional-impression path.
 */
const ALLOWED_TAX_TENANTS = new Set<string>([
	OWNER_TENANT_ID,
]);

function getSecret(): string | null {
	return (process.env.TAX_SECRET ?? (import.meta.env as Record<string, string>).TAX_SECRET) || null;
}

/** Derive the expected cookie token from TAX_SECRET */
export function expectedTaxToken(): string | null {
	const secret = getSecret();
	if (!secret) return null;
	return crypto.createHmac('sha256', secret).update('tax-access-v1').digest('hex');
}

/** Sync check by tenant id — for nav gating where the tenant is already known. */
export function tenantHasTaxAccess(tenantId: string | null | undefined): boolean {
	return !!tenantId && ALLOWED_TAX_TENANTS.has(tenantId);
}

/**
 * Tax-section access — granted only to allow-listed tenants (owner).
 * Async: resolves the tenant from the request session.
 */
export async function hasTaxAccess(request: Request): Promise<boolean> {
	try {
		const session = await requireTenantSession(request);
		return !!session && ALLOWED_TAX_TENANTS.has(session.tenantId);
	} catch {
		return false;
	}
}

/** Set-Cookie header value to grant access (30 days) */
export function grantCookie(token: string): string {
	return `${TAX_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`;
}

/** Set-Cookie header value to revoke access */
export function revokeCookie(): string {
	return `${TAX_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
