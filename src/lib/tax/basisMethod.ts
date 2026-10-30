/**
 * basisMethod.ts: which lot rule a tenant's figures follow, and from when.
 *
 * Since January 1, 2025 the default for units held in a wallet or account is first-in, first-out
 * within that wallet or account, by the date the units were first acquired
 * (Treas. Reg. 1.1012-1(j)(1)). Years before that keep one pool per coin: the rule did not apply.
 * The ledger core (lotLedger.ts) does both; this file says which tenants get which, and names the
 * result for the surfaces that print it.
 */

/** The UTC date from which each wallet or account has its own pool. */
export const PER_WALLET_FROM = '2025-01-01';

/**
 * Who gets the per-wallet rule. 'owner': the deployment owner's tenant, when its jurisdiction is
 * the US. 'us': every US tenant. One constant, so widening the rollout is a one-word change.
 */
export const PER_WALLET_ROLLOUT: 'owner' | 'us' = 'owner';

/** What a tenant's figures are computed with. */
export type BasisMethod = 'per_wallet_fifo_from_2025' | 'universal_fifo';

/** What one tax year used. */
export type RuleForYear = 'per_wallet' | 'universal';

export const UNIVERSAL_METHOD: BasisMethod = 'universal_fifo';
export const PER_WALLET_METHOD: BasisMethod = 'per_wallet_fifo_from_2025';

/** Whether a tenant is in the rollout. Pure: the caller supplies the owner check and the jurisdiction. */
export function inPerWalletRollout(isOwnerTenant: boolean, jurisdiction: string): boolean {
	if (jurisdiction !== 'us') return false;
	return PER_WALLET_ROLLOUT === 'us' ? true : isOwnerTenant;
}

/** The rule one tax year used under a method. Years before the boundary are always one pool. */
export function ruleForYear(method: BasisMethod | undefined, year: number): RuleForYear {
	return method === PER_WALLET_METHOD && year >= Number(PER_WALLET_FROM.slice(0, 4)) ? 'per_wallet' : 'universal';
}

/**
 * One plain sentence on which rule a year's figures used, for the Year Summary and other printed
 * surfaces. Records wording: it states what was done, not what anyone owes.
 */
export function basisRuleStatement(rule: RuleForYear, year: number): string {
	if (rule === 'per_wallet') {
		return `Cost basis rule for ${year}: each sale uses only the coins held in the wallet or account it was made from, oldest first by original purchase date (Treas. Reg. 1.1012-1(j)). Coins moved between your own wallets keep their original date and cost.`;
	}
	return year >= Number(PER_WALLET_FROM.slice(0, 4))
		? `Cost basis rule for ${year}: one pool per coin across all your wallets and accounts. The wallet-by-wallet rule for sales from January 1, 2025 is not applied to these figures.`
		: `Cost basis rule for ${year}: one pool per coin across all your wallets and accounts, oldest first.`;
}
