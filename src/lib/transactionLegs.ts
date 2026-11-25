/**
 * transactions.leg: which movement of a transaction a row is. Until now the table kept one row per
 * account, hash and chain (index transactions_tenant_hash_chain_unique, migrations/0006_tenants.sql),
 * so the second side of a swap overwrote the first. A row is now keyed by account, hash, chain,
 * wallet and leg (src/lib/sync/evmSyncRows.ts names the legs; src/lib/evmTransfers.ts explains them).
 *
 * The legs of rows saved before the column existed are filled from what each row already holds, in
 * the same words the sync uses, so syncing a wallet again updates those rows instead of adding a
 * second copy:
 *   - a token row: `token:<contract>:<from>:<to>:<value>:0`;
 *   - a coin row that moved coin: `native:<from>:<to>:<value>:0`;
 *   - a coin row that moved nothing (a failed transaction, a zero-value call, a send to itself): `fee`;
 *   - an entry the customer added by hash: `custom`; one added by hand: `manual`;
 *   - anything else (an Aave liquidation read from the subgraph, which has its own `liq-` hash): empty.
 * Only rows whose leg is still NULL are filled, so a row the new sync wrote is never renamed.
 *
 * Run lazily, once per process, before the first write (bulkUpsertTransactions in ./transactions.ts
 * and the custom-entry route); mirrored by migrations-pg/0079_transaction_legs.sql, and
 * tests/sync/transactionLegs.test.ts keeps the two identical. The schema is read first, so the
 * statements run only while something is missing. Each statement is safe to run more than once.
 * If they cannot all be run, the caller gets false and writes nothing: a row written against the
 * old key could overwrite a leg again.
 */

import { db } from './db';

export const TRANSACTION_LEG_INDEX = 'transactions_tenant_hash_chain_wallet_leg_unique';
export const OLD_TRANSACTION_INDEX = 'transactions_tenant_hash_chain_unique';

/** The conflict target every upsert into `transactions` names. */
export const TRANSACTION_CONFLICT_KEY = '(tenant_id, hash, chain, wallet_id, leg)';

const LEG_BACKFILL = `UPDATE transactions SET leg = CASE
  WHEN metadata_json LIKE '%"isCustomEntry":true%' AND metadata_json LIKE '%"path":"manual"%' THEN 'manual'
  WHEN metadata_json LIKE '%"isCustomEntry":true%' THEN 'custom'
  WHEN metadata_json LIKE '%"source":"scan_token"%' THEN 'token:' || lower(COALESCE(contract_address, '')) || ':' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || COALESCE(value, '') || ':0'
  WHEN metadata_json LIKE '%"source":"scan_native"%' OR metadata_json LIKE '%"source":"aave"%' THEN
    CASE WHEN COALESCE(status, '') = 'failed' OR COALESCE(value, '') IN ('', '0') OR lower(COALESCE(from_address, '')) = lower(COALESCE(to_address, ''))
      THEN 'fee'
      ELSE 'native:' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || value || ':0'
    END
  ELSE ''
END
WHERE leg IS NULL`;

export const TRANSACTION_LEGS_DDL: readonly string[] = [
	'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS leg TEXT',
	LEG_BACKFILL,
	`CREATE UNIQUE INDEX IF NOT EXISTS ${TRANSACTION_LEG_INDEX} ON transactions (tenant_id, hash, chain, wallet_id, leg) NULLS NOT DISTINCT`,
	`DROP INDEX IF EXISTS ${OLD_TRANSACTION_INDEX}`,
];

let ensured = false;

/** True once the column is filled, the new key is in place and the old one is gone. */
export async function ensureTransactionLegs(): Promise<boolean> {
	if (ensured) return true;
	try {
		const col = await db.execute({
			sql: `SELECT 1 AS ok FROM information_schema.columns
			      WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'leg'`,
			args: [],
		});
		const idx = await db.execute({
			sql: `SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'transactions'`,
			args: [],
		});
		const names = new Set(idx.rows.map((r) => String((r as { name?: unknown }).name ?? '')));
		const done = col.rows.length > 0 && names.has(TRANSACTION_LEG_INDEX) && !names.has(OLD_TRANSACTION_INDEX);
		if (!done) {
			for (const sql of TRANSACTION_LEGS_DDL) await db.execute({ sql, args: [] });
		}
		ensured = true;
	} catch (error) {
		console.warn('[transactions] could not ensure the leg column and key', error instanceof Error ? error.message : '');
	}
	return ensured;
}

/** For tests: forget that the schema was ensured in this process. */
export function resetTransactionLegsForTests(): void {
	ensured = false;
}
