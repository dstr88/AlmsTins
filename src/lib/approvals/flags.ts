/**
 * The flags on a standing approval (decision D1, Nov 28, 2026). Pure, so every rule is tested on its own.
 *
 * No approval is safe. An approval in force goes in one of two groups, and the group only sets the
 * order to look at them:
 *   - revoke_first: at least one flag applies
 *       (a) unlimited: an unlimited token amount, or a whole NFT collection
 *       (b) inactive: the spender contract has no transaction in 12 months or more
 *       (c) checker: the wallet checker's sources flag the spender (GoPlus, the OFAC SDN list,
 *           the curated compromised list)
 *   - still_a_risk: none applies. Still a risk: it lasts until it is canceled.
 * An approval that couldn't be read is `unknown`, shown as "couldn't check", never dropped.
 *
 * Not in this version: "this contract was exploited" (no free official feed yet).
 */

import type { ApprovalGroup, ApprovalKind, ApprovalReason, StandingApproval } from './types';

/** Months without a transaction before a spender counts as inactive. */
export const INACTIVE_MONTHS = 12;

/**
 * The amounts wallets and sites ask for as "unlimited": the largest number each common integer size
 * holds (uint96 for UNI and COMP, uint160 for Permit2, uint256 for most tokens), or anything at or
 * above 2^200 (a max allowance some tokens count down as it is spent). No token has a supply near
 * these, so such an approval covers every token the wallet will ever hold.
 */
const MAX_VALUES = [96, 112, 128, 160, 256].map((bits) => (1n << BigInt(bits)) - 1n);
const HUGE = 1n << 200n;

export function isUnlimitedAmount(amount: bigint | null): boolean {
	if (amount === null) return false;
	return amount >= HUGE || MAX_VALUES.includes(amount);
}

/** Whole months between two times (the later second), rounded down. */
export function monthsBetween(fromMs: number, toMs: number): number {
	if (!(toMs > fromMs)) return 0;
	const a = new Date(fromMs);
	const b = new Date(toMs);
	let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
	if (b.getUTCDate() < a.getUTCDate()) months -= 1;
	return Math.max(0, months);
}

export interface FlagInput {
	kind: ApprovalKind;
	amount: bigint | null;
	/** ISO time of the spender's newest transaction, or null when none is listed or it couldn't be read. */
	lastActiveAt: string | null;
	/** The wallet checker's hits on the spender; null when it wasn't asked. */
	checkerHits: string[] | null;
}

/** Whether the approval covers everything: an unlimited amount, or every NFT in a collection. */
export function isUnlimitedApproval(kind: ApprovalKind, amount: bigint | null): boolean {
	if (kind === 'nft_all') return true;
	if (kind === 'nft_one') return false;
	return isUnlimitedAmount(amount);
}

export function flagApproval(input: FlagInput, nowMs: number): { group: Exclude<ApprovalGroup, 'unknown'>; reasons: ApprovalReason[] } {
	const reasons: ApprovalReason[] = [];
	if (isUnlimitedApproval(input.kind, input.amount)) reasons.push({ code: 'unlimited' });
	if (input.lastActiveAt) {
		const last = Date.parse(input.lastActiveAt);
		const months = Number.isFinite(last) ? monthsBetween(last, nowMs) : 0;
		if (months >= INACTIVE_MONTHS) reasons.push({ code: 'inactive', months });
	}
	if (input.checkerHits && input.checkerHits.length > 0) reasons.push({ code: 'checker', hits: [...input.checkerHits] });
	return { group: reasons.length > 0 ? 'revoke_first' : 'still_a_risk', reasons };
}

const GROUP_ORDER: Record<ApprovalGroup, number> = { revoke_first: 0, still_a_risk: 1, unknown: 2 };
const REASON_WEIGHT: Record<ApprovalReason['code'], number> = { checker: 4, inactive: 2, unlimited: 1 };

/**
 * The order the list shows: "Revoke first", then "Still a risk", then "Couldn't check". Inside a
 * group, a checker hit first, then inactive, then unlimited; then the oldest approval first.
 */
export function sortApprovals(list: StandingApproval[]): StandingApproval[] {
	const weight = (a: StandingApproval) => a.reasons.reduce((s, r) => s + REASON_WEIGHT[r.code], 0);
	const given = (a: StandingApproval) => (a.givenAt ? Date.parse(a.givenAt) : Number.POSITIVE_INFINITY);
	return [...list].sort(
		(a, b) =>
			GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
			weight(b) - weight(a) ||
			given(a) - given(b) ||
			a.id.localeCompare(b.id),
	);
}
