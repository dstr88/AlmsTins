/**
 * POST /api/verify/receivables/claim — register a financing claim (authenticated).
 *
 * Body: { receivableId, financier, amount, currency?, date?, force?, acceptsWarnings?, acknowledge? }
 *
 * The write itself is the duplicate-financing guard: a claim that exceeds the
 * receivable's unencumbered headroom answers 409 exceeds_headroom with the available
 * figure; force:true records it anyway and signs the acknowledgment into the claim. Signed
 * with the Almstins key; the returned digest can be Bitcoin-anchored via /api/verify/anchor.
 *
 * Also REJECTED (409, not force-able) when there's no genuine debtor confirmation on
 * file: the financier must first accept responsibility for having verified the debtor
 * themselves, via POST /api/verify/receivables/diligence-accept.
 *
 * 410 withdrawn when the receivable's owner withdrew it (S2): nothing new is recorded on it.
 *
 * Duplicate check (S3): when the receivable matches another record that is recorded as financed,
 * a caller that sends acceptsWarnings: true gets 409 possible_duplicate { warnings, duplicateCheck }
 * and records the claim by sending it again with acknowledge: ['possible_duplicate'], which is
 * signed into the claim. A caller that does not send acceptsWarnings (every client before S4)
 * gets today's 200, plus notices: ['possible_duplicate']. When the check cannot run, the 200
 * carries notices: ['duplicate_check_unavailable'], never a 409. An acknowledgment code this
 * server does not know answers 400 unknown_acknowledgment.
 *
 * Tiered (owner decision 9), by a second read of the session: a verified account (verified email,
 * or a Google or GitHub sign-in) gets the warning for a financed match and the full duplicateCheck.
 * Any other account gets it for any match, financed or not, with duplicateCheck { state } only, so
 * the warning itself never tells it whether the match is financed.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { addClaim } from '@/lib/receivablesRegistry';
import { isVerifiedViewer } from '@/lib/receivables/server/viewerTier';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await addClaim(session.tenantId, String(body.receivableId ?? ''), {
    financier: String(body.financier ?? ''),
    amount: Number(body.amount),
    currency: body.currency ? String(body.currency) : undefined,
    date: body.date ? String(body.date) : undefined,
    force: body.force === true,
    acceptsWarnings: body.acceptsWarnings === true,
    acknowledge: Array.isArray(body.acknowledge) ? body.acknowledge : undefined,
  }, { verifiedViewer: await isVerifiedViewer(request) });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : result.error === 'exceeds_headroom' ? 409
    : result.error === 'diligence_required' ? 409
    : result.error === 'possible_duplicate' ? 409
    : result.error === 'withdrawn' ? 410
    : 400;
  return json(result, status);
};
