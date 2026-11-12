/**
 * The Almstins Verify plans in one file: what each is called, what it costs and how many
 * destinations it holds. The limits code (./verifyEntitlements.ts) and every screen that shows a
 * plan read this file, so a number cannot differ between pages.
 *
 * A destination is one wallet address or one payment QR or link. Free is counted per kind (2
 * addresses and 1 QR). Business and Pro are counted in total, any mix of the two kinds. Prices
 * are whole US dollars; the early-access discount is a coupon in Stripe and is not stored here.
 *
 * The deployment owner's account has no limit. It is not a plan anyone can buy, so it is not in
 * this list (./verifyEntitlements.ts answers it).
 *
 * Pure and import-free, so a browser component can read it.
 */

export type VerifyPaidPlanId = 'business' | 'pro';
export type VerifyPlanId = 'free' | VerifyPaidPlanId;

/** What a plan allows. `null` is no limit. */
export interface VerifyPlanLimits {
  /** Wallet addresses. */
  address: number | null;
  /** Payment QRs or links. */
  qr: number | null;
  /** Destinations of both kinds together. */
  total: number | null;
}

export interface VerifyPlan {
  id: VerifyPlanId;
  /** What the plan is called on a screen. */
  name: string;
  /** US dollars a month. */
  monthlyUsd: number;
  /** US dollars a year. */
  yearlyUsd: number;
  limits: VerifyPlanLimits;
}

export const VERIFY_PLANS: Record<VerifyPlanId, VerifyPlan> = {
  free: { id: 'free', name: 'Free', monthlyUsd: 0, yearlyUsd: 0, limits: { address: 2, qr: 1, total: null } },
  business: { id: 'business', name: 'Business', monthlyUsd: 99, yearlyUsd: 990, limits: { address: null, qr: null, total: 10 } },
  pro: { id: 'pro', name: 'Pro', monthlyUsd: 299, yearlyUsd: 2990, limits: { address: null, qr: null, total: 50 } },
};

/** Smallest first: the order a price table lists them and the order an upgrade climbs. */
export const VERIFY_PLAN_ORDER: readonly VerifyPlanId[] = ['free', 'business', 'pro'];

export function isVerifyPaidPlan(v: unknown): v is VerifyPaidPlanId {
  return v === 'business' || v === 'pro';
}

/** The next plan up, or null from the largest. */
export function nextVerifyPlan(id: VerifyPlanId): VerifyPlan | null {
  const next = VERIFY_PLAN_ORDER[VERIFY_PLAN_ORDER.indexOf(id) + 1];
  return next ? VERIFY_PLANS[next] : null;
}

/**
 * What a refused registration answers: the limit of the plan the account is on, then the next
 * plan up. `kind` picks the sentence on a plan that counts per kind; a plan that counts in total
 * has one sentence for both. An id outside this list (the owner's account, which is never
 * refused) gets the plain sentence.
 */
export function verifyLimitMessage(id: string, kind: 'address' | 'qr'): string {
  const plan = VERIFY_PLAN_ORDER.includes(id as VerifyPlanId) ? VERIFY_PLANS[id as VerifyPlanId] : null;
  if (!plan) return 'This account is at its destination limit.';
  const perKind = kind === 'qr' ? plan.limits.qr : plan.limits.address;
  const held = perKind !== null
    ? kind === 'qr'
      ? `The ${plan.name} plan includes ${perKind} payment ${perKind === 1 ? 'QR' : 'QRs'}.`
      : `The ${plan.name} plan includes ${perKind} wallet ${perKind === 1 ? 'address' : 'addresses'}.`
    : `The ${plan.name} plan holds ${plan.limits.total} destinations.`;
  const next = nextVerifyPlan(plan.id);
  return next
    ? `${held} The ${next.name} plan holds ${next.limits.total} destinations. Get in touch to move up.`
    : `${held} Need more? Get in touch.`;
}
