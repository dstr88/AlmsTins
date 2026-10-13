/**
 * POST /api/verify/receivables/precheck — the duplicate check while the invoice is still being
 * typed in (Addendum A), before anything is saved.
 *
 * Body: { supplier?, buyer, invoiceNo?, face, currency, details?: { buyerRef? }, isTest? }, the
 * create form's fields. Needs a debtor, a positive face, a currency, and an invoice number or a
 * debtor reference (400 otherwise). Answers the same duplicateCheck the create would return for
 * those fields: a verified account (verified email, or a Google or GitHub sign-in) gets
 * { ok, duplicateCheck, ownMatches }, any other account { ok, duplicateCheck: { state } }.
 *
 * Writes nothing and logs nothing about the fields. It warns; the form stays free to submit.
 *
 * Signed in only, never public (not in isPublicPath): 401 without a session, 403 for the demo
 * account. Limits: 60 a minute per account and 120 a minute per client address (429,
 * Retry-After). Body capped at 4 KB (413). No CORS, no-store. 503 when the store fails.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { previewDuplicateCheck } from '@/lib/receivablesRegistry';
import { stateOnly } from '@/lib/receivables/duplicateCheck';
import { isVerifiedViewer } from '@/lib/receivables/server/viewerTier';
import { kickFingerprintBackfill } from '@/lib/receivables/server/fingerprintBackfill';
import { createFixedWindowLimiter, clientIpKey } from '@/lib/rateLimit';
import { admitByKey, methodNotAllowed, publicJson, readCappedJson } from '@/lib/http/publicApi';

export const prerender = false;

const MAX_BODY_BYTES = 4096;
const WINDOW_MS = 60_000;
const tenantLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 60 });
const ipLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 120 });
const RATE_LIMITED = { body: { ok: false, error: 'rate_limited' }, retryAfterSeconds: WINDOW_MS / 1000 };

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return publicJson({ ok: false, error: 'unauthenticated' }, 401);
  // The demo account is shared by every visitor, so it gets no lookup a signed-in account is
  // limited to (owner decision 9). The middleware's demo guard answers first in production.
  if (session.isDemo) return publicJson({ ok: false, error: 'demo_readonly' }, 403);

  const limited = admitByKey(tenantLimiter, `tenant:${session.tenantId}`, RATE_LIMITED)
    ?? admitByKey(ipLimiter, clientIpKey(request), RATE_LIMITED);
  if (limited) return limited;

  const read = await readCappedJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body && typeof read.body === 'object' ? read.body : {}) as Record<string, unknown>;
  const details = body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : null;

  kickFingerprintBackfill();
  try {
    const result = await previewDuplicateCheck({
      supplier: str(body.supplier),
      buyer: str(body.buyer),
      invoiceNo: str(body.invoiceNo),
      face: Number(body.face),
      currency: str(body.currency),
      details: details ? { buyerRef: str(details.buyerRef) } : null,
      isTest: body.isTest === true,
    }, session.tenantId);
    if (!result.ok) return publicJson(result, 400);
    const verified = await isVerifiedViewer(request);
    return publicJson(verified
      ? { ok: true, duplicateCheck: result.duplicateCheck, ownMatches: result.ownMatches }
      : { ok: true, duplicateCheck: stateOnly(result.duplicateCheck) });
  } catch {
    console.error('[receivables-precheck] store unavailable');
    return publicJson({ ok: false, error: 'unavailable' }, 503);
  }
};

export const GET: APIRoute = () => methodNotAllowed({ ok: false, error: 'Method not allowed' }, 'POST');
