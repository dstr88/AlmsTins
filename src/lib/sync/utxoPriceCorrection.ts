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
 *   - a value, and no price_source (the import price backfill and the fixed sync both set one;
 *     neither the app nor a user writes native_usd any other way);
 *   - the sync's fingerprint: one sync priced its whole batch at one spot price, so every row of
 *     the batch is |amount| × that price, in cents. A row that disagrees with its batch's price is
 *     left alone and counted.
 * Each tenant's updates run in one transaction; every UPDATE also requires the value it read and
 * a NULL price_source, and the transaction rolls back unless each changes exactly one row.
 */

import { CHAINS } from '@/lib/chains';
import { usdAt, utcDay, dailyUsdPrice, type DayPrice, type DayPriceLookup } from './utxoHistoricalPrice';

/** The coin each sync source stores (BTC, LTC). */
const COIN: Record<string, string> = { bitcoin: CHAINS.bitcoin.native.symbol, litecoin: CHAINS.litecoin.native.symbol };

/** The rows of one tenant that could be sync-priced. $1 is the tenant. */
export const CANDIDATE_SQL = `SELECT id, source, asset_symbol, kind, tx_hash, amount, native_usd, timestamp_utc, import_batch_id
	FROM import_transactions
	WHERE tenant_id = $1 AND source IN ('bitcoin', 'litecoin')
	  AND native_usd IS NOT NULL AND price_source IS NULL
	ORDER BY timestamp_utc, id`;

/** Tenants with Bitcoin or Litecoin sync rows. */
export const TENANTS_SQL = `SELECT DISTINCT tenant_id FROM import_transactions WHERE source IN ('bitcoin', 'litecoin') ORDER BY tenant_id`;

export const UPDATE_SQL = `UPDATE import_transactions SET native_usd = $1, price_source = $2
	WHERE id = $3 AND tenant_id = $4 AND native_usd = $5 AND price_source IS NULL`;

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
};

export type SyncRow = { id: string; symbol: string; amount: number; usd: number; timestamp: string; day: string };

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
		list.push({ id: String(r.id), symbol, amount: Math.abs(amount), usd, timestamp: String(r.timestamp_utc), day });
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

export type Change = { id: string; day: string; symbol: string; amount: number; oldUsd: number; newUsd: number; source: string };

export type Plan = {
	changes: Change[];
	/** Already at its day's price (to the cent). */
	unchanged: number;
	/** No price for the row's day: left as it is. */
	unpriced: SyncRow[];
};

/**
 * Prices each row at its own UTC day, one lookup per coin and day. `beforeLookup` runs before
 * each lookup (the script waits there, to stay under the provider's rate limit).
 */
export async function planCorrections(
	rows: readonly SyncRow[],
	opts: { lookup?: DayPriceLookup; beforeLookup?: () => Promise<void> } = {},
): Promise<Plan> {
	const { lookup = dailyUsdPrice, beforeLookup } = opts;
	const prices = new Map<string, DayPrice | null>();
	const plan: Plan = { changes: [], unchanged: 0, unpriced: [] };
	for (const r of rows) {
		const key = `${r.symbol}|${r.day}`;
		if (!prices.has(key)) {
			if (beforeLookup) await beforeLookup();
			prices.set(key, await lookup(r.symbol, r.day));
		}
		const p = prices.get(key);
		if (!p) { plan.unpriced.push(r); continue; }
		const newUsd = usdAt(r.amount, p.unitPriceUsd);
		if (newUsd === r.usd) { plan.unchanged++; continue; }
		plan.changes.push({ id: r.id, day: r.day, symbol: r.symbol, amount: r.amount, oldUsd: r.usd, newUsd, source: p.source });
	}
	return plan;
}

/** What the script needs of a pg client. */
export type Queryable = {
	query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

/**
 * Writes one tenant's changes in one transaction. Throws (after ROLLBACK, nothing changed) if any
 * row no longer holds the value that was read, or already has a price_source.
 */
export async function applyCorrections(client: Queryable, tenantId: string, changes: readonly Change[]): Promise<number> {
	if (changes.length === 0) return 0;
	await client.query('BEGIN');
	try {
		// Scope row-level security to this tenant too, should the role be subject to it.
		await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
		for (const c of changes) {
			const { rowCount } = await client.query(UPDATE_SQL, [c.newUsd, c.source, c.id, tenantId, c.oldUsd]);
			if (rowCount !== 1) throw new Error(`row ${c.id} changed since it was read`);
		}
		await client.query('COMMIT');
		return changes.length;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	}
}
