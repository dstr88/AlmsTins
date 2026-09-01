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
 */
import type { APIRoute } from 'astro';
import { getReceivableStatus } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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

const isHex64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);

export const GET: APIRoute = async ({ url, clientAddress }) => {
  const raw = url.searchParams.get('id');
  if (!isHex64(raw)) return json({ ok: false, error: 'A valid receivable ID (64 hex chars) is required.' }, 400);

  const ip = clientAddress || 'unknown';
  if (rateLimited(ip)) return json({ ok: false, error: 'Too many requests.' }, 429);

  try {
    const status = await getReceivableStatus(raw.toLowerCase());
    if (!status) return json({ ok: true, found: false, receivable: null });
    return json({ ok: true, found: true, receivable: status });
  } catch (err) {
    console.error('[receivables-lookup] error:', err instanceof Error ? err.message : err);
    return json({ ok: false, error: 'lookup_failed' }, 500);
  }
};

// Read-only endpoint.
export const POST: APIRoute = () => json({ ok: false, error: 'Method not allowed' }, 405);
