/**
 * DELETE /api/verify/destinations/:id  — remove one of the tenant's Destinations
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { deleteDestination } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  const id = String(params.id ?? '');
  if (!id) return json({ ok: false, error: 'invalid' }, 400);
  await deleteDestination(session.tenantId, id);
  return json({ ok: true });
};
