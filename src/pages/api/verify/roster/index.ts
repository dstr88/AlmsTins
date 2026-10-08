/**
 * GET /api/verify/roster?domain=...
 *
 * The last successfully decrypted + challenge-matched roster for this (tenant,
 * domain), from the durable cache written by recordRosterProofResult — never a
 * fresh fetch. Backs the editor's pre-fill so returning to edit a list doesn't force
 * a live decrypt just to show what's already published.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getCachedRoster } from '@/lib/verifyRegistry';
import { normalizeProofDomain } from '@/lib/verifyProof';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false }, 401);

  const domain = normalizeProofDomain(url.searchParams.get('domain') ?? '');
  if (!domain) return json({ ok: true, cached: null });

  const cached = await getCachedRoster(session.tenantId, domain);
  return json({ ok: true, cached });
};
