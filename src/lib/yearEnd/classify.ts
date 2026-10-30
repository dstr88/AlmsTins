// ─────────────────────────────────────────────────────────────────────────────
// Tax classification pipeline orchestrator
//
// Runs all five passes in order and writes results to the DB:
//   Pass 1  Easy classifications (CEX labels, burns, Aave liquidations)
//   Pass 2  Transfer matching + loan detection
//   Pass 3  Income & interest
//   Pass 4  FIFO lot matching (builds tax_lots + tax_disposals)
//   Pass 5  Review queue (flags anything still needing attention)
//
// Manual overrides (is_manual = 1) are NEVER overwritten.
// Existing auto classifications are wiped and recomputed each run.
//
// ── Reliability guarantees ────────────────────────────────────────────────────
// 1. ATOMIC PERSIST — all four tables (classifications, review items, lots,
//    disposals) are written in a single db.batch() call. If any statement
//    fails the entire write is rolled back; the DB is never left in a state
//    where, e.g., new lots exist alongside old disposal rows.
//
// 2. PIPELINE RUN LOG — every invocation is recorded in tax_pipeline_runs.
//    The row is inserted with status='running' before any computation begins,
//    then updated to 'success' or 'failed' when the run ends. The UI can read
//    this to show "last computed X minutes ago" and warn when data is stale
//    or when the previous run crashed.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { deleteCachePrefix } from '@/lib/tursoCache';

// Minimal local alias for a Turso batch statement — matches the libsql BatchStatement shape.
// Using a local type avoids coupling to internal @libsql/core sub-paths.
type BatchStatement = { sql: string; args?: (string | number | bigint | boolean | null | Uint8Array | ArrayBuffer | Date)[] };
import type {
	ClassificationResult,
	PipelineStats,
	ReviewItem,
} from './types';
import { classifyAll } from './classifyAll';
import { runFifo, type FifoContext } from './pass4';
import { loadLedgerContext } from '../tax/ledgerContext';
import { invalidateLedger, perWalletEnabled } from '../tax/computeLedger';
import { loadAllocationOverrides } from '../tax/allocationOverride';
import { loadIdentifications } from '../lotIdentificationStore';
import { selectionResolver } from '../tax/lotIdentification';
import { PER_WALLET_FROM } from '../tax/basisMethod';
import { buildReviewQueue } from './pass5';
import {
	loadImportTransactions,
	loadManualClassifications,
	loadOnchainTransactions,
	loadResolvedReviewKeys,
	loadWalletAddresses,
} from './loaders';

const NOW_SQL = `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// ── Statement builders (return SQL arrays, never execute directly) ────────────
// Each builder produces the full list of BatchStatement objects for its table.
// They are all collected and executed in one db.batch() call so that the
// write is atomic: either every table is updated or none is.

function buildClassificationStatements(
	tenantId: string,
	results: ClassificationResult[],
): BatchStatement[] {
	const stmts: BatchStatement[] = [];

	// Wipe previous auto-classifications (manual rows have is_manual=1 and are untouched)
	stmts.push({
		sql: `DELETE FROM tax_classifications WHERE tenant_id = ? AND is_manual = 0`,
		args: [tenantId],
	});

	for (const r of results) {
		stmts.push({
			sql: `INSERT INTO tax_classifications
			      (id, tenant_id, source_type, source_id, category, sub_category, confidence,
			       linked_tx_id, linked_source_type, asset_symbol, amount_usd, tax_year,
			       is_manual, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ${NOW_SQL}, ${NOW_SQL})
ON CONFLICT DO NOTHING`,
			args: [
				randomUUID(), tenantId,
				r.sourceType, r.sourceId,
				r.category, r.subCategory ?? null, r.confidence,
				r.linkedTxId ?? null, r.linkedSourceType ?? null,
				r.assetSymbol ?? null, r.amountUsd ?? null, r.taxYear ?? null,
			],
		});
	}

	return stmts;
}

function buildReviewItemStatements(
	tenantId: string,
	items: ReviewItem[],
): BatchStatement[] {
	return items.map((item) => ({
		sql: `INSERT INTO tax_review_items
		      (id, tenant_id, source_type, source_id, reason, reason_detail,
		       snapshot_json, resolved, created_at, updated_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ${NOW_SQL}, ${NOW_SQL})
ON CONFLICT DO NOTHING`,
		args: [
			randomUUID(), tenantId,
			item.sourceType, item.sourceId,
			item.reason, item.reasonDetail,
			item.snapshotJson,
		],
	}));
}

function buildLotStatements(
	tenantId: string,
	lots: ReturnType<typeof runFifo>['lots'],
): BatchStatement[] {
	const stmts: BatchStatement[] = [];

	stmts.push({ sql: `DELETE FROM tax_lots WHERE tenant_id = ?`, args: [tenantId] });

	for (const lot of lots) {
		stmts.push({
			sql: `INSERT INTO tax_lots
			      (id, tenant_id, asset_symbol, acquired_at, quantity, remaining_qty,
			       cost_basis_usd, price_per_unit, source_type, source_id, lot_type,
			       origin_lot_id, is_exhausted, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_SQL}, ${NOW_SQL})`,
			args: [
				lot.id, tenantId, lot.assetSymbol, lot.acquiredAt,
				lot.quantity, lot.remainingQty,
				lot.costBasisUsd ?? null, lot.pricePerUnit ?? null,
				lot.sourceType, lot.sourceId, lot.lotType,
				lot.originLotId ?? null,
				lot.remainingQty <= 0 ? 1 : 0,
			],
		});
	}

	return stmts;
}

function buildDisposalStatements(
	tenantId: string,
	disposals: ReturnType<typeof runFifo>['disposals'],
): BatchStatement[] {
	const stmts: BatchStatement[] = [];

	stmts.push({ sql: `DELETE FROM tax_disposals WHERE tenant_id = ?`, args: [tenantId] });

	for (const d of disposals) {
		stmts.push({
			sql: `INSERT INTO tax_disposals
			      (id, tenant_id, asset_symbol, disposed_at, quantity, proceeds_usd,
			       cost_basis_usd, gain_loss_usd, is_short_term, category,
			       source_type, source_id, lot_id, notes, created_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_SQL})`,
			args: [
				d.id, tenantId, d.assetSymbol, d.disposedAt,
				d.quantity, d.proceedsUsd ?? null,
				d.costBasisUsd ?? null, d.gainLossUsd ?? null,
				d.isShortTerm ? 1 : 0, d.category,
				d.sourceType, d.sourceId, d.lotId,
				d.notes ?? null,
			],
		});
	}

	return stmts;
}

// ── Pipeline run log helpers ──────────────────────────────────────────────────

async function insertRunRecord(runId: string, tenantId: string): Promise<void> {
	await db.execute({
		sql: `INSERT INTO tax_pipeline_runs (id, tenant_id, started_at, status)
		      VALUES (?, ?, ${NOW_SQL}, 'running')`,
		args: [runId, tenantId],
	});
}

function buildRunSuccessStatement(runId: string, stats: PipelineStats): BatchStatement {
	return {
		sql: `UPDATE tax_pipeline_runs
		      SET status           = 'success',
		          completed_at     = ${NOW_SQL},
		          pass1_easy       = ?,
		          pass2_transfers  = ?,
		          pass2b_loans     = ?,
		          pass3_income     = ?,
		          pass3_fees       = ?,
		          pass3b_defi      = ?,
		          pass4_lots       = ?,
		          pass4_disposals  = ?,
		          pass5_review     = ?,
		          total_classified = ?,
		          total_unknown    = ?
		      WHERE id = ?`,
		args: [
			stats.pass1Easy,
			stats.pass2Transfers,
			stats.pass2bLoans,
			stats.pass3Income,
			stats.pass3Fees,
			stats.pass3bDefi,
			stats.pass4Lots,
			stats.pass4Disposals,
			stats.pass5ReviewItems,
			stats.totalClassified,
			stats.totalUnknown,
			runId,
		],
	};
}

async function markRunFailed(runId: string, error: unknown): Promise<void> {
	const msg = error instanceof Error ? error.message : String(error);
	try {
		await db.execute({
			sql: `UPDATE tax_pipeline_runs
			      SET status = 'failed', completed_at = ${NOW_SQL}, error_message = ?
			      WHERE id = ?`,
			args: [msg.slice(0, 2000), runId],
		});
	} catch {
		// Best-effort — don't mask the original error
	}
}

/** What pass 4 needs besides the rows to tell a transfer from a sale. */
async function loadFifoContext(tenantId: string, manualOverrides: Map<string, ClassificationResult>): Promise<FifoContext> {
	const ctx = await loadLedgerContext(tenantId);
	const perWallet = await perWalletEnabled(tenantId);
	return {
		perWalletFrom: perWallet ? PER_WALLET_FROM : null,
		allocationOverrides: perWallet ? await loadAllocationOverrides(tenantId) : [],
		selectionFor: perWallet ? selectionResolver(await loadIdentifications(tenantId)) : undefined,
		manualKeys: new Set(manualOverrides.keys()),
		wallets: ctx.walletsById,
		walletIdByTxHash: ctx.walletIdByTxHash,
		transferMatches: ctx.transferMatches,
		ownerIndex: ctx.ownerIndex,
		manualBasis: ctx.manualBasis,
	};
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runTaxPipeline(tenantId: string): Promise<PipelineStats> {
	const runId = randomUUID();

	// Record that a run has started. This row exists even if everything below
	// blows up, so the UI can show "last attempted X minutes ago (failed)".
	await insertRunRecord(runId, tenantId);

	try {
		const [importRows, onchainRows, walletAddresses, manualOverrides, resolvedReviewKeys] =
			await Promise.all([
				loadImportTransactions(tenantId),
				loadOnchainTransactions(tenantId),
				loadWalletAddresses(tenantId),
				loadManualClassifications(tenantId),
				loadResolvedReviewKeys(tenantId),
			]);

		// ── Passes 1 to 3b: classify every row they can read ──────────────────
		const { classifications, classifiedKeys, reviewItems: allReviewItems, counts } = classifyAll(
			importRows, onchainRows, walletAddresses, manualOverrides,
		);

		// ── Pass 4: FIFO lot matching ──────────────────────────────────────────
		const { lots, disposals } = runFifo(tenantId, importRows, onchainRows, classifications, await loadFifoContext(tenantId, manualOverrides));

		// ── Pass 5: Build review queue ─────────────────────────────────────────
		const existingReviewKeys = new Set([
			...allReviewItems.map((i) => `${i.sourceType}:${i.sourceId}:${i.reason}`),
			...resolvedReviewKeys,
		]);
		const reviewItems5 = buildReviewQueue(importRows, onchainRows, classifications, existingReviewKeys);
		allReviewItems.push(...reviewItems5);

		// ── Compute stats ──────────────────────────────────────────────────────
		const allAutoResults = [...classifications.values()].filter((r) => {
			const key = `${r.sourceType}:${r.sourceId}`;
			return !manualOverrides.has(key);
		});

		const totalUnknown =
			[...importRows, ...onchainRows].filter((r) => {
				const key = 'timestamp_utc' in r ? `import:${r.id}` : `onchain:${r.id}`;
				return !classifiedKeys.has(key);
			}).length;

		const stats: PipelineStats = {
			pass1Easy:       counts.pass1Easy,
			pass2Transfers:  counts.pass2TransferResults / 2,
			pass2bLoans:     counts.pass2bLoans,
			pass3Income:     counts.pass3Income,
			pass3Fees:       counts.pass3Fees,
			pass3bDefi:      counts.pass3bDefi,
			pass4Lots:       lots.length,
			pass4Disposals:  disposals.length,
			pass5ReviewItems: allReviewItems.length,
			totalClassified: classifiedKeys.size,
			totalUnknown,
		};

		// ── Atomic persist ─────────────────────────────────────────────────────
		// All four tables are written in a single db.batch() transaction.
		// If any statement fails every change is rolled back — the DB is never
		// left with, e.g., fresh lots alongside stale disposal rows.
		const persistStatements: BatchStatement[] = [
			...buildClassificationStatements(tenantId, allAutoResults),
			...buildReviewItemStatements(tenantId, allReviewItems),
			...buildLotStatements(tenantId, lots),
			...buildDisposalStatements(tenantId, disposals),
			// Mark this run as successful (included in the same transaction so
			// status only flips to 'success' when everything else committed too)
			buildRunSuccessStatement(runId, stats),
		];

		await db.batch(persistStatements, 'write');
		invalidateLedger(tenantId);

		// Bust all tenant-scoped tax caches so the next page load reads fresh
		// numbers. Fire-and-forget — a cache bust failure is never worth surfacing.
		deleteCachePrefix(`t:${tenantId}:`).catch((e) =>
			console.warn('[classify] cache bust failed (non-fatal)', e),
		);

		return stats;

	} catch (err) {
		// Update the run record to 'failed' with the error message so the UI
		// can surface "last run failed — pipeline may be showing stale data"
		await markRunFailed(runId, err);
		throw err;
	}
}
