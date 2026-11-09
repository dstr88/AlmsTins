/**
 * What an account may register in Almstins Verify: how many wallet addresses and how many
 * payment QRs or links it can hold as destinations.
 *
 * Today there are two answers. Every account is on the Free plan: 2 addresses and 1 payment QR
 * (3 destinations, one of which can be a QR; the same value shown in many places is one row, so
 * placements never count). The deployment owner's account has no limits. Nothing is billed and
 * there is no upgrade path in this code: the plan an account is on is a function of who it is.
 *
 * The caps are enforced where the row is written (createDestination in ./verifyRegistry.ts, a
 * capped insert behind an advisory lock for the account, the same shape as the Agent Vault's), never
 * only in a screen: a refused create answers 403 limit_reached, and the dashboard only words it. The
 * dashboard reads the limits from the destinations API, so the owner's screen shows no cap.
 *
 * This file is the one place in Verify that knows who the owner is for the purpose of a limit.
 */
import { isOwner } from '@/lib/owner';
import type { DestinationKind } from './verifyRegistry';

export type VerifyPlanName = 'free' | 'unlimited';

/** What a plan allows per kind. `null` is no limit. */
export interface VerifyPlanLimits {
  address: number | null;
  qr: number | null;
}

export interface VerifyEntitlements {
  plan: VerifyPlanName;
  /** What the plan is called on a screen. */
  label: string;
  limits: VerifyPlanLimits;
}

/** The Free plan: 2 wallet addresses and 1 payment QR, as decided for the early access. */
export const VERIFY_FREE_LIMITS: VerifyPlanLimits = { address: 2, qr: 1 };

const FREE: VerifyEntitlements = { plan: 'free', label: 'Free', limits: VERIFY_FREE_LIMITS };
const UNLIMITED: VerifyEntitlements = { plan: 'unlimited', label: 'Unlimited', limits: { address: null, qr: null } };

/**
 * The plan an account is on. Async so a paid plan that comes later does not change a caller: it
 * looks the account up here, in a table of Verify's own, never the tracker's subscriptions row.
 */
export async function getVerifyEntitlements(tenantId: string): Promise<VerifyEntitlements> {
  if (isOwner(tenantId)) return UNLIMITED;
  return FREE;
}

/** The cap for one kind of destination, or null for no limit. */
export function verifyLimitFor(e: VerifyEntitlements, kind: DestinationKind): number | null {
  return kind === 'qr' ? e.limits.qr : e.limits.address;
}
