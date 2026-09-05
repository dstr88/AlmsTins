/**
 * POST /api/verify/receivables — create + sign a receivable (authenticated).
 *
 * Returns the receivable ID (SHA-256 of the signed creation manifest). That ID is the
 * capability: hand it to a counterparty and they can query the receivable's financing
 * status via GET /api/verify/receivables/lookup. Writes are tenant-scoped; the ID and
 * status reads never expose tenant_id.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createReceivable, listReceivables, deleteReceivable } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// List the receivables this tenant created (so they don't have to keep the IDs).
export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  const receivables = await listReceivables(session.tenantId);
  return json({ ok: true, receivables });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await createReceivable(session.tenantId, {
    supplier: String(body.supplier ?? ''),
    buyer: String(body.buyer ?? ''),
    invoiceNo: String(body.invoiceNo ?? ''),
    face: Number(body.face),
    currency: String(body.currency ?? 'NGN'),
    terms: body.terms ?? null,
    dueDate: body.dueDate ?? null,
    acknowledgedAt: body.acknowledgedAt ?? null,
    rtype: body.rtype ?? null,
    paymentMethod: body.paymentMethod ?? null,
    details: body.details ?? null,
    isTest: body.isTest === true,
  });

  return result.ok ? json(result) : json(result, 400);
};

// Delete a receivable this tenant created (cascades its claims + attestations).
export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let id = url.searchParams.get('id') ?? '';
  if (!id) { try { id = String((await request.json())?.id ?? ''); } catch { /* ignore */ } }

  const removed = await deleteReceivable(session.tenantId, id);
  return removed ? json({ ok: true }) : json({ ok: false, error: 'not_found' }, 404);
};
