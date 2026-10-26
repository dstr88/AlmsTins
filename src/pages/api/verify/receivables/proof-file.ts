/**
 * GET /api/verify/receivables/proof-file?kind=<kind>&id=<id>
 *
 * Downloads one record's proof file (receivables/server/proofFile.ts): the signed manifest,
 * signature, public key, digest and Bitcoin .ots proof, so the record can be checked without
 * almstins.com. Signed in, and only for the tenant that owns the record, the same scope as the
 * anchor endpoint. A read: nothing is stamped, signed or written. Demo sessions may download.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getRecordProofSource } from '@/lib/receivablesRegistry';
import { isAnchorKind } from '@/lib/receivables/anchorSpec';
import { buildRecordProofFile } from '@/lib/receivables/server/proofFile';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { json } from '@/lib/http';

export const prerender = false;

const limiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 60 });

export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401, { noStore: true });
  if (limiter.hit(`tenant:${session.tenantId}`)) return json({ ok: false, error: 'rate_limited' }, 429, { noStore: true });

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!isAnchorKind(kind)) return json({ ok: false, error: 'invalid_kind' }, 400, { noStore: true });
  if (!id || id.length > 200) return json({ ok: false, error: 'invalid_id' }, 400, { noStore: true });

  const src = await getRecordProofSource(session.tenantId, kind, id);
  if (!src) return json({ ok: false, error: 'not_found' }, 404, { noStore: true });
  const file = buildRecordProofFile(kind, id, src);
  if (!file) return json({ ok: false, error: 'record_unreadable' }, 409, { noStore: true });

  const name = `almstins-${kind}-${file.digest.slice(0, 12)}.proof.json`;
  return new Response(JSON.stringify(file, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
};
