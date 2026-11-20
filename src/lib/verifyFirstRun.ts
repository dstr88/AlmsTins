/**
 * Almstins Verify: the first-run rule (Verify first run, Part C).
 *
 * An account that holds no Verify destination of either kind meets one card on
 * /dashboard/verify ("Register the address you ask people to pay") in place of the hero image and
 * the empty panels. This file is the one place that decides it: the page
 * (src/pages/dashboard/verify.astro) asks it whether to render the hero, and the island
 * (src/components/verify/VerifyDashboard.tsx) asks it again with the live count, so the card
 * leaves the moment the first destination exists and comes back if the last one is removed.
 *
 * Who never sees it:
 *   - the demo: its sample account is shown as it always was;
 *   - a platform account (approved for platform lists, or already holding one): its list controls
 *     sit on the dashboard, and hiding them behind a first destination would take them away;
 *   - an account whose destinations could not be read: it gets the dashboard, which reports the
 *     load error itself.
 *
 * It also holds what the screen shows right after the first registration: which of the two
 * proving steps a wallet address has done (proveGuideFor).
 *
 * Pure and import-free, so the page, the island and the tests all read the same rule.
 */

export interface VerifyFirstRunFacts {
	/** The seeded sample account (requireTenantSession's isDemo). */
	isDemo: boolean;
	/** Destinations of either kind the account holds. null: the count could not be read. */
	destinationCount: number | null;
	/** Approved for platform lists, or already holding one (isPlatformAccount). */
	platformAccount: boolean;
}

/** True when the account meets the first-run card and nothing else. */
export function isVerifyFirstRun(facts: VerifyFirstRunFacts): boolean {
	if (facts.isDemo || facts.platformAccount) return false;
	return facts.destinationCount === 0;
}

/** A platform account: one that may publish a platform list, or that already holds one. */
export function isPlatformAccount(input: { approved: boolean; listCount: number }): boolean {
	return input.approved || input.listCount > 0;
}

// ── Right after the first registration ───────────────────────────────────────

/** The fields of a destination row that say how far its proof has come. */
export interface ProveGuideInput {
	kind: 'address' | 'qr';
	proofStatus: string;
	/** The row's public answer is Verified today (VerifyDashboard's isCurrentlyVerified). */
	verified: boolean;
}

export type ProveStepState = 'next' | 'open' | 'done';

export type ProveGuide =
	/** A wallet address: the two proving steps, in order. */
	| { kind: 'address'; claim: ProveStepState; list: ProveStepState }
	/** A payment link or QR: it has no proving step of its own. */
	| { kind: 'qr' };

/**
 * What the guide shows for the destination an account has just registered, or null once there is
 * nothing left to do on it.
 *
 * A wallet address has two steps. The satoshi test (a self-send) proves control: Claimed. A file
 * on the owner's website that lists the address anchors it to a domain: Verified. The file can
 * also do both at once for an address that never took the test (verifyAnchor's 'flip'), so step 2
 * is open from the start. Once an address is Verified the test is no longer offered on its row,
 * which is why the steps are numbered in this order.
 */
export function proveGuideFor(d: ProveGuideInput): ProveGuide | null {
	if (d.kind === 'qr') return { kind: 'qr' };
	if (d.verified) return null;
	const claimed = d.proofStatus === 'proven';
	return claimed
		? { kind: 'address', claim: 'done', list: 'next' }
		: { kind: 'address', claim: 'next', list: 'open' };
}
