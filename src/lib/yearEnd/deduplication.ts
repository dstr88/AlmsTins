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
//
// ── Atomicity ─────────────────────────────────────────────────────────────────
// All reads happen in Phase 1 (no writes). All writes happen in Phase 2 via a
// single db.batch() call. Either all flag changes commit or none do — there is
// no window where flags are partially applied.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';

export type DedupStats = {
	strategy1TxHash: number;
	strategy2CrossTable: number;
	strategy3WithinImport: number;
	totalMarked: number;
	totalCleared: number;
};

const AMOUNT_TOLERANCE  = 0.01;  // 1 %
const CROSS_WINDOW_SEC  = 300;   // 5 minutes (cross-table: import vs on-chain)
const IMPORT_WINDOW_SEC = 300;   // 5 minutes (within-import, was 30s — widened to catch re-uploads)

type DbRow = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const num = (v: unknown) => (typeof v === 'number' ? v : null);

// ── Batch statement type (mirrors libsql InStatement shape) ──────────────────
type BatchStatement = {
	sql: string;
	args?: (string | number | bigint | boolean | null | Uint8Array | ArrayBuffer | Date)[];
};

// ─────────────────────────────────────────────────────────────────────────────

export async function runDuplicateSweep(tenantId: string): Promise<DedupStats> {
	// ══ PHASE 1 — READ ONLY ═══════════════════════════════════════════════════
	// Perform all queries needed to determine which rows should be flagged.
	// No writes happen here; the DB state is unchanged until Phase 2.
	// Because we're going to clear all auto-flags in the batch anyway, we load
	// all non-user-overridden rows regardless of their current is_duplicate value.

	// ── Strategy 1: tx_hash exact match ───────────────────────────────────────
	const hashMatchRows = await db.execute({
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

	type HashMatch = { importId: string; onchainId: string };
	const hashMatches: HashMatch[] = (hashMatchRows.rows as DbRow[]).map((r) => ({
		importId:  str(r.import_id),
		onchainId: str(r.onchain_id),
	}));

	// Build a set of import IDs already handled by strategy 1 so strategies 2/3
	// can record their own matches without double-updating (both are fine, but
	// we want accurate per-strategy counts).
	const s1ImportIds = new Set(hashMatches.map((m) => m.importId));

	// ── Strategy 2: Cross-table amount + symbol + timestamp ───────────────────
	const importPool = await db.execute({
		sql: `SELECT id, asset_symbol, ABS(amount) AS qty, timestamp_utc
		      FROM import_transactions
		      WHERE tenant_id = ? AND is_duplicate != -1 AND amount IS NOT NULL
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});

	const onchainPool = await db.execute({
		sql: `SELECT id, token_symbol, CAST(value AS REAL) AS qty, timestamp
		      FROM transactions
		      WHERE tenant_id = ? AND is_duplicate != -1 AND value IS NOT NULL
		      ORDER BY timestamp ASC`,
		args: [tenantId],
	});

	type SimpleTx = { id: string; symbol: string; qty: number; tsMs: number };

	const impRows: SimpleTx[] = (importPool.rows as DbRow[])
		.map((r): SimpleTx | null => {
			const sym = typeof r.asset_symbol === 'string' ? r.asset_symbol.toUpperCase() : null;
			const qty = num(r.qty);
			if (!sym || qty === null || qty === 0) return null;
			const ts = new Date(str(r.timestamp_utc)).getTime();
			return isNaN(ts) ? null : { id: str(r.id), symbol: sym, qty, tsMs: ts };
		})
		.filter(Boolean) as SimpleTx[];

	const oncRows: SimpleTx[] = (onchainPool.rows as DbRow[])
		.map((r): SimpleTx | null => {
			const sym = typeof r.token_symbol === 'string' ? r.token_symbol.toUpperCase() : null;
			const qty = Math.abs(num(r.qty) ?? 0);
			if (!sym || qty === 0) return null;
			const ts = new Date(str(r.timestamp)).getTime();
			return isNaN(ts) ? null : { id: str(r.id), symbol: sym, qty, tsMs: ts };
		})
		.filter(Boolean) as SimpleTx[];

	// Build symbol → onchain rows map for fast lookup
	const oncBySymbol = new Map<string, SimpleTx[]>();
	for (const oc of oncRows) {
		const list = oncBySymbol.get(oc.symbol) ?? [];
		list.push(oc);
		oncBySymbol.set(oc.symbol, list);
	}

	type CrossMatch = { importId: string; onchainId: string };
	const crossMatches: CrossMatch[] = [];
	const matchedOnchainIds = new Set<string>();
	const windowMs2 = CROSS_WINDOW_SEC * 1000;

	for (const imp of impRows) {
		if (s1ImportIds.has(imp.id)) continue; // already caught by strategy 1
		const candidates = oncBySymbol.get(imp.symbol) ?? [];
		for (const oc of candidates) {
			if (matchedOnchainIds.has(oc.id)) continue;
			if (Math.abs(imp.tsMs - oc.tsMs) > windowMs2) continue;
			const ratio = imp.qty > 0 ? Math.abs(oc.qty - imp.qty) / imp.qty : 1;
			if (ratio > AMOUNT_TOLERANCE) continue;
			crossMatches.push({ importId: imp.id, onchainId: oc.id });
			matchedOnchainIds.add(oc.id);
			break;
		}
	}

	// ── Strategy 3: Within import_transactions same-source near-duplicate ─────
	const s2ImportIds = new Set(crossMatches.map((m) => m.importId));

	const importBatchRows = await db.execute({
		sql: `SELECT id, source, asset_symbol, direction, ABS(amount) AS qty,
		             import_batch_id, timestamp_utc
		      FROM import_transactions
		      WHERE tenant_id = ? AND is_duplicate != -1 AND amount IS NOT NULL
		      ORDER BY timestamp_utc ASC`,
		args: [tenantId],
	});

	type BatchRow = {
		id: string; source: string; symbol: string;
		direction: string; qty: number; batchId: string; tsMs: number;
	};
	const batchRows: BatchRow[] = (importBatchRows.rows as DbRow[])
		.map((r): BatchRow | null => {
			const qty = num(r.qty);
			if (!qty) return null;
			const ts = new Date(str(r.timestamp_utc)).getTime();
			if (isNaN(ts)) return null;
			return {
				id: str(r.id), source: str(r.source),
				symbol: str(r.asset_symbol).toUpperCase(),
				direction: str(r.direction),
				qty, batchId: str(r.import_batch_id), tsMs: ts,
			};
		})
		.filter(Boolean) as BatchRow[];

	// Group by (source, symbol, direction)
	const groups = new Map<string, BatchRow[]>();
	for (const row of batchRows) {
		const key = `${row.source}:${row.symbol}:${row.direction}`;
		const list = groups.get(key) ?? [];
		list.push(row);
		groups.set(key, list);
	}

	type WithinMatch = { keeperId: string; dupeId: string };
	const withinMatches: WithinMatch[] = [];
	const seenImportIds = new Set<string>();
	const windowMs3 = IMPORT_WINDOW_SEC * 1000;

	for (const [, group] of groups) {
		for (let i = 0; i < group.length; i++) {
			const keeper = group[i];
			if (seenImportIds.has(keeper.id)) continue;
			if (s1ImportIds.has(keeper.id) || s2ImportIds.has(keeper.id)) continue;

			for (let j = i + 1; j < group.length; j++) {
				const candidate = group[j];
				if (seenImportIds.has(candidate.id)) continue;
				// Allow same-batch matches — re-uploading the same CSV creates
				// duplicates in the same batch with identical fields.
				if (Math.abs(candidate.tsMs - keeper.tsMs) > windowMs3) continue;
				const ratio = keeper.qty > 0 ? Math.abs(candidate.qty - keeper.qty) / keeper.qty : 1;
				if (ratio > AMOUNT_TOLERANCE) continue;
				withinMatches.push({ keeperId: keeper.id, dupeId: candidate.id });
				seenImportIds.add(candidate.id);
			}
		}
	}

	// ══ PHASE 2 — ATOMIC WRITE ════════════════════════════════════════════════
	// Collect every SQL statement — clears first, then all flag updates —
	// and execute as one db.batch(). All changes commit together or not at all.

	const stmts: BatchStatement[] = [
		// Clear previous auto-flags on both tables
		{
			sql: `UPDATE import_transactions SET is_duplicate = 0, duplicate_of = NULL
			      WHERE tenant_id = ? AND is_duplicate = 1`,
			args: [tenantId],
		},
		{
			sql: `UPDATE transactions SET is_duplicate = 0, duplicate_of = NULL
			      WHERE tenant_id = ? AND is_duplicate = 1`,
			args: [tenantId],
		},
		// Strategy 1: hash matches
		...hashMatches.map(({ importId, onchainId }): BatchStatement => ({
			sql: `UPDATE import_transactions
			      SET is_duplicate = 1, duplicate_of = ?
			      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
			args: [onchainId, importId, tenantId],
		})),
		// Strategy 2: cross-table matches
		...crossMatches.map(({ importId, onchainId }): BatchStatement => ({
			sql: `UPDATE import_transactions
			      SET is_duplicate = 1, duplicate_of = ?
			      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
			args: [onchainId, importId, tenantId],
		})),
		// Strategy 3: within-import matches
		...withinMatches.map(({ keeperId, dupeId }): BatchStatement => ({
			sql: `UPDATE import_transactions
			      SET is_duplicate = 1, duplicate_of = ?
			      WHERE id = ? AND tenant_id = ? AND is_duplicate NOT IN (-1, 2)`,
			args: [keeperId, dupeId, tenantId],
		})),
	];

	await db.batch(stmts, 'write');

	// Count "cleared" as the rows that had is_duplicate = 1 before this run.
	// Since we can't get rowsAffected from batch, approximate from the matches
	// produced by the previous run (which we just cleared). This is a best-effort
	// count used only for display — it doesn't affect correctness.
	const totalMarked = hashMatches.length + crossMatches.length + withinMatches.length;

	return {
		strategy1TxHash:    hashMatches.length,
		strategy2CrossTable: crossMatches.length,
		strategy3WithinImport: withinMatches.length,
		totalMarked,
		totalCleared: totalMarked, // approximation: same set we're re-marking
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
