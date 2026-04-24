/**
 * GET /api/portfolio/performance
 *
 * Returns per-asset unrealized P&L based on:
 *   - cost basis from asset_lifecycle_groups (weighted avg)
 *   - current prices from CoinPaprika (cached)
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
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { getCache, setCache } from '@/lib/tursoCache';

export const prerender = false;

const CACHE_TTL = 5 * 60; // 5 minutes

interface AssetRow {
	symbol:          string;
	quantity:        number;
	weightedAvgCost: number;   // per unit
	totalCostBasis:  number;
	currentPrice:    number | null;
	currentValue:    number | null;
	unrealizedPnl:   number | null;
	pnlPercent:      number | null;
	lastAcquiredAt:  string | null;
	priceSource:     'coinpaprika' | 'none';
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

		const cacheKey = `t:${tenantId}:portfolio:performance:v4`;
		const cached = await getCache<unknown>(cacheKey, {
			allowStale: true,
			staleMaxAgeSeconds: 30 * 60,
		});
		if (cached.value) {
			return json({ ok: true, ...(cached.value as object), cached: true, stale: cached.isStale });
		}

		// ── 1. Load asset groups + net disposal quantities ────────────────────
		// total_quantity only tracks acquisitions; we subtract outbound non-linked
		// exchange events (sells, sends to external wallets) to get net holdings.
		// linked_transfer = 0 excludes wallet-to-wallet moves that appear on
		// both sides of the ledger (they'd net to zero anyway).
		const groupsResult = await db.execute({
			sql: `SELECT
			        alg.asset_symbol,
			        alg.total_quantity                                          AS gross_quantity,
			        alg.weighted_avg_cost_usd,
			        alg.latest_acquired_at,
			        COALESCE(SUM(
			            CASE
			                WHEN ale.direction = 'out'
			                 AND ale.transaction_class = 'other'
			                 AND (ale.linked_transfer = 0 OR ale.linked_transfer IS NULL)
			                THEN ale.amount
			                ELSE 0
			            END
			        ), 0) AS disposed_quantity
			      FROM asset_lifecycle_groups alg
			      LEFT JOIN asset_lifecycle_events ale
			             ON ale.group_id = alg.id
			      WHERE alg.tenant_id = ?
			      GROUP BY alg.id, alg.asset_symbol, alg.total_quantity,
			               alg.weighted_avg_cost_usd, alg.latest_acquired_at
			      HAVING (alg.total_quantity - COALESCE(SUM(
			            CASE
			                WHEN ale.direction = 'out'
			                 AND ale.transaction_class = 'other'
			                 AND (ale.linked_transfer = 0 OR ale.linked_transfer IS NULL)
			                THEN ale.amount ELSE 0
			            END
			        ), 0)) > 0
			      ORDER BY alg.asset_symbol`,
			args: [tenantId],
		});

		type DbRow = Record<string, unknown>;
		const groups = groupsResult.rows as DbRow[];

		if (groups.length === 0) {
			const empty = {
				updatedAt: new Date().toISOString(),
				summary: { totalCostBasis: 0, pricedCostBasis: 0, totalCurrentValue: 0, totalUnrealizedPnl: 0, pnlPercent: null },
				assets: [],
			};
			return json({ ok: true, ...empty, cached: false });
		}

		// ── 2. Fetch current prices ────────────────────────────────────────────
		let tickers: Array<{ symbol: string; quotes?: { USD?: { price?: number } } }> = [];
		try {
			tickers = (await getTickersUSD()) as typeof tickers;
		} catch (err) {
			console.warn('[portfolio/performance] CoinPaprika fetch failed', err);
		}

		// Build price map — first occurrence wins (highest market cap by default)
		const priceMap = new Map<string, number>();
		for (const t of tickers) {
			const sym = t.symbol?.toUpperCase();
			if (sym && !priceMap.has(sym)) {
				const price = t.quotes?.USD?.price;
				if (price != null && price > 0) priceMap.set(sym, price);
			}
		}

		// ── 3. Build per-asset rows ────────────────────────────────────────────
		const assets: AssetRow[] = [];

		for (const g of groups) {
			const symbol          = String(g.asset_symbol ?? '').toUpperCase();
			const grossQuantity   = Number(g.gross_quantity ?? 0);
			const disposedQty     = Number(g.disposed_quantity ?? 0);
			const quantity        = Math.max(0, grossQuantity - disposedQty);
			const weightedAvgCost = Number(g.weighted_avg_cost_usd ?? 0);
			const totalCostBasis  = quantity * weightedAvgCost;
			const lastAcquiredAt  = g.latest_acquired_at ? String(g.latest_acquired_at).slice(0, 10) : null;

			const currentPrice = priceMap.get(symbol) ?? null;
			const currentValue = currentPrice != null ? quantity * currentPrice : null;
			const unrealizedPnl = currentValue != null ? currentValue - totalCostBasis : null;
			const pnlPercent = unrealizedPnl != null && totalCostBasis > 0
				? (unrealizedPnl / totalCostBasis) * 100
				: null;

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
				priceSource: currentPrice != null ? 'coinpaprika' : 'none',
			});
		}

		// Sort by absolute unrealized P&L descending (assets with prices first, then by cost basis)
		assets.sort((a, b) => {
			if (a.unrealizedPnl != null && b.unrealizedPnl != null) {
				return Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl);
			}
			if (a.unrealizedPnl != null) return -1;
			if (b.unrealizedPnl != null) return 1;
			return b.totalCostBasis - a.totalCostBasis;
		});

		// ── 4. Aggregate summary ───────────────────────────────────────────────
		const totalCostBasis   = assets.reduce((s, a) => s + a.totalCostBasis, 0);
		const totalCurrentValue = assets.reduce((s, a) => s + (a.currentValue ?? 0), 0);
		const totalUnrealizedPnl = totalCurrentValue - assets.reduce((s, a) => s + (a.currentValue != null ? a.totalCostBasis : 0), 0);
		const pricedCostBasis = assets.reduce((s, a) => s + (a.currentValue != null ? a.totalCostBasis : 0), 0);
		const summaryPnlPercent = pricedCostBasis > 0 ? (totalUnrealizedPnl / pricedCostBasis) * 100 : null;

		const payload = {
			updatedAt: new Date().toISOString(),
			summary: {
				totalCostBasis,
				pricedCostBasis,      // cost basis of priced assets only — reconciles with P&L
				totalCurrentValue,
				totalUnrealizedPnl,
				pnlPercent: summaryPnlPercent,
			},
			assets,
		};

		await setCache(cacheKey, payload, CACHE_TTL);

		return json({ ok: true, ...payload, cached: false, stale: false });
	} catch (err) {
		console.error('[portfolio/performance] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
