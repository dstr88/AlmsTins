/**
 * owner.ts — single source of truth for the deployment owner's tenant ID.
 *
 * This UUID was previously hardcoded across ~9 files (the owner-only tax tools,
 * the PetroTins owner link, the TurboTax / Form-8949 gates, the tax-access
 * allow-list). It lives here now so there is exactly one place to change it.
 *
 * Override per deployment with the OWNER_TENANT_ID environment variable; the
 * literal below stays as the default so existing deployments keep working with
 * no env change required. The value is the tenant ID shown in the account menu
 * — an identifier, not a secret — and every consumer is server-side only.
 */

const DEFAULT_OWNER_TENANT_ID = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';

/** The owner's tenant ID, normalized to lowercase. Env-overridable. */
export const OWNER_TENANT_ID = (
	process.env.OWNER_TENANT_ID?.trim() || DEFAULT_OWNER_TENANT_ID
).toLowerCase();

/** True if the given tenant ID belongs to the deployment owner (case-insensitive). */
export function isOwner(tenantId: string | null | undefined): boolean {
	return !!tenantId && String(tenantId).toLowerCase() === OWNER_TENANT_ID;
}
