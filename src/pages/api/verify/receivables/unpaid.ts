/**
 * POST /api/verify/receivables/unpaid — flag a claim's promise as not kept (authenticated).
 *
 * Body: { claimId, note? } — the note is optional free text (D4: the flag itself is the signal),
 * signed into the event, tenant-tier only (never returned by the public lookup).
 *
 * One of the three one-click updates on a lender's own entry (aging A1): a signed, dated,
 * append-only status event. An owner touch for the lapse backstop (D7); it does NOT move the
 * promised date, so a past-due record honestly stays past due until it is extended, discharged
 * or settled.
 *
 * Tenant-scoped to the claim's owner: a non-owner gets 404. 409 already_discharged on a
 * discharged claim; 410 withdrawn when the receivable's owner withdrew the record. Stamps the
 * event's digest into Bitcoin in the same request (anchorNow, kind 'status_event'); the signed
 * event stands whether or not the stamp lands.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { markUnpaid } from '@/lib/receivablesRegistry';
import { anchorNow, evidenceStampLimiter } from '@/lib/receivables/server/anchorNow';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await markUnpaid(session.tenantId, String(body.claimId ?? ''), {
    note: typeof body.note === 'string' ? body.note : undefined,
  });
  if (result.ok) {
    const anchor = await anchorNow(session.tenantId, 'status_event', result.eventId, evidenceStampLimiter);
    return json({ ...result, ...anchor });
  }
  const status =
    result.error === 'not_found' ? 404
    : result.error === 'already_discharged' ? 409
    : result.error === 'withdrawn' ? 410
    : 400;
  return json(result, status);
};
