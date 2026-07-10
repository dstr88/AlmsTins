/**
 * GET  /api/wallet-check?address=  — public, address from query param
 * POST /api/wallet-check           — public, address from JSON body
 *
 * Security layers:
 *   1. maxlength enforced client-side (128 chars)
 *   2. Server-side address format validation (SSRF prevention)
 *   3. Per-IP rate limit: 10 req/min (unauthenticated)
 *   4. API key rate limit: up to 60/min (X-Api-Key header)
 *   5. In-memory result cache: 5-min TTL, 500 entry max
 *   6. 8-second upstream timeouts
 *   7. Sanitized error responses — no stack traces, no env var names
 *   8. Checked addresses are logged only as irreversible one-way hashes — the raw
 *      address is never stored and the log cannot be reversed to identify what was checked
 */

import type { APIRoute } from 'astro';
import {
  isValidAddress,
  checkRateLimit,
  getCached,
  setCache,
  checkWallet,
} from '@/lib/walletChecker';
import { recordCheck } from '@/lib/checkLog';
import { getClientIp } from '@/lib/analytics/ip';
import { validateApiKey, checkKeyRateLimit } from '@/lib/apiKeys';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ── Shared handler ────────────────────────────────────────────────────────────

async function handleCheck(address: string, ip: string, apiKeyHeader: string | null, req?: Request) {
  // Input validation
  if (address.length > 128) {
    return json({ ok: false, error: 'Address too long' }, 400);
  }
  if (!isValidAddress(address)) {
    return json({ ok: false, error: 'Invalid wallet address format' }, 400);
  }

  // Rate limiting — API key takes precedence over IP
  if (apiKeyHeader) {
    const keyData = await validateApiKey(apiKeyHeader);
    if (!keyData) {
      return json({ ok: false, error: 'Invalid API key.' }, 401);
    }
    if (!checkKeyRateLimit(keyData.keyId, keyData.rateLimitPerMin)) {
      return json({ ok: false, error: 'Too many requests.' }, 429);
    }
  } else {
    if (!checkRateLimit(ip)) {
      return json(
        { ok: false, error: 'Too many requests. Please wait a minute and try again.' },
        429,
      );
    }
  }

  // Detect chain
  const chain = /^0x[0-9a-fA-F]{40}$/.test(address) ? 'evm'
    : /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) ? 'btc'
    : /^bc1[a-z0-9]{6,87}$/.test(address) ? 'btc'
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? 'sol'
    : 'unknown';

  const logCheck = (cacheHit: boolean) =>
    recordCheck({ kind: 'wallet', subject: address, request: req ?? new Request('https://almstins.com'), fallbackIp: ip, chain, cacheHit });

  // Cache hit
  const cached = getCached(address);
  if (cached) {
    logCheck(true);
    return json({ ok: true, result: cached, cached: true });
  }

  // Live check
  try {
    const result = await checkWallet(address);
    setCache(address, result);
    logCheck(false);
    return json({ ok: true, result, cached: false });
  } catch (err) {
    console.error('[wallet-check] unexpected error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'Check failed. Please try again.' }, 500);
  }
}

// ── Route exports ─────────────────────────────────────────────────────────────

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const raw = url.searchParams.get('address')?.trim() ?? '';
  if (!raw) return json({ ok: false, error: 'address is required' }, 400);

  const ip = getClientIp(request) ?? clientAddress ?? 'unknown';
  const apiKeyHeader = request.headers.get('x-api-key');

  return handleCheck(raw, ip, apiKeyHeader, request);
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
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

  const ip = getClientIp(request) ?? clientAddress ?? 'unknown';
  const apiKeyHeader = request.headers.get('x-api-key');

  return handleCheck(raw.trim(), ip, apiKeyHeader, request);
};

export const PUT: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
