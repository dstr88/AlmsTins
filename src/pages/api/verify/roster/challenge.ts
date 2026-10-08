/**
 * POST /api/verify/roster/challenge
 *
 * Issue (or re-show) the account-bound challenge for a domain, for the roster tool.
 * Unlike /api/verify/destinations/:id/challenge, this isn't anchored to one existing
 * destination — the roster can list addresses that aren't registered yet at all, so
 * requiring a pre-existing destination id here would be circular. Body: { domain }.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { issueChallenge } from '@/lib/verifyRegistry';
import { normalizeProofDomain } from '@/lib/verifyProof';

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

  const challenge = await issueChallenge(session.tenantId, domain);
  return json({ ok: true, domain, challenge });
};
