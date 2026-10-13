/**
 * POST /api/verify/anchor
 *
 * PUBLIC, login-free. Anchors a caller-supplied SHA-256 digest to Bitcoin via
 * OpenTimestamps, or upgrades a pending receipt once Bitcoin has confirmed it.
 * It only ever sees a 32-byte hash — never a key, a record, or any identity — so
 * there is no signing, no attribution, and no SSRF surface beyond the fixed
 * OpenTimestamps calendar servers the library talks to.
 *
 * Backs the /artifacts/sandbox "anchor to Bitcoin" step. Two shapes share the route:
 *   { digest: "<64 hex>" }                    -> stamp: returns a pending receipt
 *   { upgrade: true, receipt: AnchorReceipt } -> upgrade: fills in the Bitcoin block
 *                                                time once the calendars carry it (~1-2h)
 *
 * The stamp is a fresh calendar submission, so anchoredAt is null until Bitcoin
 * confirms; the caller re-checks later via the upgrade shape (or with the .ots and
 * the standard OpenTimestamps client). Non-fatal: calendar hiccups return ok:false,
 * never a 500, so the sandbox still shows the signed proof.
 */
import type { APIRoute } from 'astro';
import { clientIpKey, createFixedWindowLimiter } from '@/lib/rateLimit';
import { OpenTimestampsAnchor } from '@/lib/rwaProof/anchorOpenTimestamps';
import type { AnchorReceipt } from '@/lib/rwaProof/types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Per-client limiter — calendar submissions are cheap but external, so keep it modest.
// Keyed on the Cloudflare-set client IP (an IPv6 client by its /64), never on Astro's
// client address, which is the caller-set leftmost X-Forwarded-For; bounded so unique keys
// can't grow memory without limit.
const anchorLimiter = createFixedWindowLimiter({ windowMs: 60_000, max: 12 });

const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);

export const POST: APIRoute = async ({ request }) => {
  if (anchorLimiter.hit(clientIpKey(request))) return json({ ok: false, error: 'rate_limited' }, 429);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const anchor = new OpenTimestampsAnchor();

  try {
    // upgrade a pending receipt -> Bitcoin confirmation
    if (body?.upgrade) {
      const receipt = body.receipt as AnchorReceipt | undefined;
      if (!receipt || receipt.type !== 'opentimestamps' || typeof receipt.receipt !== 'string' || !isHex64(receipt.digest)) {
        return json({ ok: false, error: 'invalid_receipt' }, 400);
      }
      const upgraded = await anchor.upgrade(receipt);
      return json({ ok: true, anchor: upgraded });
    }

    // stamp a fresh digest -> pending receipt
    if (!isHex64(body?.digest)) {
      return json({ ok: false, error: 'digest must be 64 hex chars (sha-256)' }, 400);
    }
    const receipt = await anchor.stamp(body.digest.toLowerCase());
    return json({ ok: true, anchor: receipt });
  } catch (err) {
    // Calendars unreachable, package missing, etc. — non-fatal for the caller.
    return json({ ok: false, error: 'anchor_unavailable', detail: String((err as Error)?.message || err) }, 502);
  }
};
