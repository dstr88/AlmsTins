/**
 * GET /api/verify/check?value=<address | payment URL | EMV/UPI payload>&expect=<domain>
 *
 * PUBLIC, login-free — the machine-readable pre-send destination check for payment
 * agents. Same proof registry as /api/verify/lookup, but with an agent-grade contract:
 *
 *   status: 'proven'     — level is 'verified' (a fresh domain anchor exists), and (no
 *                          `expect` given, or the anchoring domain matches it)
 *           'mismatch'   — level is 'verified', but the anchoring domain is DIFFERENT
 *                          from `expect`. The loudest signal here: the invoice says one
 *                          business, the address belongs to another. Never soft-pedaled.
 *           'unanchored' — the destination HAS a proof on record (a self-send, a lapsed
 *                          listing, or a payment link registered to an account), but no
 *                          domain currently vouches for it. Not a fraud signal — treat it
 *                          the way `unknown` is treated: hold and confirm out of band.
 *           'unknown'    — no proof on record at all (registered-but-unproven is never
 *                          surfaced as positive, same rule as /lookup)
 *
 * C5/S7b (this contract, replacing the earlier domain-match-only one): `status` used to
 * come from the domain match alone, so a stale anchor, or a self-send wallet whose
 * account merely HELD a business name, both answered `proven`; a self-send wallet with no
 * name answered `mismatch` whenever `expect` was passed. Gating on `level` first closes
 * both: only a currently-verified answer can be `proven` or `mismatch`, and `domain`
 * below is now always the domain that actually anchors THIS destination (provingDomain),
 * never the account's business name — see VerifiedAddressHit in verifyEntities.ts.
 *
 * Error semantics differ from /lookup ON PURPOSE. /lookup fails soft (a badge just
 * doesn't render). An agent must be able to tell "verify says no proof" (200 unknown,
 * act on fail-closed policy) from "verify is unavailable" (503, retry) — collapsing an
 * outage into `unknown` would make downtime look like fraud signals.
 *
 * Returns proof status ONLY — never reputation, risk scores, or safe/unsafe judgments;
 * never tenant ids or legal identity. `label` is returned only alongside a `proven` or
 * `mismatch` answer, and only when it derives from `domain` under the same rule public
 * cards use (displayableName) — never the account's raw freeform text, which is never an
 * identity we can vouch for (S7b: the same "no freeform label, ever, in public" rule
 * verifyPublicCard.ts already enforces for wallet-checker and /verify/scan). Read-only, no
 * upstream fetch at check time (no SSRF surface). Additive-only response contract; `v`
 * bumps only on a breaking change — a new `status` value is additive (an agent that reads
 * status verbatim without an exhaustive switch already treats anything but `proven` as a
 * hold, per /verify/agents).
 */
import type { APIRoute } from 'astro';
import { getClientIp } from '@/lib/analytics/ip';
import { isValidAddress } from '@/lib/walletChecker';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '@/lib/verifyEntities';
import { displayableName } from '@/lib/verifyPublicCard';
import { isEmvPayload } from '@/lib/paymentQr';
import { authenticateAgentKey } from '@/lib/agentKeys';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  // Public read-only API: browser-based agents and demos may call cross-origin.
  'Access-Control-Allow-Origin': '*',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

// Own budget, separate from /lookup's — an agent hammering the check must not starve
// the badge lookups (or vice versa). Anonymous callers get a per-IP budget; a
// domain-proven key (see /api/verify/agent-keys) gets a fleet-scale per-key budget.
const HITS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const ANON_PER_WINDOW = 30;
const KEYED_PER_WINDOW = 300;
function rateLimited(bucket: string, max: number): boolean {
  const now = Date.now();
  const e = HITS.get(bucket);
  if (!e || now >= e.resetAt) { HITS.set(bucket, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  e.count += 1;
  return e.count > max;
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

  // A presented key must be valid — a dead or malformed key gets 401, never a silent
  // downgrade to anonymous, because an agent fleet needs to KNOW its key stopped working.
  const authz = request.headers.get('authorization') ?? '';
  const bearer = authz.replace(/^Bearer\s+/i, '').trim();
  let keyId: string | null = null;
  if (bearer) {
    const key = await authenticateAgentKey(bearer);
    if (!key) return json({ ok: false, error: 'invalid key' }, 401);
    keyId = key.id;
  }

  const bucket = keyId ? `k:${keyId}` : `ip:${getClientIp(request) ?? clientAddress ?? 'unknown'}`;
  if (rateLimited(bucket, keyId ? KEYED_PER_WINDOW : ANON_PER_WINDOW)) {
    return json({ ok: false, error: 'rate limited' }, 429, { 'Retry-After': '60' });
  }

  let hit;
  try {
    hit = isQrValue ? await lookupVerifiedUrl(raw) : await lookupVerifiedAddress(raw);
  } catch (err) {
    console.error('[verify-check] error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'check unavailable' }, 503, { 'Retry-After': '30' });
  }

  // The domain that actually vouches for this destination right now, never the account's
  // business-name domain (VerifiedAddressHit.provingDomain — null whenever level isn't
  // 'verified', so this branch never runs on a stale or control-only hit).
  const provingDomain = normDomain(hit?.provingDomain);
  const status =
    !hit ? 'unknown'
    : hit.level !== 'verified' ? 'unanchored'
    : expect ? (provingDomain && domainMatches(provingDomain, expect) ? 'proven' : 'mismatch')
    : 'proven';
  const anchored = status === 'proven' || status === 'mismatch';

  const since = hit?.since ? String(hit.since).slice(0, 10) : null;
  const proofAgeDays = since
    ? Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 86_400_000))
    : null;
  // A shown label always derives from `domain` (never the account's raw text) — the same
  // rule verifyPublicCard.ts uses for the wallet-checker and /verify/scan cards.
  const label = anchored && provingDomain ? displayableName(hit?.label ?? null, provingDomain) : null;

  return json({
    v: 1,
    status,
    level: hit?.level ?? null,
    domain: anchored ? provingDomain : null,
    label,
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
