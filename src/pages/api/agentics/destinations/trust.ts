/**
 * Run (or re-run) the checks on a tin's destinations. Owner only; not public.
 *
 * POST {tinId, ids?}  -> check exactly `ids`, or, without ids, the tin's pending destinations (at
 *          most 10 per call; `remaining` says how many are left). Answers each destination's
 *          status now.
 *
 * Checking is paid for in addresses, from the same budget as an add (30 a minute for an account on
 * a plan with a cap on addresses): a request that would pass it is 429 `rate_limited`, with nothing
 * asked and nothing changed.
 *
 * A flag is never cleared by a check: a flagged destination is checked again and stays flagged
 * (listed in `stillFlagged`), whatever the new answer is. To clear one, remove the destination
 * and add it again. A check that cannot run leaves the destination pending; it never passes one.
 */
import { failure, json, readJsonBody, vaultRoute } from '@/lib/agentVault/api';
import { trustDestinations } from '@/lib/agentVault/vault';

export const prerender = false;

export const POST = vaultRoute(async ({ tenantId, request }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const r = await trustDestinations(tenantId, { tinId: parsed.body.tinId, ids: parsed.body.ids });
  return r.ok ? json(r) : failure(r);
});
