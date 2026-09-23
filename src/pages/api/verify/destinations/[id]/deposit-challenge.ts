/**
 * GET  /api/verify/destinations/:id/deposit-challenge
 * POST /api/verify/destinations/:id/deposit-challenge   body: { ready: true }
 *
 * The satoshi test (a self-send, no website needed). The merchant sends EXACTLY the
 * amount we issue FROM their registered address TO that same address, from their own
 * wallet app. Read-only: Almstins never sends, holds, or signs.
 *
 * GET reads the current test so a reopened panel can resume it; it never issues one.
 * POST issues one, and only on the merchant's explicit "I'm ready to send" (the body
 * must carry ready:true). An unexpired test is returned unchanged; an expired one is
 * replaced by a new amount. The amount can't be rerolled: while this account holds an
 * unexpired amount for the address (even after deleting and re-adding it), POST returns
 * that same amount, and new amounts are capped (429 rate_limited, with retryAt).
 *
 * Returns { ok, challenge: { amount, baseAmount, unit, baseUnit, issuedAt, expiresAt,
 * checkUntil, late, expired } } (challenge is null on GET when there is none), or
 * { ok:false, error, retryAt? }. error 'unavailable' (503) means the chain couldn't be
 * read to set the test up; 'busy' (503) means no amount could be drawn right now.
 * The response never contains an address: the merchant copies their own address from
 * their wallet's Receive screen, and Almstins never gives anyone an address to send to.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getDepositChallenge, issueDepositChallenge } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);

  const res = await getDepositChallenge(session.tenantId, String(params.id ?? ''));
  if (!res.ok) return json({ ok: false, error: res.error }, res.error === 'not_found' ? 404 : 400);
  return json({ ok: true, challenge: res.challenge });
};

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: { ready?: unknown } = {};
  try { body = await request.json(); } catch { /* no body */ }
  if (body?.ready !== true) return json({ ok: false, error: 'ready_required' }, 400);

  const res = await issueDepositChallenge(session.tenantId, String(params.id ?? ''));
  if (!res.ok) {
    if (res.error === 'rate_limited') return json({ ok: false, error: res.error, retryAt: res.retryAt }, 429);
    const status = res.error === 'not_found' ? 404 : res.error === 'unavailable' || res.error === 'busy' ? 503 : 400;
    return json({ ok: false, error: res.error }, status);
  }
  return json({ ok: true, challenge: res.challenge });
};
