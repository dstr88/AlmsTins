/**
 * POST /api/verify/roster/check
 *
 * Domain-scoped counterpart to /api/verify/destinations/:id/prove's roster branch —
 * not anchored to one existing destination, since the roster can register brand-new
 * ones (recordRosterProofResult auto-creates, and immediately lapses any it no
 * longer vouches for — see verifyRegistry.ts). Body: { domain }.
 *
 * Returns { ok, outcome, flipped }, outcome one of:
 *   proven | challenge_mismatch | unreachable | malformed | invalid_domain | no_pointer | not_configured
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getChallenge, recordRosterProofResult } from '@/lib/verifyRegistry';
import { normalizeProofDomain, verifyRosterDocument } from '@/lib/verifyProof';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const domain = normalizeProofDomain(String(body.domain ?? ''));
  if (!domain) return json({ ok: true, outcome: 'invalid_domain' });

  const challenge = await getChallenge(session.tenantId, domain);
  if (!challenge) return json({ ok: true, outcome: 'invalid_domain' });

  const result = await verifyRosterDocument(domain, challenge);
  if (!result.ok) return json({ ok: true, outcome: result.code });

  const flipped = await recordRosterProofResult(session.tenantId, domain, result.addresses);
  return json({ ok: true, outcome: 'proven', flipped: flipped.length });
};
