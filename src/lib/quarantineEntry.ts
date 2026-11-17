/**
 * One quarantine entry as the screens receive it, and the rule for the wallet button's count.
 * Import-light so React islands can use it; the list itself is built in src/lib/quarantine.ts.
 */

import type { PoisonSignal } from './addressPoisoning';

export interface QuarantineEntry {
	/** The address, in its stored form. */
	address: string;
	/** Why the rules flagged it; null when it is here only because the user quarantined it. */
	signal: PoisonSignal | null;
	/** The saved entry it looks like (signals B and C). */
	imitates: { address: string; label: string } | null;
	/** The user quarantined it themselves (shown with ☠). */
	byUser: boolean;
	/** When it first appeared in the history (ISO), or when the user quarantined it. */
	firstAt: string | null;
	/** Transfers with it in the history. */
	transfers: number;
	/** What it sent in, in US dollars, priced transfers only. */
	usdIn: number;
	/** The account's wallets (wallets row ids) it touched. */
	wallets: string[];
}

/** True when an entry counts toward the red number on a wallet's Quarantine button. */
export function countsOnButton(e: Pick<QuarantineEntry, 'signal' | 'byUser'>): boolean {
	return e.signal === 'lookalike' || e.signal === 'both';
}

