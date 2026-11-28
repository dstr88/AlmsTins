/**
 * GET /api/verify/receivables/proof-records?receivableId=<id>
 *
 * The signed records the caller's own account holds on one receivable: the ones
 * /api/verify/receivables/proof-file will hand it. The desk and the client page list them as
 * downloads. Signed in, tenant-scoped (listOwnProofRecords filters every table by the caller's
 * tenant), so another firm's claim or another account's answer on the same receivable is never
 * listed or counted. A read: demo sessions may use it.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { listOwnProofRecords } from '@/lib/receivablesRegistry';
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

  const records = await listOwnProofRecords(session.tenantId, id);
  return json({ ok: true, records }, 200, { noStore: true });
};
