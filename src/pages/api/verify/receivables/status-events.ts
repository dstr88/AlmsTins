/**
 * GET /api/verify/receivables/status-events?claimId=<id> — a claim's own status-event chain,
 * reasons included (authenticated).
 *
 * The signed-in tier of D3: the public lookup carries the dated extended/unpaid chain but never
 * a reason; the desk reads the reasons HERE, and only for the caller's own claim. Tenant-scoped
 * exactly like the status mutations: a non-owner gets 404, never that the claim exists. A read,
 * so it stays open to the demo (the demo browses, never writes) and keeps answering on a
 * discharged claim or a withdrawn record — the dated chain is the record.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listOwnClaimStatusEvents } from '@/lib/receivablesRegistry';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const result = await listOwnClaimStatusEvents(session.tenantId, String(url.searchParams.get('claimId') ?? ''));
  return json(result, result.ok ? 200 : 404);
};
