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

type Stmt = { sql: string; args: Array<string | null> };

/**
 * Fills counterparty_address on the tenant's own imported row (the account and row_hash its
 * per-account unique index keys on), only while it is NULL. Nothing else on the row changes.
 * Runs after the row's `INSERT … ON CONFLICT DO NOTHING`, so it covers a new row and one saved
 * by an earlier sync alike. (Not an ON CONFLICT DO UPDATE: that needs one conflict target, and
 * import_transactions may still carry a global row_hash unique besides the per-account one, see
 * src/scripts/checkImportRowHashUnique.mjs; a conflict on the other one would throw and fail the
 * whole batch.)
 */
export function importCounterpartyUpdate(tenantId: string, source: string, accountId: string, rowHash: string, counterparty: string): Stmt {
	return {
		sql: `UPDATE import_transactions SET counterparty_address = ?
		      WHERE tenant_id = ? AND source = ? AND account_id = ? AND row_hash = ? AND counterparty_address IS NULL`,
		args: [counterparty, tenantId, source, accountId, rowHash],
	};
}

/** The same for one of the tenant's Sui rows (the id is digest:coin, unique across tenants). */
export function suiCounterpartyUpdate(tenantId: string, walletId: string, id: string, counterparty: string): Stmt {
	return {
		sql: `UPDATE sui_transactions SET counterparty_address = ?
		      WHERE tenant_id = ? AND wallet_id = ? AND id = ? AND counterparty_address IS NULL`,
		args: [counterparty, tenantId, walletId, id],
	};
}

/**
 * Runs those updates after a sync has saved its rows. Never throws: a counterparty that cannot
 * be saved leaves the column NULL and costs the sync nothing. Logs no address.
 */
export async function fillCounterparties(stmts: readonly Stmt[]): Promise<void> {
	if (stmts.length === 0 || !(await ensureCounterpartyColumns())) return;
	const BATCH = 100;
	try {
		for (let i = 0; i < stmts.length; i += BATCH) {
			await db.batch(stmts.slice(i, i + BATCH), 'write');
		}
	} catch {
		console.warn('[counterparty] could not save counterparty addresses');
	}
}
