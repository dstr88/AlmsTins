/**
 * What an account may hold in the Agent Vault: how many agents (bots), how many registered
 * addresses over all of its agents, and how many of an agent's own wallets each agent may list.
 *
 * Today there are two answers. Every account is on the Free plan: 3 agents, 15 registered
 * addresses pooled over those agents, and 5 of an agent's own wallets for each agent. The deployment
 * owner's account has no limits. Nothing is billed, nothing has a price, and there is no upgrade
 * path in this code: the plan an account is on is a function of who it is, and of nothing else.
 *
 * The caps are enforced where rows are written (./vault.ts, backed by the capped inserts in
 * ./store.ts), never only in a screen: a refused create answers 409 plan_limit with the cap, its
 * limit and what the account uses now, and a screen only words it.
 *
 * This file and the access gate (src/lib/agenticsAccess.ts) are the only places in the Vault that
 * know who the owner is. The report, delivery and job code, and every page, assume nothing about it.
 */
import { isOwner } from '@/lib/owner';
import { countLiveDestinations, countLiveTins } from './store';

export type PlanName = 'free' | 'unlimited';

/** What a plan allows. `null` is no limit. */
export interface PlanLimits {
  /** Live agents (tins) for the account. */
  bots: number | null;
  /** Live registered destinations, pooled over all the account's agents. */
  addresses: number | null;
  /** Live own wallets, for each agent. */
  walletsPerBot: number | null;
}

export interface Entitlements {
  plan: PlanName;
  /** What the plan is called on a screen. */
  label: string;
  limits: PlanLimits;
}

/**
 * The Free plan. 3 agents and 15 pooled addresses are the plan as decided. 5 own wallets for each
 * agent is a default of this build: the watcher reads every wallet against every watched
 * destination, so the number of wallets an agent lists is what multiplies its explorer calls.
 */
export const FREE_LIMITS: PlanLimits = { bots: 3, addresses: 15, walletsPerBot: 5 };

/**
 * Keyed checks an agent may have written to its ledger in one UTC day on the Free plan. The check
 * itself always answers; past this number a call is answered and not recorded (`vault.logged` is
 * false, with the reason `log_limit`), so an account cannot fill its ledger by looping on a key. 5,000
 * is about 3.5 a minute around the clock for each agent, far more than an agent that pays invoices or
 * runs a payout asks. It is a default of this build, not a decided number, and it sits beside the plan
 * limits rather than in them because it is a guard on volume, not something an account lists or buys.
 */
export const FREE_LOGGED_CHECKS_PER_DAY = 5_000;

const FREE: Entitlements = { plan: 'free', label: 'Free', limits: FREE_LIMITS };
const UNLIMITED: Entitlements = { plan: 'unlimited', label: 'Unlimited', limits: { bots: null, addresses: null, walletsPerBot: null } };

/**
 * The plan an account is on. Async so the paid plans that come later do not change a caller: they
 * look the account up here.
 */
export async function getEntitlements(tenantId: string): Promise<Entitlements> {
  if (isOwner(tenantId)) return UNLIMITED;

  // ── SEAM: paid plans ───────────────────────────────────────────────────────────────────────────
  // When paid Agentics plans exist, look the account up here, in a table of Agentics' own
  // (agentics_subscriptions, with its own billing), and return that plan's limits in place of FREE.
  // It must never be the tracker's `subscriptions` row: a tracker plan unlocks nothing in the Vault
  // and a Vault plan unlocks nothing in the tracker. Until then every account but the owner's is Free.
  return FREE;
}

/**
 * How many keyed checks the plan lets each of the account's agents have recorded per UTC day, or null
 * for no limit (the deployment owner's account). Async for the same reason as getEntitlements: a paid
 * plan will answer from its own row.
 */
export async function getLoggedChecksPerDay(tenantId: string): Promise<number | null> {
  const { plan } = await getEntitlements(tenantId);
  return plan === 'free' ? FREE_LOGGED_CHECKS_PER_DAY : null;
}

/** The slots left under a limit: `null` when there is no limit, never below zero. */
export const slotsLeft = (limit: number | null, used: number): number | null => (limit === null ? null : Math.max(0, limit - used));

export interface PlanUse {
  /** Live agents. */
  bots: number;
  /** Live registered destinations over all the agents. */
  addresses: number;
}

/** The plan, its limits and what the account uses now: what GET /api/agentics/plan answers and the usage meter shows. */
export interface PlanSummary extends Entitlements {
  use: PlanUse;
}

export async function getPlanSummary(tenantId: string): Promise<PlanSummary> {
  const [entitlements, bots, addresses] = await Promise.all([getEntitlements(tenantId), countLiveTins(tenantId), countLiveDestinations(tenantId)]);
  return { ...entitlements, use: { bots, addresses } };
}
