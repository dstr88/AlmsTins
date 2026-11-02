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
 * Protected by CRON_SECRET. Called by .github/workflows/receivables-notices.yml
 */
import type { APIRoute } from 'astro';
import { runAgingNotices } from '@/lib/receivables/server/noticeDelivery';
import { json } from '@/lib/http';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();
  try {
    const counts = await runAgingNotices(new Date());
    return json({ ok: true, elapsed_ms: Date.now() - started, ...counts });
  } catch (err) {
    console.error('[cron/receivables-notices] pass failed:', err);
    return json({ ok: false, error: 'notice_pass_failed', elapsed_ms: Date.now() - started }, 500);
  }
};
