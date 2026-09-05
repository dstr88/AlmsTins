/**
 * POST /api/verify/receivables/offer-respond — the client accepts or declines.
 *
 * DELIBERATELY UNAUTHENTICATED. He is being offered money, not signing up for software,
 * and his signature is worth most here: he accepts because that is how he gets funded.
 * After the money lands he has nothing to gain by signing anything.
 *
 * Body: { token, outcome: 'accept' | 'decline', by, title?, reason? }
 */
import type { APIRoute } from 'astro';
import { respondToOffer } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  const outcome = String(body.outcome ?? '');
  if (outcome !== 'accept' && outcome !== 'decline') return json({ ok: false, error: 'invalid_outcome' }, 400);

  const result = await respondToOffer(token, outcome, {
    by: String(body.by ?? ''),
    title: body.title ? String(body.title) : null,
    reason: body.reason ? String(body.reason) : null,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['expired', 'offer_expired', 'revoked', 'used', 'wrong_kind'].includes(result.error) ? 410
    : 400;
  return json(result, status);
};
