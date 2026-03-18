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
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
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
import { runFifo } from './pass4';
import { buildReviewQueue } from './pass5';

type DbRow = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const n = (v: unknown) => (typeof v === 'number' ? v : null);

// ── Load raw data ─────────────────────────────────────────────────────────────

async function loadImportTransactions(tenantId: string): Promise<RawImportTx[]> {
	const result = await db.execute({
		sql: `SELECT id, timestamp_utc, asset_symbol, direction, kind, amount,
		             to_amount, native_usd, tx_hash, source, notes, category
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

// ── Persist results ───────────────────────────────────────────────────────────

async function persistClassifications(
	tenantId: string,
	results: ClassificationResult[],
): Promise<void> {
	if (!results.length) return;

	// Delete auto classifications — manual ones have is_manual = 1 so they survive the UNIQUE constraint update
	await db.execute({
		sql: `DELETE FROM tax_classifications WHERE tenant_id = ? AND is_manual = 0`,
		args: [tenantId],
	});

	// Batch insert (SQLite has 999 variable limit; chunk to be safe)
	const CHUNK = 50;
	for (let i = 0; i < results.length; i += CHUNK) {
		const chunk = results.slice(i, i + CHUNK);
		for (const r of chunk) {
			await db.execute({
				sql: `INSERT OR IGNORE INTO tax_classifications
				      (id, tenant_id, source_type, source_id, category, sub_category, confidence,
				       linked_tx_id, linked_source_type, asset_symbol, amount_usd, tax_year,
				       is_manual, created_at, updated_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
				              strftime('%Y-%m-%dT%H:%M:%SZ','now'),
				              strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
				args: [
					randomUUID(), tenantId,
					r.sourceType, r.sourceId,
					r.category, r.subCategory ?? null, r.confidence,
					r.linkedTxId ?? null, r.linkedSourceType ?? null,
					r.assetSymbol ?? null, r.amountUsd ?? null, r.taxYear ?? null,
				],
			});
		}
	}
}

async function persistReviewItems(tenantId: string, items: ReviewItem[]): Promise<void> {
	if (!items.length) return;
	for (const item of items) {
		await db.execute({
			sql: `INSERT OR IGNORE INTO tax_review_items
			      (id, tenant_id, source_type, source_id, reason, reason_detail,
			       snapshot_json, resolved, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, 0,
			              strftime('%Y-%m-%dT%H:%M:%SZ','now'),
			              strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
			args: [
				randomUUID(), tenantId,
				item.sourceType, item.sourceId,
				item.reason, item.reasonDetail,
				item.snapshotJson,
			],
		});
	}
}

async function persistLots(tenantId: string, lots: ReturnType<typeof runFifo>['lots']): Promise<void> {
	await db.execute({ sql: `DELETE FROM tax_lots WHERE tenant_id = ?`, args: [tenantId] });
	for (const lot of lots) {
		await db.execute({
			sql: `INSERT INTO tax_lots
			      (id, tenant_id, asset_symbol, acquired_at, quantity, remaining_qty,
			       cost_basis_usd, price_per_unit, source_type, source_id, lot_type,
			       origin_lot_id, is_exhausted, created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			              strftime('%Y-%m-%dT%H:%M:%SZ','now'),
			              strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
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
}

async function persistDisposals(tenantId: string, disposals: ReturnType<typeof runFifo>['disposals']): Promise<void> {
	await db.execute({ sql: `DELETE FROM tax_disposals WHERE tenant_id = ?`, args: [tenantId] });
	for (const d of disposals) {
		await db.execute({
			sql: `INSERT INTO tax_disposals
			      (id, tenant_id, asset_symbol, disposed_at, quantity, proceeds_usd,
			       cost_basis_usd, gain_loss_usd, is_short_term, category,
			       source_type, source_id, lot_id, notes, created_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			              strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
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
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runTaxPipeline(tenantId: string): Promise<PipelineStats> {
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

	// ── Pass 1: Easy classifications ──────────────────────────────────────────
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

	// ── Pass 2A: Transfer matching ────────────────────────────────────────────
	const { results: transferResults, reviewItems: transferReview } = matchTransfers(
		importRows, onchainRows, walletAddresses, classifiedKeys,
	);
	for (const r of transferResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	allReviewItems.push(...transferReview);

	// ── Pass 2B: Loan detection ───────────────────────────────────────────────
	const { results: loanResults, reviewItems: loanReview } = detectLoans(
		onchainRows, walletAddresses, classifiedKeys,
	);
	for (const r of loanResults) {
		const key = `${r.sourceType}:${r.sourceId}`;
		if (!classifiedKeys.has(key)) { classifications.set(key, r); classifiedKeys.add(key); }
	}
	allReviewItems.push(...loanReview);

	// ── Pass 3: Income & fees ─────────────────────────────────────────────────
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

	// ── Pass 4: FIFO lot matching ─────────────────────────────────────────────
	const { lots, disposals } = runFifo(tenantId, importRows, onchainRows, classifications);

	// ── Pass 5: Build review queue ────────────────────────────────────────────
	const existingReviewKeys = new Set([
		...allReviewItems.map((i) => `${i.sourceType}:${i.sourceId}:${i.reason}`),
		...resolvedReviewKeys,
	]);
	const reviewItems5 = buildReviewQueue(importRows, onchainRows, classifications, existingReviewKeys);
	allReviewItems.push(...reviewItems5);

	// ── Persist everything ────────────────────────────────────────────────────
	const allAutoResults = [...classifications.values()].filter((r) => {
		const key = `${r.sourceType}:${r.sourceId}`;
		return !manualOverrides.has(key);
	});

	await Promise.all([
		persistClassifications(tenantId, allAutoResults),
		persistReviewItems(tenantId, allReviewItems),
		persistLots(tenantId, lots),
		persistDisposals(tenantId, disposals),
	]);

	const totalUnknown =
		[...importRows, ...onchainRows].filter((r) => {
			const key = 'timestamp_utc' in r ? `import:${r.id}` : `onchain:${r.id}`;
			return !classifiedKeys.has(key);
		}).length;

	return {
		pass1Easy: pass1Count,
		pass2Transfers: transferResults.length / 2,
		pass2bLoans: loanResults.length,
		pass3Income: incomeResults.length,
		pass3bInterest: feeResults.length,
		pass4Lots: lots.length,
		pass4Disposals: disposals.length,
		pass5ReviewItems: allReviewItems.length,
		totalClassified: classifiedKeys.size,
		totalUnknown,
	};
}
