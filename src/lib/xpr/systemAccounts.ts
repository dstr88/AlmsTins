/**
 * Plain labels for the XPR Network accounts whose transfers are not an ordinary payment between
 * two people: staking, voting and block-producer payouts, token locking and vesting, and swaps.
 * Their rows are stored exactly as the chain wrote them (a send, a receive) with a review kind and
 * a plain note, so a person can see at a glance why they need a second look. Almstins decides
 * nothing about them: how they are treated is for the owner and their tax professional.
 *
 * Only accounts seen on the chain doing what the label says (checked on proton.eosusa.io,
 * 2026-10-30) are named. Any other `eosio.` account is a chain system account.
 *
 * The words of a label and a note are chosen with care: the tax passes read a row's kind and
 * notes for keywords (src/lib/yearEnd/constants.ts INCOME_KEYWORDS and the DeFi lists) and give a
 * row a treatment from them. Nothing written here may contain one, and nothing a stranger wrote
 * (the memo) is put where those passes read; tests/xpr/systemAccounts.test.ts pins both.
 */

const KNOWN: ReadonlyMap<string, string> = new Map([
	['stake.proton', 'XPR Network stake contract'],
	['eosio.vpay', 'XPR Network voter payout account'],
	['eosio.bpay', 'XPR Network block producer payout account'],
	['eosio.saving', 'XPR Network voter payout account'],
	['locked.token', 'token locking contract (locked or vesting balances)'],
	['lock.token', 'token locking contract (locked or vesting balances)'],
	['proton.swaps', 'token swap contract (an exchange)'],
	['swap.alcor', 'token swap contract (an exchange)'],
]);

/** What the counterparty is, in plain words, when it is one of these accounts; null for an ordinary account. */
export function xprCounterpartyLabel(account: string): string | null {
	const a = account.trim().toLowerCase();
	const known = KNOWN.get(a);
	if (known) return known;
	return a === 'eosio' || a.startsWith('eosio.') ? 'XPR Network system account' : null;
}

/** A row of a review account is stored with one of these kinds instead of plain send / receive. */
export const XPR_REVIEW_KINDS: ReadonlySet<string> = new Set(['send_review', 'receive_review']);

/** True for a row stored for review (see XPR_REVIEW_KINDS). */
export function isXprReviewKind(kind: unknown): boolean {
	return XPR_REVIEW_KINDS.has(String(kind ?? '').trim().toLowerCase());
}

/**
 * The kind a transfer is stored with: send or receive, and send_review or receive_review when the
 * other side is one of the accounts above. Both still read as a send or a receive to every
 * consumer of kind (the transfer matcher looks for those words).
 */
export function xprRowKind(direction: 'in' | 'out', counterparty: string): string {
	const base = direction === 'in' ? 'receive' : 'send';
	return xprCounterpartyLabel(counterparty) ? `${base}_review` : base;
}

/**
 * The note of a row that needs a second look, or '' for any other. The memo is deliberately not
 * here: it is text a stranger wrote, and the tax passes read notes for keywords. The memo is kept
 * with the raw row (import_raw_rows).
 */
export function xprRowNotes(counterparty: string): string {
	const label = xprCounterpartyLabel(counterparty);
	return label
		? `Needs review: this transfer was with ${counterparty}, the ${label}. It is recorded as sent or received and nothing more; what it was is for you and your tax professional to decide.`
		: '';
}
