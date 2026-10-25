/**
 * counterparty_address on import_transactions and sui_transactions: the full address on the other
 * side of a chain-synced row (Bitcoin, Solana, Sui), so GET /api/address-history can find the
 * user's own rows with one address. NULL where the chain data does not name one other party.
 *
 * Added lazily, once per process, before the syncs write it and before history reads it; mirrored
 * by migrations-pg/0062_counterparty_address.sql. The schema is read first so the ALTER (which
 * locks the table) runs only while a column is missing. If it cannot be ensured, callers skip the
 * column: a sync still saves its rows, and history selects no rows from these tables.
 */

import { db } from './db';

const TABLES = ['import_transactions', 'sui_transactions'] as const;

export const COUNTERPARTY_DDL: readonly string[] = TABLES.map(
	(t) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS counterparty_address TEXT`,
);

let ensured = false;

/** True once both tables have the column. */
export async function ensureCounterpartyColumns(): Promise<boolean> {
	if (ensured) return true;
	try {
		const res = await db.execute({
			sql: `SELECT table_name AS name FROM information_schema.columns
			      WHERE table_schema = 'public' AND column_name = 'counterparty_address'
			        AND table_name IN ('import_transactions', 'sui_transactions')`,
			args: [],
		});
		const have = new Set(res.rows.map((r) => String((r as { name?: unknown }).name ?? '')));
		for (let i = 0; i < TABLES.length; i++) {
			if (!have.has(TABLES[i])) await db.execute({ sql: COUNTERPARTY_DDL[i], args: [] });
		}
		ensured = true;
	} catch {
		console.warn('[counterparty] could not ensure counterparty_address columns');
	}
	return ensured;
}
