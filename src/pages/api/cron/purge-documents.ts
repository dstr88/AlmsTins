/**
 * GET /api/cron/purge-documents
 *
 * Drops the stored bytes of every receivable document that nobody still needs to read,
 * leaving the sha256 tombstone behind.
 *
 * A promissory note sits on this server for one reason: so the person being asked to
 * confirm it can see what they are vouching for. The moment the last outstanding
 * confirmation request on that receivable is answered, revoked, or expired, that reason
 * is gone and the file should be too. Every party to the deal already holds their own
 * copy, and the hash in the anchored attestation is what proves the copy is the one they
 * looked at. Almstins witnesses the paperwork; it does not become its custodian.
 *
 * What survives: filename, size, mime, sha256, uploaded_at, purged_at. What does not:
 * the document. There is nothing left here to subpoena, leak, or lose.
 *
 * Protected by CRON_SECRET; never touches sessions.
 * Called by the GitHub Actions workflow: .github/workflows/purge-documents.yml
 */
import type { APIRoute } from 'astro';
import { listPurgeableReceivables, purgeDocuments } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_PER_RUN = 200;

export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  const provided =
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret');
  if (!secret || provided !== secret) return json({ ok: false, error: 'unauthorized' }, 401);

  const started = Date.now();

  let due: string[] = [];
  try {
    due = await listPurgeableReceivables(MAX_PER_RUN);
  } catch (err) {
    return json({ ok: false, error: 'list_failed', detail: String((err as Error)?.message || err) }, 500);
  }

  let receivables = 0, documents = 0, failed = 0;
  for (const receivableId of due) {
    try {
      const n = await purgeDocuments(receivableId);
      if (n > 0) { receivables++; documents += n; }
    } catch (err) {
      failed++;
      console.error('[purge-documents] failed for', receivableId, err);
    }
  }

  return json({
    ok: true,
    elapsed_ms: Date.now() - started,
    due: due.length,
    receivables,
    documents,
    failed,
  });
};
