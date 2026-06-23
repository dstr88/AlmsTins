/**
 * DELETE /api/verify/entities/:id — remove an entity and its mirrored addresses.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { deleteEntity } from '@/lib/verifyEntities';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const id = String(params.id ?? '');
  if (!id) return json({ ok: false, error: 'invalid' }, 400);
  await deleteEntity(session.tenantId, id);
  return json({ ok: true });
};
