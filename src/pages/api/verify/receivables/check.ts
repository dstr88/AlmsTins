/**
 * POST /api/verify/receivables/check: "Seen before?" (S5). Whether an invoice is already on record
 * at Almstins, asked before anyone advances against it, by someone who holds no receivable ID.
 *
 * Body: { invoice: { supplier, buyer, invoiceNo, face, currency, buyerRef? }, test? }, read by
 * parseSeenBeforeBody (400 with its message otherwise). The match is on the invoice key only, across
 * every account (src/lib/receivables/server/seenBeforeStore.ts). A verified account (verified
 * email, or a Google or GitHub sign-in) gets the full answer (FULL_ANSWER_KEYS), any other account
 * { v, found, test, checkedAt } only. No answer carries another record's ID, its account, its
 * invoice text, its amount or a hash.
 *
 * Writes nothing and logs nothing about the fields. It warns; the person decides.
 *
 * Signed in only, never public (not in isPublicPath; no anonymous tier and no agent-key tier in S5):
 * 401 with a sign-in prompt without a session, 403 for the demo account. Limits: 60 a minute per
 * account and 120 a minute per client address (429, Retry-After 60). Body capped at 4 KB (413). No
 * CORS, no-store. When the check cannot run (no key, fingerprints still being computed, or a store
 * error) the answer is 503 check_unavailable with Retry-After 30, never found: false.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isVerifiedViewer } from '@/lib/receivables/server/viewerTier';
import { kickFingerprintBackfill } from '@/lib/receivables/server/fingerprintBackfill';
import { readSeenBefore, type SeenBeforeRead } from '@/lib/receivables/server/seenBeforeStore';
import {
  SEEN_BEFORE_LIMITS,
  SEEN_BEFORE_MAX_BYTES,
  parseSeenBeforeBody,
  summarizeMatches,
} from '@/lib/receivables/seenBefore';
import { SEEN_BEFORE_DEMO, SEEN_BEFORE_SIGN_IN, SEEN_BEFORE_UNAVAILABLE } from '@/lib/receivables/copy/seenBefore';
import { receivablesLogin } from '@/lib/receivables/paths';
import { createFixedWindowLimiter, clientIpKey } from '@/lib/rateLimit';
import { admitByKey, methodNotAllowed, publicJson, readCappedJson } from '@/lib/http/publicApi';

export const prerender = false;

const WINDOW_MS = 60_000;
// This route's own budgets, apart from the precheck's.
const tenantLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: SEEN_BEFORE_LIMITS.perTenantPerMinute });
const ipLimiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: SEEN_BEFORE_LIMITS.perIpPerMinute });
const RATE_LIMITED = { body: { ok: false, error: 'rate_limited' }, retryAfterSeconds: WINDOW_MS / 1000 };

/** 503: the check did not run. Never an answer about the invoice. */
const unavailable = () =>
  publicJson({ ok: false, error: 'check_unavailable', message: SEEN_BEFORE_UNAVAILABLE }, 503, { 'Retry-After': '30' });

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  // app.ts answers a signed-out call first in production; this is the route's own prompt.
  if (!session) {
    return publicJson({ ok: false, error: 'unauthenticated', message: SEEN_BEFORE_SIGN_IN, signIn: receivablesLogin('/receivables') }, 401);
  }
  // The demo account is shared by every visitor, so it gets no cross-account read (owner decision 9).
  if (session.isDemo) return publicJson({ ok: false, error: 'demo_readonly', message: SEEN_BEFORE_DEMO }, 403);

  const limited = admitByKey(tenantLimiter, `tenant:${session.tenantId}`, RATE_LIMITED)
    ?? admitByKey(ipLimiter, clientIpKey(request), RATE_LIMITED);
  if (limited) return limited;

  const body = await readCappedJson(request, SEEN_BEFORE_MAX_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseSeenBeforeBody(body.body);
  if (!parsed.ok) return publicJson({ ok: false, error: 'invalid', message: parsed.message }, 400);

  kickFingerprintBackfill();
  let read: SeenBeforeRead;
  try {
    read = await readSeenBefore(parsed.input);
  } catch {
    console.error('[receivables-check] store unavailable');
    return unavailable();
  }
  if (read.state === 'unavailable') return unavailable();

  const verified = await isVerifiedViewer(request);
  const s = summarizeMatches(read.rows, { refChecked: read.refChecked, test: parsed.input.isTest, checkedAt: new Date().toISOString() });
  // One literal per tier: the docs pin these keys, in this order.
  if (verified) {
    return publicJson({ v: 1, found: s.found, matches: s.matches, status: s.status, anyFinanced: s.anyFinanced, financing: s.financing, claimsAffirmed: s.claimsAffirmed, anySettled: s.anySettled, anyStale: s.anyStale, staleSince: s.staleSince, debtor: s.debtor, withdrawn: s.withdrawn, refChecked: s.refChecked, refMatch: s.refMatch, firstSeen: s.firstSeen, test: s.test, checkedAt: s.checkedAt });
  }
  return publicJson({ v: 1, found: s.found, test: s.test, checkedAt: s.checkedAt });
};

const usePost: APIRoute = () => methodNotAllowed({ ok: false, error: 'use_post' }, 'POST');
export const GET = usePost;
export const PUT = usePost;
export const DELETE = usePost;
export const PATCH = usePost;
