/**
 * POST /api/verify/receivables/seen — mark a receivable as seen (authenticated).
 *
 * Body: { receivableId }  (also accepts { id })
 *
 * Records that this tenant has looked at (or just acted on) a receivable, so only later
 * changes read as unseen updates in their book. The desk calls it when a contract is
 * opened and after any action the banker takes, so the "N updates" badge only ever counts
 * things other parties did (a debtor confirming, a competing claim), never the banker's
 * own moves. Tenant-scoped; idempotent; never fatal.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { markReceivableSeen } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  // Demo users may read the desk; recording their read-state is harmless, but keep it a
  // no-op so demo activity never writes rows.
  if (session.isDemo) return json({ ok: true, noop: true });

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const id = String(body.receivableId ?? body.id ?? '').trim();
  if (!id) return json({ ok: false, error: 'invalid' }, 400);

  await markReceivableSeen(session.tenantId, id);
  return json({ ok: true });
};
