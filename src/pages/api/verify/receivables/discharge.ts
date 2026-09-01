/**
 * POST /api/verify/receivables/discharge — discharge a financing claim (authenticated).
 *
 * Body: { claimId }
 *
 * Stage 4 (settlement): the financing was repaid/released, so the claim stops
 * encumbering the receivable and its amount returns to the unencumbered headroom.
 * Tenant-scoped to the claim's owner (a financier releases their OWN claim). Signs a
 * dated discharge event; the returned digest is Bitcoin-anchorable.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { dischargeClaim } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await dischargeClaim(session.tenantId, String(body.claimId ?? ''));
  if (result.ok) return json(result);
  const status = result.error === 'not_found' ? 404 : 409;
  return json(result, status);
};
