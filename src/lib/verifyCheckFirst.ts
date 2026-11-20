/**
 * Almstins Verify: what the public Verify page offers a business owner after they check their own
 * address (Verify first run, Part D).
 *
 * The field near the top of /verify runs the public scanner's check (src/lib/verifyScanCheck.ts)
 * and shows the scanner's own answer. This file holds the one rule on top of it: when the page
 * may offer "Prove it's yours, free".
 *
 *   - Only when the lookup answered and no account has proven the value. An address nobody has
 *     proven is only unproven; the page never words it as anything worse.
 *   - Never for a value an account has claimed or verified, or that two accounts stand behind
 *     (disputed): the visitor sees the scanner's normal answer and is not invited to take it over.
 *   - Never when the lookup did not answer (not a valid address, too many requests, a failed
 *     request): an unanswered lookup says nothing about who holds the value.
 *
 * It also holds where that offer leads. The link is the same for every visitor: the checked
 * value is never part of it (src/lib/carriedDestination.ts carries it in the browser instead).
 *
 * Pure and import-free, so the page, the island and the tests read the same rule.
 */

/** The fields of a finished check this rule reads (ScanCheckResult in verifyScanCheck.ts). */
export interface OwnerCheckFacts {
  lookupAnswered: boolean;
  lookup: { level: string | null };
}

/** 'prove': offer "Prove it's yours, free". 'none': the scanner's answer, and nothing else. */
export type OwnerNextStep = 'prove' | 'none';

export function ownerNextStep(result: OwnerCheckFacts): OwnerNextStep {
  return result.lookupAnswered && result.lookup.level === null ? 'prove' : 'none';
}

/**
 * The Verify sign-in, returning to the Verify dashboard: where every "log in" button on the
 * public Verify page leads, and where "Prove it's yours, free" leads. Already signed in, it
 * forwards straight to the dashboard. A fixed path with a fixed query: nothing a visitor typed.
 */
export const VERIFY_SIGNIN_HREF = '/verify/login?next=/dashboard/verify';
