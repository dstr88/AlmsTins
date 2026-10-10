/**
 * POST /api/verify/receivables/diligence-accept — the financier's own accountability
 * record, required by addClaim()'s diligence_required gate before financing a receivable
 * with no genuine debtor confirmation on file.
 *
 * Body: { receivableId, financier, method: 'phone'|'relationship'|'correspondence'|'other', note? }
 *
 * Like discharge and settle, this one anchors to Bitcoin synchronously, in the same request,
 * instead of leaving the stamp as a best-effort follow-up call from the frontend. The point
 * of this endpoint is that THIS click -- the financier accepting responsibility for his own
 * verification, in his own name -- is the moment worth permanently recording, not an
 * incidental side effect of writing data. See acceptDiligence() for why this is filed under
 * role 'other' rather than 'buyer'.
 *
 * Response: the signed acceptance plus { anchored: true, anchor } or
 * { anchored: false, anchorError? } (see anchorNow). The stamp shares the per-tenant
 * evidenceStampLimiter with discharge and settle.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { acceptDiligence, type DiligenceMethod } from '@/lib/receivablesRegistry';
import { anchorNow, evidenceStampLimiter } from '@/lib/receivables/server/anchorNow';

export const prerender = false;

const METHODS: DiligenceMethod[] = ['phone', 'relationship', 'correspondence', 'other'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const method: DiligenceMethod = METHODS.includes(body.method) ? body.method : 'other';
  const result = await acceptDiligence(session.tenantId, String(body.receivableId ?? ''), {
    financier: String(body.financier ?? ''),
    method,
    note: body.note ? String(body.note) : undefined,
  });
  if (!result.ok) return json(result, result.error === 'not_found' ? 404 : 400);

  // The acceptance is already signed and saved; only the Bitcoin stamp can be delayed (rate
  // limited, or the calendars unreachable), and the response says so rather than pretending.
  const anchor = await anchorNow(session.tenantId, 'attestation', result.attestationId, evidenceStampLimiter);
  return json({ ...result, ...anchor });
};
