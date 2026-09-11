/**
 * GET /api/verify/check?value=<address | payment URL | EMV/UPI payload>&expect=<domain>
 *
 * PUBLIC, login-free — the machine-readable pre-send destination check for payment
 * agents. Same proof registry as /api/verify/lookup, but with an agent-grade contract:
 *
 *   status: 'proven'   — the destination has a live proof of control, and (no `expect`
 *                        given, or the proving domain matches it)
 *           'mismatch' — the destination IS proven, but by a DIFFERENT domain than
 *                        `expect`. The loudest signal here: the invoice says one
 *                        business, the address belongs to another. Never soft-pedaled.
 *           'unknown'  — no proof on record (registered-but-unproven is never
 *                        surfaced as positive, same rule as /lookup)
 *
 * Error semantics differ from /lookup ON PURPOSE. /lookup fails soft (a badge just
 * doesn't render). An agent must be able to tell "verify says no proof" (200 unknown,
 * act on fail-closed policy) from "verify is unavailable" (503, retry) — collapsing an
 * outage into `unknown` would make downtime look like fraud signals.
 *
 * Returns proof status ONLY — never reputation, risk scores, or safe/unsafe judgments;
 * never tenant ids or legal identity (domain + self-chosen label only). Read-only, no
 * upstream fetch at check time (no SSRF surface). Additive-only response contract; `v`
 * bumps only on a breaking change.
 */
import type { APIRoute } from 'astro';
import { getClientIp } from '@/lib/analytics/ip';
import { isValidAddress } from '@/lib/walletChecker';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '@/lib/verifyEntities';
import { isEmvPayload } from '@/lib/paymentQr';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  // Public read-only API: browser-based agents and demos may call cross-origin.
  'Access-Control-Allow-Origin': '*',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

// Own budget, separate from /lookup's — an agent hammering the check must not starve
// the badge lookups (or vice versa). Keyed tiers with higher limits arrive in slice 2.
const HITS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = HITS.get(ip);
  if (!e || now >= e.resetAt) { HITS.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  e.count += 1;
  return e.count > MAX_PER_WINDOW;
}

/**
 * Normalize a caller's `expect` (or a hit's publishing domain) to a bare lowercase
 * hostname: accepts "x-capital.com", "https://x-capital.com/pay", "WWW.X-Capital.com.".
 * Returns null when nothing hostname-shaped survives.
 */
function normDomain(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^https?:\/\//.test(s)) {
    try { s = new URL(s).hostname; } catch { return null; }
  }
  s = s.replace(/^www\./, '').replace(/\.+$/, '').split('/')[0].split(':')[0];
  if (!s || !s.includes('.') || s.length > 253) return null;
  return s;
}

/** True when the proving domain is `expect` itself or any subdomain of it. */
function domainMatches(proving: string, expect: string): boolean {
  return proving === expect || proving.endsWith('.' + expect);
}

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const raw = (url.searchParams.get('value') ?? url.searchParams.get('address') ?? '').trim();
  if (!raw) return json({ ok: false, error: 'value is required' }, 400);

  // Same input discrimination as /lookup: a payment link / EMV / UPI payload vs a
  // crypto address, with the same bounds.
  const isQrValue = /^https?:\/\//i.test(raw) || /^upi:\/\//i.test(raw) || isEmvPayload(raw);
  if (isQrValue) {
    if (raw.length > 1024) return json({ ok: false, error: 'value too long' }, 400);
  } else {
    if (raw.length > 128) return json({ ok: false, error: 'value too long' }, 400);
    if (!isValidAddress(raw)) return json({ ok: false, error: 'invalid address format' }, 400);
  }

  const expectRaw = url.searchParams.get('expect');
  const expect = expectRaw != null && expectRaw.trim() !== '' ? normDomain(expectRaw) : null;
  if (expectRaw != null && expectRaw.trim() !== '' && !expect) {
    return json({ ok: false, error: 'expect must be a domain' }, 400);
  }

  const ip = getClientIp(request) ?? clientAddress ?? 'unknown';
  if (rateLimited(ip)) {
    return json({ ok: false, error: 'rate limited' }, 429, { 'Retry-After': '60' });
  }

  let hit;
  try {
    hit = isQrValue ? await lookupVerifiedUrl(raw) : await lookupVerifiedAddress(raw);
  } catch (err) {
    console.error('[verify-check] error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'check unavailable' }, 503, { 'Retry-After': '30' });
  }

  const provingDomain = normDomain(hit?.domain);
  const status = !hit
    ? 'unknown'
    : expect
      ? (provingDomain && domainMatches(provingDomain, expect) ? 'proven' : 'mismatch')
      : 'proven';

  const since = hit?.since ? String(hit.since).slice(0, 10) : null;
  const proofAgeDays = since
    ? Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000))
    : null;

  return json({
    v: 1,
    status,
    level: hit?.level ?? null,
    domain: hit?.domain ?? null,
    label: hit?.label ?? null,
    chain: hit?.chain ?? null,
    since,
    proofAgeDays,
    checkedAt: new Date().toISOString(),
  });
};

// CORS preflight (Authorization header in slice 2 will trigger these).
export const OPTIONS: APIRoute = () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });

export const POST: APIRoute = () => json({ ok: false, error: 'method not allowed' }, 405);
export const PUT: APIRoute = () => json({ ok: false, error: 'method not allowed' }, 405);
