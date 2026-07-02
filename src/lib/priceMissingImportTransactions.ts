import { db } from './db';
import { rebuildAssetLifecycles } from './lifecycle';
import {
	getCoingeckoIdBySymbol,
	getUsdUnitPriceAtTimestampCoinGecko,
} from './coingeckoHistorical';
import { INCOME_KINDS } from './incomeKinds';
import { resetImportTransactionColumnsCache } from './importTransactionsSchema';

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
 * Ensure the FMV-provenance columns exist. price_source records HOW the USD was
 * derived (exchange-recorded = null, 'coingecko:*', or 'inferred:stablecoin-peg');
 * price_asof records the exact timestamp of the index tick used. Older DBs predate
 * both — this is the lazy-ensure that also unblocks the backfill (the UPDATE below
 * previously failed silently where price_source didn't exist).
 */
async function ensurePriceColumns(): Promise<void> {
	try { await db.execute({ sql: `ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_source TEXT`, args: [] }); } catch { /* engine without IF NOT EXISTS — column already present */ }
	try { await db.execute({ sql: `ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_asof TEXT`, args: [] }); } catch { /* ditto */ }
	resetImportTransactionColumnsCache();
}

export async function priceMissingImportTransactions(tenantId: string): Promise<BackfillResult> {
	let scanned = 0, priced = 0, skipped = 0, errors = 0;

	try {
		await ensurePriceColumns();

		const res = await db.execute({
			sql: `SELECT id, asset_symbol, amount, timestamp_utc, kind
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

		// Income is valued at its EXACT receipt time (IRS: FMV at time of receipt).
		// Everything else (trades) is fine at per-day granularity, which lets us
		// dedupe API calls by grouping (symbol, day).
		const incomeRows: Array<{ row: any; sym: string }> = [];
		const otherRows:  Array<{ row: any; sym: string }> = [];
		for (const row of rows) {
			const sym = String(row.asset_symbol ?? '').trim().toUpperCase();
			if (!sym || sym.length > 24 || sym.includes(' ')) { skipped++; continue; }
			(INCOME_KINDS.has(String(row.kind ?? '')) ? incomeRows : otherRows).push({ row, sym });
		}

		// Resolve CoinGecko IDs once per non-stablecoin symbol.
		const coinIdMap = new Map<string, string | null>();
		for (const { sym } of [...incomeRows, ...otherRows]) {
			if (STABLECOINS.has(sym) || coinIdMap.has(sym)) continue;
			try { coinIdMap.set(sym, await getCoingeckoIdBySymbol(sym)); }
			catch { coinIdMap.set(sym, null); }
		}

		// Price a symbol at a specific instant. Stablecoins peg to $1 (no tick).
		const resolvePrice = async (
			sym: string,
			iso: string,
		): Promise<{ unitPrice: number; source: string; asof: string | null } | null> => {
			if (STABLECOINS.has(sym)) return { unitPrice: 1, source: 'inferred:stablecoin-peg', asof: null };
			const coinId = coinIdMap.get(sym);
			if (!coinId) return null;
			try {
				const result = await getUsdUnitPriceAtTimestampCoinGecko({ coinId, timestampUtcIso: iso });
				if (!result || !Number.isFinite(result.unitPriceUsd) || result.unitPriceUsd <= 0) return null;
				return { unitPrice: result.unitPriceUsd, source: result.source, asof: result.pricedAtIso ?? null };
			} catch { errors++; return null; }
		};

		const updateRow = async (row: any, unitPrice: number, source: string, asof: string | null): Promise<void> => {
			const amount = Math.abs(Number(row.amount));
			const nativeUsd = amount * unitPrice;
			if (!Number.isFinite(nativeUsd) || nativeUsd <= 0) { skipped++; return; }
			try {
				await db.execute({
					sql: `UPDATE import_transactions
					      SET native_usd = ?, price_source = ?, price_asof = ?
					      WHERE id = ? AND tenant_id = ?
					        AND (native_usd IS NULL OR native_usd = 0)`,
					args: [nativeUsd, source, asof, String(row.id), tenantId],
				});
				priced++;
			} catch { skipped++; errors++; }
		};

		// Income — price each row at its actual receipt timestamp.
		for (const { row, sym } of incomeRows) {
			const iso = String(row.timestamp_utc ?? '');
			if (!iso) { skipped++; continue; }
			const p = await resolvePrice(sym, iso);
			if (!p) { skipped++; continue; }
			await updateRow(row, p.unitPrice, p.source, p.asof);
		}

		// Trades — group by (symbol, day), price once at noon UTC, apply to the group.
		const groups = new Map<string, any[]>();
		for (const { row, sym } of otherRows) {
			const day = String(row.timestamp_utc ?? '').slice(0, 10);
			if (!day || day.length < 10) { skipped++; continue; }
			const key = `${sym}|${day}`;
			const bucket = groups.get(key);
			if (bucket) bucket.push(row);
			else groups.set(key, [row]);
		}
		for (const [key, list] of groups.entries()) {
			const [sym, day] = key.split('|') as [string, string];
			const p = await resolvePrice(sym, `${day}T12:00:00Z`);
			if (!p) { skipped += list.length; continue; }
			for (const row of list) await updateRow(row, p.unitPrice, p.source, p.asof);
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
