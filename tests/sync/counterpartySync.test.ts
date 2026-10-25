import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assertInsertColumnsExist, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables, type MemRow } from '../helpers/memoryTable';

/**
 * The Bitcoin and Sui syncs keep each row's counterparty (counterparty_address), for the address
 * details modal.
 *
 *   - Bitcoin: a receive keeps its first input that is not the wallet, a send its first output
 *     that is not the wallet (skipping change). bech32 is lowercased, base58 kept exactly.
 *   - Sui: the one other owner whose balance of that coin moved the opposite way; for a receive
 *     with several, the sender. A fee-only row keeps none.
 *   - Backfill: a row an earlier sync saved without one gets it on the next sync that fetches it,
 *     and nothing else on that row changes (not the description, the USD value, the note, the
 *     category). A counterparty already stored is never replaced.
 *   - Tenant scoping: another tenant's row with the same row_hash (Bitcoin) or the same id (Sui,
 *     whose id is digest:coin across tenants) is never touched.
 *   - When the column cannot be ensured, the sync still saves its rows and sends no UPDATE.
 *
 * The database stub keeps import_transactions and sui_transactions in memory and applies the
 * INSERT … ON CONFLICT DO NOTHING and UPDATE … WHERE the code sends (tests/helpers/memoryTable.ts).
 * Every address here is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions', 'sui_transactions'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const ACCT = 'acct-btc';

const OWN_BTC = 'bc1qmywa11etqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const PAYER_UPPER = 'BC1QPAYERSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS';
const PAYER_2 = 'bc1qpayer2tttttttttttttttttttttttttttttt';
const SHOP_LEGACY = '1ShopLegacyMixedCaseAddr2345678';
const RX_TXID = 'aa'.repeat(32);
const TX_TXID = 'bb'.repeat(32);
const BLOCK_TIME = 1_760_000_000;

const OWN_SUI = '0x' + '11'.repeat(32);
const SUI_FRIEND = '0x' + '22'.repeat(32);
const SUI_POOL_A = '0x' + '33'.repeat(32);
const SUI_POOL_B = '0x' + '44'.repeat(32);
const SUI_SENDER = '0x' + '55'.repeat(32);
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC = '0x' + 'dd'.repeat(32) + '::usdc::USDC';

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	schemaFails: false,
	btcTxs: [] as unknown[],
	suiPages: [] as unknown[],
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		state.calls.push({ sql, args });
		if (/information_schema/i.test(sql)) {
			if (state.schemaFails) throw new Error('permission denied');
			return { rows: [{ name: 'import_transactions' }, { name: 'sui_transactions' }], rowsAffected: 0 };
		}
		assertInsertColumnsExist(sql, SCHEMA);
		const n = state.tables.run(sql, args);
		if (n !== null) return { rows: [], rowsAffected: n };
		if (/FROM exchange_accounts/i.test(sql)) return { rows: [{ id: ACCT }], rowsAffected: 0 };
		return { rows: [], rowsAffected: 1 };
	};
	return {
		db: {
			execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => stmts.map((s) => run(s.sql, s.args ?? [])),
		},
	};
});
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: async () => [{ symbol: 'BTC', quotes: { USD: { price: 50_000 } } }] }));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/sui', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/sui')>()),
	queryTransactionBlocks: vi.fn(async () => state.suiPages.shift() ?? { data: [], nextCursor: null, hasNextPage: false }),
}));

/** Fresh modules per test, so the once-per-process column check starts over. */
async function load() {
	const btc = await import('../../src/lib/sync/syncBtcAddress');
	const sui = await import('../../src/lib/sync/syncSuiTransactions');
	return { ...btc, ...sui };
}

const receiveTx = {
	txid: RX_TXID,
	status: { confirmed: true, block_time: BLOCK_TIME },
	vin: [
		{ prevout: { scriptpubkey_address: PAYER_UPPER, value: 60_000 } },
		{ prevout: { scriptpubkey_address: PAYER_2, value: 10_000 } },
	],
	vout: [
		{ scriptpubkey_address: OWN_BTC, value: 50_000 },
		{ scriptpubkey_address: PAYER_UPPER, value: 19_000 },
	],
};
const sendTx = {
	txid: TX_TXID,
	status: { confirmed: true, block_time: BLOCK_TIME + 600 },
	vin: [{ prevout: { scriptpubkey_address: OWN_BTC, value: 100_000 } }],
	vout: [
		{ scriptpubkey_address: OWN_BTC, value: 30_000 },
		{ scriptpubkey_address: SHOP_LEGACY, value: 69_000 },
	],
};

/** The row_hash syncBtcAddress gives a transaction (src/lib/sync/syncBtcAddress.ts). */
function btcRowHash(txid: string, blockTime: number, direction: 'in' | 'out', sats: number): string {
	return createHash('sha256')
		.update(JSON.stringify(['bitcoin', txid, new Date(blockTime * 1000).toISOString(), direction, String(sats / 100_000_000)]))
		.digest('hex');
}
const RX_HASH = btcRowHash(RX_TXID, BLOCK_TIME, 'in', 50_000);
const TX_HASH = btcRowHash(TX_TXID, BLOCK_TIME + 600, 'out', 70_000);

/** A row an earlier sync saved, before counterparty_address existed, then annotated by the user. */
function existingBtcRow(tenantId: string, accountId: string, rowHash: string, counterparty: string | null = null): MemRow {
	return {
		id: `old-${tenantId}-${rowHash.slice(0, 6)}`, tenant_id: tenantId, source: 'bitcoin', account_id: accountId,
		wallet_id: 'w-btc', import_batch_id: 'batch-old', timestamp_utc: new Date(BLOCK_TIME * 1000).toISOString(),
		description: 'receive from bc1qpayerss…', currency: 'BTC', amount: 0.0005, native_usd: 21.5,
		kind: 'receive', tx_hash: RX_TXID, direction: 'in', asset_symbol: 'BTC', row_hash: rowHash,
		notes: 'rent from Sam', category: 'income', created_at: '2026-10-01 00:00:00', counterparty_address: counterparty,
	};
}

beforeEach(() => {
	vi.resetModules();
	state.tables = new MemoryTables({
		import_transactions: [['id'], ['tenant_id', 'account_id', 'row_hash']],
		sui_transactions: [['id'], ['tenant_id', 'digest', 'coin_type']],
	});
	state.calls = [];
	state.schemaFails = false;
	state.btcTxs = [receiveTx, sendTx];
	state.suiPages = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = String(input);
			if (url.endsWith(`/address/${OWN_BTC}`)) return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: 80_000, spent_txo_sum: 0 } }));
			if (url.endsWith(`/address/${OWN_BTC}/txs`)) return new Response(JSON.stringify(state.btcTxs));
			return new Response('not found', { status: 404 });
		}),
	);
});

const importRows = (tenantId = TENANT) => state.tables.table('import_transactions').filter((r) => r.tenant_id === tenantId);
const byHash = (hash: string, tenantId = TENANT) => importRows(tenantId).find((r) => r.row_hash === hash);

describe('Bitcoin counterparty', () => {
	it('keeps the first input that is not yours on a receive and the first output that is not yours on a send', async () => {
		const { syncBtcAddress } = await load();
		await syncBtcAddress(TENANT, OWN_BTC, 'w-btc');

		expect(byHash(RX_HASH)?.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
		expect(byHash(TX_HASH)?.counterparty_address).toBe(SHOP_LEGACY);
	});

	it('fills an older row on the next sync and changes nothing else on it', async () => {
		const before = existingBtcRow(TENANT, ACCT, RX_HASH);
		state.tables.table('import_transactions').push(before);
		const snapshot = { ...before };

		const { syncBtcAddress } = await load();
		const result = await syncBtcAddress(TENANT, OWN_BTC, 'w-btc');

		expect(result.inserted).toBe(1); // only the send is new
		const after = byHash(RX_HASH)!;
		expect(after).toBe(before);
		expect(after.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
		const { counterparty_address: _, ...rest } = after;
		const { counterparty_address: __, ...restBefore } = snapshot;
		expect(rest).toEqual(restBefore);
		expect(importRows()).toHaveLength(2);
	});

	it('never replaces a counterparty already stored', async () => {
		state.tables.table('import_transactions').push(existingBtcRow(TENANT, ACCT, RX_HASH, 'bc1qkeptbefore'));
		const { syncBtcAddress } = await load();
		await syncBtcAddress(TENANT, OWN_BTC, 'w-btc');
		expect(byHash(RX_HASH)?.counterparty_address).toBe('bc1qkeptbefore');
	});

	it('never touches another tenant’s row with the same row_hash', async () => {
		const theirs = existingBtcRow(OTHER_TENANT, ACCT, RX_HASH);
		state.tables.table('import_transactions').push(theirs);
		const { syncBtcAddress } = await load();
		await syncBtcAddress(TENANT, OWN_BTC, 'w-btc');

		expect(theirs.counterparty_address).toBeNull();
		expect(byHash(RX_HASH)?.counterparty_address).toBe(PAYER_UPPER.toLowerCase());
		for (const c of state.calls.filter((x) => /^\s*UPDATE/i.test(x.sql))) expect(c.args[1]).toBe(TENANT);
	});

	it('still saves the rows, and sends no UPDATE, when the column cannot be ensured', async () => {
		state.schemaFails = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { syncBtcAddress } = await load();
		const result = await syncBtcAddress(TENANT, OWN_BTC, 'w-btc');
		warn.mockRestore();

		expect(result.inserted).toBe(2);
		expect(importRows().every((r) => r.counterparty_address === undefined)).toBe(true);
		expect(state.calls.some((c) => /^\s*UPDATE/i.test(c.sql))).toBe(false);
	});

	it('btcCounterparty: null when every address is yours', async () => {
		const { btcCounterparty } = await load();
		expect(btcCounterparty({ vin: [{ prevout: { scriptpubkey_address: OWN_BTC } }] }, OWN_BTC, 'in')).toBeNull();
		expect(btcCounterparty({ vout: [{ scriptpubkey_address: OWN_BTC }, {}] }, OWN_BTC, 'out')).toBeNull();
	});
});

// ── Sui ──────────────────────────────────────────────────────────────────────

const change = (owner: string, coinType: string, amount: string) => ({ owner: { AddressOwner: owner }, coinType, amount });
const gas = { computationCost: '1000', storageCost: '0', storageRebate: '0' };

const suiSend = {
	digest: 'DigestSend1',
	timestampMs: String(BLOCK_TIME * 1000),
	transaction: { data: { sender: OWN_SUI } },
	effects: { status: { status: 'success' }, gasUsed: gas },
	balanceChanges: [change(OWN_SUI, SUI, '-5000001000'), change(SUI_FRIEND, SUI, '5000000000')],
};
const suiSwapIn = {
	digest: 'DigestSwap2',
	timestampMs: String((BLOCK_TIME + 60) * 1000),
	transaction: { data: { sender: SUI_SENDER } },
	effects: { status: { status: 'success' }, gasUsed: gas },
	balanceChanges: [change(OWN_SUI, USDC, '700000'), change(SUI_POOL_A, USDC, '-400000'), change(SUI_POOL_B, USDC, '-300000')],
};
const suiFeeOnly = {
	digest: 'DigestFee3',
	timestampMs: String((BLOCK_TIME + 120) * 1000),
	transaction: { data: { sender: OWN_SUI } },
	effects: { status: { status: 'success' }, gasUsed: gas },
	balanceChanges: [],
};

const suiWallet = { id: 'w-sui', address: OWN_SUI } as never;
const suiRows = (tenantId = TENANT) => state.tables.table('sui_transactions').filter((r) => r.tenant_id === tenantId);
const suiId = (digest: string, coinType: string) => `${digest}:${coinType.replace(/[^a-z0-9_]/gi, '_').slice(0, 80)}`;

describe('Sui counterparty', () => {
	beforeEach(() => {
		state.suiPages = [{ data: [suiSend, suiSwapIn, suiFeeOnly], nextCursor: 'DigestFee3', hasNextPage: false }];
	});

	it('keeps the recipient of a send, the sender of a receive from several, and none for a fee-only row', async () => {
		const { syncSuiTransactions } = await load();
		await syncSuiTransactions(TENANT, suiWallet);

		const by = (id: string) => suiRows().find((r) => r.id === id);
		expect(by(suiId('DigestSend1', SUI))?.counterparty_address).toBe(SUI_FRIEND);
		expect(by(suiId('DigestSwap2', USDC))?.counterparty_address).toBe(SUI_SENDER);
		expect(by('DigestFee3:fee')?.counterparty_address).toBeUndefined();
	});

	it('fills an older row it fetches again, changing nothing else, and never another tenant’s row', async () => {
		const id = suiId('DigestSend1', SUI);
		const mine: MemRow = {
			id, wallet_id: 'w-sui', tenant_id: TENANT, digest: 'DigestSend1', coin_type: SUI, symbol: 'SUI', amount: '-5000001000',
			decimals: 9, timestamp: '2025-01-01T00:00:00.000Z', fee_mist: '1000', status: 'success', note: 'paid back', category: 'transfer',
			counterparty_address: null,
		};
		state.tables.table('sui_transactions').push(mine);
		const snapshot = { ...mine };
		// The same id (and, to test the tenant filter alone, the same wallet id) under another tenant.
		const theirs: MemRow = { ...snapshot, tenant_id: OTHER_TENANT };
		state.tables.table('sui_transactions').push(theirs);

		const { syncSuiTransactions } = await load();
		await syncSuiTransactions(TENANT, suiWallet);

		expect(mine.counterparty_address).toBe(SUI_FRIEND);
		const { counterparty_address: _, ...rest } = mine;
		const { counterparty_address: __, ...restBefore } = snapshot;
		expect(rest).toEqual(restBefore);
		expect(theirs.counterparty_address).toBeNull();
	});

	it('suiCounterparty: the one opposite owner, else the sender for a receive, else none', async () => {
		const { suiCounterparty } = await load();
		const all = [change(OWN_SUI, SUI, '-10'), change(SUI_POOL_A, SUI, '4'), change(SUI_POOL_B, SUI, '6')];
		expect(suiCounterparty(all, OWN_SUI, all[0], OWN_SUI)).toBeNull();
		expect(suiCounterparty([change(OWN_SUI, SUI, '3')], OWN_SUI, change(OWN_SUI, SUI, '3'), SUI_SENDER.toUpperCase().replace('0X', '0x'))).toBe(SUI_SENDER);
		expect(suiCounterparty([change(OWN_SUI, SUI, '0')], OWN_SUI, change(OWN_SUI, SUI, '0'), SUI_SENDER)).toBeNull();
	});
});
