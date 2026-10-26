/**
 * Which chain a health-factor alert is about. Aave computes a separate health factor for each
 * market, so a wallet with positions on two chains has two, and either can be the one at risk.
 * The alert cron used to read the first chain that had a health factor and stop, so a safe
 * position on Ethereum hid a near-liquidation on Polygon. This checks every chain:
 *
 *   - 'below': the chain with the lowest health factor under the threshold (the most at risk);
 *   - 'above': the chain with the highest health factor over the threshold.
 *
 * Pure, so the cron and its tests share it.
 */

export type AlertDirection = 'below' | 'above';

export type ChainHealth = { chain: string; healthFactor: number };

export type AlertPick =
	/** No chain has a health factor (no open position anywhere). */
	| { status: 'no-positions' }
	/** Every chain is on the safe side of the threshold. `lowest` is the closest to it, for the log. */
	| { status: 'ok'; lowest: ChainHealth }
	/** `chain` is the one to email about; `others` are further chains also past the threshold. */
	| { status: 'triggered'; chain: ChainHealth; others: ChainHealth[] };

/** Reads `chains` from GET /api/aave/health: every chain with a finite, positive health factor. */
export function chainHealths(chains: Record<string, { healthFactor?: unknown } | null | undefined> | null | undefined): ChainHealth[] {
	const out: ChainHealth[] = [];
	for (const [chain, summary] of Object.entries(chains ?? {})) {
		const raw = Number(summary?.healthFactor ?? NaN);
		if (Number.isFinite(raw) && raw > 0) out.push({ chain, healthFactor: raw });
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
