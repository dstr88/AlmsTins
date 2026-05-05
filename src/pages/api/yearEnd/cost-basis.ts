/**
 * GET /api/yearEnd/cost-basis
 *
 * Returns a per-asset cost basis summary for the authenticated tenant,
 * computed from CSV-imported exchange transactions (import_transactions table).
 *
 * Method: Weighted-Average Cost (WAC)
 *   avgCost       = totalCostUsd / totalAcquired
 *   costBasis     = avgCost × netQtyHeld
 *   realizedGain  = totalProceedsUsd − (avgCost × totalDisposed)
 *
 * Response shape:
 * {
 *   ok: true,
 *   assets: [{
 *     symbol, totalAcquired, totalCostUsd, totalDisposed, totalProceedsUsd,
 *     netQtyHeld, avgCostPerUnit, totalCostBasis, realizedGain,
 *     buyCount, sellCount, firstBuyDate
 *   }],
 *   source: "import_transactions",
 *   note: string
 * }
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	try {
		const result = await db.execute({
			sql: `SELECT
				asset_symbol,
				SUM(CASE WHEN direction = 'in'  THEN COALESCE(to_amount, ABS(amount), 0) ELSE 0 END) AS total_acquired,
				SUM(CASE WHEN direction = 'in'  THEN COALESCE(native_usd, 0)              ELSE 0 END) AS total_cost_usd,
				SUM(CASE WHEN direction = 'out' THEN ABS(COALESCE(amount, 0))             ELSE 0 END) AS total_disposed,
				SUM(CASE WHEN direction = 'out' THEN COALESCE(native_usd, 0)              ELSE 0 END) AS total_proceeds_usd,
				COUNT(CASE WHEN direction = 'in'  THEN 1 END)                                          AS buy_count,
				COUNT(CASE WHEN direction = 'out' THEN 1 END)                                          AS sell_count,
				MIN(CASE WHEN direction = 'in'  THEN timestamp_utc END)                                AS first_buy_date
			FROM import_transactions
			WHERE tenant_id = ?
				AND asset_symbol IS NOT NULL AND asset_symbol != ''
				AND direction IN ('in', 'out')
				AND native_usd IS NOT NULL AND native_usd > 0
			GROUP BY asset_symbol
			HAVING total_acquired > 0
			ORDER BY total_cost_usd DESC`,
			args: [tenantId],
		});

		const assets = result.rows.map((row: any) => {
			const totalAcquired    = Number(row.total_acquired    ?? 0);
			const totalCostUsd     = Number(row.total_cost_usd    ?? 0);
			const totalDisposed    = Number(row.total_disposed     ?? 0);
			const totalProceedsUsd = Number(row.total_proceeds_usd ?? 0);

			const avgCostPerUnit = totalAcquired > 0 ? totalCostUsd / totalAcquired : 0;
			const netQtyHeld     = Math.max(0, totalAcquired - totalDisposed);
			const totalCostBasis = avgCostPerUnit * netQtyHeld;
			const realizedGain   = totalDisposed > 0
				? totalProceedsUsd - avgCostPerUnit * totalDisposed
				: null; // null = no disposals yet

			return {
				symbol:          String(row.asset_symbol ?? ''),
				totalAcquired,
				totalCostUsd,
				totalDisposed,
				totalProceedsUsd,
				netQtyHeld,
				avgCostPerUnit,
				totalCostBasis,
				realizedGain,
				buyCount:        Number(row.buy_count  ?? 0),
				sellCount:       Number(row.sell_count ?? 0),
				firstBuyDate:    row.first_buy_date ? String(row.first_buy_date) : null,
			};
		});

		return respond({
			ok: true,
			assets,
			source: 'import_transactions',
			note: 'Weighted-average cost method. Exchange CSV imports only.',
		});
	} catch (error) {
		console.error('[tax/cost-basis] failed:', error);
		return respond({ ok: false, error: 'Unable to build cost basis summary.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
