/**
 * Almstins Verify — who may publish a platform list (a Verified Entity).
 *
 * A platform list is mirrored into the public lookup as Verified, ahead of merchant
 * proofs, and it is not yet checked against addresses another account has proven. Until
 * that guard exists, publishing a list is by approval only:
 *   - the deployment owner (isOwner), and
 *   - tenants listed in VERIFY_ENTITY_TENANTS (comma- or whitespace-separated tenant IDs,
 *     e.g. `uuid-1,uuid-2`; case, spacing and stray quotes around an ID are ignored).
 *
 * The env var is read on every call (never cached), so adding or removing a tenant applies
 * as soon as the running service has the new value. No code change is needed.
 * Everyone else is refused on every path that creates, proves, connects or refreshes a list,
 * and the public lookup ignores mirror rows whose tenant is not approved. Removing a list is
 * never gated: an account can always delete its own rows.
 *
 * Import-light on purpose (no db): the dashboard page and the API routes both call it.
 */
import { isOwner, OWNER_TENANT_ID } from './owner';

export const ENTITY_APPROVAL_ENV = 'VERIFY_ENTITY_TENANTS';

/** Error code a refused write returns. */
export const ENTITY_NOT_APPROVED = 'not_approved' as const;

/**
 * The approved tenant IDs from VERIFY_ENTITY_TENANTS (lowercased), read at call time.
 * Quotes around an ID (a value pasted as "uuid" in a hosting dashboard) are stripped, so
 * the tenant is not silently left out.
 */
export function approvedEntityTenants(): Set<string> {
  const raw = process.env[ENTITY_APPROVAL_ENV] ?? '';
  return new Set(
    raw.split(/[\s,]+/)
      .map((s) => s.replace(/^["'`]+|["'`]+$/g, '').trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Every tenant that may publish right now (the owner plus the listed tenants), lowercased.
 * Used to filter in SQL, so the public lookup never pages past approved rows.
 */
export function publishingTenantIds(): string[] {
  return [...new Set([OWNER_TENANT_ID, ...approvedEntityTenants()])];
}

/** True if this tenant may create, prove, connect or refresh a platform list. */
export function canPublishEntities(tenantId: string | null | undefined): boolean {
  if (!tenantId) return false;
  const id = String(tenantId).trim().toLowerCase();
  if (!id) return false;
  if (isOwner(id)) return true;
  return approvedEntityTenants().has(id);
}

/** The 403 every refused entity write answers with. */
export function entityNotApprovedResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: ENTITY_NOT_APPROVED,
      message: 'Platform lists are by approval during early access. Contact support@almstins.com to request access.',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
