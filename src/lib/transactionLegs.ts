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
 * Any other unique rule that covers hash and chain without leg refuses the second leg of a
 * transaction, whatever its name. Production had one made by hand, transactions_hash_chain_key on
 * (hash, chain) with no account in it, which is in no migration; it refused the second side of
 * every swap and let only one account hold a transaction two accounts share.
 * migrations-pg/0080_drop_transactions_hash_chain_key.sql drops it by name, and the check below
 * finds any such rule by its columns, drops it and says so in the log.
 *
 * Run lazily, once per process, before the first write (bulkUpsertTransactions in ./transactions.ts
 * and the custom-entry route); mirrored by migrations-pg/0079_transaction_legs.sql and
 * migrations-pg/0080_drop_transactions_hash_chain_key.sql, and tests/sync/transactionLegs.test.ts
 * keeps the files and the code identical. The schema is read first, so the statements run only
 * while something is missing. Each statement is safe to run more than once. If they cannot all be
 * run, the caller gets false and writes nothing: a row written against the old key could overwrite
 * a leg again.
 */

import { db } from './db';

export const TRANSACTION_LEG_INDEX = 'transactions_tenant_hash_chain_wallet_leg_unique';
export const OLD_TRANSACTION_INDEX = 'transactions_tenant_hash_chain_unique';
/** The rule on (hash, chain) made by hand when production was set up; in no migration before 0080. */
export const HASH_CHAIN_KEY = 'transactions_hash_chain_key';

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

const SIMPLE_NAME = /^[a-z_][a-z0-9_]*$/;
const quoteName = (name: string) => (SIMPLE_NAME.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

/**
 * The statements that drop one unique rule on `transactions`, whichever way it was made: as a
 * constraint (which owns its index) or as an index on its own. Both say IF EXISTS, so the one that
 * does not apply does nothing.
 */
export function dropUniqueRuleDdl(name: string): string[] {
	const n = quoteName(name);
	return [`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS ${n}`, `DROP INDEX IF EXISTS ${n}`];
}

/** migrations-pg/0080_drop_transactions_hash_chain_key.sql, statement for statement. */
export const HASH_CHAIN_KEY_DDL: readonly string[] = dropUniqueRuleDdl(HASH_CHAIN_KEY);

/**
 * The columns of an index, lowercased, from its definition as pg_indexes prints it
 * (`CREATE UNIQUE INDEX x ON public.transactions USING btree (hash, chain)`); null for an index
 * that is not unique or a definition that cannot be read. An expression stays as written, so
 * `lower(hash)` is not `hash`.
 */
export function uniqueIndexColumns(def: string): string[] | null {
	if (!/^\s*CREATE\s+UNIQUE\s+INDEX\b/i.test(def)) return null;
	const using = /\bUSING\s+\w+\s*\(/i.exec(def);
	if (!using) return null;
	const open = using.index + using[0].length;
	const cols: string[] = [];
	let depth = 0;
	let current = '';
	for (let i = open; i < def.length; i++) {
		const c = def[i];
		if (c === '(') depth += 1;
		if (c === ')' && depth === 0) {
			cols.push(current);
			return cols.map((col) => col.trim().replace(/^"(.*)"$/, '$1').toLowerCase()).filter(Boolean);
		}
		if (c === ')') depth -= 1;
		if (c === ',' && depth === 0) {
			cols.push(current);
			current = '';
		} else {
			current += c;
		}
	}
	return null;
}

/** True for a unique index that covers hash and chain but not leg: it refuses a transaction's second leg. */
export function refusesSecondLeg(def: string): boolean {
	const cols = uniqueIndexColumns(def);
	return Boolean(cols && cols.includes('hash') && cols.includes('chain') && !cols.includes('leg'));
}

let ensured = false;

/**
 * True once the column is filled, the new key is in place, and no unique rule that covers hash and
 * chain without leg is left.
 */
export async function ensureTransactionLegs(): Promise<boolean> {
	if (ensured) return true;
	let blockers: string[] = [];
	try {
		const col = await db.execute({
			sql: `SELECT 1 AS ok FROM information_schema.columns
			      WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'leg'`,
			args: [],
		});
		const idx = await db.execute({
			sql: `SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'transactions'`,
			args: [],
		});
		const indexes = idx.rows.map((r) => {
			const row = r as { name?: unknown; def?: unknown };
			return { name: String(row.name ?? ''), def: String(row.def ?? '') };
		});
		const names = new Set(indexes.map((i) => i.name));
		const known = new Set([OLD_TRANSACTION_INDEX, HASH_CHAIN_KEY]);
		blockers = indexes.filter((i) => refusesSecondLeg(i.def) && !known.has(i.name)).map((i) => i.name);
		const done =
			col.rows.length > 0 &&
			names.has(TRANSACTION_LEG_INDEX) &&
			!names.has(OLD_TRANSACTION_INDEX) &&
			!names.has(HASH_CHAIN_KEY) &&
			blockers.length === 0;
		if (!done) {
			for (const sql of TRANSACTION_LEGS_DDL) await db.execute({ sql, args: [] });
			for (const sql of HASH_CHAIN_KEY_DDL) await db.execute({ sql, args: [] });
			for (const name of blockers) {
				const def = indexes.find((i) => i.name === name)?.def ?? '';
				console.warn(`[transactions] dropping unique rule ${name}: it covers hash and chain without leg, so it refuses a transaction's second leg`, def);
				for (const sql of dropUniqueRuleDdl(name)) await db.execute({ sql, args: [] });
			}
		}
		ensured = true;
	} catch (error) {
		const message = error instanceof Error ? error.message : '';
		if (blockers.length) {
			console.error(
				`[transactions] SYNC IS BLOCKED: could not drop unique rule(s) ${blockers.join(', ')} on transactions, which refuse a transaction's second leg. Drop them by hand as the table owner.`,
				message,
			);
		} else {
			console.warn('[transactions] could not ensure the leg column and key', message);
		}
	}
	return ensured;
}

/** For tests: forget that the schema was ensured in this process. */
export function resetTransactionLegsForTests(): void {
	ensured = false;
}
