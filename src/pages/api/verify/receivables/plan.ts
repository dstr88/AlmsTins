/**
 * GET /api/verify/receivables/plan — the plan this account is on and what it holds (tier T1).
 *
 * Answers { ok, plan, label, limits: { contracts }, freeLockedAt, freeLockedReason, use: { claims,
 * projects, total } }, computed on load from the same rows the writes count, stored nowhere. The
 * desk's plan line is worded from this. Tenant-scoped like every claim read: the caller's own
 * contracts, never another account's. A read, so it stays open to the demo (which reads as Free).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getPlanSummary } from '@/lib/receivables/server/entitlements';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const summary = await getPlanSummary(session.tenantId);
  return json({ ok: true, ...summary });
};
