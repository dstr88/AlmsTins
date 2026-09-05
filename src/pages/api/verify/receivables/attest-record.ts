/**
 * POST /api/verify/receivables/attest-record — the client confirms his own deal.
 *
 * DELIBERATELY UNAUTHENTICATED, like the other two confirmations. The client has no
 * account in the banker-led flow, and requiring one at the moment he is standing at the
 * desk would mean the step never happens.
 *
 * Body: { token, outcome: 'accurate' | 'wrong', by, title?, correction? }
 */
import type { APIRoute } from 'astro';
import { confirmRecordByToken, readRecordRequest, type RecordOutcome } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('t') ?? '';
  if (!token) return json({ ok: false, error: 'token_required' }, 400);
  const result = await readRecordRequest(token);
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 410);
};

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  const outcome = String(body.outcome ?? '') as RecordOutcome;
  if (!['accurate', 'wrong'].includes(outcome)) return json({ ok: false, error: 'invalid_outcome' }, 400);

  const result = await confirmRecordByToken(token, outcome, {
    by: String(body.by ?? ''),
    title: body.title ? String(body.title) : null,
    correction: body.correction ? String(body.correction) : null,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['expired', 'revoked', 'used', 'wrong_kind'].includes(result.error) ? 410
    : 400;
  return json(result, status);
};
