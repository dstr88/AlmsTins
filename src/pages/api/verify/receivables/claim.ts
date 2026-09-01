/**
 * POST /api/verify/receivables/claim — register a financing claim (authenticated).
 *
 * Body: { receivableId, financier, amount, currency?, date?, force? }
 *
 * The write itself is the duplicate-financing guard: a claim that exceeds the
 * receivable's unencumbered headroom is REJECTED (409) with the available figure,
 * unless force:true is passed as an explicit, acknowledged over-claim. Signed with the
 * Almstins key; the returned digest can be Bitcoin-anchored via /api/verify/anchor.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addClaim } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await addClaim(session.tenantId, String(body.receivableId ?? ''), {
    financier: String(body.financier ?? ''),
    amount: Number(body.amount),
    currency: body.currency ? String(body.currency) : undefined,
    date: body.date ? String(body.date) : undefined,
    force: body.force === true,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : result.error === 'exceeds_headroom' ? 409
    : 400;
  return json(result, status);
};
