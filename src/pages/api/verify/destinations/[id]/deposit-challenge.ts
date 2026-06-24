/**
 * POST /api/verify/destinations/:id/deposit-challenge
 *
 * Self-send proof of control (no website needed). Issues (or returns the existing)
 * challenge for an address destination and hands back the instruction data: from
 * the wallet that holds this address, send any tiny amount; we'll watch the chain.
 * Read-only — Almstins never sends, holds, or signs.
 *
 * Returns { ok, rail, address, issuedAt } or { ok:false, error }.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { issueDepositChallenge } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const id = String(params.id ?? '');
  const res = await issueDepositChallenge(session.tenantId, id);
  if (!res.ok) {
    return json({ ok: false, error: res.error }, res.error === 'not_found' ? 404 : 400);
  }
  return json({ ok: true, rail: res.rail, address: res.address, issuedAt: res.issuedAt });
};
