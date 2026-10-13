/**
 * POST /api/verify/destinations/:id/challenge
 *
 * Phase 3 — issue (or re-show) the account-bound challenge for a domain, and return
 * the exact /.well-known/almstins-verify.json file the owner must publish. The file
 * lists all the tenant's registered receiving addresses, so one file vouches for
 * every address on that domain. Body: { domain }.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getDestination, issueChallenge, listDestinations } from '@/lib/verifyRegistry';
import { normalizeProofDomain, buildProofFile, WELL_KNOWN_PATH } from '@/lib/verifyProof';

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

  const challenge = await issueChallenge(session.tenantId, domain);
  const addresses = (await listDestinations(session.tenantId))
    .filter((d) => d.kind === 'address')
    .map((d) => d.value);

  return json({
    ok: true,
    domain,
    challenge,
    path: WELL_KNOWN_PATH,
    file: buildProofFile(challenge, addresses),
  });
};
