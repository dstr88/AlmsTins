/**
 * GET /api/tax/summary?year=YYYY
 *
 * Returns a Schedule D–style tax summary for the authenticated tenant.
 *
 * Capital gain/loss computation is approximate: proceeds come from lifecycle
 * events (out-direction, taxable classes); cost basis comes from the
 * weighted_avg_cost_usd recorded on the lifecycle group at the time the event
 * was inserted.  Exact FIFO per-lot matching is done client-side on the
 * transactions page — this endpoint provides the high-level dashboard card.
 *
 * Response shape:
 * {
 *   ok: true,
 *   year: 2024,
 *   ordinaryIncome: { total: number, count: number, byAsset: {symbol, amount}[] },
 *   disposals:      { totalProceeds: number, count: number, unpricedCount: number },
 *   unpricedOnchain: number,   // onchain txs still missing native_usd
 * }
 */

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';

export const prerender = false;

// Transaction classes that are taxable disposals (capital events)
// 'liability_liquidation' = forced sell → capital event
const DISPOSAL_CLASSES = new Set([
	'other',                // plain crypto sell / swap
	'owned_acquisition',    // sells recorded as outgoing acquisitions from exchange
	'liability_liquidation',
]);

// Classes that are never capital events
const NON_DISPOSAL_CLASSES = new Set([
	'liability_increase',
	'liability_repayment',
	'collateral_deposit',
	'collateral_withdrawal',
	'interest_income',
]);

export const GET: APIRoute = async ({ request, url }) => {
	const session = await requireTenantSession(request);
	const { tenantId } = session;

	const yearParam = url.searchParams.get('year');
	const year = yearParam ? Number(yearParam) : new Date().getFullYear();

	if (Number.isNaN(year) || year < 2009 || year > 2100) {
		return respond({ ok: false, error: 'Invalid year parameter.' }, 400);
	}

	const from = `${year}-01-01T00:00:00.000Z`;
	const to   = `${year}-12-31T23:59:59.999Z`;

	try {
		// ── 1. Ordinary income (interest_income events) ───────────────────────
		const incomeRes = await db.execute({
			sql: `SELECT ale.asset_symbol, SUM(ale.native_usd) AS total_usd, COUNT(*) AS event_count
			      FROM asset_lifecycle_events ale
			      WHERE ale.tenant_id = ?
			        AND ale.transaction_class = 'interest_income'
			        AND ale.direction = 'in'
			        AND ale.timestamp_utc BETWEEN ? AND ?
			        AND ale.native_usd IS NOT NULL AND ale.native_usd > 0
			      GROUP BY ale.asset_symbol
			      ORDER BY total_usd DESC`,
			args: [tenantId, from, to],
		});

		const byAsset = incomeRes.rows.map((r) => ({
			symbol: String(r.asset_symbol ?? ''),
			amount: Number(r.total_usd ?? 0),
			count:  Number(r.event_count ?? 0),
		}));

		const ordinaryIncome = {
			total: byAsset.reduce((s, x) => s + x.amount, 0),
			count: byAsset.reduce((s, x) => s + x.count,  0),
			byAsset,
		};

		// ── 2. Disposal summary (outgoing taxable events) ─────────────────────
		// We sum proceeds (native_usd) from out-direction lifecycle events whose
		// class is a disposal.  This is a proceeds-only number; cost basis and
		// gain/loss are in the FIFO CSV export on the transactions page.
		const disposalRes = await db.execute({
			sql: `SELECT
			        COUNT(*) AS total_count,
			        SUM(CASE WHEN ale.native_usd IS NOT NULL AND ale.native_usd > 0 THEN ale.native_usd ELSE 0 END) AS total_proceeds,
			        SUM(CASE WHEN ale.native_usd IS NULL OR ale.native_usd <= 0 THEN 1 ELSE 0 END) AS unpriced_count,
			        SUM(CASE WHEN ale.transaction_class = 'liability_liquidation' THEN 1 ELSE 0 END) AS liquidation_count
			      FROM asset_lifecycle_events ale
			      WHERE ale.tenant_id = ?
			        AND ale.direction = 'out'
			        AND ale.linked_transfer = 0
			        AND ale.transaction_class NOT IN (
			            'liability_increase', 'liability_repayment',
			            'collateral_deposit', 'collateral_withdrawal', 'interest_income'
			        )
			        AND ale.timestamp_utc BETWEEN ? AND ?`,
			args: [tenantId, from, to],
		});

		const dRow = disposalRes.rows[0] ?? {};
		const disposals = {
			totalProceeds:   Number(dRow.total_proceeds   ?? 0),
			count:           Number(dRow.total_count       ?? 0),
			unpricedCount:   Number(dRow.unpriced_count    ?? 0),
			liquidationCount: Number(dRow.liquidation_count ?? 0),
		};

		// ── 3. Unpriced onchain transactions (the raw source rows) ────────────
		const unpricedRes = await db.execute({
			sql: `SELECT COUNT(*) AS cnt
			      FROM transactions
			      WHERE tenant_id = ?
			        AND (usd_value IS NULL OR usd_value <= 0)
			        AND timestamp BETWEEN ? AND ?`,
			args: [tenantId, from, to],
		});
		const unpricedOnchain = Number(unpricedRes.rows[0]?.cnt ?? 0);

		// ── 4. Year-over-year list for the selector (available tax years) ─────
		const yearsRes = await db.execute({
			sql: `SELECT DISTINCT strftime('%Y', timestamp_utc) AS y
			      FROM asset_lifecycle_events
			      WHERE tenant_id = ?
			      ORDER BY y DESC`,
			args: [tenantId],
		});
		const availableYears = yearsRes.rows
			.map((r) => Number(r.y))
			.filter((y) => y >= 2009 && y <= 2100);

		return respond({
			ok: true,
			year,
			availableYears,
			ordinaryIncome,
			disposals,
			unpricedOnchain,
		});
	} catch (error) {
		console.error('[tax/summary] failed:', error);
		return respond({ ok: false, error: 'Unable to build tax summary.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
