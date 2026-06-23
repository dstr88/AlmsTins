/**
 * POST /api/verify/entities/:id/prove — verify the entity's domain via its published
 * .well-known challenge (reuses the Phase 3 domain-attestation mechanism).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { proveEntity } from '@/lib/verifyEntities';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const result = await proveEntity(session.tenantId, String(params.id ?? ''));
  if (!result.ok && result.code === 'not_found') return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, outcome: result.ok ? 'proven' : result.code });
};
