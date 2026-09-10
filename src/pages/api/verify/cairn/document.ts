/**
 * Paperwork on a milestone — both directions of the banker's-form workflow.
 *
 * POST  multipart { milestoneId, file }   — the lender attaches the report form (authenticated)
 * POST  multipart { token, file }         — the inspector uploads the completed, signed copy
 *                                           through the still-open single-use token (public)
 * GET   ?t=<token>&id=<documentId>        — bytes for the inspector: open, fill, print (public)
 * GET   ?id=<documentId>                  — bytes for the owner reviewing what came back
 * GET   ?milestoneId=…                    — metadata list (authenticated, owner only)
 *
 * Every file's sha256 is bound into the signed attestation at answer time, so the form the
 * inspector printed and the copy they uploaded are both provably the ones on record.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import {
  addMilestoneDocument, addCairnDocumentByToken, listMilestoneDocuments,
  readCairnDocument, readCairnDocumentByToken,
  CAIRN_DOC_MAX_SIZE_BYTES, CAIRN_DOC_ALLOWED_TYPES,
} from '@/lib/cairnRegistry';
import { db } from '@/lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fileResponse = (found: { meta: { mimeType: string; filename: string }; data: Buffer }) =>
  new Response(new Uint8Array(found.data), {
    status: 200,
    headers: {
      'Content-Type': found.meta.mimeType,
      'Content-Disposition': `inline; filename="${found.meta.filename.replace(/["\\]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  const docId = url.searchParams.get('id');

  // Token path: no session, no account. The link is the authority.
  if (token && docId) {
    const found = await readCairnDocumentByToken(token, docId);
    if (!found) return json({ ok: false, error: 'not_found' }, 404);
    return fileResponse(found);
  }

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);

  if (docId) {
    const found = await readCairnDocument(session.tenantId, docId);
    if (!found) return json({ ok: false, error: 'not_found' }, 404);
    return fileResponse(found);
  }

  const milestoneId = String(url.searchParams.get('milestoneId') ?? '').trim();
  if (!milestoneId) return json({ ok: false, error: 'milestone_required' }, 400);
  const owns = await db.execute({
    sql: `SELECT 1 FROM cairn_milestones WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [milestoneId, session.tenantId],
  });
  if (!owns.rows.length) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, documents: await listMilestoneDocuments(milestoneId) });
};

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: 'expected_multipart' }, 400); }

  const file = form.get('file');
  if (!(file instanceof File)) return json({ ok: false, error: 'file_required' }, 400);
  if (file.size > CAIRN_DOC_MAX_SIZE_BYTES) {
    return json({ ok: false, error: 'too_large', maxBytes: CAIRN_DOC_MAX_SIZE_BYTES }, 413);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const input = {
    filename: file.name || 'document',
    mimeType: file.type || 'application/octet-stream',
    bytes,
  };

  // Inspector path: the open token is the authority, same as answering. `kind` says what
  // the file is — completed report, site photo, or drawn signature.
  const token = String(form.get('token') ?? '').trim();
  if (token) {
    const kind = String(form.get('kind') ?? '') as 'report' | 'photo' | 'signature';
    // Optional device-reported capture location (site photos). The registry validates and
    // clamps; garbage coordinates simply store no location.
    const location = form.get('lat') != null
      ? { lat: Number(form.get('lat')), lon: Number(form.get('lon')), accuracyM: Number(form.get('accuracy')) }
      : undefined;
    const result = await addCairnDocumentByToken(token, { ...input, kind, location });
    if (result.ok) return json(result);
    const status =
      result.error === 'not_found' ? 404
      : ['expired', 'revoked', 'used'].includes(result.error) ? 410
      : result.error === 'too_large' ? 413
      : result.error === 'unsupported_type' ? 415
      : 400;
    return json({ ...result, allowed: CAIRN_DOC_ALLOWED_TYPES }, status);
  }

  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const milestoneId = String(form.get('milestoneId') ?? '').trim();
  if (!milestoneId) return json({ ok: false, error: 'milestone_required' }, 400);
  const result = await addMilestoneDocument(session.tenantId, milestoneId, input);
  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : result.error === 'too_large' ? 413
    : result.error === 'unsupported_type' ? 415
    : 400;
  return json({ ...result, allowed: CAIRN_DOC_ALLOWED_TYPES }, status);
};
