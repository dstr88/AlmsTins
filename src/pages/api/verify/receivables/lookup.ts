/**
 * GET /api/verify/receivables/lookup?id=<receivable-hash>
 *
 * PUBLIC, login-free — the second financier's check. Given a receivable ID (the
 * SHA-256 capability handed to them), return the receivable's financing status and
 * every claim standing against it, so they can see an existing claim BEFORE lending.
 *
 * Returns ONLY self-chosen financier labels, amounts, and dates — never tenant_id, the
 * managing account, or any legal identity (the no-attribution boundary, same as
 * /api/verify/lookup). Read-only; the queried ID is never written anywhere. Per-IP
 * rate-limited, independent of other Verify budgets.
 *
 * Headers and limits come from src/lib/http/publicApi.ts: JSON, no-store, no CORS. The limit
 * is 30 lookups a minute per client, bucketed by clientIpKey (the trusted client address, an
 * IPv6 address by its /64) in a bounded limiter. The error bodies are pinned by
 * tests/receivables/lookupRoute.test.ts and must not change.
 */
import type { APIRoute } from 'astro';
import { getReceivableStatus } from '@/lib/receivablesRegistry';
import { createFixedWindowLimiter } from '@/lib/rateLimit';
import { admitByIp, methodNotAllowed, publicJson } from '@/lib/http/publicApi';

export const prerender = false;

const WINDOW_MS = 60_000;
const limiter = createFixedWindowLimiter({ windowMs: WINDOW_MS, max: 30 });

const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);

export const GET: APIRoute = async ({ request, url }) => {
  const raw = url.searchParams.get('id');
  if (!isHex64(raw)) return publicJson({ ok: false, error: 'A valid receivable ID (64 hex chars) is required.' }, 400);

  const limited = admitByIp(limiter, request, {
    body: { ok: false, error: 'Too many requests.' },
    retryAfterSeconds: WINDOW_MS / 1000,
  });
  if (limited) return limited;

  try {
    const status = await getReceivableStatus(raw.toLowerCase());
    if (!status) return publicJson({ ok: true, found: false, receivable: null });
    return publicJson({ ok: true, found: true, receivable: status });
  } catch (err) {
    console.error('[receivables-lookup] error:', err instanceof Error ? err.message : err);
    return publicJson({ ok: false, error: 'lookup_failed' }, 500);
  }
};

// Read-only endpoint.
export const POST: APIRoute = () => methodNotAllowed({ ok: false, error: 'Method not allowed' }, 'GET');
