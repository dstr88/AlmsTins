import { db } from './db';
import { rebuildAssetLifecycles } from './lifecycle';
import {
	getCoingeckoIdBySymbol,
	getUsdUnitPriceAtTimestampCoinGecko,
} from './coingeckoHistorical';

const MAX_ROWS = 500;
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'TUSD', 'FDUSD', 'USDP', 'GUSD', 'USDE', 'BUSD']);

export interface BackfillResult {
	ok:       boolean;
	scanned:  number;
	priced:   number;
	skipped:  number;
	errors:   number;
	error?:   string;
}

/**
 * The UPDATE below records how each price was derived in price_source, a column the base
 * import_transactions schema does not have. Without it every UPDATE fails and the backfill
 * prices nothing, so add it lazily (idempotent; routed to the owner pool by db.pg.ts as
 * schema DDL). Mirrored by migrations-pg/0045_import_price_source.sql. Once per process.
 */
let priceSourceEnsured = false;
async function ensurePriceSourceColumn(): Promise<void> {
	if (priceSourceEnsured) return;
	try {
		await db.execute({ sql: `ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_source TEXT`, args: [] });
		priceSourceEnsured = true;
	} catch (err) {
		// Not fatal: if the column already exists the UPDATEs still work; if it does not,
		// they fail per row and are counted as errors.
		console.warn('[backfill] could not ensure import_transactions.price_source', err);
	}
}

export async function priceMissingImportTransactions(tenantId: string): Promise<BackfillResult> {
	let scanned = 0, priced = 0, skipped = 0, errors = 0;

	try {
		await ensurePriceSourceColumn();

		const res = await db.execute({
			sql: `SELECT id, asset_symbol, amount, timestamp_utc
			      FROM import_transactions
			      WHERE tenant_id = ?
			        AND asset_symbol IS NOT NULL
			        AND amount IS NOT NULL
			        AND ABS(amount) > 0
			        AND (native_usd IS NULL OR native_usd = 0)
			      ORDER BY timestamp_utc DESC
			      LIMIT ?`,
			args: [tenantId, MAX_ROWS],
		});

		const rows = res.rows as any[];
		scanned = rows.length;
		if (scanned === 0) return { ok: true, scanned, priced, skipped, errors };

		// Group by symbol+day to minimise API calls
		const groups = new Map<string, any[]>();
		for (const row of rows) {
			const sym = String(row.asset_symbol ?? '').trim().toUpperCase();
			if (!sym || sym.length > 24 || sym.includes(' ')) { skipped++; continue; }
			const day = String(row.timestamp_utc ?? '').slice(0, 10);
			if (!day || day.length < 10) { skipped++; continue; }
			const key = `${sym}|${day}`;
			const bucket = groups.get(key);
			if (bucket) bucket.push(row);
			else groups.set(key, [row]);
		}

		// Resolve CoinGecko IDs for non-stablecoins
		const coinIdMap = new Map<string, string | null>();
		for (const key of groups.keys()) {
			const sym = key.split('|')[0]!;
			if (STABLECOINS.has(sym) || coinIdMap.has(sym)) continue;
			try {
				coinIdMap.set(sym, await getCoingeckoIdBySymbol(sym));
			} catch {
				coinIdMap.set(sym, null);
			}
		}

		for (const [key, list] of groups.entries()) {
			const [sym, day] = key.split('|') as [string, string];

			let unitPrice: number;
			let source: string;

			if (STABLECOINS.has(sym)) {
				unitPrice = 1;
				source = 'inferred:stablecoin-peg';
			} else {
				const coinId = coinIdMap.get(sym);
				if (!coinId) { skipped += list.length; continue; }

				try {
					const result = await getUsdUnitPriceAtTimestampCoinGecko({
						coinId,
						timestampUtcIso: `${day}T12:00:00Z`,
					});
					if (!result || !Number.isFinite(result.unitPriceUsd) || result.unitPriceUsd <= 0) {
						skipped += list.length; continue;
					}
					unitPrice = result.unitPriceUsd;
					source    = result.source;
				} catch {
					skipped += list.length; errors++; continue;
				}
			}

			for (const row of list) {
				const amount    = Math.abs(Number(row.amount));
				const nativeUsd = amount * unitPrice;
				if (!Number.isFinite(nativeUsd) || nativeUsd <= 0) { skipped++; continue; }

				try {
					await db.execute({
						sql: `UPDATE import_transactions
						      SET native_usd = ?, price_source = ?
						      WHERE id = ? AND tenant_id = ?
						        AND (native_usd IS NULL OR native_usd = 0)`,
						args: [nativeUsd, source, String(row.id), tenantId],
					});
					priced++;
				} catch {
					skipped++; errors++;
				}
			}
		}

		if (priced > 0) {
			try {
				await rebuildAssetLifecycles(tenantId, { skipPricing: true });
			} catch (err) {
				console.warn('[backfill] lifecycle rebuild failed', err);
				errors++;
			}
		}

		return { ok: true, scanned, priced, skipped, errors };
	} catch (err) {
		return { ok: false, scanned, priced, skipped, errors, error: String(err) };
	}
}
