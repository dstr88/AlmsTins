/**
 * GET  /api/settings/cost-basis-method  → { method }
 * POST /api/settings/cost-basis-method  ← { method: 'fifo' | 'hifo' }  → { ok, method }
 *
 * Persists the tenant's default cost-basis method. Choosing it is an
 * Unlimited-plan feature (the same gate as the Year Summary PDF); the owner
 * always has it. The setting controls how Almstins computes the tenant's own
 * record only — it is not tax advice, it files nothing, and it instructs no
 * exchange. See costBasisMethodSetting.ts.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { canDownloadYearSummaryPdf } from '@/lib/yearSummaryAccess';
import {
  getCostBasisMethod,
  setCostBasisMethod,
  isUserCostBasisMethod,
} from '@/lib/costBasisMethodSetting';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const method = await getCostBasisMethod(session.tenantId);
  return json({ method });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  // Choosing a cost-basis method is an Unlimited-plan feature (owner always allowed).
  const plan = await getActivePlan(session.tenantId);
  if (!canDownloadYearSummaryPdf(plan.id, session.tenantId)) {
    return json({ error: 'Choosing a cost-basis method requires the Unlimited plan.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { method } = body;
  if (!isUserCostBasisMethod(method)) {
    return json({ error: 'Invalid method — must be "fifo" or "hifo"' }, 400);
  }

  await setCostBasisMethod(session.tenantId, method);
  return json({ ok: true, method });
};
