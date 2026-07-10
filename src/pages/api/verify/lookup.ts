/**
 * GET /api/verify/lookup?address=<addr-or-url>
 *
 * PUBLIC, login-free. Answers one question: has someone proven this destination is
 * theirs with Almstins? Two inputs share the endpoint:
 *   - a crypto ADDRESS → an entity's domain-published address, or a merchant's proven
 *     self-listing (the `address` param name is kept for back-compat)
 *   - an http(s) URL / payment LINK → a merchant's proven QR (account_claim)
 * Returns ONLY the publishing domain / the merchant's self-chosen label — never
 * tenant_id, the managing account, or any legal identity (the no-attribution boundary).
 * Read-only; the queried value is never written anywhere.
 *
 * Backs the "Verified publisher" badge on the public wallet-checker. Bounded input
 * (format-validated, length-capped) + a per-IP rate limit independent of the
 * wallet-check budget. Makes no upstream fetch (no SSRF surface).
 *
 * Rate limits: 30 req/min (unauthenticated IP), 60/min (X-Api-Key)
 */
import type { APIRoute } from 'astro';
import { isValidAddress } from '@/lib/walletChecker';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '@/lib/verifyEntities';
import { getClientIp } from '@/lib/analytics/ip';
import { isEmvPayload } from '@/lib/paymentQr';
import { validateApiKey, checkKeyRateLimit } from '@/lib/apiKeys';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// Lightweight per-IP limiter, separate from /api/wallet-check's budget. 30 req/min.
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

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const raw = url.searchParams.get('address');
  if (typeof raw !== 'string' || !raw.trim()) {
    return json({ ok: false, error: 'address is required' }, 400);
  }
  const query = raw.trim();
  // A "QR" value is a URL (Stripe/PayPal), an EMV/PIX TLV string, or a UPI intent URI —
  // all matched against kind='qr' destinations. Anything else must be a crypto address.
  const isQrValue = /^https?:\/\//i.test(query) || /^upi:\/\//i.test(query) || isEmvPayload(query);
  if (isQrValue) {
    if (query.length > 1024) return json({ ok: false, error: 'Value too long' }, 400);
  } else {
    if (query.length > 128) return json({ ok: false, error: 'Address too long' }, 400);
    if (!isValidAddress(query)) return json({ ok: false, error: 'Invalid address format' }, 400);
  }

  // Rate limiting — API key takes precedence over IP
  const apiKeyHeader = request.headers.get('x-api-key');
  if (apiKeyHeader) {
    const keyData = await validateApiKey(apiKeyHeader);
    if (!keyData) return json({ ok: false, error: 'Invalid API key.' }, 401);
    if (!checkKeyRateLimit(keyData.keyId, keyData.rateLimitPerMin)) {
      return json({ ok: false, error: 'Too many requests.' }, 429);
    }
  } else {
    const ip = getClientIp(request) ?? clientAddress ?? 'unknown';
    if (rateLimited(ip)) return json({ ok: false, error: 'Too many requests.' }, 429);
  }

  try {
    const hit = isQrValue ? await lookupVerifiedUrl(query) : await lookupVerifiedAddress(query);
    return json({
      ok: true,
      verified: !!hit,
      source: hit?.source ?? null,
      domain: hit?.domain ?? null,
      label: hit?.label ?? null,
      chain: hit?.chain ?? null,
    });
  } catch (err) {
    console.error('[verify-lookup] error:', err instanceof Error ? err.message : err);
    // Fail closed: never block the page — just report "not verified" (no badge).
    return json({ ok: true, verified: false, source: null, domain: null, label: null, chain: null });
  }
};

// Reject other methods.
export const POST: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
export const PUT: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
