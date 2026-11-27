/**
 * POST /api/verify/receivables/transport-doc-check — does a transport document number someone holds
 * match the one committed in a receivable? Body: { receivableId, number }. Answers
 * { ok: true, match: true | false }; never the number, never anything else about the record.
 *
 * Signed in (any account, not the demo), because the answer is a yes or no about a short,
 * guessable number: limited to 20 checks an hour per account and 40 per client address, so it
 * cannot be used to try numbers one after another. The number travels in the body, never in a URL,
 * and nothing about it is logged or stored.
 *
 * 400 invalid (no ID or no number), 404 not_found, 409 no_number (the record answered "none" or
 * "not known yet", or predates the question), 503 unavailable (the commitment's key is neither
 * current nor retired), 429 rate_limited.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { checkReceivableTransportDoc } from '@/lib/receivablesRegistry';
import { createFixedWindowLimiter, clientIpKey } from '@/lib/rateLimit';
import { admitByKey, methodNotAllowed, publicJson } from '@/lib/http/publicApi';

export const prerender = false;

const HOUR_MS = 3_600_000;
const tenantLimiter = createFixedWindowLimiter({ windowMs: HOUR_MS, max: 20 });
const ipLimiter = createFixedWindowLimiter({ windowMs: HOUR_MS, max: 40 });
const RATE_LIMITED = { body: { ok: false, error: 'rate_limited' }, retryAfterSeconds: HOUR_MS / 1000 };
const STATUS = { invalid: 400, not_found: 404, no_number: 409, unavailable: 503 } as const;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireTenantSession(request);
  if (!session) return publicJson({ ok: false, error: 'unauthenticated' }, 401);
  if (session.isDemo) return publicJson({ ok: false, error: 'demo_readonly' }, 403);
  const limited = admitByKey(tenantLimiter, `tenant:${session.tenantId}`, RATE_LIMITED)
    ?? admitByKey(ipLimiter, clientIpKey(request), RATE_LIMITED);
  if (limited) return limited;

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const id = typeof body?.receivableId === 'string' ? body.receivableId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(id)) return publicJson({ ok: false, error: 'invalid' }, 400);
  try {
    const result = await checkReceivableTransportDoc(id, body?.number);
    if (result.ok) return publicJson({ ok: true, match: result.match });
    return publicJson({ ok: false, error: result.error }, STATUS[result.error]);
  } catch {
    console.error('[receivables-transport-doc-check] unavailable');
    return publicJson({ ok: false, error: 'unavailable' }, 503);
  }
};

export const GET: APIRoute = () => methodNotAllowed({ ok: false, error: 'Method not allowed' }, 'POST');
