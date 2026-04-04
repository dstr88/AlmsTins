/**
 * POST /api/wallet-check
 *
 * Public endpoint — no auth required.
 *
 * Security layers:
 *   1. maxlength enforced client-side (128 chars)
 *   2. Server-side address format validation (SSRF prevention)
 *   3. Per-IP rate limit: 10 req/min
 *   4. In-memory result cache: 5-min TTL, 500 entry max
 *   5. 8-second upstream timeouts
 *   6. Sanitized error responses — no stack traces, no env var names
 *   7. Checked addresses are NEVER written to the database
 */

import type { APIRoute } from 'astro';
import {
  isValidAddress,
  checkRateLimit,
  getCached,
  setCache,
  checkWallet,
} from '@/lib/walletChecker';
import { db } from '@/lib/db';
import { hashWithSalt } from '@/lib/analytics/hash';
import { getClientIp } from '@/lib/analytics/ip';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // ── Parse body ──────────────────────────────────────────────────────────────
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
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    clientAddress ??
    'unknown';

  if (!checkRateLimit(ip)) {
    return json(
      { ok: false, error: 'Too many requests. Please wait a minute and try again.' },
      429,
    );
  }

  // ── Detect chain ─────────────────────────────────────────────────────────────
  const chain = /^0x[0-9a-fA-F]{40}$/.test(address) ? 'evm'
    : /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) ? 'btc'
    : /^bc1[a-z0-9]{6,87}$/.test(address) ? 'btc'
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? 'sol'
    : 'unknown';

  // ── Helper: log the check (fire-and-forget, never blocks the response) ───────
  const logCheck = (cacheHit: boolean) => {
    const ipHash   = hashWithSalt(getClientIp(request) ?? ip);
    const addrHash = hashWithSalt(address);
    db.execute({
      sql: `INSERT INTO wallet_check_log (created_at, ip_hash, addr_hash, chain, cache_hit)
            VALUES (?, ?, ?, ?, ?)`,
      args: [new Date().toISOString(), ipHash, addrHash, chain, cacheHit ? 1 : 0],
    }).catch((e) => console.warn('[wallet-check] log failed:', e instanceof Error ? e.message : e));
  };

  // ── Cache hit ────────────────────────────────────────────────────────────────
  const cached = getCached(address);
  if (cached) {
    logCheck(true);
    return json({ ok: true, result: cached, cached: true });
  }

  // ── Check wallet ─────────────────────────────────────────────────────────────
  try {
    const result = await checkWallet(address);
    setCache(address, result);
    logCheck(false);
    return json({ ok: true, result, cached: false });
  } catch (err) {
    // Sanitized — do not expose internal details
    console.error('[wallet-check] unexpected error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'Check failed. Please try again.' }, 500);
  }
};

// Reject all other methods
export const GET: APIRoute  = () => json({ ok: false, error: 'Method not allowed' }, 405);
export const PUT: APIRoute  = () => json({ ok: false, error: 'Method not allowed' }, 405);
