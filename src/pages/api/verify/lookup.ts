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
 */
import type { APIRoute } from 'astro';
import { isValidAddress } from '@/lib/walletChecker';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '@/lib/verifyEntities';
import { isEmvPayload } from '@/lib/paymentQr';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? clientAddress ?? 'unknown';
  if (rateLimited(ip)) return json({ ok: false, error: 'Too many requests.' }, 429);

  try {
    const hit = isQrValue ? await lookupVerifiedUrl(query) : await lookupVerifiedAddress(query);
    return json({
      ok: true,
      verified: !!hit,
      // Three-tier grade: 'verified' (domain-anchored) or 'claimed' (control only).
      // null when there's no hit (registered/unproven is never surfaced as positive).
      level: hit?.level ?? null,
      source: hit?.source ?? null,
      domain: hit?.domain ?? null,
      label: hit?.label ?? null,
      chain: hit?.chain ?? null,
    });
  } catch (err) {
    console.error('[verify-lookup] error:', err instanceof Error ? err.message : err);
    // Fail closed: never block the page — just report "not verified" (no badge).
    return json({ ok: true, verified: false, level: null, source: null, domain: null, label: null, chain: null });
  }
};

// Reject other methods.
export const POST: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
export const PUT: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
