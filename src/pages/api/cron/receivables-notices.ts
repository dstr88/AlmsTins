/**
 * GET /api/cron/receivables-notices
 *
 * The daily aging-notice pass (receivables aging A4 / D8): reminds a lender whose claim is
 * walking off its promised payment date — and, once the record publicly reads past due, tells
 * the client too — on the fixed schedule in src/lib/receivables/notices.ts. One email per
 * claim per notice per recipient, ever (receivable_notice_log); any owner update stops the
 * sequence at the source, because the aging state simply recomputes.
 *
 * Returns counts only: numbers and booleans. The workflow prints exactly those (this repo's
 * Actions logs are public), and no address, tenant or deal identifier belongs in them.
 *
 * The same pass retries the client emails sent when a lender acts on a claim (Part B,
 * clientActionDelivery.ts): a send that failed in the action's own request goes out here.
 *
 * It also sends each lender one summary a day of the anonymous update requests on his claims
 * (Part A, updateRequestStore.ts).
 *
 * Protected by CRON_SECRET. Called by .github/workflows/receivables-notices.yml
 */
import type { APIRoute } from 'astro';
import { runAgingNotices } from '@/lib/receivables/server/noticeDelivery';
import { runClientActionNotices } from '@/lib/receivables/server/clientActionDelivery';
import { runUpdateRequestSummaries } from '@/lib/receivables/server/updateRequestStore';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();
  try {
    const now = new Date();
    const counts = await runAgingNotices(now);
    // Part B: retry any client email about a lender's action whose first try failed.
    const actions = await runClientActionNotices(now);
    // Part A: one summary per lender of the anonymous "please update" requests since the last one.
    const requests = await runUpdateRequestSummaries(now);
    return json({ ok: true, elapsed_ms: Date.now() - started, ...counts, ...actions, ...requests });
  } catch (err) {
    console.error('[cron/receivables-notices] pass failed:', err);
    return json({ ok: false, error: 'notice_pass_failed', elapsed_ms: Date.now() - started }, 500);
  }
};
