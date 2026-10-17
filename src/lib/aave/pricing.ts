// src/lib/aave/pricing.ts
//
// How an Aave position gets its USD value, and what we do when it cannot be valued.
//
// Pure: no network, no database, no clock. Everything here takes plain values, so the whole file is
// unit-testable, and both the Aave client and the Memory Lane page (src/lib/currentHoldings.ts) share it.
//
// A position is valued, in this order, from:
//   1. Aave's own USD figure for it (userSupplies.balance.usd, userBorrows.debt.usd). Aave computes its
//      health numbers from the same figures: the collateral-enabled supplies add up to
//      userMarketState.totalCollateralBase, so the Vault agrees with Aave by construction.
//   2. aaveSymbolUsdPrice() from market tickers, for a position Aave did not value.
//   3. Neither: the position is UNPRICED. It is counted and reported, never silently worth $0.

import type { AaveChainSummary, AavePosition, AavePositionsResponse, AaveSide } from './client';

// ── 1. The fallback price rule ────────────────────────────────────────────────

/**
 * Coins that are the same asset as another coin Aave lists, priced as that base coin: 1:1 wrappers
 * (redeemable for the base coin) and the two bridged 1:1 copies Aave lists on Avalanche. Everything else,
 * WBTC and the staking tokens (sAVAX, stETH, wstETH) included, trades apart from its base coin and is
 * priced from its OWN ticker, or not at all. A name that merely looks like a wrapper is not in this map.
 */
export const AAVE_BASE_COIN: ReadonlyMap<string, string> = new Map([
	['WETH', 'ETH'],
	['WPOL', 'POL'],
	['WMATIC', 'POL'],
	['WAVAX', 'AVAX'],
	['BTC.B', 'BTC'],
	['WETH.E', 'ETH'],
]);

const AAVE_STABLES = new Set(['USDC', 'USDT', 'USDT0', 'USDC.E', 'USDT.E']);

/**
 * The USD price of an Aave-supplied symbol from market tickers, or null when it cannot be priced.
 * tickerPrices maps UPPERCASE ticker symbols to USD prices. A ticker may be missing at any time (the
 * price feed is cut at its top coins and the cut moves), so a missing ticker is null, never a guess.
 */
export function aaveSymbolUsdPrice(symbol: string, tickerPrices: ReadonlyMap<string, number>): number | null {
	const sym = String(symbol ?? '').trim().toUpperCase();
	if (!sym) return null;
	const base = AAVE_BASE_COIN.get(sym) ?? sym;
	if (AAVE_STABLES.has(base) || base.startsWith('USDC') || base.startsWith('USDT')) return 1;
	const price = tickerPrices.get(base);
	return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Turns a price feed's ticker list (best-ranked coin first) into UPPERCASE symbol to USD price. The FIRST
 * usable ticker per symbol wins, so a low-ranked coin that reuses a real coin's symbol cannot override it.
 * Anything that is not a list, and any ticker without a positive finite USD price, is skipped.
 */
export function buildTickerPriceMap(tickers: unknown): Map<string, number> {
	const out = new Map<string, number>();
	if (!Array.isArray(tickers)) return out;
	for (const t of tickers) {
		const sym = String(t?.symbol ?? '').trim().toUpperCase();
		const price = t?.quotes?.USD?.price;
		if (!sym || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
		if (!out.has(sym)) out.set(sym, price);
	}
	return out;
}

// ── 2. Pricing one position ───────────────────────────────────────────────────

export type AavePriceSource = 'aave' | 'market' | 'none';

function finiteNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Aave's own USD figure for one position, from its balance (supply) or debt (borrow) node, or null when
 * Aave did not give a usable one. A figure of 0 counts only when it is real: there is nothing to value, or
 * Aave also gave a positive per-token price. Otherwise a 0 means "no price", not "worth nothing".
 */
export function readAaveUsd(node: unknown, amount: number): number | null {
	const n = node as { usd?: unknown; usdPerToken?: unknown } | null | undefined;
	const usd = finiteNumber(n?.usd);
	if (usd === null || usd < 0) return null;
	if (usd > 0) return usd;
	const perToken = finiteNumber(n?.usdPerToken);
	return !(amount > 0) || (perToken !== null && perToken > 0) ? 0 : null;
}

/** Prices one position: Aave's own figure first, then market tickers, else unpriced with a placeholder 0. */
export function priceAavePosition(
	pos: Pick<AavePosition, 'assetSymbol' | 'amount' | 'aaveUsd'>,
	tickerPrices: ReadonlyMap<string, number>,
): { usdValue: number; priceSource: AavePriceSource } {
	const aaveUsd = pos.aaveUsd;
	if (typeof aaveUsd === 'number' && Number.isFinite(aaveUsd) && aaveUsd >= 0) {
		return { usdValue: aaveUsd, priceSource: 'aave' };
	}
	if (Number.isFinite(pos.amount) && pos.amount > 0) {
		const price = aaveSymbolUsdPrice(pos.assetSymbol, tickerPrices);
		if (price !== null) return { usdValue: pos.amount * price, priceSource: 'market' };
	}
	return { usdValue: 0, priceSource: 'none' };
}

/** True for a position that holds something no price source could value. An empty position needs no price. */
export function isUnpricedPosition(pos: Pick<AavePosition, 'amount' | 'priceSource'>): boolean {
	return pos.priceSource === 'none' && Number.isFinite(pos.amount) && pos.amount > 0;
}

// ── 3. Coverage: what a total leaves out ──────────────────────────────────────

/** A gap smaller than this share of the larger figure is noise (interest accrual, price timing). */
export const AAVE_GAP_REL_TOLERANCE = 0.05;
/** ...and so is a gap smaller than this many dollars, whatever its share. */
export const AAVE_GAP_ABS_TOLERANCE_USD = 5;
/** How many unpriced positions a coverage report names. The count is always exact. */
export const MAX_UNPRICED_LISTED = 25;
/** Stands in for a whole lookup that failed before any chain answered. */
export const AAVE_ALL_CHAINS = 'all';

export type AaveUnpricedPosition = { chain: string; side: AaveSide; symbol: string; amount: number };

/** Our priced figure and Aave's own disagree by more than the tolerance. */
export type AaveGap = {
	chain: string;
	kind: 'collateral' | 'debt';
	pricedUsd: number;
	aaveUsd: number;
	gapUsd: number;
};

export type AaveCoverage = {
	/** True when a total built from this lookup may leave something out. */
	partial: boolean;
	/** Positions holding a balance that no price source could value (counted at $0, so they understate). */
	unpricedCount: number;
	unpriced: AaveUnpricedPosition[];
	/** Chains whose Aave lookup failed (AAVE_ALL_CHAINS when the whole lookup did). */
	unavailableChains: string[];
	/** Chains where priced collateral or debt disagrees with Aave's own totals. */
	gaps: AaveGap[];
};

export function emptyCoverage(): AaveCoverage {
	return { partial: false, unpricedCount: 0, unpriced: [], unavailableChains: [], gaps: [] };
}

/** One coverage report from several (for example, one per wallet). */
export function mergeCoverage(parts: ReadonlyArray<AaveCoverage | null | undefined>): AaveCoverage {
	const out = emptyCoverage();
	for (const part of parts) {
		if (!part) continue;
		out.partial = out.partial || part.partial;
		out.unpricedCount += part.unpricedCount;
		for (const item of part.unpriced) if (out.unpriced.length < MAX_UNPRICED_LISTED) out.unpriced.push(item);
		for (const chain of part.unavailableChains) out.unavailableChains.push(chain);
		for (const gap of part.gaps) out.gaps.push(gap);
	}
	return out;
}

/**
 * The sanity check: is our priced figure within tolerance of Aave's own? Null when it is, or when either
 * figure is unusable. This is what keeps a position priced at a silent $0 from ever returning unnoticed.
 */
export function findGap(
	chain: string,
	kind: AaveGap['kind'],
	pricedUsd: number,
	aaveUsd: number | null | undefined,
): AaveGap | null {
	if (aaveUsd === null || aaveUsd === undefined) return null;
	if (!Number.isFinite(pricedUsd) || !Number.isFinite(aaveUsd)) return null;
	const gapUsd = Math.abs(pricedUsd - aaveUsd);
	const allowed = Math.max(AAVE_GAP_ABS_TOLERANCE_USD, AAVE_GAP_REL_TOLERANCE * Math.max(Math.abs(pricedUsd), Math.abs(aaveUsd)));
	return gapUsd > allowed ? { chain, kind, pricedUsd, aaveUsd, gapUsd } : null;
}

/** An Aave lookup with every position priced, totals per chain and overall, and what those totals leave out. */
export type AaveTotals = AavePositionsResponse & {
	suppliedUsdTotal: number;
	debtUsdTotal: number;
	suppliedUsd: number;
	debtUsd: number;
	coverage: AaveCoverage;
};

/**
 * Pure. Prices every position of an Aave lookup, totals them per chain and overall, and reports what the
 * totals leave out: positions no price source could value, chains that did not answer, and chains whose
 * priced collateral or debt disagrees with the totals Aave itself reports.
 */
export function completeAaveTotals(
	result: AavePositionsResponse,
	tickerPrices: ReadonlyMap<string, number>,
): AaveTotals {
	const unpriced: AaveUnpricedPosition[] = [];
	let unpricedCount = 0;
	const unavailableChains: string[] = [];
	const gaps: AaveGap[] = [];
	if (result.ok === false && result.chains.length === 0) unavailableChains.push(AAVE_ALL_CHAINS);

	const chains: AaveChainSummary[] = result.chains.map((chain) => {
		let suppliedUsdTotal = 0;
		let debtUsdTotal = 0;
		let collateralUsd = 0;
		let collateralFlagsKnown = true;
		const positions: AavePosition[] = chain.positions.map((pos) => {
			const { usdValue, priceSource } = priceAavePosition(pos, tickerPrices);
			const priced: AavePosition = { ...pos, usdValue, priceSource };
			if (pos.side === 'supply') {
				suppliedUsdTotal += usdValue;
				if (pos.isCollateral === true) collateralUsd += usdValue;
				if (typeof pos.isCollateral !== 'boolean') collateralFlagsKnown = false;
			} else {
				debtUsdTotal += usdValue;
			}
			if (isUnpricedPosition(priced)) {
				unpricedCount += 1;
				if (unpriced.length < MAX_UNPRICED_LISTED) {
					unpriced.push({ chain: chain.chain, side: pos.side, symbol: pos.assetSymbol, amount: pos.amount });
				}
			}
			return priced;
		});

		if (chain.ok === false) {
			unavailableChains.push(chain.chain);
		} else if (chain.reported) {
			// Aave's collateral figure counts only the supplies enabled as collateral, so it can be checked
			// only when every supply says whether it is one.
			const collateralGap = collateralFlagsKnown
				? findGap(chain.chain, 'collateral', collateralUsd, chain.reported.totalCollateralUsd)
				: null;
			const debtGap = findGap(chain.chain, 'debt', debtUsdTotal, chain.reported.totalDebtUsd);
			if (collateralGap) gaps.push(collateralGap);
			if (debtGap) gaps.push(debtGap);
		}

		return {
			...chain,
			positions,
			suppliedUsdTotal,
			debtUsdTotal,
			suppliedUsd: suppliedUsdTotal,
			debtUsd: debtUsdTotal,
		};
	});

	const suppliedUsdTotal = chains.reduce((sum, chain) => sum + (chain.suppliedUsdTotal ?? 0), 0);
	const debtUsdTotal = chains.reduce((sum, chain) => sum + (chain.debtUsdTotal ?? 0), 0);

	return {
		...result,
		chains,
		suppliedUsdTotal,
		debtUsdTotal,
		suppliedUsd: suppliedUsdTotal,
		debtUsd: debtUsdTotal,
		coverage: {
			partial: unpricedCount > 0 || unavailableChains.length > 0 || gaps.length > 0,
			unpricedCount,
			unpriced,
			unavailableChains,
			gaps,
		},
	};
}
