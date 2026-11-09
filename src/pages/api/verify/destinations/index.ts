/**
 * GET  /api/verify/destinations  — list the tenant's registered Destinations (with the
 *                                  owner-only needsReproof flag; see listDestinationsForOwner)
 *                                  and the plan's limits per kind (verifyEntitlements.ts)
 * POST /api/verify/destinations  — register a new Destination (capped by the plan; 403 limit_reached)
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listDestinationsForOwner, createDestination } from '@/lib/verifyRegistry';
import { getVerifyEntitlements } from '@/lib/verifyEntitlements';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const [destinations, entitlements] = await Promise.all([
    listDestinationsForOwner(session.tenantId),
    getVerifyEntitlements(session.tenantId),
  ]);
  // The plan's caps per kind (null: no limit), so the dashboard words the same rule the write enforces.
  return json({ ok: true, destinations, limits: entitlements.limits });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await createDestination(session.tenantId, {
    kind: body.kind === 'qr' ? 'qr' : 'address',
    rail: String(body.rail ?? ''),
    value: String(body.value ?? ''),
    label: body.label ?? null,
  });

  if (!result.ok) {
    const status = result.error === 'limit_reached' ? 403
      : result.error === 'claimed_elsewhere' || result.error === 'name_taken' ? 409
      : 400;
    return json(result, status);
  }
  return json(result);
};
