/**
 * Documents on a receivable — the promissory note, contract, or delivery paperwork.
 *
 * POST   multipart/form-data { receivableId, file }  — attach (authenticated, owner only)
 * GET    ?receivableId=…                             — list metadata (authenticated, owner only)
 * GET    ?t=<token>&id=<documentId>                  — fetch the bytes with a confirmation
 *                                                      token, for the debtor who has no account
 *
 * The bytes do not live here long. Once every confirmation request on the receivable has
 * been answered or has expired, the hourly purge nulls them and leaves the sha256 behind.
 * See purgeDocuments / listPurgeableReceivables in receivablesRegistry.ts.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import {
  addDocument, listDocuments, readDocumentByToken, ownsReceivable,
  DOC_MAX_SIZE_BYTES, DOC_ALLOWED_TYPES,
} from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  const docId = url.searchParams.get('id');

  // Token path: no session, no account. The link is the authority.
  if (token && docId) {
    const found = await readDocumentByToken(token, docId);
    if (!found) return json({ ok: false, error: 'not_found' }, 404);
    return new Response(new Uint8Array(found.data), {
      status: 200,
      headers: {
        'Content-Type': found.meta.mimeType,
        'Content-Disposition': `inline; filename="${found.meta.filename.replace(/["\\]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  const receivableId = String(url.searchParams.get('receivableId') ?? '').trim();
  if (!receivableId) return json({ ok: false, error: 'receivable_required' }, 400);

  // Owner only: listing the paperwork on someone else's receivable is not a read we allow.
  if (!(await ownsReceivable(session.tenantId, receivableId))) {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  return json({ ok: true, documents: await listDocuments(receivableId) });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: 'expected_multipart' }, 400); }

  const receivableId = String(form.get('receivableId') ?? '').trim();
  const file = form.get('file');
  if (!receivableId) return json({ ok: false, error: 'receivable_required' }, 400);
  if (!(file instanceof File)) return json({ ok: false, error: 'file_required' }, 400);
  if (file.size > DOC_MAX_SIZE_BYTES) {
    return json({ ok: false, error: 'too_large', maxBytes: DOC_MAX_SIZE_BYTES }, 413);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await addDocument(session.tenantId, receivableId, {
    filename: file.name || 'document',
    mimeType: file.type || 'application/octet-stream',
    bytes,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : result.error === 'too_large' ? 413
    : result.error === 'unsupported_type' ? 415
    : 400;
  return json({ ...result, allowed: DOC_ALLOWED_TYPES }, status);
};
