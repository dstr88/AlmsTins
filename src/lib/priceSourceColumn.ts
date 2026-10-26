/**
 * import_transactions.price_source: how a row's USD value was priced after the fact
 * ('coingecko:range', 'coingecko:history', 'coinbase:candles', 'inferred:stablecoin-peg', and
 * 'sync_date_estimate' for a sync value the price correction could not re-price). NULL means the
 * value came with the row: the imported file carried it, or a chain sync stored it before it
 * recorded a source.
 *
 * Not in the base schema: added lazily, once per process, before the first write that names it;
 * mirrored by migrations-pg/0045_import_price_source.sql. The schema is read first so the ALTER
 * (which locks the table) runs only while the column is missing. If it cannot be ensured, callers
 * leave the column out and still save their prices.
 */

import { db } from './db';

export const PRICE_SOURCE_DDL = `ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_source TEXT`;

let ensured = false;

/** True once import_transactions has the column. */
export async function ensurePriceSourceColumn(): Promise<boolean> {
	if (ensured) return true;
	try {
		const res = await db.execute({
			sql: `SELECT column_name AS name FROM information_schema.columns
			      WHERE table_schema = 'public' AND table_name = 'import_transactions' AND column_name = 'price_source'`,
			args: [],
		});
		if (res.rows.length === 0) await db.execute({ sql: PRICE_SOURCE_DDL, args: [] });
		ensured = true;
	} catch (err) {
		console.warn('[price_source] could not ensure import_transactions.price_source', err);
	}
	return ensured;
}
