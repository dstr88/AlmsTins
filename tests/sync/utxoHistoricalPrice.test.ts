import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables, type MemRow } from '../helpers/memoryTable';

/**
 * Bitcoin and Litecoin rows are stored at the price of the transaction's own UTC day, never at the
 * price on the day of the sync (which put the sync day's price on transactions years old, and so
 * into cost basis and proceeds).
 *
 *   - A transaction from months ago gets that day's price (CoinGecko at 12:00 UTC, the import
 *     backfill's convention) and price_source names it; the balance snapshot keeps today's price.
 *   - A day with no price stores NULL, never another day's price, and no price_source.
 *   - Each day is looked up once per sync, newest first, at most MAX_PRICE_DAYS_PER_SYNC days; a
 *     second sync looks nothing up for rows already priced, and the provider's cache answers a
 *     repeated coin and day without a second request.
 *   - A stored row whose value is still empty is priced by the next sync; a stored value is never
 *     changed by a sync, and another tenant's row is never touched.
 *
 * The database stub keeps the tables in memory (tests/helpers/memoryTable.ts). Every address and
 * amount is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-a';
const OWN_BTC = 'bc1qmywa11etqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const PAYER = 'bc1qpayerssssssssssssssssssssssssssssss';
const SPOT = 90_000; // today's price: must never reach a row
const DAY_PRICE: Record<string, number> = { '2026-03-14': 60_000, '2026-06-01': 70_000 };

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	accounts: [] as MemRow[],
	txs: [] as unknown[],
	lookups: [] as Array<{ coinId: string; ts: string }>,
	snapshots: [] as unknown[][],
	failAll: false,
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		if (/information_schema/i.test(sql)) return { rows: [{ name: 'price_source' }], rowsAffected: 0 };
		assertInsertColumnsExist(sql, SCHEMA);
		const n = state.tables.run(sql, args);
		if (n !== null) return { rows: [], rowsAffected: n };
		if (/^\s*SELECT row_hash, native_usd FROM import_transactions/i.test(sql)) {
			const [tenant, source, account] = args;
			return {
				rows: state.tables.table('import_transactions')
					.filter((r) => r.tenant_id === tenant && r.source === source && r.account_id === account),
				rowsAffected: 0,
			};
		}
		if (/^\s*INSERT INTO wallet_snapshots/.test(sql)) {
			state.snapshots.push(args);
			return { rows: [], rowsAffected: 1 };
		}
		if (/^\s*INSERT INTO exchange_accounts/.test(sql)) {
			const [id, tenant_id, source, name] = args;
			state.accounts.push({ id, tenant_id, source, name });
			return { rows: [], rowsAffected: 1 };
		}
		if (/FROM exchange_accounts/i.test(sql)) {
			return { rows: state.accounts.filter((a) => a.tenant_id === args[0] && a.source === args[1]), rowsAffected: 0 };
		}
		return { rows: [], rowsAffected: 1 };
	};
	return {
		db: {
			execute: async (stmt: string | { sql: string; args?: unknown[] }) =>
				typeof stmt === 'string' ? run(stmt, []) : run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => stmts.map((s) => run(s.sql, s.args ?? [])),
		},
	};
});
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: async () => [{ symbol: 'BTC', quotes: { USD: { price: SPOT } } }] }));
vi.mock('@/lib/coingeckoHistorical', () => ({
	getCoingeckoIdBySymbol: async (symbol: string) => ({ BTC: 'bitcoin', LTC: 'litecoin' } as Record<string, string>)[symbol] ?? null,
	getUsdUnitPriceAtTimestampCoinGecko: async ({ coinId, timestampUtcIso }: { coinId: string; timestampUtcIso: string }) => {
		state.lookups.push({ coinId, ts: timestampUtcIso });
		if (state.failAll) throw new Error('CoinGecko HTTP 500');
		const p = DAY_PRICE[timestampUtcIso.slice(0, 10)];
		return p ? { unitPriceUsd: p, pricedAtIso: timestampUtcIso, source: 'coingecko:range', confidence: 'historical' } : null;
	},
}));

const at = (iso: string) => Date.parse(iso) / 1000;
const receive = (txid: string, iso: string, sats: number) => ({
	txid, status: { confirmed: true, block_time: at(iso) },
	vin: [{ prevout: { scriptpubkey_address: PAYER, value: sats + 1_000 } }],
	vout: [{ scriptpubkey_address: OWN_BTC, value: sats }],
});

const rows = (tenant = TENANT) => state.tables.table('import_transactions').filter((r) => r.tenant_id === tenant);
const byTx = (txid: string) => rows().find((r) => r.tx_hash === txid)!;
/** A row's USD value and price_source (absent when no statement named the column). */
const priceOf = (r: MemRow) => ({ native_usd: r.native_usd, price_source: r.price_source ?? null });

beforeEach(() => {
	vi.resetModules();
	state.tables = new MemoryTables({
		import_raw_rows: [['id']],
		import_transactions: [['id'], ['tenant_id', 'account_id', 'row_hash']],
	});
	state.accounts = [];
	state.lookups = [];
	state.snapshots = [];
	state.failAll = false;
	state.txs = [];
	vi.stubGlobal('fetch', vi.fn(async (input: string) => {
		const url = String(input);
		if (url.endsWith(`/address/${OWN_BTC}`)) return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }));
		if (url.endsWith(`/address/${OWN_BTC}/txs`)) return new Response(JSON.stringify(state.txs));
		if (url.includes(`/address/${OWN_BTC}/txs/chain/`)) return new Response('[]'); // one page is the whole history
		throw new Error(`unexpected fetch ${url}`);
	}));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const sync = async () => (await import('../../src/lib/sync/syncBtcAddress')).syncUtxoAddress(TENANT, 'bitcoin', OWN_BTC, 'w-btc');

describe('the Bitcoin sync prices each row on its own day', () => {
	it('a transaction from months ago gets that day\'s price, not the sync day\'s', async () => {
		state.txs = [receive('aa'.repeat(32), '2026-03-14T22:15:00Z', 50_000_000)];
		await sync();
		expect(byTx('aa'.repeat(32))).toMatchObject({ native_usd: 30_000, price_source: 'coingecko:range' });
		expect(state.lookups).toEqual([{ coinId: 'bitcoin', ts: '2026-03-14T12:00:00Z' }]);
		// The balance snapshot is today's value, at today's price.
		expect(state.snapshots).toHaveLength(1);
		expect(JSON.parse(String(state.snapshots[0][4]))[0]).toMatchObject({ symbol: 'BTC', priceUsd: SPOT });
	});

	it('a day with no price stores NULL and no price_source, never today\'s price', async () => {
		state.txs = [receive('bb'.repeat(32), '2019-01-02T10:00:00Z', 10_000_000)];
		await sync();
		expect(priceOf(byTx('bb'.repeat(32)))).toEqual({ native_usd: null, price_source: null });

		state.failAll = true; // a provider error is no price too
		state.txs = [receive('cc'.repeat(32), '2026-03-14T01:00:00Z', 10_000_000)];
		await sync();
		expect(priceOf(byTx('cc'.repeat(32)))).toEqual({ native_usd: null, price_source: null });
	});

	it('looks each day up once, and nothing again for rows already priced', async () => {
		state.txs = [
			receive('a1'.repeat(32), '2026-03-14T01:00:00Z', 10_000_000),
			receive('a2'.repeat(32), '2026-03-14T23:00:00Z', 20_000_000),
			receive('a3'.repeat(32), '2026-06-01T09:00:00Z', 30_000_000),
		];
		await sync();
		expect(state.lookups.map((l) => l.ts)).toEqual(['2026-06-01T12:00:00Z', '2026-03-14T12:00:00Z']);
		expect(rows().map((r) => r.native_usd).sort()).toEqual([12_000, 21_000, 6_000].sort());

		state.lookups = [];
		await sync();
		expect(state.lookups).toEqual([]);
	});

	it('looks up at most MAX_PRICE_DAYS_PER_SYNC days, newest first; the next sync prices the rest', async () => {
		const { MAX_PRICE_DAYS_PER_SYNC } = await import('../../src/lib/sync/utxoHistoricalPrice');
		const start = Date.parse('2026-01-01T06:00:00Z');
		state.txs = Array.from({ length: MAX_PRICE_DAYS_PER_SYNC + 5 }, (_, i) =>
			receive(i.toString(16).padStart(64, '0'), new Date(start + i * 86_400_000).toISOString(), 1_000_000));
		for (let i = 0; i < MAX_PRICE_DAYS_PER_SYNC + 5; i++) DAY_PRICE[new Date(start + i * 86_400_000).toISOString().slice(0, 10)] = 1_000 + i;

		await sync();
		expect(state.lookups).toHaveLength(MAX_PRICE_DAYS_PER_SYNC);
		expect(state.lookups[0].ts).toBe('2026-02-04T12:00:00Z'); // the newest day
		const empty = rows().filter((r) => r.native_usd === null);
		expect(empty.map((r) => String(r.timestamp_utc).slice(0, 10)).sort())
			.toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);

		state.lookups = [];
		await sync();
		expect(state.lookups).toHaveLength(5);
		expect(rows().filter((r) => r.native_usd === null)).toEqual([]);
		expect(rows().find((r) => String(r.timestamp_utc).startsWith('2026-01-01'))).toMatchObject({ native_usd: 10, price_source: 'coingecko:range' });
	});

	it('never changes a stored value, and never touches another tenant', async () => {
		state.txs = [receive('dd'.repeat(32), '2026-03-14T05:00:00Z', 50_000_000)];
		await sync();
		const row = byTx('dd'.repeat(32));
		row.native_usd = 45_000; // a value stored earlier (say by an older sync)
		row.price_source = null;
		const other = { ...row, id: 'other', tenant_id: 'tenant-b', native_usd: null };
		state.tables.table('import_transactions').push(other);

		await sync();
		expect(priceOf(byTx('dd'.repeat(32)))).toEqual({ native_usd: 45_000, price_source: null });
		expect(other).toMatchObject({ native_usd: null });
	});
});

describe('utxoHistoricalPrice helpers', () => {
	it('utcDay, usdAt and priceDays', async () => {
		const { utcDay, usdAt, priceDays } = await import('../../src/lib/sync/utxoHistoricalPrice');
		expect(utcDay('2026-03-14T23:59:59.999Z')).toBe('2026-03-14');
		expect(utcDay('2026-03-14T23:30:00-05:00')).toBe('2026-03-15');
		expect(utcDay('nope')).toBeNull();
		expect(usdAt(-0.00012345, 60_000)).toBe(7.41);

		const seen: string[] = [];
		const map = await priceDays('BTC', ['2026-01-02', '2026-01-01', '2026-01-02', '2026-01-03'], {
			max: 2,
			lookup: async (_s, day) => { seen.push(day); return day === '2026-01-03' ? null : { unitPriceUsd: 1, source: 'x' }; },
		});
		expect(seen).toEqual(['2026-01-03', '2026-01-02']);
		expect([...map.entries()]).toEqual([['2026-01-03', null], ['2026-01-02', { unitPriceUsd: 1, source: 'x' }]]);
	});

	it('dailyUsdPrice asks for 12:00 UTC of the day and never throws', async () => {
		const { dailyUsdPrice } = await import('../../src/lib/sync/utxoHistoricalPrice');
		expect(await dailyUsdPrice('BTC', '2026-06-01')).toEqual({ unitPriceUsd: 70_000, source: 'coingecko:range' });
		expect(state.lookups).toEqual([{ coinId: 'bitcoin', ts: '2026-06-01T12:00:00Z' }]);
		expect(await dailyUsdPrice('NOPE', '2026-06-01')).toBeNull();
		state.failAll = true;
		expect(await dailyUsdPrice('BTC', '2026-06-01')).toBeNull();
	});
});
