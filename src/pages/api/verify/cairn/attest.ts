/**
 * The inspector answers — DELIBERATELY UNAUTHENTICATED, like the receivables
 * confirmations. The inspector has no account; they are standing on a site with a phone,
 * and requiring a signup at that moment would mean the attestation never happens. The
 * single-use token is the authentication: it was minted by the project's owner, addressed
 * to one milestone, and dies the moment it is spent.
 *
 * GET  ?t=…                                          -> what the inspector sees before answering
 * POST { token, outcome, by, title?, note? }         -> record the signed, anchored attestation
 *      outcome ∈ 'reached' | 'not_reached' | 'disputed'
 */
import type { APIRoute } from 'astro';
import { readAttestRequest, attestByToken, type AttestOutcome } from '@/lib/cairnRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('t') ?? url.searchParams.get('token') ?? '';
  if (!token) return json({ ok: false, error: 'token_required' }, 400);
  const result = await readAttestRequest(token);
  return result.ok ? json(result) : json(result, result.error === 'not_found' ? 404 : 410);
};

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const token = String(body.token ?? '').trim();
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  const outcome = String(body.outcome ?? '') as AttestOutcome;
  if (!['reached', 'not_reached', 'disputed'].includes(outcome)) {
    return json({ ok: false, error: 'invalid_outcome' }, 400);
  }

  const result = await attestByToken(token, outcome, {
    by: String(body.by ?? ''),
    title: body.title ? String(body.title) : null,
    note: body.note ? String(body.note) : null,
  });

  if (result.ok) return json(result);
  const status =
    result.error === 'not_found' ? 404
    : ['expired', 'revoked', 'used'].includes(result.error) ? 410
    : 400;
  return json(result, status);
};
