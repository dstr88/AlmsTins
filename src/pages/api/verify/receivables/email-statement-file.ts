/**
 * GET /api/verify/receivables/email-statement-file?claimId=<id>
 *
 * Downloads a signed statement of the emails Almstins sent about one claim, as of now (email
 * statement, approved 2026-11-28). Each download makes a new record (kind email_statement): the
 * manifest is signed with the published Almstins key, stored under the caller's account, stamped
 * to Bitcoin, and handed back as a proof file that passes /verify-record and the offline script.
 * Only the claim's lender and the receivable's client may make one; anyone else gets 404. A GET
 * so it works as a plain Download link; it writes a record, so the demo is refused and the rate
 * is held low. It sends nothing.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { makeStatementFile } from '@/lib/receivables/server/emailStatementStore';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { json } from '@/lib/http';

export const prerender = false;

const limiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 10 });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401, { noStore: true });
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403, { noStore: true });
  if (limiter.hit(`tenant:${session.tenantId}`)) return json({ ok: false, error: 'rate_limited' }, 429, { noStore: true });

  const claimId = (new URL(request.url).searchParams.get('claimId') ?? '').trim();
  if (!claimId || claimId.length > 200) return json({ ok: false, error: 'invalid_id' }, 400, { noStore: true });

  const made = await makeStatementFile(session.tenantId, claimId);
  if (!made.ok) return json({ ok: false, error: made.error }, made.error === 'not_found' ? 404 : 409, { noStore: true });

  const name = `almstins-email_statement-${made.file.digest.slice(0, 12)}.proof.json`;
  return new Response(JSON.stringify(made.file, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
};
