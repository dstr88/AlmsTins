/**
 * POST /api/verify/receivables/diligence-accept — the financier's own accountability
 * record, required by addClaim()'s diligence_required gate before financing a receivable
 * with no genuine debtor confirmation on file.
 *
 * Body: { receivableId, financier, method: 'phone'|'relationship'|'correspondence'|'other', note? }
 *
 * Unlike every other write in this file, this one anchors to Bitcoin synchronously, in the
 * same request, instead of leaving the stamp as a best-effort follow-up call from the
 * frontend. The point of this endpoint is that THIS click -- the financier accepting
 * responsibility for his own verification, in his own name -- is the moment worth
 * permanently recording, not an incidental side effect of writing data. See
 * acceptDiligence() for why this is filed under role 'other' rather than 'buyer'.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { acceptDiligence, getRecordForAnchor, setRecordAnchor, type DiligenceMethod } from '@/lib/receivablesRegistry';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import { createFixedWindowLimiter } from '@/lib/rateLimit';

export const prerender = false;

const stampLimiter = createFixedWindowLimiter({ windowMs: 60 * 60 * 1000, max: 30 });
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

  if (stampLimiter.hit(`tenant:${session.tenantId}`)) {
    // The acceptance is already signed and saved -- only the Bitcoin stamp is delayed.
    // Report this plainly rather than pretending the anchor happened.
    return json({ ...result, anchored: false, anchorError: 'rate_limited' });
  }
  try {
    const record = await getRecordForAnchor(session.tenantId, 'attestation', result.attestationId);
    if (record) {
      const receipt = await new OpenTimestampsAnchor().stamp(record.digest.toLowerCase());
      await setRecordAnchor(session.tenantId, 'attestation', result.attestationId, JSON.stringify(receipt));
      return json({ ...result, anchored: true, anchor: receipt });
    }
  } catch (err) {
    // Same non-fatal posture as /anchor: the signed acceptance stands regardless of
    // whether the Bitcoin stamp succeeded this instant.
    return json({ ...result, anchored: false, anchorError: String((err as Error)?.message || err) });
  }
  return json({ ...result, anchored: false });
};
