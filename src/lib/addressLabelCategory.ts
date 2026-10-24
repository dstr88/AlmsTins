/**
 * The category an address label is stored under.
 *
 * A wallet the user controls is `own_wallet`: the only value autoClassify treats as "yours"
 * (with `exchange` as the one it must never auto-resolve). An earlier form saved such a wallet
 * as `personal`, which no reader recognised, so a label made there looked right on screen and
 * did nothing. `personal` is accepted on the way in and written as `own_wallet`; readers also
 * accept stored `personal` rows (OWN_WALLET_CATEGORIES) so labels saved before this change work.
 */
export const OWN_WALLET_CATEGORIES = ['own_wallet', 'personal'] as const;

export function normalizeLabelCategory(raw: unknown): string {
	const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
	if (!value) return 'counterparty';
	if (value === 'personal') return 'own_wallet';
	return value;
}
