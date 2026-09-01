/**
 * POST /api/verify/receivables/settle — mark a receivable settled (authenticated).
 *
 * Body: { receivableId }
 *
 * Stage 4 (settlement): the buyer paid, closing the lifecycle. Tenant-scoped to the
 * receivable's creator (the supplier/originator confirms payment arrived). Signs a
 * dated settlement event; the returned digest is Bitcoin-anchorable. Financiers still
 * release their own claims via /api/verify/receivables/discharge.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { settleReceivable } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await settleReceivable(session.tenantId, String(body.receivableId ?? ''));
  if (result.ok) return json(result);
  const status = result.error === 'not_found' ? 404 : 409;
  return json(result, status);
};
