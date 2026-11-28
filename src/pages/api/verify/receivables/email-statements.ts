/**
 * GET /api/verify/receivables/email-statements?receivableId=<id>
 *
 * The statement of the emails Almstins sent about each claim on one receivable that the caller
 * may see (email statement, approved 2026-11-28): its own claims as their lender, every claim as
 * the receivable's client. Anyone else gets an empty list; a signed-out visitor gets 401. Each
 * statement is the four summary lines, the forecast, where history starts and one line per
 * email; never an address, a note, a requester or any email text. A read: nothing is signed or
 * sent, so demo sessions may use it. The signed copy is email-statement-file.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listStatementsFor } from '@/lib/receivables/server/emailStatementStore';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { json } from '@/lib/http';

export const prerender = false;

const limiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 60 });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401, { noStore: true });
  if (limiter.hit(`tenant:${session.tenantId}`)) return json({ ok: false, error: 'rate_limited' }, 429, { noStore: true });

  const id = (new URL(request.url).searchParams.get('receivableId') ?? '').trim();
  if (!id || id.length > 200) return json({ ok: false, error: 'invalid_id' }, 400, { noStore: true });

  const list = await listStatementsFor(session.tenantId, id);
  const statements = list.map((s) => ({
    claimId: s.claim.claimId,
    role: s.claim.role,
    financier: s.claim.financier,
    amount: s.claim.amount,
    currency: s.claim.currency,
    asOf: s.asOf,
    ...s.view,
  }));
  return json({ ok: true, statements }, 200, { noStore: true });
};
