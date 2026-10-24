/**
 * Rules for reading the latest wallet_snapshots rows into a total.
 *
 * - One row per wallet and chain. `captured_at` has one-second precision, so two writers that
 *   finish in the same second (Sync Tins and a wallet card's refresh, say) leave two rows that
 *   both match "the latest". Joining on MAX(captured_at) then returns both, and the wallet is
 *   counted twice. Keep the first row per (wallet, chain) instead.
 * - On-chain imports are not exchanges. The Bitcoin and Litecoin syncs file their transactions
 *   under an exchange_accounts row (source `bitcoin` / `litecoin`) so the ledger can use them.
 *   Its mirror wallet (`cex:bitcoin:…`) must not be valued: the coins are already counted at the
 *   address's on-chain balance, so valuing the mirror counts them twice.
 */

/** exchange_accounts sources that hold an on-chain wallet's imported history, not an exchange balance. */
export const ON_CHAIN_IMPORT_SOURCES: ReadonlySet<string> = new Set(['bitcoin', 'litecoin']);

/** True for the `cex:<source>:<id>` mirror wallet of an on-chain import account. */
export function isOnChainImportMirror(address: string | null | undefined): boolean {
	const match = /^cex:([^:]+):/i.exec(String(address ?? '').trim());
	return !!match && ON_CHAIN_IMPORT_SOURCES.has(match[1].toLowerCase());
}

/** Keeps the first row for each (wallet, chain), dropping same-second duplicates. */
export function onePerWalletChain<T>(rows: readonly T[], walletOf: (row: T) => string, chainOf: (row: T) => string): T[] {
	const seen = new Set<string>();
	const kept: T[] = [];
	for (const row of rows) {
		const key = `${walletOf(row)}\u0000${chainOf(row)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(row);
	}
	return kept;
}

/** The networth summary's cache key. Writers that change a total delete it, so they must use this one. */
export function networthSummaryCacheKey(tenantId: string): string {
	return `t:${tenantId}:networth:summary:v5`;
}
