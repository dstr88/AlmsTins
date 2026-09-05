/**
 * POST /api/verify/receivables/countersign — the supplier confirms an advance arrived.
 *
 * DELIBERATELY UNAUTHENTICATED. The supplier who is owed the money has an account in the
 * banker-led flow only sometimes, and requiring one here would mean a lender's claim
 * could never be counter-signed by a client who does not use the software. The single-use
 * token is the capability, exactly as with the buyer confirmation.
 *
 * Body: { token, outcome: 'received' | 'not_received' | 'amount_wrong',
 *         by, title?, amountReceived? }
 *
 * GET ?t=<token> returns what the supplier is being asked about.
 */
import type { APIRoute } from 'astro';
import {
  affirmClaimByToken, readCountersignRequest, type CountersignOutcome,
} from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OUTCOMES: CountersignOutcome[] = ['received', 'not_received', 'amount_wrong'];

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('t') ?? '';
  if (!token) return json({ ok: false, error: 'token_required' }, 400);
  const result = await readCountersignRequest(token);
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 410);
};

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  const outcome = String(body.outcome ?? '') as CountersignOutcome;
  if (!OUTCOMES.includes(outcome)) return json({ ok: false, error: 'invalid_outcome' }, 400);

  const result = await affirmClaimByToken(token, outcome, {
    by: String(body.by ?? ''),
    title: body.title ? String(body.title) : null,
    amountReceived: body.amountReceived != null ? Number(body.amountReceived) : null,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['expired', 'revoked', 'used'].includes(result.error) ? 410
    : 400;
  return json(result, status);
};
