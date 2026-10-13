/**
 * monthlyReconciliation.ts — checkbook-style monthly portfolio reconciliation.
 *
 * Formula per month:
 *   expected_closing = opening_assets + inflows - outflows
 *                    + (transfer_in - transfer_out)   ← net ~0 for own-wallet moves
 *   delta            = actual_closing - expected_closing
 *
 * A non-zero delta means:
 *   - Market price changes (appreciation/depreciation) — normal
 *   - Missing data: transaction disappeared from the source
 *   - Unmatched transfer half: sent out but no matching inbound in our data (or vice versa)
 *
 * Transfer handling:
 *   Matched transfers (transfer_matches table, status != 'rejected') contribute to
 *   transfer_in / transfer_out and net to ~0 (minus small fee).
 *   Unmatched transfer halves (one side missing) are tracked separately as
 *   unmatchedOutUsd / unmatchedInUsd — these are the "disappeared transactions".
 */

import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonthlyReconciliation = {
	yearMonth: string;             // 'YYYY-MM'
	openingAssetsUsd: number | null;
	closingAssetsUsd: number | null;
	inflowsUsd: number;            // non-transfer inflows (buys, income, rewards)
	outflowsUsd: number;           // non-transfer outflows (sells, fees, payments)
	transferInUsd: number;         // matched transfer inflows
	transferOutUsd: number;        // matched transfer outflows
	unmatchedOutUsd: number;       // sent out, no matching inbound found — data gap
	unmatchedInUsd: number;        // received, no matching outbound found — data gap
	expectedClosingUsd: number | null;
	deltaUsd: number | null;       // closing - expected (0 = balanced)
	txCount: number;
	unmatchedTxCount: number;
	assets: MonthlyAssetRow[];
};

export type MonthlyAssetRow = {
	assetSymbol: string;
	inflowsQty: number;
	inflowsUsd: number;
	outflowsQty: number;
	outflowsUsd: number;
	unmatchedOutQty: number;
	unmatchedOutUsd: number;
	unmatchedInQty: number;
	unmatchedInUsd: number;
	txCount: number;
};

type DbRow = Record<string, unknown>;
const num  = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);
const str  = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Sum of all wallet asset USD (no debt) from wallet_snapshots at or before `before`.
 * Uses the most-recent snapshot per wallet+chain captured before the boundary.
 */
async function getAssetTotalAtOrBefore(
	tenantId: string,
	before: string,
): Promise<number | null> {
	const result = await db.execute({
		sql: `SELECT SUM(ws.totals_usd) AS total
		      FROM (
		        SELECT wallet_id, chain, MAX(captured_at) AS latest
		        FROM wallet_snapshots
		        WHERE tenant_id = ? AND captured_at < ?
		        GROUP BY wallet_id, chain
		      ) latest_per_chain
		      JOIN wallet_snapshots ws
		        ON  ws.wallet_id   = latest_per_chain.wallet_id
		        AND ws.chain       = latest_per_chain.chain
		        AND ws.captured_at = latest_per_chain.latest
		        AND ws.tenant_id   = ?`,
		args: [tenantId, before, tenantId],
	});
	const row = result.rows[0] as DbRow | undefined;
	const total = row?.total;
	return typeof total === 'number' ? total : null;
}

// ── Cash flow query ───────────────────────────────────────────────────────────

type FlowRow = {
	txId: string;
	assetSymbol: string;
	direction: string;
	totalUsd: number;
	totalQty: number;
	isTransfer: number;
	isMatched: number;
};

async function getMonthFlows(tenantId: string, yearMonth: string): Promise<FlowRow[]> {
	// One row per transaction.  Join tax_classifications for transfer flag,
	// transfer_matches to know if the transfer has a counterpart in our data.
	const result = await db.execute({
		sql: `
		SELECT
		  it.id                                                       AS "txId",
		  UPPER(COALESCE(it.asset_symbol, '?'))                       AS "assetSymbol",
		  LOWER(COALESCE(it.direction, ''))                           AS direction,
		  COALESCE(it.native_usd, 0)                                  AS "totalUsd",
		  ABS(COALESCE(it.amount, 0))                                 AS "totalQty",
		  CASE WHEN tc.category = 'transfer' THEN 1 ELSE 0 END        AS "isTransfer",
		  CASE WHEN (tm_out.id IS NOT NULL
		          OR tm_in.id  IS NOT NULL) THEN 1 ELSE 0 END         AS "isMatched"
		FROM import_transactions it
		LEFT JOIN tax_classifications tc
		  ON  tc.source_type = 'import'
		  AND tc.source_id   = it.id
		  AND tc.tenant_id   = it.tenant_id
		LEFT JOIN transfer_matches tm_out
		  ON  tm_out.out_tx_id  = it.id
		  AND tm_out.tenant_id  = it.tenant_id
		  AND tm_out.status    != 'rejected'
		LEFT JOIN transfer_matches tm_in
		  ON  tm_in.in_tx_id   = it.id
		  AND tm_in.tenant_id  = it.tenant_id
		  AND tm_in.status     != 'rejected'
		WHERE it.tenant_id = ?
		  AND substr(it.timestamp_utc, 1, 7) = ?
		  AND it.is_duplicate != 1
		  AND it.direction IN ('in', 'out')
		`,
		args: [tenantId, yearMonth],
	});

	return (result.rows as DbRow[]).map((r) => ({
		txId:        str(r.txId),
		assetSymbol: str(r.assetSymbol),
		direction:   str(r.direction),
		totalUsd:    num(r.totalUsd),
		totalQty:    num(r.totalQty),
		isTransfer:  num(r.isTransfer),
		isMatched:   num(r.isMatched),
	}));
}

// ── Main compute function ─────────────────────────────────────────────────────

export async function computeMonthlyReconciliation(
	tenantId: string,
	yearMonth: string,
): Promise<MonthlyReconciliation> {
	const [year, month] = yearMonth.split('-').map(Number);
	const monthStart = `${yearMonth}-01T00:00:00Z`;
	const nextMonth  = month === 12
		? `${year + 1}-01-01T00:00:00Z`
		: `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00Z`;

	const [openingAssetsUsd, closingAssetsUsd, flows] = await Promise.all([
		getAssetTotalAtOrBefore(tenantId, monthStart),
		getAssetTotalAtOrBefore(tenantId, nextMonth),
		getMonthFlows(tenantId, yearMonth),
	]);

	let inflowsUsd    = 0;
	let outflowsUsd   = 0;
	let transferInUsd  = 0;
	let transferOutUsd = 0;
	let unmatchedOutUsd = 0;
	let unmatchedInUsd  = 0;
	let totalTxCount    = 0;
	let unmatchedTxCount = 0;

	const assetMap = new Map<string, MonthlyAssetRow>();

	for (const flow of flows) {
		const sym = flow.assetSymbol;
		if (!assetMap.has(sym)) {
			assetMap.set(sym, {
				assetSymbol: sym,
				inflowsQty: 0, inflowsUsd: 0,
				outflowsQty: 0, outflowsUsd: 0,
				unmatchedOutQty: 0, unmatchedOutUsd: 0,
				unmatchedInQty: 0, unmatchedInUsd: 0,
				txCount: 0,
			});
		}
		const asset = assetMap.get(sym)!;
		totalTxCount++;
		asset.txCount++;

		const isIn  = flow.direction === 'in';
		const isOut = flow.direction === 'out';

		if (flow.isTransfer) {
			if (flow.isMatched) {
				// Matched transfer — moves between own wallets, nets ~0
				if (isIn)  transferInUsd  += flow.totalUsd;
				if (isOut) transferOutUsd += flow.totalUsd;
			} else {
				// Unmatched — this transaction's counterpart disappeared from the data
				unmatchedTxCount++;
				if (isOut) {
					unmatchedOutUsd        += flow.totalUsd;
					asset.unmatchedOutQty  += flow.totalQty;
					asset.unmatchedOutUsd  += flow.totalUsd;
				}
				if (isIn) {
					unmatchedInUsd         += flow.totalUsd;
					asset.unmatchedInQty   += flow.totalQty;
					asset.unmatchedInUsd   += flow.totalUsd;
				}
			}
		} else {
			// Regular cash flow (buy, sell, income, reward, fee)
			if (isIn) {
				inflowsUsd      += flow.totalUsd;
				asset.inflowsQty += flow.totalQty;
				asset.inflowsUsd += flow.totalUsd;
			}
			if (isOut) {
				outflowsUsd      += flow.totalUsd;
				asset.outflowsQty += flow.totalQty;
				asset.outflowsUsd += flow.totalUsd;
			}
		}
	}

	const expectedClosingUsd = openingAssetsUsd !== null
		? openingAssetsUsd + inflowsUsd - outflowsUsd + (transferInUsd - transferOutUsd)
		: null;

	const deltaUsd = closingAssetsUsd !== null && expectedClosingUsd !== null
		? closingAssetsUsd - expectedClosingUsd
		: null;

	return {
		yearMonth,
		openingAssetsUsd,
		closingAssetsUsd,
		inflowsUsd,
		outflowsUsd,
		transferInUsd,
		transferOutUsd,
		unmatchedOutUsd,
		unmatchedInUsd,
		expectedClosingUsd,
		deltaUsd,
		txCount: totalTxCount,
		unmatchedTxCount,
		assets: Array.from(assetMap.values()).sort(
			(a, b) => (b.inflowsUsd + b.outflowsUsd) - (a.inflowsUsd + a.outflowsUsd)
		),
	};
}

// ── Persist ───────────────────────────────────────────────────────────────────

export async function saveMonthlyReconciliation(
	tenantId: string,
	rec: MonthlyReconciliation,
): Promise<void> {
	await db.batch([
		{
			sql: `INSERT INTO portfolio_reconciliation
			        (id, tenant_id, year_month, opening_assets_usd, closing_assets_usd,
			         inflows_usd, outflows_usd, transfer_in_usd, transfer_out_usd,
			         unmatched_out_usd, unmatched_in_usd, expected_closing_usd, delta_usd,
			         tx_count, unmatched_tx_count, computed_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			              to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
			      ON CONFLICT (tenant_id, year_month) DO UPDATE SET
			        opening_assets_usd   = excluded.opening_assets_usd,
			        closing_assets_usd   = excluded.closing_assets_usd,
			        inflows_usd          = excluded.inflows_usd,
			        outflows_usd         = excluded.outflows_usd,
			        transfer_in_usd      = excluded.transfer_in_usd,
			        transfer_out_usd     = excluded.transfer_out_usd,
			        unmatched_out_usd    = excluded.unmatched_out_usd,
			        unmatched_in_usd     = excluded.unmatched_in_usd,
			        expected_closing_usd = excluded.expected_closing_usd,
			        delta_usd            = excluded.delta_usd,
			        tx_count             = excluded.tx_count,
			        unmatched_tx_count   = excluded.unmatched_tx_count,
			        computed_at          = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
			args: [
				randomUUID(), tenantId, rec.yearMonth,
				rec.openingAssetsUsd, rec.closingAssetsUsd,
				rec.inflowsUsd, rec.outflowsUsd,
				rec.transferInUsd, rec.transferOutUsd,
				rec.unmatchedOutUsd, rec.unmatchedInUsd,
				rec.expectedClosingUsd, rec.deltaUsd,
				rec.txCount, rec.unmatchedTxCount,
			],
		},
		{
			sql: `DELETE FROM portfolio_reconciliation_assets WHERE tenant_id = ? AND year_month = ?`,
			args: [tenantId, rec.yearMonth],
		},
		...rec.assets.map((a) => ({
			sql: `INSERT INTO portfolio_reconciliation_assets
			        (id, tenant_id, year_month, asset_symbol,
			         inflows_qty, inflows_usd, outflows_qty, outflows_usd,
			         unmatched_out_qty, unmatched_out_usd,
			         unmatched_in_qty,  unmatched_in_usd, tx_count)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				randomUUID(), tenantId, rec.yearMonth, a.assetSymbol,
				a.inflowsQty, a.inflowsUsd, a.outflowsQty, a.outflowsUsd,
				a.unmatchedOutQty, a.unmatchedOutUsd,
				a.unmatchedInQty,  a.unmatchedInUsd,
				a.txCount,
			],
		})),
	]);
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadMonthlyReconciliation(
	tenantId: string,
	yearMonth: string,
): Promise<MonthlyReconciliation | null> {
	const [mainRes, assetsRes] = await Promise.all([
		db.execute({
			sql: `SELECT * FROM portfolio_reconciliation WHERE tenant_id = ? AND year_month = ?`,
			args: [tenantId, yearMonth],
		}),
		db.execute({
			sql: `SELECT * FROM portfolio_reconciliation_assets
			      WHERE tenant_id = ? AND year_month = ?
			      ORDER BY inflows_usd + outflows_usd DESC`,
			args: [tenantId, yearMonth],
		}),
	]);

	if (!mainRes.rows.length) return null;
	const r = mainRes.rows[0] as DbRow;

	return {
		yearMonth,
		openingAssetsUsd:    typeof r.opening_assets_usd   === 'number' ? r.opening_assets_usd   : null,
		closingAssetsUsd:    typeof r.closing_assets_usd   === 'number' ? r.closing_assets_usd   : null,
		inflowsUsd:          num(r.inflows_usd),
		outflowsUsd:         num(r.outflows_usd),
		transferInUsd:       num(r.transfer_in_usd),
		transferOutUsd:      num(r.transfer_out_usd),
		unmatchedOutUsd:     num(r.unmatched_out_usd),
		unmatchedInUsd:      num(r.unmatched_in_usd),
		expectedClosingUsd:  typeof r.expected_closing_usd === 'number' ? r.expected_closing_usd : null,
		deltaUsd:            typeof r.delta_usd            === 'number' ? r.delta_usd            : null,
		txCount:             num(r.tx_count),
		unmatchedTxCount:    num(r.unmatched_tx_count),
		assets: (assetsRes.rows as DbRow[]).map((a) => ({
			assetSymbol:     str(a.asset_symbol),
			inflowsQty:      num(a.inflows_qty),
			inflowsUsd:      num(a.inflows_usd),
			outflowsQty:     num(a.outflows_qty),
			outflowsUsd:     num(a.outflows_usd),
			unmatchedOutQty: num(a.unmatched_out_qty),
			unmatchedOutUsd: num(a.unmatched_out_usd),
			unmatchedInQty:  num(a.unmatched_in_qty),
			unmatchedInUsd:  num(a.unmatched_in_usd),
			txCount:         num(a.tx_count),
		})),
	};
}

// ── Available months ─────────────────────────────────────────────────────────

export async function getAvailableReconciliationMonths(tenantId: string): Promise<string[]> {
	const result = await db.execute({
		sql: `SELECT DISTINCT substr(timestamp_utc, 1, 7) AS ym
		      FROM import_transactions
		      WHERE tenant_id = ? AND timestamp_utc IS NOT NULL
		      ORDER BY ym DESC`,
		args: [tenantId],
	});
	return (result.rows as DbRow[]).map((r) => str(r.ym)).filter(Boolean);
}
