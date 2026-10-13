/**
 * POST /api/verify/receivables/discharge — discharge a financing claim (authenticated).
 *
 * Body: { claimId, reason? } — reason is optional free text (e.g. "wire received Sept 28"),
 * signed into the discharge manifest, tenant-only (never returned by the public lookup).
 *
 * Stage 4 (settlement): the financing was repaid/released, so the claim stops
 * encumbering the receivable and its amount returns to the unencumbered headroom.
 * Tenant-scoped to the claim's owner (a financier releases their OWN claim). Signs a
 * dated discharge event, keeps the signature, and stamps its digest into Bitcoin in the
 * same request (anchorNow, kind 'claim_discharge'). A success adds { anchored: true, anchor }
 * or { anchored: false, anchorError? }: the discharge stands either way.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { dischargeClaim } from '@/lib/receivablesRegistry';
import { anchorNow, evidenceStampLimiter } from '@/lib/receivables/server/anchorNow';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const claimId = String(body.claimId ?? '');
  const result = await dischargeClaim(
    session.tenantId,
    claimId,
    typeof body.reason === 'string' ? body.reason : undefined,
  );
  if (result.ok) {
    const anchor = await anchorNow(session.tenantId, 'claim_discharge', claimId, evidenceStampLimiter);
    return json({ ...result, ...anchor });
  }
  const status = result.error === 'not_found' ? 404 : 409;
  return json(result, status);
};
