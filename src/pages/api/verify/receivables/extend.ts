/**
 * POST /api/verify/receivables/extend — record a new promised date on a claim (authenticated).
 *
 * Body: { claimId, newPromisedDate, reasonCode, reasonNote? }
 *
 * One of the three one-click updates on a lender's own entry (aging A1). The structured reason is
 * MANDATORY — debtor_requested | partial_payment_received | renegotiated_terms | awaiting_delivery
 * | other — and is signed into a dated, append-only status event, so three extensions are three
 * dated reasons in the lifecycle. The receivable's own due date is never rewritten. Resets the
 * aging clock and opens a fresh grace window; also an owner touch for the lapse backstop (D7).
 *
 * Tenant-scoped to the claim's owner (each lender maintains only his own entry): a non-owner gets
 * 404. 400 invalid_reason without a known reason code; 400 invalid without a YYYY-MM-DD date;
 * 409 already_discharged on a discharged claim; 410 withdrawn when the receivable's owner withdrew
 * the record. Stamps the event's digest into Bitcoin in the same request (anchorNow, kind
 * 'status_event'); a success adds { anchored: true, anchor } or { anchored: false, anchorError? }
 * — the signed event stands either way. The reason echoes back to the actor here; the public
 * status never carries it (D3).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addExtension } from '@/lib/receivablesRegistry';
import { anchorNow, evidenceStampLimiter } from '@/lib/receivables/server/anchorNow';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await addExtension(session.tenantId, String(body.claimId ?? ''), {
    newPromisedDate: String(body.newPromisedDate ?? ''),
    reasonCode: String(body.reasonCode ?? ''),
    reasonNote: typeof body.reasonNote === 'string' ? body.reasonNote : undefined,
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
