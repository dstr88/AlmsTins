/**
 * What an account may register in Almstins Verify: how many wallet addresses and how many
 * payment QRs or links it can hold as destinations.
 *
 * There are four answers. No row in verify_subscriptions is the Free plan: 2 addresses and 1
 * payment QR (the same value shown in many places is one row, so placements never count). A live
 * row is Business (10 destinations) or Pro (50), counted in total over both kinds. The deployment
 * owner's account has no limits and needs no row. The names, prices and numbers are in
 * ./verifyPlans.ts; this file decides which of them an account is on.
 *
 * A row is live while its status is active, trialing or past_due (Stripe is still retrying the
 * card) and its paid_through date, when it has one, has not passed. Anything else reads as Free.
 * The row is written by the owner's switch (./verifyPlanAdmin.ts) and nothing else yet.
 *
 * The plan is Verify's own. The tracker's `subscriptions` row is never read here, so a tracker
 * plan changes nothing in Verify, and a Verify plan changes nothing in the tracker.
 *
 * The caps are enforced where the row is written (createDestination in ./verifyRegistry.ts, a
 * capped insert behind an advisory lock for the account, the same shape as the Agent Vault's), never
 * only in a screen: a refused create answers 403 limit_reached, and the dashboard only words it. The
 * dashboard reads the limits from the destinations API, so the owner's screen shows no cap.
 *
 * This file is the one place in Verify that knows who the owner is for the purpose of a limit.
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/owner';
import type { DestinationKind } from './verifyRegistry';
import { VERIFY_PLANS, isVerifyPaidPlan, type VerifyPaidPlanId, type VerifyPlanId, type VerifyPlanLimits } from './verifyPlans';

export type { VerifyPlanLimits };

/** 'unlimited' is the deployment owner's account only. */
export type VerifyPlanName = VerifyPlanId | 'unlimited';

export interface VerifyEntitlements {
  plan: VerifyPlanName;
  /** What the plan is called on a screen. */
  label: string;
  limits: VerifyPlanLimits;
}

/** The Free plan: 2 wallet addresses and 1 payment QR, as decided for the early access. */
export const VERIFY_FREE_LIMITS: VerifyPlanLimits = VERIFY_PLANS.free.limits;

const planEntitlements = (id: VerifyPlanId): VerifyEntitlements => ({
  plan: id, label: VERIFY_PLANS[id].name, limits: VERIFY_PLANS[id].limits,
});

const FREE = planEntitlements('free');
const PAID: Record<VerifyPaidPlanId, VerifyEntitlements> = {
  business: planEntitlements('business'),
  pro: planEntitlements('pro'),
};
const UNLIMITED: VerifyEntitlements = { plan: 'unlimited', label: 'Unlimited', limits: { address: null, qr: null, total: null } };

/**
 * verify_subscriptions: the plan an account is on in Verify. One row per account; no row is Free.
 *
 * `plan` is business or pro. `status` holds Stripe's words (active, trialing, past_due, canceled),
 * so billing can write them unchanged. `paid_through` is a YYYY-MM-DD date, empty for a running
 * subscription and set for a one-off invoice or a year paid by wire; the plan is live through the
 * end of that day, UTC. `note` and `set_by` (the admin's user id) say why and by whom a row was
 * set by hand.
 *
 * The row-level policy and the foreign key are in
 * src/scripts/sql/20261111_verify_subscriptions.sql, applied by hand.
 */
export const CREATE_VERIFY_SUBSCRIPTIONS = `
  CREATE TABLE IF NOT EXISTS verify_subscriptions (
    tenant_id               TEXT NOT NULL PRIMARY KEY,
    plan                    TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'active',
    paid_through            TEXT,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    note                    TEXT,
    set_by                  TEXT,
    created_at              TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at              TEXT
  )
`;

// Single-flight. The registry's ensure (ensureVerifyTables) calls this too, so the table stands
// beside the other Verify tables whichever of the two runs first.
let ensurePromise: Promise<void> | null = null;
export function ensureVerifySubscriptionsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = db.execute({ sql: CREATE_VERIFY_SUBSCRIPTIONS, args: [] }).then(() => undefined);
    ensurePromise = run;
    run.catch(() => { if (ensurePromise === run) ensurePromise = null; });
  }
  return ensurePromise;
}

/** A subscription in one of these Stripe states is a live plan. past_due counts: Stripe is still
 *  retrying the card, and a failed card does not end a plan until Stripe gives up. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Today's date in UTC, in the shape paid_through is stored in. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Whether a subscription row is a live plan today: a live status, and not past its paid_through. */
export function isLiveVerifySubscription(row: { status?: unknown; paid_through?: unknown }, today: string = todayUtc()): boolean {
  if (!LIVE_STATUSES.has(String(row.status ?? ''))) return false;
  const through = typeof row.paid_through === 'string' ? row.paid_through.slice(0, 10) : '';
  return !through || through >= today;
}

/**
 * The plan an account is on. Owner first (no row needed); then the account's own row, when it is
 * live; no row, or a row that is not live, is Free.
 */
export async function getVerifyEntitlements(tenantId: string): Promise<VerifyEntitlements> {
  if (isOwner(tenantId)) return UNLIMITED;
  await ensureVerifySubscriptionsTable();
  const r = await db.execute({
    sql: `SELECT plan, status, paid_through FROM verify_subscriptions WHERE tenant_id = ? LIMIT 1`,
    args: [tenantId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return FREE;
  const plan = String(row.plan);
  return isVerifyPaidPlan(plan) && isLiveVerifySubscription(row) ? PAID[plan] : FREE;
}

/** The cap for one kind of destination, or null for no limit. */
export function verifyLimitFor(e: VerifyEntitlements, kind: DestinationKind): number | null {
  return kind === 'qr' ? e.limits.qr : e.limits.address;
}
