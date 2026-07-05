/**
 * GET /api/portfolio/performance
 *
 * Returns per-asset unrealized P&L based on:
 *   - current quantities from wallet_snapshots (source of truth for what you hold)
 *   - cost basis from asset_lifecycle_groups (weighted avg cost per unit)
 *   - current prices from wallet_snapshots (already priced by CoinPaprika at sync time)
 *
 * Using wallet_snapshots for quantities avoids the lifecycle disposal-overcounting
 * problem where unlinked wallet-to-wallet transfers are mistakenly treated as sales,
 * causing assets like ETH and SOL to show zero even though the user still holds them.
 *
 * Response shape:
 * {
 *   ok: true,
 *   updatedAt: ISO string,
 *   summary: { totalCostBasis, totalCurrentValue, totalUnrealizedPnl, pnlPercent },
 *   assets: AssetRow[],
 * }
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getCache, setCache } from '@/lib/tursoCache';
import { getAaveTotalsForWallet } from '@/lib/aave/client';
import { loadSpamFilter } from '@/lib/tokenOverrides';

export const prerender = false;

const CACHE_TTL = 5 * 60; // 5 minutes

const memCache = new Map<string, { data: object; expiresAt: number }>();
const MIN_VALUE_USD = 1;   // hide dust < $1

// Aave symbol normalization — keep WBTC as WBTC (not BTC) so it stays a
// distinct row from exchange BTC; only unwrap wrapper prefixes for price lookup.
const AAVE_SYMBOL_NORMALIZE: Record<string, string> = {
	WPOL:   'POL',
	WMATIC: 'POL',
	WAVAX:  'AVAX',
	// WBTC and WETH stay as-is so they reconcile with on-chain snapshots
};

interface AssetRow {
	symbol:          string;
	quantity:        number;
	weightedAvgCost: number;    // per unit — 0 if no lifecycle record
	totalCostBasis:  number;
	currentPrice:    number | null;
	currentValue:    number | null;
	unrealizedPnl:   number | null;
	pnlPercent:      number | null;
	lastAcquiredAt:  string | null;
	priceSource:     'snapshot' | 'aave' | 'none';
	isCollateral:    boolean;   // true when any quantity comes from Aave supply
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return json({ ok: false, error: 'Unauthorized' }, 401);
		const { tenantId } = session;
		const isFiltered = await loadSpamFilter(tenantId); // override-aware spam filter

		const cacheKey = `t:${tenantId}:portfolio:performance:v6`;
		const memKey   = `portfolio:${tenantId}`;

		// L1 — in-memory, zero-latency
		const mem = memCache.get(memKey);
		if (mem && mem.expiresAt > Date.now()) {
			return json({ ...mem.data, cached: true });
		}

		const cached = await getCache<unknown>(cacheKey, {
			allowStale: true,
			staleMaxAgeSeconds: 30 * 60,
		});
		if (cached.value) {
			memCache.set(memKey, { data: cached.value as object, expiresAt: Date.now() + CACHE_TTL * 1000 });
			return json({ ok: true, ...(cached.value as object), cached: true, stale: cached.isStale });
		}

		// ── 1. Aggregate current holdings from wallet_snapshots ───────────────
		// Wallet snapshots are the authoritative source for what you actually hold
		// right now.  Each snapshot's payload_json is an array of token entries
		// { symbol, amount, priceUsd, valueUsd }.  We sum across all wallets so
		// that the same asset held in multiple places is consolidated.
		//
		// We use the latest snapshot per (wallet_id, chain) pair — the same
		// strategy as the networth/summary endpoint.
		const snapshotResult = await db.execute({
			sql: `WITH latest AS (
			        SELECT wallet_id, chain, MAX(captured_at) AS captured_at
			        FROM wallet_snapshots WHERE tenant_id = ?
			        GROUP BY wallet_id, chain
			      )
			      SELECT ws.payload_json
			      FROM wallet_snapshots ws
			      JOIN latest l
			        ON l.wallet_id   = ws.wallet_id
			       AND l.chain       = ws.chain
			       AND l.captured_at = ws.captured_at
			      JOIN wallets w ON w.id = ws.wallet_id
			      WHERE ws.tenant_id = ? AND w.tenant_id = ?`,
			args: [tenantId, tenantId, tenantId],
		});

		type SnapshotEntry = { qty: number; valueUsd: number; priceUsd: number | null };
		const bySymbol = new Map<string, SnapshotEntry>();

		for (const row of snapshotResult.rows) {
			if (!row.payload_json) continue;
			let tokens: Array<{ symbol?: string; amount?: number | string; priceUsd?: number | null; valueUsd?: number | null }>;
			try {
				tokens = JSON.parse(String(row.payload_json));
				if (!Array.isArray(tokens)) continue;
			} catch {
				continue;
			}
			for (const t of tokens) {
				const sym = (t.symbol ?? '').toString().trim().toUpperCase();
				if (!sym) continue;
				if (isFiltered(sym)) continue;
				const qty      = Number(t.amount  ?? 0);
				const valueUsd = Number(t.valueUsd ?? 0);
				const priceUsd = t.priceUsd != null ? Number(t.priceUsd) : null;
				if (qty <= 0 && valueUsd <= 0) continue;

				const existing = bySymbol.get(sym) ?? { qty: 0, valueUsd: 0, priceUsd: null };
				existing.qty      += qty;
				existing.valueUsd += valueUsd;
				// Use the first non-null price we encounter
				if (existing.priceUsd == null && priceUsd != null && priceUsd > 0) {
					existing.priceUsd = priceUsd;
				}
				bySymbol.set(sym, existing);
			}
		}

		// ── 1b. Merge live Aave collateral positions ──────────────────────────
		// Alchemy only sees tokens sitting in the wallet address itself.
		// WBTC/WETH/etc. deposited into Aave live in the Aave pool contract and
		// never appear in payload_json.  We fetch them here directly from the
		// Aave GraphQL API (same path vault uses) and add them to bySymbol so
		// the portfolio table shows collateral alongside free holdings.
		//
		// Non-fatal: if Aave is unreachable the rest of the portfolio still loads.
		const aaveCollateralSymbols = new Set<string>();
		try {
			const walletsResult = await db.execute({
				sql: `SELECT DISTINCT address FROM wallets
				      WHERE tenant_id = ?
				        AND (wallet_type = 'onchain' OR wallet_type IS NULL)`,
				args: [tenantId],
			});

			for (const walletRow of walletsResult.rows) {
				const address = String(walletRow.address ?? '').trim();
				if (!address) continue;

				const aaveTotals = await getAaveTotalsForWallet(address);

				for (const chain of aaveTotals.chains) {
					for (const pos of chain.positions) {
						if (pos.side !== 'supply') continue;
						if (!Number.isFinite(pos.amount) || pos.amount <= 0) continue;
						// Keep unpriced Aave collateral visible: usdValue 0 means "missing price"
						// (e.g. POL/MATIC symbol mismatch), not dust. Only drop genuine priced
						// dust below the threshold, never a real supply position we couldn't price.
						if (pos.usdValue > 0 && pos.usdValue < MIN_VALUE_USD) continue;

						const rawSym = pos.assetSymbol.trim().toUpperCase();
						const sym = AAVE_SYMBOL_NORMALIZE[rawSym] ?? rawSym;

						aaveCollateralSymbols.add(sym);

						const existing = bySymbol.get(sym) ?? { qty: 0, valueUsd: 0, priceUsd: null };
						existing.qty      += pos.amount;
						existing.valueUsd += pos.usdValue;
						if (existing.priceUsd == null && pos.amount > 0) {
							existing.priceUsd = pos.usdValue / pos.amount;
						}
						bySymbol.set(sym, existing);
					}
				}
			}
		} catch (aaveErr) {
			console.error('[portfolio/performance] Aave fetch failed (non-fatal)', aaveErr);
		}

		if (bySymbol.size === 0) {
			const empty = {
				updatedAt: new Date().toISOString(),
				summary: { totalCostBasis: 0, pricedCostBasis: 0, totalCurrentValue: 0, totalUnrealizedPnl: 0, pnlPercent: null },
				assets: [],
			};
			return json({ ok: true, ...empty, cached: false });
		}

		// ── 2. Load cost basis from lifecycle groups ──────────────────────────
		// weighted_avg_cost_usd is the average cost per unit across all acquisitions.
		// We also grab latest_acquired_at for display.
		const lifecycleResult = await db.execute({
			sql: `SELECT asset_symbol, weighted_avg_cost_usd, latest_acquired_at
			      FROM asset_lifecycle_groups
			      WHERE tenant_id = ?`,
			args: [tenantId],
		});

		const avgCostMap    = new Map<string, number>();
		const acquiredAtMap = new Map<string, string>();
		for (const row of lifecycleResult.rows) {
			const sym     = String(row.asset_symbol ?? '').toUpperCase();
			const avgCost = Number(row.weighted_avg_cost_usd ?? 0);
			if (sym && avgCost > 0) avgCostMap.set(sym, avgCost);
			if (sym && row.latest_acquired_at) acquiredAtMap.set(sym, String(row.latest_acquired_at).slice(0, 10));
		}

		// ── 3. Build per-asset rows ────────────────────────────────────────────
		const assets: AssetRow[] = [];

		for (const [symbol, snap] of bySymbol) {
			// Skip dust
			if (snap.valueUsd < MIN_VALUE_USD) continue;

			const quantity        = snap.qty;
			const currentValue    = snap.valueUsd;
			const currentPrice    = snap.priceUsd ?? (quantity > 0 ? snap.valueUsd / quantity : null);
			const weightedAvgCost = avgCostMap.get(symbol) ?? 0;
			const totalCostBasis  = quantity * weightedAvgCost;
			const lastAcquiredAt  = acquiredAtMap.get(symbol) ?? null;

			const unrealizedPnl = weightedAvgCost > 0 ? currentValue - totalCostBasis : null;
			const pnlPercent = unrealizedPnl != null && totalCostBasis > 0
				? (unrealizedPnl / totalCostBasis) * 100
				: null;

			const isCollateral = aaveCollateralSymbols.has(symbol);

			assets.push({
				symbol,
				quantity,
				weightedAvgCost,
				totalCostBasis,
				currentPrice,
				currentValue,
				unrealizedPnl,
				pnlPercent,
				lastAcquiredAt,
				priceSource: isCollateral && snap.priceUsd == null ? 'aave' : currentPrice != null ? 'snapshot' : 'none',
				isCollateral,
			});
		}

		// Sort: known P&L first (largest absolute), then by current value
		assets.sort((a, b) => {
			if (a.unrealizedPnl != null && b.unrealizedPnl != null) {
				return Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl);
			}
			if (a.unrealizedPnl != null) return -1;
			if (b.unrealizedPnl != null) return 1;
			return (b.currentValue ?? 0) - (a.currentValue ?? 0);
		});

		// ── 4. Aggregate summary ───────────────────────────────────────────────
		const totalCurrentValue  = assets.reduce((s, a) => s + (a.currentValue  ?? 0), 0);
		const totalCostBasis     = assets.reduce((s, a) => s + a.totalCostBasis, 0);
		const pricedCostBasis    = assets.reduce((s, a) => s + (a.unrealizedPnl != null ? a.totalCostBasis : 0), 0);
		const pricedValue        = assets.reduce((s, a) => s + (a.unrealizedPnl != null ? (a.currentValue ?? 0) : 0), 0);
		const totalUnrealizedPnl = pricedValue - pricedCostBasis;
		const summaryPnlPercent  = pricedCostBasis > 0 ? (totalUnrealizedPnl / pricedCostBasis) * 100 : null;

		const payload = {
			updatedAt: new Date().toISOString(),
			summary: {
				totalCostBasis,
				pricedCostBasis,
				totalCurrentValue,
				totalUnrealizedPnl,
				pnlPercent: summaryPnlPercent,
			},
			assets,
		};

		await setCache(cacheKey, payload, CACHE_TTL);
		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });

		return json({ ok: true, ...payload, cached: false, stale: false });
	} catch (err) {
		console.error('[portfolio/performance] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
