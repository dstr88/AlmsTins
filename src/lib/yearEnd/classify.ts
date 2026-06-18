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
	RawImportTx,
	RawOnchainTx,
	ReviewItem,
} from './types';
import { classifyImportTxPass1, classifyOnchainTxPass1 } from './pass1';
import { matchTransfers, detectLoans } from './pass2';
import { classifyIncomePass3, classifyFeesPass3 } from './pass3';
import { classifyDeFiPass3b } from './pass3b';
import { runFifo } from './pass4';
import { buildReviewQueue } from './pass5';

type DbRow = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const n = (v: unknown) => (typeof v === 'number' ? v : null);

const NOW_SQL = `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// ── Load raw data ─────────────────────────────────────────────────────────────

async function loadImportTransactions(tenantId: string): Promise<RawImportTx[]> {
	const result = await db.execute({
		sql: `SELECT id, timestamp_utc, asset_symbol, direction, kind, amount,
		             to_amount, native_usd, tx_hash, source, notes, category, description
		      FROM import_transactions
		      WHERE tenant_id = ?
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});
	return result.rows.map((r: DbRow) => ({
		id: s(r.id),
		timestamp_utc: s(r.timestamp_utc),
		asset_symbol: typeof r.asset_symbol === 'string' ? r.asset_symbol : null,
		direction: typeof r.direction === 'string' ? r.direction : null,
		kind: typeof r.kind === 'string' ? r.kind : null,
		amount: n(r.amount),
		to_amount: n(r.to_amount),
		native_usd: n(r.native_usd),
		tx_hash: typeof r.tx_hash === 'string' ? r.tx_hash : null,
		source: s(r.source),
		notes: typeof r.notes === 'string' ? r.notes : null,
		category: typeof r.category === 'string' ? r.category : null,
		description: typeof r.description === 'string' ? r.description : null,
	}));
}

async function loadOnchainTransactions(tenantId: string): Promise<RawOnchainTx[]> {
	const result = await db.execute({
		sql: `SELECT t.id, t.timestamp, t.token_symbol, t.value,
		             t.from_address, t.to_address, t.tx_type,
		             t.usd_value, t.chain, w.address AS wallet_address
		      FROM transactions t
		      JOIN wallets w ON w.id = t.wallet_id
		      WHERE t.tenant_id = ?
		      ORDER BY t.timestamp ASC`,
		args: [tenantId],
	});
	return result.rows.map((r: DbRow) => ({
		id: s(r.id),
		timestamp: s(r.timestamp),
		token_symbol: typeof r.token_symbol === 'string' ? r.token_symbol : null,
		value: typeof r.value === 'string' ? r.value : null,
		from_address: typeof r.from_address === 'string' ? r.from_address : null,
		to_address: typeof r.to_address === 'string' ? r.to_address : null,
		tx_type: typeof r.tx_type === 'string' ? r.tx_type : null,
		usd_value: n(r.usd_value),
		chain: s(r.chain),
		wallet_address: typeof r.wallet_address === 'string' ? r.wallet_address : undefined,
	}));
}

async function loadWalletAddresses(tenantId: string): Promise<Set<string>> {
	const result = await db.execute({
		sql: `SELECT address FROM wallets WHERE tenant_id = ?`,
		args: [tenantId],
	});
	return new Set(result.rows.map((r: DbRow) => s(r.address).toLowerCase()));
}

async function loadManualClassifications(tenantId: string): Promise<Map<string, ClassificationResult>> {
	const result = await db.execute({
		sql: `SELECT source_type, source_id, category, sub_category, confidence,
		             linked_tx_id, linked_source_type, asset_symbol, amount_usd, tax_year
		      FROM tax_classifications
		      WHERE tenant_id = ? AND is_manual = 1`,
		args: [tenantId],
	});
	const map = new Map<string, ClassificationResult>();
	for (const r of result.rows as DbRow[]) {
		const key = `${s(r.source_type)}:${s(r.source_id)}`;
		map.set(key, {
			sourceType: s(r.source_type) as 'import' | 'onchain',
			sourceId: s(r.source_id),
			category: s(r.category) as ClassificationResult['category'],
			subCategory: typeof r.sub_category === 'string' ? r.sub_category : undefined,
			confidence: n(r.confidence) ?? 1.0,
			linkedTxId: typeof r.linked_tx_id === 'string' ? r.linked_tx_id : undefined,
			linkedSourceType: typeof r.linked_source_type === 'string'
				? (r.linked_source_type as 'import' | 'onchain')
				: undefined,
			assetSymbol: typeof r.asset_symbol === 'string' ? r.asset_symbol : null,
			amountUsd: n(r.amount_usd),
			taxYear: typeof r.tax_year === 'number' ? r.tax_year : null,
		});
	}
	return map;
}

async function loadResolvedReviewKeys(tenantId: string): Promise<Set<string>> {
	const result = await db.execute({
		sql: `SELECT source_type, source_id, reason FROM tax_review_items WHERE tenant_id = ? AND resolved = 1`,
		args: [tenantId],
	});
	return new Set(result.rows.map((r: DbRow) => `${s(r.source_type)}:${s(r.source_id)}:${s(r.reason)}`));
}

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

		// Start with manual overrides already locked in
		const classifications = new Map<string, ClassificationResult>(manualOverrides);
		const classifiedKeys = new Set<string>(manualOverrides.keys());
		const allReviewItems: ReviewItem[] = [];

		// ── Pass 1: Easy classifications ──────────────────────────────────────
		let pass1Count = 0;
		for (const row of importRows) {
			const key = `import:${row.id}`;
			if (classifiedKeys.has(key)) continue;
			const result = classifyImportTxPass1(row);
			if (result) { classifications.set(key, result); classifiedKeys.add(key); pass1Count++; }
		}
		for (const row of onchainRows) {
			const key = `onchain:${row.id}`;
			if (classifiedKeys.has(key)) continue;
			const result = classifyOnchainTxPass1(row);
			if (result) { classifications.set(key, result); classifiedKeys.add(key); pass1Count++; }
		}

		// ── Pass 2A: Transfer matching ─────────────────────────────────────────
		const { results: transferResults, reviewItems: transferReview } = matchTransfers(
			importRows, onchainRows, walletAddresses, classifiedKeys,
		);
		for (const r of transferResults) {
			const key = `${r.sourceType}:${r.sourceId}`;
			if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
		}
		allReviewItems.push(...transferReview);

		// ── Pass 2B: Loan detection ────────────────────────────────────────────
		const { results: loanResults, reviewItems: loanReview } = detectLoans(
			onchainRows, walletAddresses, classifiedKeys,
		);
		for (const r of loanResults) {
			const key = `${r.sourceType}:${r.sourceId}`;
			if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
		}
		allReviewItems.push(...loanReview);

		// ── Pass 3: Income & fees ──────────────────────────────────────────────
		const { results: incomeResults, reviewItems: incomeReview } = classifyIncomePass3(
			importRows, classifiedKeys,
		);
		for (const r of incomeResults) {
			const key = `${r.sourceType}:${r.sourceId}`;
			if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
		}
		allReviewItems.push(...incomeReview);

		const feeResults = classifyFeesPass3(onchainRows, classifiedKeys);
		for (const r of feeResults) {
			const key = `${r.sourceType}:${r.sourceId}`;
			if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
		}

		// ── Pass 3b: DeFi event classification ────────────────────────────────
		const { results: defiResults, reviewItems: defiReview } = classifyDeFiPass3b(
			importRows, classifiedKeys,
		);
		for (const r of defiResults) {
			const key = `${r.sourceType}:${r.sourceId}`;
			if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
		}
		allReviewItems.push(...defiReview);

		// ── Pass 4: FIFO lot matching ──────────────────────────────────────────
		const { lots, disposals } = runFifo(tenantId, importRows, onchainRows, classifications);

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
			pass1Easy:       pass1Count,
			pass2Transfers:  transferResults.length / 2,
			pass2bLoans:     loanResults.length,
			pass3Income:     incomeResults.length,
			pass3Fees:   feeResults.length,
			pass3bDefi:  defiResults.length,
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
