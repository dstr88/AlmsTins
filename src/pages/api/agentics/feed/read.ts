/**
 * Read an account's wallets while its Live page is open. Owner only (a plain 404 for anyone else); not public.
 *
 * POST {tinId?}  -> runs the same pass the daily job and "Read the chain now" run, for ONE agent: the one named,
 *          or, when none is, the one that has waited longest and has a wallet and a trusted address on the same
 *          chain. Answers `{ ok, status, tinId, pass, waitMs }`:
 *            read     an agent was read (`pass` says how each wallet went, as /api/agentics/refresh does);
 *            recent   every agent was read less than 45 seconds ago, by this page or another;
 *            busy     another read is running in this process;
 *            nothing  no agent has a wallet and a trusted address on the same chain.
 *          `waitMs` is how long the page should wait before asking again. A page that asks sooner is only told
 *          "recent" or "busy"; nothing is read twice in a hurry.
 *
 * Only registered, trusted addresses are looked for, and only in the agent's own wallets; a transfer to any
 * other address is not recorded, counted or mentioned. At most 6 requests a minute for an account (429
 * `rate_limited`, with `Retry-After`); the count is per process and resets on a restart. Nothing runs unless a
 * page asks: the Vault never starts this itself.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { fail } from '@/lib/agentVault/errors';
import { LIVE_READ_REQUEST_WINDOW_MS, LIVE_READ_REQUESTS_PER_WINDOW, liveRead } from '@/lib/agentVault/liveRead';
import { createFixedWindowLimiter } from '@/lib/rateLimit';

export const prerender = false;

const limiter = createFixedWindowLimiter({ windowMs: LIVE_READ_REQUEST_WINDOW_MS, max: LIVE_READ_REQUESTS_PER_WINDOW });

export const POST = vaultRoute(async ({ tenantId, request }) => {
  if (limiter.hit(`t:${tenantId}`)) return failure(fail('rate_limited'));
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await liveRead(tenantId, { tinId: parsed.body.tinId });
  return r.ok ? json(r) : failure(r);
});
