/**
 * GET /api/cron/chase-requests
 *
 * Writes down every confirmation request that expired without a reply.
 *
 * A client who takes the money and goes quiet, or a
 * debtor who never replies, used to leave nothing behind: the link expired and the record
 * simply had a hole in it, with no evidence anyone had ever asked. We cannot make people
 * answer. We can prove the asking happened, which is the same thing this registry does for
 * everything else.
 *
 * Reminders before expiry are not built yet; see the note in the handler.
 *
 * Protected by CRON_SECRET. Called by .github/workflows/chase-requests.yml
 */
import type { APIRoute } from 'astro';
import { listLapsedRequests, recordLapse } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_PER_RUN = 200;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();
  let recorded = 0, failed = 0;

  // Reminders are not here yet: sending one means reusing the message builder that
  // currently lives inside the send endpoint, and copying it would guarantee the two
  // drift. Extracting it is its own change. This pass does the part that was actually
  // losing information.

  // Pass 2 — write the silence down.
  try {
    for (const req of await listLapsedRequests(MAX_PER_RUN)) {
      try { if (await recordLapse(req)) recorded++; }
      catch (err) { failed++; console.error('[chase-requests] lapse failed for', req.token, err); }
    }
  } catch (err) {
    return json({ ok: false, error: 'lapse_pass_failed', detail: String((err as Error)?.message || err) }, 500);
  }

  return json({ ok: true, elapsed_ms: Date.now() - started, recorded, failed });
};
