/**
 * Offers put to the client, before money moves.
 *
 * POST (authenticated)   { receivableId, financier, amount, price?, recourse, repayment?, validDays? }
 * GET  ?receivableId=…   (authenticated) every offer on a receivable
 * GET  ?t=<token>        PUBLIC — what the client sees
 *
 * The response endpoint is separate: /api/verify/receivables/offer-respond.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createOffer, listOffers, readOfferRequest, ownsReceivable, type Recourse } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('t');
  if (token) {
    const result = await readOfferRequest(token);
    return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 410);
  }

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const receivableId = String(url.searchParams.get('receivableId') ?? '').trim();
  if (!receivableId) return json({ ok: false, error: 'receivable_required' }, 400);
  if (!(await ownsReceivable(session.tenantId, receivableId))) {
    return json({ ok: false, error: 'not_found' }, 404);
  }
  return json({ ok: true, offers: await listOffers(receivableId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const result = await createOffer(session.tenantId, String(body.receivableId ?? ''), {
    financier: String(body.financier ?? ''),
    amount: Number(body.amount),
    currency: body.currency ? String(body.currency) : undefined,
    price: body.price ? String(body.price) : null,
    recourse: (String(body.recourse) === 'non_recourse' ? 'non_recourse' : 'recourse') as Recourse,
    repayment: body.repayment ? String(body.repayment) : null,
    validDays: body.validDays != null ? Number(body.validDays) : undefined,
  });
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 400);
};
