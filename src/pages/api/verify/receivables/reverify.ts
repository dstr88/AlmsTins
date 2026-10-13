/**
 * POST /api/verify/receivables/reverify — "Verify now".
 *
 * Re-runs a receivable's load-bearing checks on demand and fails closed: record integrity
 * (the signature still verifies and nothing was altered), financing headroom (no double-pledge
 * has landed since), debtor acknowledgment, funds affirmation, and the Bitcoin anchor. Returns
 * a dated verdict — 'confirmed' only if every check passes — and records a signed
 * re-verification so the party who relied on it has contemporaneous evidence the control ran.
 *
 * Any authenticated tenant holding the ID is a party (same model as registering a claim) and
 * may verify; the recorded row notes WHO checked and is never surfaced publicly. Demo sessions
 * are blocked at the middleware mutation guard, so a receipt is only ever written for a real
 * account. Reads (the public status) stay login-free via lookup.ts.
 *
 * The duplicate row (S3) is tiered (owner decision 9), by a second read of the session: a verified
 * account (verified email, or a Google or GitHub sign-in) is told whether a matching record is
 * recorded as financed and when it matched on the debtor's reference alone; any other account is
 * told only that another record matches. The row's state, the verdict and the signed receipt are
 * the same for both, and the stored re-verification keeps the plain wording.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { reverifyReceivable } from '@/lib/receivablesRegistry';
import { isVerifiedViewer } from '@/lib/receivables/server/viewerTier';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const receivableId = String(body.receivableId ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(receivableId)) {
    return json({ ok: false, error: 'invalid', message: 'A valid receivable ID is required.' }, 400);
  }

  // persist:false for demo is defense-in-depth — the middleware guard already blocks demo
  // POSTs here, so this branch is only reached by real accounts.
  const result = await reverifyReceivable(session.tenantId, receivableId, {
    persist: !session.isDemo,
    verifiedViewer: await isVerifiedViewer(request),
  });
  // 410 withdrawn: the owner withdrew the receivable (S2), so no new re-verification is recorded.
  return result.ok ? json(result) : json(result, result.error === 'withdrawn' ? 410 : 404);
};
