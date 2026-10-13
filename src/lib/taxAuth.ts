/**
 * taxAuth.ts
 *
 * Tax documents are the owner's alone (owner decision, Oct 12 2026). Almstins does not
 * offer tax software, so nobody else can view or download them. This is permanent, not a
 * "not demo-ready yet" gate.
 *
 * Tax documents: the Form 8949 and Schedule D views and data, the gains, lots, review and
 * report pages, 1099 upload / list / reconciliation, the tax documents store, the Annual
 * Records PDF, and every CSV of gains, losses or lots (the TurboTax CSV and the bookkeeping
 * shortTerm / longTerm / stillHolding sections). Every route that serves them calls
 * requireTaxOwner() (APIs) or hasTaxAccess() (pages) before touching the database (pinned
 * by tests/tax/taxDocsOwnerOnly.test.ts, which also sweeps src/pages for new ones).
 *
 * Not tax documents, and not gated here: the Year Summary PDF and proof bundle (Unlimited
 * or owner, src/lib/yearSummaryAccess.ts), the bookkeeping Needs Attention and Income CSV
 * sections (any paid plan: lists of records with no basis, gain/loss or holding term), the
 * tables and totals shown on Bookkeeping, and the completeness score shown there.
 *
 * Access is decided by the signed-in tenant only. There is no passphrase or cookie way in
 * (the old TAX_SECRET passphrase path was removed on Oct 12 2026).
 */

import { requireTenantSession } from './requireTenantSession';
import { isOwner } from './owner';

/** Where tax pages send anyone who is not the owner (signed in or not). */
export const TAX_DENIED_REDIRECT = '/dashboard/bookkeeping';

/** Sync check by tenant id, for nav gating where the tenant is already known. Owner only. */
export function tenantHasTaxAccess(tenantId: string | null | undefined): boolean {
	return isOwner(tenantId);
}

/**
 * Tax-document access: the owner's real signed-in session only. Demo sessions never pass,
 * whatever tenant they carry. Async: resolves the tenant from the request session.
 */
export async function hasTaxAccess(request: Request): Promise<boolean> {
	try {
		const session = await requireTenantSession(request);
		return !!session && !session.isDemo && isOwner(session.tenantId);
	} catch {
		return false;
	}
}

/**
 * API gate for tax documents. Returns a generic 404 for anyone who is not the owner
 * (signed in, demo, or anonymous), the same answer the other owner-only routes give, so
 * the route does not advertise that it exists. Returns null when the owner may proceed.
 *
 *   const denied = await requireTaxOwner(request);
 *   if (denied) return denied;
 */
export async function requireTaxOwner(request: Request): Promise<Response | null> {
	if (await hasTaxAccess(request)) return null;
	return taxNotFound();
}

/** The generic 404 every locked tax route returns to a non-owner. */
export function taxNotFound(): Response {
	return new Response(JSON.stringify({ error: 'Not found' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
