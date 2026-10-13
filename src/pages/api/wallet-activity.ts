/**
 * POST /api/wallet-activity
 *
 * Public endpoint — no auth required. Backs the wallet checker's Activity tab: first and
 * last activity, transactions sent, native balance, and which chains were read. The same
 * facts /api/wallet-check used to carry; no counterparties, no flows.
 *
 * Separate from /api/wallet-check on purpose: activity is a fact shown to the person and
 * never an input to the verdict, and reading it (several chains, rate-limited explorers)
 * takes seconds. The checker loads it after the verdict, so the verdict never waits, and
 * the Verify screens and mail scanning (verdict only) never pay for it.
 *
 * Same security layers as /api/wallet-check:
 *   1. Server-side address format validation before any fetch (SSRF prevention)
 *   2. Per-IP rate limit: 10 req/min, counted apart from wallet-check's
 *   3. In-memory cache: 5-min TTL (1 min when a chain could not be read)
 *   4. Upstream timeouts (src/lib/evmActivity.ts)
 *   5. Sanitized error responses — no stack traces, no env var names
 *   6. Checked addresses are NEVER written to the database or logged
 */

import type { APIRoute } from 'astro';
import { clientIpKey } from '@/lib/rateLimit';
import {
  isValidAddress,
  checkActivityRateLimit,
  getCachedActivity,
  setCachedActivity,
  fetchWalletActivity,
} from '@/lib/walletChecker';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const raw = (body as any)?.address;
  if (typeof raw !== 'string') {
    return json({ ok: false, error: 'address is required' }, 400);
  }

  const address = raw.trim();

  // ── Input validation (SSRF prevention — must pass before any fetch) ─────────
  if (address.length > 128) {
    return json({ ok: false, error: 'Address too long' }, 400);
  }
  if (!isValidAddress(address)) {
    return json({ ok: false, error: 'Invalid wallet address format' }, 400);
  }

  // ── Rate limit ───────────────────────────────────────────────────────────────
  // Keyed on the Cloudflare-set client IP (an IPv6 client by its /64).
  if (!checkActivityRateLimit(clientIpKey(request))) {
    return json(
      { ok: false, error: 'Too many requests. Please wait a minute and try again.' },
      429,
    );
  }

  const cached = getCachedActivity(address);
  if (cached) return json({ ok: true, ...cached, cached: true });

  try {
    const result = await fetchWalletActivity(address);
    setCachedActivity(address, result);
    return json({ ok: true, ...result, cached: false });
  } catch (err) {
    // Sanitized — do not expose internal details
    console.error('[wallet-activity] unexpected error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'Activity check failed. Please try again.' }, 500);
  }
};

// Reject all other methods
export const GET: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
export const PUT: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
