/**
 * The one-time correction behind src/scripts/correctUtxoPrices.ts: Bitcoin and Litecoin rows the
 * sync stored before it priced rows on their own day carry the price of the day of that sync
 * (src/lib/sync/syncBtcAddress.ts). This finds those rows for one tenant, prices each at its own
 * UTC day exactly as the sync now does (src/lib/sync/utxoHistoricalPrice.ts), and writes only
 * native_usd and price_source.
 *
 * A row is a candidate only when all of these hold, so a value anyone else wrote is never touched:
 *   - source bitcoin or litecoin, that chain's coin (BTC or LTC), kind receive or send, a tx hash,
 *     an amount, an import batch;
 *   - a value, and either no price_source (the import price backfill and the fixed sync both set
 *     one; neither the app nor a user writes native_usd any other way) or the mark this
 *     correction leaves on a row it could not price (ESTIMATE_SOURCE), so a later run can still
 *     price it (e.g. once a price source answers for its day);
 *   - the sync's fingerprint: one sync priced its whole batch at one spot price, so every row of
 *     the batch is |amount| × that price, in cents. A row that disagrees with its batch's price is
 *     left alone and counted.
 * Prices come from CoinGecko, then Coinbase's public candles for the days CoinGecko cannot reach
 * (src/lib/sync/utxoHistoricalPrice.ts); together they cover Bitcoin from 2015-07-20 and Litecoin
 * from 2016-08-17. A row with no price for its day keeps its value and gets
 * price_source = ESTIMATE_SOURCE, so reports keep working and every figure still resting on the old
 * sync-date price can be found.
 * Each tenant's updates run in one transaction; every UPDATE also requires the value and the
 * price_source it read, and the transaction rolls back unless each changes exactly one row.
 */

import { CHAINS } from '@/lib/chains';
import { usdAt, utcDay, dailyUsdPrice, type DayPrice, type DayPriceLookup } from './utxoHistoricalPrice';

/** price_source of a row whose sync-date value is kept because no price for its own day was found. */
export const ESTIMATE_SOURCE = 'sync_date_estimate';

/** The coin each sync source stores (BTC, LTC). */
const COIN: Record<string, string> = { bitcoin: CHAINS.bitcoin.native.symbol, litecoin: CHAINS.litecoin.native.symbol };

/** The rows of one tenant that could be sync-priced. $1 is the tenant. */
export const CANDIDATE_SQL = `SELECT id, source, asset_symbol, kind, tx_hash, amount, native_usd, timestamp_utc, import_batch_id, price_source
	FROM import_transactions
	WHERE tenant_id = $1 AND source IN ('bitcoin', 'litecoin')
	  AND native_usd IS NOT NULL AND (price_source IS NULL OR price_source = '${ESTIMATE_SOURCE}')
	ORDER BY timestamp_utc, id`;

/** Tenants with Bitcoin or Litecoin sync rows. */
export const TENANTS_SQL = `SELECT DISTINCT tenant_id FROM import_transactions WHERE source IN ('bitcoin', 'litecoin') ORDER BY tenant_id`;

export const UPDATE_SQL = `UPDATE import_transactions SET native_usd = $1, price_source = $2
	WHERE id = $3 AND tenant_id = $4 AND native_usd = $5 AND price_source IS NOT DISTINCT FROM $6::text`;

/** Marks a row with no price for its day: the value stays, price_source says it is an estimate. */
export const MARK_SQL = `UPDATE import_transactions SET price_source = $1
	WHERE id = $2 AND tenant_id = $3 AND native_usd = $4 AND price_source IS NULL`;

export type CandidateRow = {
	id: string;
	source: string;
	asset_symbol: string | null;
	kind: string | null;
	tx_hash: string | null;
	amount: number | string | null;
	native_usd: number | string | null;
	timestamp_utc: string | null;
	import_batch_id: string | null;
	price_source?: string | null;
};

/** priorSource: the row's price_source as read, null or ESTIMATE_SOURCE. */
export type SyncRow = { id: string; symbol: string; amount: number; usd: number; timestamp: string; day: string; priorSource: string | null };

export type Selection = {
	rows: SyncRow[];
	/** Not the sync's shape (another kind, coin, missing hash, amount or batch). */
	notSyncShape: number;
	/** In a sync batch but not at that batch's one price: possibly not the sync's value. */
	offBatchPrice: number;
};

const num = (v: unknown): number | null => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Keeps only rows the old sync priced (see the header). Pure. */
export function selectSyncPricedRows(input: readonly CandidateRow[]): Selection {
	let notSyncShape = 0;
	const batches = new Map<string, SyncRow[]>();
	for (const r of input) {
		const symbol = COIN[r.source];
		const amount = num(r.amount);
		const usd = num(r.native_usd);
		const day = utcDay(String(r.timestamp_utc ?? ''));
		const shaped = symbol && r.asset_symbol === symbol && (r.kind === 'receive' || r.kind === 'send')
			&& !!r.tx_hash && !!r.import_batch_id && amount !== null && amount !== 0 && usd !== null && usd >= 0 && day;
		if (!shaped) { notSyncShape++; continue; }
		const key = `${r.source}|${r.import_batch_id}`;
		const list = batches.get(key) ?? [];
		list.push({ id: String(r.id), symbol, amount: Math.abs(amount), usd, timestamp: String(r.timestamp_utc), day, priorSource: r.price_source ?? null });
		batches.set(key, list);
	}

	let offBatchPrice = 0;
	const rows: SyncRow[] = [];
	for (const list of batches.values()) {
		// The batch's price, from its largest amount (cents rounding matters least there).
		const ref = list.reduce((a, b) => (b.amount > a.amount ? b : a));
		const price = ref.usd / ref.amount;
		for (const r of list) {
			if (Math.abs(usdAt(r.amount, price) - r.usd) <= 0.011) rows.push(r);
			else offBatchPrice++;
		}
	}
	rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
	return { rows, notSyncShape, offBatchPrice };
}

export type Change = {
	id: string; day: string; symbol: string; amount: number; oldUsd: number; newUsd: number; source: string;
	/** price_source as read (null or ESTIMATE_SOURCE); the UPDATE requires it unchanged. */
	priorSource: string | null;
};

/** A row with no price for its day, not yet marked: it keeps its value and gets ESTIMATE_SOURCE. */
export type Mark = { id: string; oldUsd: number };

export type Plan = {
	changes: Change[];
	/** Already at its day's price (to the cent), and not marked as an estimate. */
	unchanged: number;
	/** No price for the row's day: the value stays (already marked rows included). */
	unpriced: SyncRow[];
	/** The unpriced rows not yet marked as estimates. */
	marks: Mark[];
};

/**
 * Prices each row at its own UTC day, one lookup per coin and day. `beforeLookup` runs before
 * each lookup with its coin and day (the script waits there before a day CoinGecko is asked for,
 * to stay under its rate limit).
 */
export async function planCorrections(
	rows: readonly SyncRow[],
	opts: { lookup?: DayPriceLookup; beforeLookup?: (symbol: string, day: string) => Promise<void> } = {},
): Promise<Plan> {
	const { lookup = dailyUsdPrice, beforeLookup } = opts;
	const prices = new Map<string, DayPrice | null>();
	const plan: Plan = { changes: [], unchanged: 0, unpriced: [], marks: [] };
	for (const r of rows) {
		const key = `${r.symbol}|${r.day}`;
		if (!prices.has(key)) {
			if (beforeLookup) await beforeLookup(r.symbol, r.day);
			prices.set(key, await lookup(r.symbol, r.day));
		}
		const p = prices.get(key);
		if (!p) {
			plan.unpriced.push(r);
			if (r.priorSource === null) plan.marks.push({ id: r.id, oldUsd: r.usd });
			continue;
		}
		const newUsd = usdAt(r.amount, p.unitPriceUsd);
		// A marked row whose value turns out right still gets the real source, so it stops reading as an estimate.
		if (newUsd === r.usd && r.priorSource === null) { plan.unchanged++; continue; }
		plan.changes.push({ id: r.id, day: r.day, symbol: r.symbol, amount: r.amount, oldUsd: r.usd, newUsd, source: p.source, priorSource: r.priorSource });
	}
	return plan;
}

/** What the script needs of a pg client. */
export type Queryable = {
	query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/**
 * Writes one tenant's changes and estimate marks in one transaction. Throws (after ROLLBACK,
 * nothing changed) if any row no longer holds the value and price_source that were read.
 */
export async function applyCorrections(
	client: Queryable,
	tenantId: string,
	changes: readonly Change[],
	marks: readonly Mark[] = [],
): Promise<{ changed: number; marked: number }> {
	if (changes.length === 0 && marks.length === 0) return { changed: 0, marked: 0 };
	await client.query('BEGIN');
	try {
		// Scope row-level security to this tenant too, should the role be subject to it.
		await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
		for (const c of changes) {
			const { rowCount } = await client.query(UPDATE_SQL, [c.newUsd, c.source, c.id, tenantId, c.oldUsd, c.priorSource]);
			if (rowCount !== 1) throw new Error(`row ${c.id} changed since it was read`);
		}
		for (const m of marks) {
			const { rowCount } = await client.query(MARK_SQL, [ESTIMATE_SOURCE, m.id, tenantId, m.oldUsd]);
			if (rowCount !== 1) throw new Error(`row ${m.id} changed since it was read`);
		}
		await client.query('COMMIT');
		return { changed: changes.length, marked: marks.length };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	}
}
