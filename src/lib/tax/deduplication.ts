// ─────────────────────────────────────────────────────────────────────────────
// Duplicate sweep
//
// Detects rows in import_transactions and/or transactions that represent the
// same real-world event and marks the lesser-quality one as is_duplicate = 1.
//
// Three match strategies (in order of confidence):
//
//   1. tx_hash exact match (confidence 1.0)
//      An import row shares its tx_hash with an on-chain row.
//      Keep the on-chain row (more data); mark the import row as duplicate.
//
//   2. Cross-table amount + symbol + timestamp (confidence 0.9)
//      An import row and an on-chain row have the same asset symbol,
//      amount within 1 %, and timestamps within 5 minutes.
//      Mark the import row as duplicate.
//
//   3. Within import_transactions (confidence 0.85)
//      Two import rows from DIFFERENT batch IDs share the same source,
//      asset_symbol, amount, direction, and timestamp within 30 seconds.
//      Mark the newer-batch row as duplicate.
//
// Rows with is_duplicate = -1 (user override "not a duplicate") are skipped.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';

export type DedupStats = {
	strategy1TxHash: number;
	strategy2CrossTable: number;
	strategy3WithinImport: number;
	totalMarked: number;
	totalCleared: number;
};

const AMOUNT_TOLERANCE   = 0.01;  // 1 %
const CROSS_WINDOW_SEC   = 300;   // 5 minutes
const IMPORT_WINDOW_SEC  = 30;    // 30 seconds

type DbRow = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const n = (v: unknown) => (typeof v === 'number' ? v : null);

// ─────────────────────────────────────────────────────────────────────────────

export async function runDuplicateSweep(tenantId: string): Promise<DedupStats> {
	let s1 = 0, s2 = 0, s3 = 0, cleared = 0;

	// ── Reset previous auto-flags so we get a clean slate ────────────────────
	// Only reset is_duplicate = 1 (auto); leave -1 (user "not a dup") and 2 (user confirmed) alone.
	const clearImport = await db.execute({
		sql: `UPDATE import_transactions SET is_duplicate = 0, duplicate_of = NULL
		      WHERE tenant_id = ? AND is_duplicate = 1`,
		args: [tenantId],
	});
	const clearOnchain = await db.execute({
		sql: `UPDATE transactions SET is_duplicate = 0, duplicate_of = NULL
		      WHERE tenant_id = ? AND is_duplicate = 1`,
		args: [tenantId],
	});
	cleared = (clearImport.rowsAffected ?? 0) + (clearOnchain.rowsAffected ?? 0);

	// ── Strategy 1: tx_hash exact match ───────────────────────────────────────
	// Find import rows whose tx_hash matches a transactions row for the same tenant.
	// Prefer keeping the on-chain row; mark the import row as duplicate.
	const hashMatches = await db.execute({
		sql: `SELECT it.id AS import_id, t.id AS onchain_id
		      FROM import_transactions it
		      JOIN transactions t
		        ON t.hash = it.tx_hash
		       AND t.tenant_id = it.tenant_id
		      WHERE it.tenant_id = ?
		        AND it.tx_hash IS NOT NULL
		        AND it.is_duplicate != -1
		        AND t.is_duplicate  != -1`,
		args: [tenantId],
	});

	for (const row of hashMatches.rows as DbRow[]) {
		const importId  = s(row.import_id);
		const onchainId = s(row.onchain_id);
		await db.execute({
			sql: `UPDATE import_transactions
			      SET is_duplicate = 1, duplicate_of = ?
			      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
			args: [onchainId, importId, tenantId],
		});
		s1++;
	}

	// ── Strategy 2: Cross-table amount + symbol + timestamp ───────────────────
	// Load unduped import rows that have native_usd > 0 and a timestamp
	const importPool = await db.execute({
		sql: `SELECT id, asset_symbol, ABS(amount) AS qty, timestamp_utc, direction
		      FROM import_transactions
		      WHERE tenant_id = ? AND is_duplicate = 0 AND amount IS NOT NULL
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});

	// Load unduped on-chain rows
	const onchainPool = await db.execute({
		sql: `SELECT id, token_symbol, CAST(value AS REAL) AS qty, timestamp
		      FROM transactions
		      WHERE tenant_id = ? AND is_duplicate = 0 AND value IS NOT NULL
		      ORDER BY timestamp ASC`,
		args: [tenantId],
	});

	type SimpleTx = { id: string; symbol: string; qty: number; tsMs: number };
	const toSimpleImport = (r: DbRow): SimpleTx | null => {
		const sym = typeof r.asset_symbol === 'string' ? r.asset_symbol.toUpperCase() : null;
		const qty = n(r.qty);
		if (!sym || qty === null || qty === 0) return null;
		const ts = new Date(s(r.timestamp_utc)).getTime();
		return isNaN(ts) ? null : { id: s(r.id), symbol: sym, qty, tsMs: ts };
	};
	const toSimpleOnchain = (r: DbRow): SimpleTx | null => {
		const sym = typeof r.token_symbol === 'string' ? r.token_symbol.toUpperCase() : null;
		const qty = Math.abs(n(r.qty) ?? 0);
		if (!sym || qty === 0) return null;
		const ts = new Date(s(r.timestamp)).getTime();
		return isNaN(ts) ? null : { id: s(r.id), symbol: sym, qty, tsMs: ts };
	};

	const impRows  = (importPool.rows  as DbRow[]).map(toSimpleImport).filter(Boolean)  as SimpleTx[];
	const oncRows  = (onchainPool.rows as DbRow[]).map(toSimpleOnchain).filter(Boolean) as SimpleTx[];

	// Build a quick map: symbol → onchain rows (sorted by tsMs)
	const oncBySymbol = new Map<string, SimpleTx[]>();
	for (const oc of oncRows) {
		const list = oncBySymbol.get(oc.symbol) ?? [];
		list.push(oc);
		oncBySymbol.set(oc.symbol, list);
	}

	const matchedOnchainIds = new Set<string>();
	const windowMs2 = CROSS_WINDOW_SEC * 1000;

	for (const imp of impRows) {
		const candidates = oncBySymbol.get(imp.symbol) ?? [];
		for (const oc of candidates) {
			if (matchedOnchainIds.has(oc.id)) continue;
			const timeDiff = Math.abs(imp.tsMs - oc.tsMs);
			if (timeDiff > windowMs2) continue;
			const ratio = imp.qty > 0 ? Math.abs(oc.qty - imp.qty) / imp.qty : 1;
			if (ratio > AMOUNT_TOLERANCE) continue;

			// Match found — mark import as duplicate of on-chain
			const updated = await db.execute({
				sql: `UPDATE import_transactions
				      SET is_duplicate = 1, duplicate_of = ?
				      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
				args: [oc.id, imp.id, tenantId],
			});
			if ((updated.rowsAffected ?? 0) > 0) {
				matchedOnchainIds.add(oc.id);
				s2++;
			}
			break;
		}
	}

	// ── Strategy 3: Within import_transactions same-source near-duplicate ─────
	// Groups by (tenant, source, asset_symbol, direction).  Within each group,
	// rows from different batch IDs with the same amount and very close timestamps
	// are treated as duplicates — keep the earliest batch row.
	const importBatchRows = await db.execute({
		sql: `SELECT id, source, asset_symbol, direction, ABS(amount) AS qty,
		             import_batch_id, timestamp_utc
		      FROM import_transactions
		      WHERE tenant_id = ? AND is_duplicate = 0 AND amount IS NOT NULL
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});

	type BatchRow = {
		id: string; source: string; symbol: string;
		direction: string; qty: number; batchId: string; tsMs: number;
	};
	const batchRows: BatchRow[] = (importBatchRows.rows as DbRow[])
		.map((r) => {
			const qty = n(r.qty);
			if (!qty) return null;
			const ts = new Date(s(r.timestamp_utc)).getTime();
			if (isNaN(ts)) return null;
			return {
				id: s(r.id), source: s(r.source),
				symbol: s(r.asset_symbol).toUpperCase(),
				direction: s(r.direction),
				qty, batchId: s(r.import_batch_id), tsMs: ts,
			};
		})
		.filter(Boolean) as BatchRow[];

	// Group by (source, symbol, direction)
	type GroupKey = string;
	const groups = new Map<GroupKey, BatchRow[]>();
	for (const row of batchRows) {
		const key: GroupKey = `${row.source}:${row.symbol}:${row.direction}`;
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}

	const windowMs3 = IMPORT_WINDOW_SEC * 1000;
	const seenImportIds = new Set<string>();

	for (const [, group] of groups) {
		// Already sorted by tsMs asc — first occurrence is the "keeper"
		for (let i = 0; i < group.length; i++) {
			const keeper = group[i];
			if (seenImportIds.has(keeper.id)) continue;

			for (let j = i + 1; j < group.length; j++) {
				const candidate = group[j];
				if (seenImportIds.has(candidate.id)) continue;
				if (candidate.batchId === keeper.batchId) continue; // same upload — not a dup

				const timeDiff = Math.abs(candidate.tsMs - keeper.tsMs);
				if (timeDiff > windowMs3) continue;

				const ratio = keeper.qty > 0 ? Math.abs(candidate.qty - keeper.qty) / keeper.qty : 1;
				if (ratio > AMOUNT_TOLERANCE) continue;

				const updated = await db.execute({
					sql: `UPDATE import_transactions
					      SET is_duplicate = 1, duplicate_of = ?
					      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
					args: [keeper.id, candidate.id, tenantId],
				});
				if ((updated.rowsAffected ?? 0) > 0) {
					seenImportIds.add(candidate.id);
					s3++;
				}
			}
		}
	}

	return {
		strategy1TxHash: s1,
		strategy2CrossTable: s2,
		strategy3WithinImport: s3,
		totalMarked: s1 + s2 + s3,
		totalCleared: cleared,
	};
}

// ── User override: mark / unmark a specific row ───────────────────────────────

export async function setDuplicateOverride(
	tenantId: string,
	sourceType: 'import' | 'onchain',
	sourceId: string,
	override: 'duplicate' | 'not-duplicate' | 'clear',
): Promise<void> {
	const value = override === 'duplicate' ? 2 : override === 'not-duplicate' ? -1 : 0;
	const table = sourceType === 'import' ? 'import_transactions' : 'transactions';
	await db.execute({
		sql: `UPDATE ${table} SET is_duplicate = ?, duplicate_of = CASE WHEN ? = 0 THEN NULL ELSE duplicate_of END
		      WHERE id = ? AND tenant_id = ?`,
		args: [value, value, sourceId, tenantId],
	});
}
