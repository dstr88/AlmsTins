/**
 * GET  /api/verify/destinations  — list the tenant's registered Destinations
 * POST /api/verify/destinations  — register a new Destination (free-tier limited)
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listDestinations, createDestination } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const destinations = await listDestinations(session.tenantId);
  return json({ ok: true, destinations });
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
