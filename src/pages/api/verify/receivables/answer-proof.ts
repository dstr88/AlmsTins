/**
 * GET /api/verify/receivables/answer-proof?t=<token>&which=answer|receivable
 *
 * The proof file for one of the two records an answered emailed request hands back to the person
 * who answered it (receivables downloads, Part B): their own answer, or the receivable it is
 * about. No account: the link is the authority, as it is for the paperwork. It reads only after
 * the link was answered, until six months after the due date (receivables/answerWindow.ts), and
 * never after the sender revokes it. It can't answer again; nothing is written.
 *
 * Rate-limited per client network, like the public lookup. The token is never logged.
 */
import type { APIRoute } from 'astro';
import { getAnswerProofSource, type AnswerProofWhich } from '@/lib/receivablesRegistry';
import { buildRecordProofFile } from '@/lib/receivables/server/proofFile';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { admitByIp } from '@/lib/http/publicApi';
import { json } from '@/lib/http';

export const prerender = false;

const WINDOW_MS = 60 * 1000;
const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 30 });

/** Refusals that mean "this link hands out nothing now", all answered the same way. */
const GONE = new Set(['not_found', 'revoked', 'not_answered', 'no_record', 'closed']);

export const GET: APIRoute = async ({ request }) => {
  const limited = admitByIp(limiter, request, {
    body: { ok: false, error: 'rate_limited' },
    retryAfterSeconds: WINDOW_MS / 1000,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const token = (url.searchParams.get('t') ?? '').trim();
  const which = url.searchParams.get('which') as AnswerProofWhich | null;
  if (!token || token.length > 200) return json({ ok: false, error: 'invalid_token' }, 400, { noStore: true });
  if (which !== 'answer' && which !== 'receivable') return json({ ok: false, error: 'invalid_which' }, 400, { noStore: true });

  const got = await getAnswerProofSource(token, which);
  if ('error' in got) {
    return json({ ok: false, error: got.error }, GONE.has(got.error) ? 404 : 400, { noStore: true });
  }
  if (!got.src) return json({ ok: false, error: 'not_found' }, 404, { noStore: true });
  const file = buildRecordProofFile(got.kind, got.id, got.src);
  if (!file) return json({ ok: false, error: 'record_unreadable' }, 409, { noStore: true });

  const name = `almstins-${got.kind}-${file.digest.slice(0, 12)}.proof.json`;
  return new Response(JSON.stringify(file, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
