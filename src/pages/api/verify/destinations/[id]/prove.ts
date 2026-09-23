/**
 * POST /api/verify/destinations/:id/prove
 *
 * Phase 3 — verify the domain's published proof against the challenge we issued.
 * On success, flips every registered address the file vouches for to proven and
 * reports whether THIS destination was among them. Body: { domain }.
 *
 * Returns { ok, outcome }, where outcome is a code the UI maps to localized copy:
 *   proven | address_not_listed | claimed_elsewhere | challenge_mismatch | unreachable |
 *   malformed | invalid_domain | name_attached
 * claimed_elsewhere: the file lists this wallet, but another account already proved it
 * (S5a claim guard); the other account is never named.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getDestination, getChallenge, recordProofResult, recordDomainControlProof, markProofChecked } from '@/lib/verifyRegistry';
import { normalizeProofDomain, verifyDomainProof, verifyDnsTxt } from '@/lib/verifyProof';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, params }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const id = String(params.id ?? '');
  const dest = await getDestination(session.tenantId, id);
  if (!dest) return json({ ok: false, error: 'not_found' }, 404);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const domain = normalizeProofDomain(String(body.domain ?? ''));
  if (!domain) return json({ ok: true, outcome: 'invalid_domain' });

  // Must have requested a challenge for this domain first.
  const challenge = await getChallenge(session.tenantId, domain);
  if (!challenge) return json({ ok: true, outcome: 'invalid_domain' });

  // Method 1 — the published file (carries the address list; vouches for addresses).
  const result = await verifyDomainProof(domain, challenge);
  if (result.ok) {
    const { flipped, claimedElsewhere } = await recordProofResult(session.tenantId, domain, result.addresses);
    return json({
      ok: true,
      outcome: flipped.includes(id) ? 'proven'
        : claimedElsewhere.includes(id) ? 'claimed_elsewhere'
        : 'address_not_listed',
      flipped: flipped.length,
    });
  }

  // Method 2 — DNS TXT record (the easier path for managed-host merchants). It proves
  // CONTROL but carries no address list, so it attaches the business NAME without
  // vouching for addresses (those stay self-send/file-proven).
  const dns = await verifyDnsTxt(domain, challenge);
  if (dns.ok) {
    await recordDomainControlProof(session.tenantId, domain);
    return json({ ok: true, outcome: 'name_attached' });
  }

  // Neither method passed — surface the file outcome as the primary hint.
  await markProofChecked(session.tenantId, domain, 'failed');
  return json({ ok: true, outcome: result.code });
};
