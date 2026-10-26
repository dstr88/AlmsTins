/**
 * POST /api/verify/receivables — create + sign a receivable (authenticated).
 *
 * Returns the receivable ID (SHA-256 of the signed creation manifest). That ID is the
 * capability: hand it to a counterparty and they can query the receivable's financing
 * status via GET /api/verify/receivables/lookup. Writes are tenant-scoped; the ID and
 * status reads never expose tenant_id.
 *
 * Duplicate check (S3): the answer carries duplicateCheck, whether another record at Almstins
 * matches this one. A verified account (verified email, or a Google or GitHub sign-in) gets the
 * full answer plus ownMatches, its own matching records; any other account gets { state } only.
 * The same tiering applies to the 409 id_collision. Creation is never refused because of a match.
 * Limits: 120 creates an hour per account and 300 an hour per client address (429, Retry-After).
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { createReceivable, listReceivables, deleteReceivable } from '@/lib/receivablesRegistry';
import { stateOnly, type DuplicateCheck } from '@/lib/receivables/duplicateCheck';
import { isVerifiedViewer } from '@/lib/receivables/server/viewerTier';
import { kickFingerprintBackfill } from '@/lib/receivables/server/fingerprintBackfill';
import { createFixedWindowLimiter, clientIpKey } from '@/lib/rateLimit';
import { admitByKey } from '@/lib/http/publicApi';
import { json } from '@/lib/http';

export const prerender = false;

const HOUR_MS = 3_600_000;
const tenantLimiter = createFixedWindowLimiter({ windowMs: HOUR_MS, max: 120 });
const ipLimiter = createFixedWindowLimiter({ windowMs: HOUR_MS, max: 300 });
const RATE_LIMITED = { body: { ok: false, error: 'rate_limited' }, retryAfterSeconds: HOUR_MS / 1000 };

/** The duplicate facts an account may see: everything when verified, the state alone otherwise. */
function tiered<T extends { duplicateCheck: DuplicateCheck; ownMatches?: unknown }>(result: T, verified: boolean) {
  if (verified) return result;
  const { ownMatches: _own, duplicateCheck, ...rest } = result;
  return { ...rest, duplicateCheck: stateOnly(duplicateCheck) };
}

// List the receivables this tenant created (so they don't have to keep the IDs).
// A signed-out visitor simply has no receivables to list, so return an empty list
// (200) rather than 401. The public /verify/registry page fetches this on load; a 401
// there logs a console error for every anonymous visitor with nothing to hide. This
// leaks nothing (no tenant, no data) — writes (POST/DELETE) below stay strictly 401.
export const GET: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: true, receivables: [] });
  const receivables = await listReceivables(session.tenantId);
  return json({ ok: true, receivables });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  const limited = admitByKey(tenantLimiter, `tenant:${session.tenantId}`, RATE_LIMITED)
    ?? admitByKey(ipLimiter, clientIpKey(request), RATE_LIMITED);
  if (limited) return limited;
  kickFingerprintBackfill();

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const result = await createReceivable(session.tenantId, {
    supplier: String(body.supplier ?? ''),
    buyer: String(body.buyer ?? ''),
    invoiceNo: String(body.invoiceNo ?? ''),
    face: Number(body.face),
    currency: String(body.currency ?? 'NGN'),
    terms: body.terms ?? null,
    dueDate: body.dueDate ?? null,
    acknowledgedAt: body.acknowledgedAt ?? null,
    rtype: body.rtype ?? null,
    paymentMethod: body.paymentMethod ?? null,
    details: body.details ?? null,
    isTest: body.isTest === true,
  });

  // A record this tenant withdrew comes back when it records the same details: 200 with
  // restored: true. Another tenant's identical record answers id_collision even once withdrawn.
  if (result.ok) return json(tiered(result, await isVerifiedViewer(request)));
  if (result.error === 'id_collision') return json(tiered(result, await isVerifiedViewer(request)), 409);
  return json(result, 400);
};

// Withdraw a receivable this tenant created (S2 soft delete): nothing is removed. Its open
// requests stop working, pending offers end and attached files drop to their fingerprints, while
// every claim and statement on it stays on file. 200 { withdrawn, withdrawnAt } (again on a
// repeat), 404 when it is not this tenant's, 503 while the deleted_at column is not confirmed.
export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await requireTenantSession(request);
  if (!session) return json({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return json({ ok: false, error: 'demo_readonly' }, 403);

  let id = url.searchParams.get('id') ?? '';
  if (!id) { try { id = String((await request.json())?.id ?? ''); } catch { /* ignore */ } }

  const result = await deleteReceivable(session.tenantId, id);
  if (result.ok) return json({ ok: true, withdrawn: true, withdrawnAt: result.withdrawnAt });
  return json(result, result.error === 'unavailable' ? 503 : 404);
};
