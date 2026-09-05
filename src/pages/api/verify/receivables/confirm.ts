/**
 * Buyer confirmation by link — deliberately unauthenticated.
 *
 * The obligor acts once and gains nothing from an account, so the single-use token is the
 * capability. It carries what a session would: which receivable, sent to which address,
 * answerable once.
 *
 * GET  ?token=…  what the answerer sees before answering
 * POST { token, outcome, ...answers }
 */
import type { APIRoute } from 'astro';
import { readConfirmRequest, confirmByToken, type ConfirmOutcome } from '@/lib/receivablesRegistry';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const OUTCOMES: ConfirmOutcome[] = ['confirmed', 'not_ours', 'amount_wrong'];

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  if (!token) return json({ ok: false, error: 'not_found' }, 400);
  const result = await readConfirmRequest(token);
  return result.ok ? json(result) : json(result, 404);
};

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const outcome = body.outcome as ConfirmOutcome;
  if (!OUTCOMES.includes(outcome)) return json({ ok: false, error: 'invalid_outcome' }, 400);

  const result = await confirmByToken(String(body.token ?? ''), outcome, {
    theirReference: String(body.theirReference ?? ''),
    by: String(body.by ?? ''),
    title: body.title ?? null,
    goodsReceived: body.goodsReceived === true,
    amountCorrect: body.amountCorrect === true,
    noOffsets: body.noOffsets === true,
    notAlreadyPaid: body.notAlreadyPaid === true,
  });
  return result.ok ? json(result) : json(result, 400);
};
