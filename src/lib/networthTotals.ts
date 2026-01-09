/**
 * Typed helpers for Totals tin calculations.
 * These functions are pure and do not perform any fetching.
 */

// Mirror the shape returned by /api/networth/summary (LatestNetWorthSummary).
export type NetworthSummary = {
	totalUsd: number;
	byWallet: Array<{
		walletId: string;
		walletLabel: string | null;
		totalUsd: number;
		byChain: Array<{
			chain: string;
			totalUsd: number;
			capturedAt: string;
		}>;
	}>;
	byChain: Array<{
		chain: string;
		totalUsd: number;
	}>;
	// Optional richer breakdowns if/when API provides them.
	// Optional richer breakdown if/when API provides tin-level aggregates.
	tins?: Array<{
		tinId: string;
		tinName: string;
		assetsUsd: number;
		debtUsd?: number;
		netUsd?: number;
	}>;
	tokens?: Array<{
		symbol: string;
		assetsUsd: number;
		debtUsd?: number;
		netUsd?: number;
	}>;
};

export type TinBreakdown = {
	tinId: string;
	tinName: string;
	assetsUsd: number;
	debtUsd: number;
	netUsd: number;
};

export type ChainBreakdown = {
	chain: string;
	assetsUsd: number;
	debtUsd: number;
	netUsd: number;
};

export type TokenBreakdown = {
	symbol: string;
	assetsUsd: number;
	debtUsd: number;
	netUsd: number;
};

const normalizeNumber = (value: unknown): number => {
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
};

export function getTotalAssetsUsd(summary: NetworthSummary): number {
	return normalizeNumber(summary.totalUsd);
}

// Free assets and debt are not currently surfaced by the API; default to assets and zero respectively.
export function getTotalFreeAssetsUsd(summary: NetworthSummary): number {
	return normalizeNumber(summary.totalUsd);
}

export function getTotalDebtUsd(summary: NetworthSummary): number {
	// Prefer tin-level debt if available
	if (summary.tins && summary.tins.length) {
		return summary.tins.reduce((acc, tin) => {
			const debt = normalizeNumber(tin.debtUsd);
			return acc + debt;
		}, 0);
	}
	// Fallback: no debt data exposed in current payload
	return 0;
}

export function getBreakdownByTin(summary: NetworthSummary): TinBreakdown[] {
	if (summary.tins && summary.tins.length) {
		return summary.tins.map((tin) => {
			const assetsUsd = normalizeNumber(tin.assetsUsd);
			const debtUsd = normalizeNumber(tin.debtUsd);
			const netUsd = normalizeNumber(tin.netUsd ?? assetsUsd - debtUsd);
			return {
				tinId: tin.tinId,
				tinName: tin.tinName,
				assetsUsd,
				debtUsd,
				netUsd,
			};
		});
	}

	return (summary.byWallet ?? []).map((wallet) => {
		const assetsUsd = normalizeNumber(wallet.totalUsd);
		const debtUsd = 0;
		return {
			tinId: wallet.walletId,
			tinName: wallet.walletLabel ?? wallet.walletId,
			assetsUsd,
			debtUsd,
			netUsd: assetsUsd - debtUsd,
		};
	});
}

export function getBreakdownByChain(summary: NetworthSummary): ChainBreakdown[] {
	return (summary.byChain ?? []).map((entry) => {
		const assetsUsd = normalizeNumber(entry.totalUsd);
		const debtUsd = 0;
		return {
			chain: entry.chain,
			assetsUsd,
			debtUsd,
			netUsd: assetsUsd - debtUsd,
		};
	});
}

export function getBreakdownByToken(summary: NetworthSummary): TokenBreakdown[] {
	if (summary.tokens && summary.tokens.length) {
		return summary.tokens.map((token) => {
			const assetsUsd = normalizeNumber(token.assetsUsd);
			const debtUsd = normalizeNumber(token.debtUsd);
			const netUsd = normalizeNumber(token.netUsd ?? assetsUsd - debtUsd);
			return {
				symbol: token.symbol.toUpperCase(),
				assetsUsd,
				debtUsd,
				netUsd,
			};
		});
	}
	return [];
}
