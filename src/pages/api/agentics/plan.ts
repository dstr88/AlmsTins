/**
 * The plan an account is on and how much of it is used. Owner only (a plain 404 for anyone else);
 * not public. The account comes from the session, never from the request.
 *
 * GET  -> { plan, label, limits: { bots, addresses, walletsPerBot }, use: { bots, addresses } }
 *          `plan` is `free` or `unlimited`; a limit of null is no limit. `use` is what the account
 *          holds now: live agents, and live registered addresses over all of them. Own wallets are
 *          limited for each agent, so they are not in `use`; an agent's own list says how many it has.
 *
 * The limits are enforced where the rows are written, not here: a create that would pass one is
 * refused with 409 `plan_limit`, which names the cap (`bots`, `addresses` or `wallets`), its
 * `limit` and what the account `used`. A removed agent, wallet or address frees its slot.
 *
 * There is nothing to buy through this endpoint: it reads, and it is the whole of the plan story
 * until paid plans exist.
 */
import { json, vaultRoute } from '@/lib/agentVault/api';
import { getPlanSummary } from '@/lib/agentVault/entitlements';

export const prerender = false;

export const GET = vaultRoute(async ({ tenantId }) => {
  const plan = await getPlanSummary(tenantId);
  return json({ ok: true, plan: plan.plan, label: plan.label, limits: plan.limits, use: plan.use });
});
