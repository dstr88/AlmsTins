import { describe, expect, it, vi } from 'vitest';

/**
 * The one-time correction of Bitcoin and Litecoin USD values (src/scripts/correctUtxoPrices.ts,
 * logic in src/lib/sync/utxoPriceCorrection.ts):
 *
 *   - selects only rows the old sync priced: bitcoin/litecoin source with that chain's coin,
 *     receive or send, a tx hash and a batch, a value and no price_source, and the batch's one
 *     spot price (|amount| × price in cents); anything else is left alone and counted;
 *   - prices each row at its own UTC day, one lookup per coin and day, as the sync does; a day
 *     with no price leaves the row as it is;
 *   - writes one tenant in one transaction, each UPDATE naming the tenant, the value read and a
 *     NULL price_source, and rolls back the tenant if any row changed since it was read.
 *
 * No database, no network: the price lookup and the pg client are stubs.
 */

vi.mock('@/lib/coingeckoHistorical', () => ({
	getCoingeckoIdBySymbol: async () => { throw new Error('the tests pass their own lookup'); },
	getUsdUnitPriceAtTimestampCoinGecko: async () => { throw new Error('the tests pass their own lookup'); },
}));

import {
	CANDIDATE_SQL, UPDATE_SQL, applyCorrections, planCorrections, selectSyncPricedRows,
	type CandidateRow, type Queryable,
} from '../../src/lib/sync/utxoPriceCorrection';

const SPOT = 90_000; // the price on the day of the old sync

let n = 0;
const row = (over: Partial<CandidateRow> & { amount: number }): CandidateRow => ({
	id: `r${++n}`, source: 'bitcoin', asset_symbol: 'BTC', kind: 'receive', tx_hash: 'ab'.repeat(32),
	native_usd: Math.round(Math.abs(over.amount) * SPOT * 100) / 100, timestamp_utc: '2024-03-14T22:15:00.000Z',
	import_batch_id: 'batch-1', ...over,
});

describe('selectSyncPricedRows', () => {
	it('keeps rows at their batch\'s one price, sends and receives, Bitcoin and Litecoin', () => {
		const rows = [
			row({ amount: 0.5 }),
			row({ amount: -0.00012345, kind: 'send' }), // cents rounding on a tiny amount still fits
			row({ amount: 3, source: 'litecoin', asset_symbol: 'LTC', native_usd: 240, import_batch_id: 'batch-2' }),
		];
		const sel = selectSyncPricedRows(rows);
		expect(sel.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
		expect(sel.rows[1]).toMatchObject({ symbol: 'BTC', amount: 0.00012345, usd: 11.11, day: '2024-03-14' });
		expect(sel.rows[2]).toMatchObject({ symbol: 'LTC', amount: 3, usd: 240 });
		expect(sel).toMatchObject({ notSyncShape: 0, offBatchPrice: 0 });
	});

	it('leaves alone anything not shaped like a sync row', () => {
		const sel = selectSyncPricedRows([
			row({ amount: 1, asset_symbol: 'LTC' }),                // wrong coin for the chain
			row({ amount: 1, source: 'coinbase' }),                  // not a chain sync
			row({ amount: 1, kind: 'buy' }),
			row({ amount: 1, tx_hash: null }),
			row({ amount: 1, import_batch_id: null }),
			row({ amount: 0 }),
			row({ amount: 1, native_usd: null }),
			row({ amount: 1, timestamp_utc: 'not a date' }),
		]);
		expect(sel).toEqual({ rows: [], notSyncShape: 8, offBatchPrice: 0 });
	});

	it('leaves alone a row that disagrees with its batch\'s price', () => {
		const sel = selectSyncPricedRows([
			row({ amount: 2 }),
			row({ amount: 1, native_usd: 61_234.56 }), // not 1 × the batch's 90,000
			row({ amount: 1, native_usd: 30_000, import_batch_id: 'other' }), // alone in its batch: its own price
		]);
		expect(sel.rows.map((r) => r.usd)).toEqual([180_000, 30_000]);
		expect(sel.offBatchPrice).toBe(1);
	});
});

describe('planCorrections', () => {
	it('prices each row at its own day, one lookup per coin and day, in time order', async () => {
		const { rows } = selectSyncPricedRows([
			row({ amount: 0.5, timestamp_utc: '2024-03-14T01:00:00Z' }),
			row({ amount: 0.25, timestamp_utc: '2024-03-14T23:00:00Z' }),
			row({ amount: 1, timestamp_utc: '2024-06-01T09:00:00Z' }),
			row({ amount: 2, timestamp_utc: '2017-01-01T09:00:00Z' }),
			row({ amount: 4, source: 'litecoin', asset_symbol: 'LTC', native_usd: 400, timestamp_utc: '2024-03-14T05:00:00Z', import_batch_id: 'b2' }),
		]);
		const lookups: string[] = [];
		const waits = vi.fn(async () => {});
		const prices: Record<string, number> = { 'BTC|2024-03-14': 70_000, 'BTC|2024-06-01': SPOT, 'LTC|2024-03-14': 90 };
		const plan = await planCorrections(rows, {
			beforeLookup: waits,
			lookup: async (symbol, day) => {
				lookups.push(`${symbol}|${day}`);
				const p = prices[`${symbol}|${day}`];
				return p ? { unitPriceUsd: p, source: 'coingecko:range' } : null;
			},
		});
		expect(lookups.sort()).toEqual(['BTC|2017-01-01', 'BTC|2024-03-14', 'BTC|2024-06-01', 'LTC|2024-03-14']);
		expect(waits).toHaveBeenCalledTimes(4);
		expect(plan.changes.map((c) => [c.symbol, c.day, c.oldUsd, c.newUsd, c.source])).toEqual([
			['BTC', '2024-03-14', 45_000, 35_000, 'coingecko:range'],
			['LTC', '2024-03-14', 400, 360, 'coingecko:range'],
			['BTC', '2024-03-14', 22_500, 17_500, 'coingecko:range'],
		]);
		expect(plan.unchanged).toBe(1); // 2024-06-01 was the sync day
		expect(plan.unpriced.map((r) => r.day)).toEqual(['2017-01-01']); // left as it is
	});
});

/** A pg client stub over one in-memory table, answering BEGIN/COMMIT/ROLLBACK and UPDATE_SQL. */
function fakeClient(table: Array<{ id: string; tenant_id: string; native_usd: number | null; price_source: string | null }>) {
	let snapshot: typeof table | null = null;
	const log: string[] = [];
	const client: Queryable = {
		async query(text, values = []) {
			log.push(text.trim().split(/\s+/)[0]);
			if (text === 'BEGIN') { snapshot = table.map((r) => ({ ...r })); return { rows: [], rowCount: null }; }
			if (text === 'COMMIT') { snapshot = null; return { rows: [], rowCount: null }; }
			if (text === 'ROLLBACK') { table.splice(0, table.length, ...snapshot!); return { rows: [], rowCount: null }; }
			if (text.includes('set_config')) return { rows: [{}], rowCount: 1 };
			if (text === UPDATE_SQL) {
				const [usd, source, id, tenant, old] = values;
				const hit = table.filter((r) => r.id === id && r.tenant_id === tenant && r.native_usd === old && r.price_source === null);
				for (const r of hit) { r.native_usd = usd as number; r.price_source = source as string; }
				return { rows: [], rowCount: hit.length };
			}
			throw new Error(`unexpected query ${text}`);
		},
	};
	return { client, log };
}

describe('applyCorrections', () => {
	const change = (id: string, oldUsd: number, newUsd: number) => ({ id, day: '2024-03-14', symbol: 'BTC', amount: 1, oldUsd, newUsd, source: 'coingecko:range' });

	it('writes native_usd and price_source in one transaction for the tenant', async () => {
		const table = [
			{ id: 'a', tenant_id: 't1', native_usd: 90_000, price_source: null },
			{ id: 'b', tenant_id: 't1', native_usd: 45_000, price_source: null },
			{ id: 'a2', tenant_id: 't2', native_usd: 90_000, price_source: null },
		];
		const { client, log } = fakeClient(table);
		expect(await applyCorrections(client, 't1', [change('a', 90_000, 70_000), change('b', 45_000, 35_000)])).toBe(2);
		expect(log).toEqual(['BEGIN', 'SELECT', 'UPDATE', 'UPDATE', 'COMMIT']);
		expect(table).toEqual([
			{ id: 'a', tenant_id: 't1', native_usd: 70_000, price_source: 'coingecko:range' },
			{ id: 'b', tenant_id: 't1', native_usd: 35_000, price_source: 'coingecko:range' },
			{ id: 'a2', tenant_id: 't2', native_usd: 90_000, price_source: null },
		]);
	});

	it('rolls the tenant back if a row changed since it was read, or was priced by someone else', async () => {
		const table = [
			{ id: 'a', tenant_id: 't1', native_usd: 90_000, price_source: null },
			{ id: 'b', tenant_id: 't1', native_usd: 45_000, price_source: 'coingecko:history' },
		];
		const before = table.map((r) => ({ ...r }));
		const { client, log } = fakeClient(table);
		await expect(applyCorrections(client, 't1', [change('a', 90_000, 70_000), change('b', 45_000, 35_000)])).rejects.toThrow(/row b changed/);
		expect(log.at(-1)).toBe('ROLLBACK');
		expect(table).toEqual(before);
	});

	it('does nothing without changes', async () => {
		const { client, log } = fakeClient([]);
		expect(await applyCorrections(client, 't1', [])).toBe(0);
		expect(log).toEqual([]);
	});
});

describe('the statements', () => {
	it('select one tenant\'s unsourced, valued Bitcoin and Litecoin rows, and update only with the value read', () => {
		expect(CANDIDATE_SQL).toMatch(/tenant_id = \$1/);
		expect(CANDIDATE_SQL).toMatch(/source IN \('bitcoin', 'litecoin'\)/);
		expect(CANDIDATE_SQL).toMatch(/native_usd IS NOT NULL AND price_source IS NULL/);
		expect(UPDATE_SQL).toMatch(/SET native_usd = \$1, price_source = \$2\s+WHERE id = \$3 AND tenant_id = \$4 AND native_usd = \$5 AND price_source IS NULL$/);
	});
});
