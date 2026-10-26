/**
 * Which market a health-factor alert is about. Aave computes a separate health factor for each
 * market, so a wallet with positions in two markets (Polygon and Ethereum Lido, say) has two, and
 * either can be the one at risk.
 * The alert cron used to read the first chain that had a health factor and stop, so a safe
 * position on Ethereum hid a near-liquidation on Polygon. This checks every chain:
 *
 *   - 'below': the chain with the lowest health factor under the threshold (the most at risk);
 *   - 'above': the chain with the highest health factor over the threshold.
 *
 * Pure, so the cron and its tests share it.
 */

export type AlertDirection = 'below' | 'above';

/** `chain` is the market's key in the health response ('polygon', 'ethereum_lido'); `label` its display name. */
export type ChainHealth = { chain: string; label: string; healthFactor: number };

export type AlertPick =
	/** No chain has a health factor (no open position anywhere). */
	| { status: 'no-positions' }
	/** Every chain is on the safe side of the threshold. `lowest` is the closest to it, for the log. */
	| { status: 'ok'; lowest: ChainHealth }
	/** `chain` is the one to email about; `others` are further chains also past the threshold. */
	| { status: 'triggered'; chain: ChainHealth; others: ChainHealth[] };

/** "ethereum_v4" → "Ethereum v4", for a response without labels (one cached before markets had them). */
function labelFromKey(chain: string): string {
	const spaced = chain.replace(/_/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Reads `chains` from GET /api/aave/health: every market with a finite, positive health factor. */
export function chainHealths(
	chains: Record<string, { healthFactor?: unknown; label?: unknown } | null | undefined> | null | undefined,
): ChainHealth[] {
	const out: ChainHealth[] = [];
	for (const [chain, summary] of Object.entries(chains ?? {})) {
		const raw = Number(summary?.healthFactor ?? NaN);
		const label = typeof summary?.label === 'string' && summary.label.trim() ? summary.label.trim() : labelFromKey(chain);
		if (Number.isFinite(raw) && raw > 0) out.push({ chain, label, healthFactor: raw });
	}
	return out;
}

export function pickAlertChain(healths: readonly ChainHealth[], threshold: number, direction: AlertDirection): AlertPick {
	if (healths.length === 0) return { status: 'no-positions' };
	const byRisk = [...healths].sort((a, b) => a.healthFactor - b.healthFactor);
	const past =
		direction === 'below'
			? byRisk.filter((h) => h.healthFactor < threshold)
			: direction === 'above'
				? byRisk.filter((h) => h.healthFactor > threshold).reverse()
				: [];
	if (past.length === 0) return { status: 'ok', lowest: byRisk[0] };
	return { status: 'triggered', chain: past[0], others: past.slice(1) };
}
