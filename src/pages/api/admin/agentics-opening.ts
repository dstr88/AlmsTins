/**
 * Admin only: the one email that tells everyone who signed up while the Agentics vault was private
 * that it is open.
 *
 * GET  /api/admin/agentics-opening
 *        -> { ok, vaultOpen, waiting }       how many accounts have not been told (the owner's does not count)
 * POST /api/admin/agentics-opening   { apply?: boolean, limit?: number }
 *        -> { ok, dryRun, waiting, sent, failed, timedOut, noEmail, remaining }
 *
 * A POST without `apply: true` is a dry run: it counts and sends nothing. A real send is refused with
 * 409 `vault_not_open` until the flag that opens the Vault is on, because the email says it is open.
 * `limit` (default 100, at most 200) bounds one call; the call also ends the batch after 12
 * seconds, and one send gets 8 (a request that runs past 30 seconds is cut by the host). Call again until
 * `remaining` is 0. Each account is claimed before its email goes out, so two calls at once cannot send it
 * twice. A send that fails is tried again by the next call; one that timed out may still arrive, so it is
 * kept for a quarter of an hour first. With no mail transport set up a real send fails instead of
 * counting as sent.
 *
 * The body is never read for who to write to: the list is the signup table (src/lib/agenticsSignup.ts),
 * and the address is the account's own sign-in address. Answers carry numbers only, never an address.
 */
import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';
import { AGENTICS_VAULT_PUBLIC } from '@/lib/agenticsAccess';
import { countOpeningWaiting, OPENING_BATCH_DEFAULT, sendOpeningNotices } from '@/lib/agenticsSignup';

export const prerender = false;

/**
 * The most one call spends starting sends. The rest of a slow mail server's work waits for the next call.
 * One send in flight when this runs out gets OPENING_SEND_TIMEOUT_MS more, so a call ends within about 20 seconds.
 */
export const OPENING_CALL_BUDGET_MS = 12_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The admin check, as a response to return instead of a throw (requireAdminSession throws one). */
async function refuseNonAdmin(request: Request): Promise<Response | null> {
  try {
    await requireAdminSession(request);
    return null;
  } catch (e) {
    return e instanceof Response ? json({ ok: false, error: e.status === 401 ? 'unauthorized' : 'forbidden' }, e.status) : json({ ok: false, error: 'forbidden' }, 403);
  }
}

export const GET: APIRoute = async ({ request }) => {
  const refused = await refuseNonAdmin(request);
  if (refused) return refused;
  try {
    return json({ ok: true, vaultOpen: AGENTICS_VAULT_PUBLIC, waiting: await countOpeningWaiting() });
  } catch (err) {
    console.error('[admin] agentics opening count failed', { name: String((err as { name?: unknown })?.name ?? 'Error') });
    return json({ ok: false, error: 'unavailable' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const refused = await refuseNonAdmin(request);
  if (refused) return refused;

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    else return json({ ok: false, error: 'invalid_body' }, 400);
  } catch {
    // An empty body is a dry run.
  }
  const apply = body.apply === true;
  const limit = body.limit === undefined ? OPENING_BATCH_DEFAULT : Number(body.limit);
  if (!Number.isFinite(limit) || limit < 1) return json({ ok: false, error: 'invalid_limit' }, 400);
  if (apply && !AGENTICS_VAULT_PUBLIC) return json({ ok: false, error: 'vault_not_open' }, 409);

  try {
    const report = await sendOpeningNotices({ apply, limit, deadlineAt: Date.now() + OPENING_CALL_BUDGET_MS });
    return json({ ok: true, ...report });
  } catch (err) {
    console.error('[admin] agentics opening failed', { name: String((err as { name?: unknown })?.name ?? 'Error') });
    return json({ ok: false, error: 'unavailable' }, 500);
  }
};
