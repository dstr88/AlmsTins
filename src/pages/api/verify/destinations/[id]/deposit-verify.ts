/**
 * POST /api/verify/destinations/:id/deposit-verify
 *
 * Reads the chain for a NEW outgoing transaction from the address after the
 * challenge was issued. If found, flips the destination to proven
 * (proof_method='micro_deposit') through the claim-once guard. Read-only — no
 * funds move; Almstins only observes public chain data.
 *
 * Returns { ok, outcome, ref? } where outcome is a code the UI maps to copy:
 *   proven | not_yet | no_challenge | claimed_elsewhere | unsupported_rail |
 *   unavailable | already_proven | not_address
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { verifyMicroDeposit } from '@/lib/verifyRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const id = String(params.id ?? '');
  const { outcome, ref } = await verifyMicroDeposit(session.tenantId, id);
  if (outcome === 'not_found') return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, outcome, ref });
};
