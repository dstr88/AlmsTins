/**
 * The one writer for imported rows: import_raw_rows (a source row as it was read) and
 * import_transactions (the normalized row). Every importer and chain sync hands its rows here, so
 * the column names, the conflict handling and the batching live in one place. Copies of these
 * INSERTs once named columns the tables do not have (batch_id, raw_json) and failed in production.
 *
 * Each caller keeps its own parsing, row_hash, sign conventions and account handling; this only
 * stores what it is given. A column a row leaves out is written NULL, except imported_at and
 * created_at, which then get the UTC time as 'YYYY-MM-DD HH24:MI:SS' (the expression the importers
 * wrote inline, and the tables' default). Columns no importer sets (is_duplicate, price_source, …)
 * are not named, so they keep their defaults.
 *
 * Every statement is `ON CONFLICT DO NOTHING`: a row the tenant already has (same account and
 * row_hash) is skipped, not changed. A row's counterparty is saved after the insert, only while
 * the column is NULL (src/lib/counterpartyColumn.ts).
 */

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { fillCounterparties, importCounterpartyUpdate } from './counterpartyColumn';

/** Statements per db.batch round trip (one transaction each). */
export const IMPORT_BATCH_SIZE = 100;

/** One source row, stored as read. */
export type RawImportRow = {
	/** Defaults to a new random UUID. */
	id?: string;
	rowJson: string;
	rowHash: string;
	/** Defaults to now (UTC). */
	importedAt?: string | null;
};

/** One normalized transaction. Amounts keep the caller's signs. */
export type ImportTxRow = {
	/** Defaults to a new random UUID. */
	id?: string;
	timestampUtc: string;
	direction: string;
	rowHash: string;
	description?: string | null;
	currency?: string | null;
	amount?: number | null;
	toCurrency?: string | null;
	toAmount?: number | null;
	nativeCurrency?: string | null;
	nativeAmount?: number | null;
	nativeUsd?: number | null;
	feeUsd?: number | null;
	kind?: string | null;
	txHash?: string | null;
	assetSymbol?: string | null;
	groupId?: string | null;
	category?: string | null;
	notes?: string | null;
	/** Defaults to now (UTC). */
	createdAt?: string | null;
	/** The full address on the other side, saved into counterparty_address after the insert. */
	counterparty?: string | null;
};

export type ImportBatch = {
	tenantId: string;
	/** exchange_accounts.id the rows belong to; null for writers that have none. */
	accountId: string | null;
	/** wallets.id, for rows a wallet sync produced. Not stored on raw rows (no such column). */
	walletId?: string | null;
	source: string;
	batchId: string;
	rawRows?: readonly RawImportRow[];
	rows: readonly ImportTxRow[];
};

export type ImportBatchResult = {
	/** Per raw row, in order: true when it was inserted, false when it already existed. */
	rawInserted: boolean[];
	/** Per normalized row, in order. */
	inserted: boolean[];
	insertedRaw: number;
	insertedNormalized: number;
};

type Stmt = { sql: string; args: Array<string | number | null> };

const RAW_SQL = `INSERT INTO import_raw_rows
	(id, tenant_id, account_id, import_batch_id, source, row_json, row_hash, imported_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')))
ON CONFLICT DO NOTHING`;

const TX_SQL = `INSERT INTO import_transactions
	(id, tenant_id, source, account_id, wallet_id, import_batch_id, timestamp_utc,
	 description, currency, amount, to_currency, to_amount,
	 native_currency, native_amount, native_usd, fee_usd,
	 kind, tx_hash, direction, asset_symbol, group_id, category, notes, row_hash, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?,
	        COALESCE(?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')))
ON CONFLICT DO NOTHING`;

/** The INSERT for one raw row. */
export function rawRowStatement(batch: Omit<ImportBatch, 'rows' | 'rawRows'>, row: RawImportRow): Stmt {
	return {
		sql: RAW_SQL,
		args: [
			row.id ?? randomUUID(), batch.tenantId, batch.accountId, batch.batchId, batch.source,
			row.rowJson, row.rowHash, row.importedAt ?? null,
		],
	};
}

/** The INSERT for one normalized row. */
export function importTxStatement(batch: Omit<ImportBatch, 'rows' | 'rawRows'>, row: ImportTxRow): Stmt {
	return {
		sql: TX_SQL,
		args: [
			row.id ?? randomUUID(), batch.tenantId, batch.source, batch.accountId, batch.walletId ?? null,
			batch.batchId, row.timestampUtc,
			row.description ?? null, row.currency ?? null, row.amount ?? null, row.toCurrency ?? null, row.toAmount ?? null,
			row.nativeCurrency ?? null, row.nativeAmount ?? null, row.nativeUsd ?? null, row.feeUsd ?? null,
			row.kind ?? null, row.txHash ?? null, row.direction, row.assetSymbol ?? null, row.groupId ?? null,
			row.category ?? null, row.notes ?? null, row.rowHash, row.createdAt ?? null,
		],
	};
}

async function runInBatches(stmts: readonly Stmt[]): Promise<boolean[]> {
	const inserted: boolean[] = [];
	for (let i = 0; i < stmts.length; i += IMPORT_BATCH_SIZE) {
		const res = await db.batch(stmts.slice(i, i + IMPORT_BATCH_SIZE), 'write');
		for (const r of res) inserted.push((r.rowsAffected ?? 0) > 0);
	}
	return inserted;
}

const count = (flags: readonly boolean[]) => flags.filter(Boolean).length;

/**
 * Stores one import: the raw rows first, then the normalized rows, IMPORT_BATCH_SIZE statements
 * per round trip, then the counterparties. Throws if a batch fails (rows of earlier batches stay
 * stored, as before).
 */
export async function insertImportBatch(batch: ImportBatch): Promise<ImportBatchResult> {
	if (!batch.tenantId) throw new Error('[importRows] tenantId is required');
	const rawInserted = await runInBatches((batch.rawRows ?? []).map((r) => rawRowStatement(batch, r)));
	const inserted = await runInBatches(batch.rows.map((r) => importTxStatement(batch, r)));

	const { accountId } = batch;
	if (accountId) {
		await fillCounterparties(batch.rows.flatMap((r) =>
			r.counterparty ? [importCounterpartyUpdate(batch.tenantId, batch.source, accountId, r.rowHash, r.counterparty)] : []));
	}

	return { rawInserted, inserted, insertedRaw: count(rawInserted), insertedNormalized: count(inserted) };
}
