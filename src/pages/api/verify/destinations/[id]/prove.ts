/**
 * POST /api/verify/destinations/:id/prove
 *
 * Phase 3 — verify the domain's published proof against the challenge we issued.
 * On success, anchors every registered address the file lists to this domain (proving
 * the unproven ones; attaching the domain to self-send-proven ones) and reports what
 * happened to THIS destination. Body: { domain, method? }.
 *
 * method: 'file' is the "add a domain to a proven address" flow: only the file can
 * anchor an address, so the DNS method is skipped and a failure reports the file's code.
 *
 * Returns { ok, outcome }, where outcome is a code the UI maps to localized copy:
 *   proven | name_attached | address_not_listed | anchored_other_domain | claimed_elsewhere
 *   | reprove_required | challenge_mismatch | unreachable | malformed | invalid_domain
 * claimed_elsewhere: the file lists this wallet, but another account already proved it
 * (S5a claim guard); the other account is never named.
 * reprove_required: the file lists this wallet, but this account holds it only through a
 * claim made under the old, unbound self-send rule (legacy_unbound); it stays as it was until
 * the owner takes the satoshi test again on that wallet (in place, see needsSelfSend).
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

  const fileOnly = body.method === 'file';
  const domain = normalizeProofDomain(String(body.domain ?? ''));
  if (!domain) return json({ ok: true, outcome: 'invalid_domain' });

  // Must have requested a challenge for this domain first.
  const challenge = await getChallenge(session.tenantId, domain);
  if (!challenge) return json({ ok: true, outcome: 'invalid_domain' });

  // Method 1 — the published file (carries the address list; vouches for addresses).
  const result = await verifyDomainProof(domain, challenge);
  if (result.ok) {
    const r = await recordProofResult(session.tenantId, domain, result.addresses);
    const outcome = r.flipped.includes(id) ? 'proven'
      : r.otherDomain.includes(id) ? 'anchored_other_domain'
      : r.claimedElsewhere.includes(id) ? 'claimed_elsewhere'
      : r.legacyUnbound.includes(id) ? 'reprove_required'
      : 'address_not_listed';
    return json({ ok: true, outcome, flipped: r.flipped.length });
  }

  // Method 2 — DNS TXT record (the easier path for managed-host merchants). It proves
  // CONTROL but carries no address list, so it attaches the business NAME without
  // vouching for addresses (those stay self-send/file-proven).
  if (!fileOnly) {
    const dns = await verifyDnsTxt(domain, challenge);
    if (dns.ok) {
      await recordDomainControlProof(session.tenantId, domain);
      return json({ ok: true, outcome: 'name_attached' });
    }
  }

  // No method passed — surface the file outcome as the primary hint.
  await markProofChecked(session.tenantId, domain, 'failed');
  return json({ ok: true, outcome: result.code });
};
