/**
 * DELETE /api/verify/destinations/:id  — remove one of the tenant's Destinations
 * PATCH  /api/verify/destinations/:id  — set/clear the published-page monitor URL
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { deleteDestination, setMonitorUrl } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const DELETE: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const id = String(params.id ?? '');
  if (!id) return json({ ok: false, error: 'invalid' }, 400);
  await deleteDestination(session.tenantId, id);
  return json({ ok: true });
};

export const PATCH: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);
  const id = String(params.id ?? '');
  if (!id) return json({ ok: false, error: 'invalid' }, 400);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  // null / '' clears monitoring; a string sets it.
  const raw = body.monitorUrl;
  const monitorUrl = raw == null ? null : String(raw);

  const result = await setMonitorUrl(session.tenantId, id, monitorUrl);
  if (!result.ok) return json(result, result.error === 'not_found' ? 404 : 400);
  return json(result);
};
