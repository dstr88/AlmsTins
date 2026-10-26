import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assertInsertColumnsExist, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables, type MemRow } from '../helpers/memoryTable';

/**
 * Litecoin history is imported, the same way as Bitcoin's (it used to get a balance snapshot only).
 *
 *   - The Litecoin sync reads litecoinspace.org, never Blockstream, and stores each transaction in
 *     import_transactions with source `litecoin`, LTC, a signed amount, its USD value at the LTC
 *     price of its day, a `litecoin` row_hash and its counterparty (the first input that is not the wallet on a
 *     receive, the first output that is not the wallet on a send; bech32 lowercased, base58 kept).
 *   - The rows are filed under the tenant's `litecoin` exchange account, never the `bitcoin` one, so
 *     a Bitcoin and a Litecoin transaction never collide.
 *   - Tenant scoping: another tenant's row with the same row_hash is never touched; every statement
 *     names the session's tenant.
 *   - A second sync adds nothing (same account and row_hash) and fills the counterparty of a row
 *     saved without one.
 *   - Every way in syncs the history: Sync Tins (POST /api/import/btc-sync), an address in its body,
 *     the weekly cron and the wallet's own sync (POST /api/wallets/{id}/sync), which used to send a
 *     Litecoin wallet to the EVM sync.
 *   - The balance snapshot is written once per sync, as before; the rows add no wallet snapshot.
 *
 * The database stub keeps the tables in memory and applies the INSERT … ON CONFLICT DO NOTHING and
 * UPDATE … WHERE the code sends (tests/helpers/memoryTable.ts). Every address and amount is
 * invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

const OWN_LTC = 'ltc1qmywa11etqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const PAYER_UPPER = 'LTC1QPAYERSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS';
const PAYER_2 = 'ltc1qpayer2tttttttttttttttttttttttttttttt';
const SHOP_LEGACY = 'LShopLegacyMixedCaseAddr2345678';
const RX_TXID = 'aa'.repeat(32);
const TX_TXID = 'bb'.repeat(32);
const BLOCK_TIME = 1_760_000_000;
const LTC_PRICE = 80;
const BTC_PRICE = 50_000;

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	wallets: [] as Array<Record<string, unknown>>,
	ltcTxs: [] as unknown[],
	fetched: [] as string[],
	accounts: [] as MemRow[],
	snapshots: [] as MemRow[],
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		state.calls.push({ sql, args });
		if (/information_schema/i.test(sql)) return { rows: [{ name: 'import_transactions' }, { name: 'sui_transactions' }], rowsAffected: 0 };
		assertInsertColumnsExist(sql, SCHEMA);
		const n = state.tables.run(sql, args);
		if (n !== null) return { rows: [], rowsAffected: n };
		if (/^\s*INSERT INTO exchange_accounts \(id, tenant_id, source, name\) VALUES \(\?, \?, \?, \?\)/.test(sql)) {
			const [id, tenant_id, source, name] = args;
			state.accounts.push({ id, tenant_id, source, name });
			return { rows: [], rowsAffected: 1 };
		}
		if (/^\s*INSERT INTO wallet_snapshots/.test(sql)) {
			const [tenant_id, wallet_id, chain, totals_usd, payload_json] = args;
			state.snapshots.push({ tenant_id, wallet_id, chain, totals_usd, payload_json });
			return { rows: [], rowsAffected: 1 };
		}
		if (/FROM exchange_accounts/i.test(sql)) {
			// `… WHERE tenant_id = ? AND source = ? [AND lower(name) = ?]`
			const rows = state.accounts.filter((a) => a.tenant_id === args[0] && a.source === args[1]);
			return { rows: /lower\(name\)/.test(sql) ? rows.filter((a) => String(a.name).toLowerCase() === args[2]) : rows, rowsAffected: 0 };
		}
		const select = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+wallets\b/i);
		if (select) {
			const columns = select[1].split(',').map((c) => c.trim());
			return { rows: state.wallets.map((w) => Object.fromEntries(columns.map((c) => [c, w[c]]))), rowsAffected: 0 };
		}
		return { rows: [], rowsAffected: 0 };
	};
	return {
		db: {
			execute: async (stmt: string | { sql: string; args?: unknown[] }) =>
				typeof stmt === 'string' ? run(stmt, []) : run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => stmts.map((s) => run(s.sql, s.args ?? [])),
		},
	};
});
vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: async () => [
		{ symbol: 'BTC', quotes: { USD: { price: BTC_PRICE } } },
		{ symbol: 'LTC', quotes: { USD: { price: LTC_PRICE } } },
	],
}));
// Each row's day price (src/lib/sync/utxoHistoricalPrice.ts): the same as the spot price here.
vi.mock('@/lib/coingeckoHistorical', () => ({
	getCoingeckoIdBySymbol: async (symbol: string) => ({ BTC: 'bitcoin', LTC: 'litecoin' } as Record<string, string>)[symbol] ?? null,
	getUsdUnitPriceAtTimestampCoinGecko: async ({ coinId }: { coinId: string }) =>
		({ unitPriceUsd: coinId === 'litecoin' ? LTC_PRICE : BTC_PRICE, pricedAtIso: '', source: 'coingecko:range', confidence: 'historical' }),
	coingeckoReaches: () => true,
}));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT }) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: async () => {} }));
vi.mock('@/lib/sync/syncTransactions', () => ({ syncWalletTransactions: vi.fn(async () => { throw new Error('EVM sync called'); }) }));
vi.mock('@/lib/wallets', () => ({
	getAllActiveWallets: async () =>
		state.wallets.map((w) => ({ id: w.id, address: w.address, label: w.label, chains: JSON.parse(String(w.chains)) })),
}));

const receiveTx = {
	txid: RX_TXID,
	status: { confirmed: true, block_time: BLOCK_TIME },
	vin: [
		{ prevout: { scriptpubkey_address: PAYER_UPPER, value: 160_000_000 } },
		{ prevout: { scriptpubkey_address: PAYER_2, value: 10_000_000 } },
	],
	vout: [
		{ scriptpubkey_address: OWN_LTC, value: 150_000_000 },
		{ scriptpubkey_address: PAYER_UPPER, value: 19_000_000 },
	],
};
const sendTx = {
	txid: TX_TXID,
	status: { confirmed: true, block_time: BLOCK_TIME + 600 },
	vin: [{ prevout: { scriptpubkey_address: OWN_LTC, value: 150_000_000 } }],
	vout: [
		{ scriptpubkey_address: OWN_LTC, value: 124_000_000 },
		{ scriptpubkey_address: SHOP_LEGACY, value: 25_000_000 },
	],
};

/** The row_hash the UTXO sync gives a transaction (src/lib/sync/syncBtcAddress.ts). */
function rowHash(chain: string, txid: string, blockTime: number, direction: 'in' | 'out', units: number): string {
	return createHash('sha256')
		.update(JSON.stringify([chain, txid, new Date(blockTime * 1000).toISOString(), direction, String(units / 100_000_000)]))
		.digest('hex');
}
const RX_HASH = rowHash('litecoin', RX_TXID, BLOCK_TIME, 'in', 150_000_000);
const TX_HASH = rowHash('litecoin', TX_TXID, BLOCK_TIME + 600, 'out', 26_000_000);

const wallet = (id: string, address: string, chains: string[], tenantId = TENANT) => ({
	id, tenant_id: tenantId, address, label: id, chains: JSON.stringify(chains), wallet_type: 'onchain', created_at: '2026-01-01',
});
const importRows = (tenantId = TENANT) => state.tables.table('import_transactions').filter((r) => r.tenant_id === tenantId);
const byHash = (hash: string, tenantId = TENANT) => importRows(tenantId).find((r) => r.row_hash === hash);
const snapshots = () => state.snapshots;
const json = (body: unknown) => new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
	vi.resetModules();
	state.tables = new MemoryTables({
		import_raw_rows: [['id']],
		import_transactions: [['id'], ['tenant_id', 'account_id', 'row_hash']],
	});
	state.accounts = [];
	state.snapshots = [];
	state.calls = [];
	state.wallets = [];
	state.ltcTxs = [receiveTx, sendTx];
	state.fetched = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = String(input);
			state.fetched.push(url);
			if (url === `https://litecoinspace.org/api/address/${OWN_LTC}`) {
				return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: 124_000_000, spent_txo_sum: 0 } }));
			}
			if (url === `https://litecoinspace.org/api/address/${OWN_LTC}/txs`) return new Response(JSON.stringify(state.ltcTxs));
			return new Response('Invalid address', { status: 400 });
		}),
	);
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const load = () => import('../../src/lib/sync/syncBtcAddress');

describe('the Litecoin sync', () => {
	it('reads litecoinspace only and stores every transaction as a litecoin LTC row', async () => {
		const { syncUtxoAddress } = await load();
		const result = await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		expect(result).toEqual({ inserted: 2, skipped: 0, txCount: 2, snapshotWritten: true });
		expect(state.fetched.every((u) => u.startsWith('https://litecoinspace.org/api/'))).toBe(true);
		expect(state.fetched.some((u) => u.endsWith('/txs'))).toBe(true);

		const rx = byHash(RX_HASH)!;
		const tx = byHash(TX_HASH)!;
		expect(rx).toMatchObject({
			tenant_id: TENANT, source: 'litecoin', wallet_id: 'w-ltc', currency: 'LTC', asset_symbol: 'LTC',
			amount: 1.5, native_currency: 'USD', native_usd: 1.5 * LTC_PRICE, kind: 'receive', direction: 'in', tx_hash: RX_TXID,
			timestamp_utc: new Date(BLOCK_TIME * 1000).toISOString(),
		});
		expect(tx).toMatchObject({ source: 'litecoin', currency: 'LTC', amount: -0.26, native_usd: 0.26 * LTC_PRICE, kind: 'send', direction: 'out' });
		expect(importRows()).toHaveLength(2);
		expect(state.tables.table('import_raw_rows').map((r) => r.source)).toEqual(['litecoin', 'litecoin']);
	});

	it('keeps the first input that is not yours on a receive and the first output that is not yours on a send', async () => {
		const { syncUtxoAddress } = await load();
		await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		expect(byHash(RX_HASH)?.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
		expect(byHash(TX_HASH)?.counterparty_address).toBe(SHOP_LEGACY);
	});

	it('files the rows under a litecoin account, apart from the tenant’s bitcoin account', async () => {
		state.accounts.push({ id: 'acct-btc', tenant_id: TENANT, source: 'bitcoin', name: 'Bitcoin Wallet (bc1q…)' });
		const { syncUtxoAddress } = await load();
		await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		const ltcAccounts = state.accounts.filter((a) => a.source === 'litecoin');
		expect(ltcAccounts).toHaveLength(1);
		expect(ltcAccounts[0]).toMatchObject({ tenant_id: TENANT, name: `Litecoin Wallet (${OWN_LTC.slice(0, 12)}…)` });
		expect(importRows().every((r) => r.account_id === ltcAccounts[0].id)).toBe(true);
	});

	it('a second sync adds nothing and fills a counterparty an older row lacks', async () => {
		const { syncUtxoAddress } = await load();
		await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');
		byHash(RX_HASH)!.counterparty_address = null;
		const before = { ...byHash(RX_HASH)! };

		const again = await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		expect(again).toMatchObject({ inserted: 0, skipped: 2 });
		expect(importRows()).toHaveLength(2);
		const { counterparty_address: _, ...rest } = byHash(RX_HASH)!;
		const { counterparty_address: __, ...restBefore } = before;
		expect(rest).toEqual(restBefore);
		expect(byHash(RX_HASH)?.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
	});

	it('never touches another tenant’s row with the same row_hash, and names the tenant everywhere', async () => {
		const theirs: MemRow = {
			id: 'theirs', tenant_id: OTHER_TENANT, source: 'litecoin', account_id: 'acct-theirs', wallet_id: 'w-theirs',
			row_hash: RX_HASH, amount: 9, currency: 'LTC', counterparty_address: null, notes: 'theirs',
		};
		state.tables.table('import_transactions').push(theirs);
		const { syncUtxoAddress } = await load();
		await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		expect(theirs).toMatchObject({ amount: 9, counterparty_address: null, notes: 'theirs' });
		expect(importRows(OTHER_TENANT)).toHaveLength(1);
		expect(byHash(RX_HASH)?.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
		for (const c of state.calls.filter((x) => /^\s*UPDATE/i.test(x.sql))) expect(c.args[1]).toBe(TENANT);
		for (const c of state.calls.filter((x) => /INSERT INTO import_transactions/i.test(x.sql))) expect(c.args).toContain(TENANT);
	});

	it('writes one LTC balance snapshot and no other value: the rows are not valued again', async () => {
		const { syncUtxoAddress } = await load();
		await syncUtxoAddress(TENANT, 'litecoin', OWN_LTC, 'w-ltc');

		expect(snapshots()).toHaveLength(1);
		expect(snapshots()[0]).toMatchObject({ tenant_id: TENANT, wallet_id: 'w-ltc', chain: 'litecoin', totals_usd: 1.24 * LTC_PRICE });
		expect(JSON.parse(String(snapshots()[0].payload_json))).toEqual([
			{ symbol: 'LTC', amount: 1.24, priceUsd: LTC_PRICE, valueUsd: 1.24 * LTC_PRICE, tokenAddress: null },
		]);
	});

	it('a Litecoin row_hash differs from a Bitcoin one for the same transaction values', () => {
		// Bitcoin's own rows are pinned by tests/import/importWriterGolden.test.ts.
		expect(rowHash('bitcoin', RX_TXID, BLOCK_TIME, 'in', 150_000_000)).not.toBe(RX_HASH);
	});
});

describe('every way in syncs Litecoin history', () => {
	it('Sync Tins imports a stored Litecoin wallet’s history by its id', async () => {
		state.wallets = [wallet('w-ltc', OWN_LTC, ['litecoin'])];
		const { POST } = await import('../../src/pages/api/import/btc-sync');
		const res = await POST({ request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ inserted: 2, skipped: 0, snapshots: 1, failed: 0, wallets: [OWN_LTC] });
		expect(importRows().map((r) => [r.source, r.wallet_id])).toEqual([['litecoin', 'w-ltc'], ['litecoin', 'w-ltc']]);
		expect(state.calls.some((c) => /INSERT INTO wallets/.test(c.sql))).toBe(false);
	});

	it('Sync Tins with an ltc1 address in the body syncs it as Litecoin', async () => {
		const { POST } = await import('../../src/pages/api/import/btc-sync');
		await POST({ request: json({ address: OWN_LTC }) } as never);

		expect(state.fetched.length).toBeGreaterThan(0);
		expect(state.fetched.every((u) => u.startsWith('https://litecoinspace.org/api/'))).toBe(true);
		expect(importRows().every((r) => r.source === 'litecoin')).toBe(true);
	});

	it('the weekly cron imports it and reports it synced', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		vi.stubEnv('CRON_SECRET', 'test-secret');
		state.wallets = [wallet('w-ltc', OWN_LTC, ['litecoin'])];
		const { GET } = await import('../../src/pages/api/cron/sync-btc');
		const pending = GET({
			request: new Request('https://app.test/api/cron/sync-btc', { headers: { 'x-cron-secret': 'test-secret' } }),
		} as never) as Promise<Response>;
		await vi.runAllTimersAsync();
		const body = await (await pending).json();

		expect(body).toMatchObject({ synced: 1, failed: 0 });
		expect(body.results[0]).toMatchObject({ walletId: 'w-ltc', status: 'synced', inserted: 2 });
		expect(importRows()).toHaveLength(2);
	});

	it('the wallet’s own sync imports it instead of calling the EVM sync', async () => {
		state.wallets = [wallet('w-ltc', OWN_LTC, ['litecoin'])];
		const { POST } = await import('../../src/pages/api/wallets/[id]/sync');
		const res = await POST({ params: { id: 'w-ltc' }, request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ ok: true, walletId: 'w-ltc', totalInserted: 2, totalSkipped: 0 });
		expect(body.chains[0]).toMatchObject({ chain: 'litecoin', inserted: 2 });
		expect(importRows()).toHaveLength(2);
	});
});
