import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, insertColumns, migrationColumns } from '../helpers/migrationColumns';

/**
 * Regression: no Solana history was ever saved.
 *
 * syncSolanaAddress wrote import_raw_rows with columns batch_id and raw_json; the table has
 * import_batch_id and row_json (migrations/0001_crypto_com.sql, which the Postgres schema was
 * converted from). The raw insert runs before the transactions insert and the cursor, so every
 * sync threw there and stored nothing. The db stub below throws, as Postgres does, on any column
 * the migrations never created.
 *
 * Every address and signature here is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-sol';
const OWN = 'Wa11etMine' + 'A'.repeat(34);
const SENDER = 'SenderXyz' + 'B'.repeat(35);
const SHOP = 'ShopQrs' + 'C'.repeat(37);
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const state = vi.hoisted(() => ({
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	cursor: null as string | null,
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		state.calls.push({ sql, args });
		assertInsertColumnsExist(sql, SCHEMA);
		if (/FROM wallet_sync_state/i.test(sql)) return { rows: state.cursor ? [{ last_timestamp: state.cursor }] : [], rowsAffected: 0 };
		if (/FROM exchange_accounts/i.test(sql)) return { rows: [{ id: 'acct-sol' }], rowsAffected: 0 };
		return { rows: [], rowsAffected: 1 };
	};
	return {
		db: {
			execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => stmts.map((s) => run(s.sql, s.args ?? [])),
		},
	};
});
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/lifecycle', () => ({ rebuildAssetLifecycles: vi.fn(async () => {}) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));

import { syncSolanaAddress } from '../../src/lib/sync/syncSolanaTransactions';

const BLOCK_TIME = 1_760_000_000;

/** A native SOL receive: SENDER pays 2 SOL plus the fee, OWN gets 2 SOL. */
const receiveSol = {
	blockTime: BLOCK_TIME,
	meta: {
		err: null,
		fee: 5_000,
		preBalances: [10_000_000_000, 1_000_000_000, 1],
		postBalances: [7_999_995_000, 3_000_000_000, 1],
		preTokenBalances: [],
		postTokenBalances: [],
	},
	transaction: { message: { accountKeys: [{ pubkey: SENDER }, { pubkey: OWN }, { pubkey: '11111111111111111111111111111111' }] } },
};

/** An SPL send: OWN pays 25 USDC to SHOP. */
const sendUsdc = {
	blockTime: BLOCK_TIME + 60,
	meta: {
		err: null,
		fee: 5_000,
		preBalances: [1_000_000_000, 2_039_280, 2_039_280],
		postBalances: [999_995_000, 2_039_280, 2_039_280],
		preTokenBalances: [
			{ accountIndex: 1, mint: USDC, owner: OWN, uiTokenAmount: { uiAmount: 100, decimals: 6 } },
			{ accountIndex: 2, mint: USDC, owner: SHOP, uiTokenAmount: { uiAmount: 5, decimals: 6 } },
		],
		postTokenBalances: [
			{ accountIndex: 1, mint: USDC, owner: OWN, uiTokenAmount: { uiAmount: 75, decimals: 6 } },
			{ accountIndex: 2, mint: USDC, owner: SHOP, uiTokenAmount: { uiAmount: 30, decimals: 6 } },
		],
	},
	transaction: { message: { accountKeys: [{ pubkey: OWN }, { pubkey: 'OwnUsdcAta' }, { pubkey: 'ShopUsdcAta' }] } },
};

const TXS: Record<string, unknown> = {};

beforeEach(() => {
	state.calls = [];
	state.cursor = null;
	for (const k of Object.keys(TXS)) delete TXS[k];
	Object.assign(TXS, { 'sig-receive': receiveSol, 'sig-send': sendUsdc });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: { body: string }) => {
			const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
			if (method === 'getSignaturesForAddress') {
				return new Response(JSON.stringify({ result: [{ signature: 'sig-send' }, { signature: 'sig-receive' }] }));
			}
			if (method === 'getTransaction') return new Response(JSON.stringify({ result: TXS[String(params[0])] ?? null }));
			return new Response(JSON.stringify({ error: { message: 'unknown method' } }));
		}),
	);
});

const wallet = { id: 'w-sol', address: OWN } as Parameters<typeof syncSolanaAddress>[1];
const inserts = (table: string) => state.calls.filter((c) => insertColumns(c.sql)?.table === table);

describe('syncSolanaAddress', () => {
	it('saves the raw rows, the transactions and the cursor, naming only columns the tables have', async () => {
		const result = await syncSolanaAddress(TENANT, wallet);

		expect(result).toMatchObject({ inserted: 2, txCount: 2 });
		const raw = inserts('import_raw_rows');
		expect(raw).toHaveLength(2);
		expect(insertColumns(raw[0].sql)!.columns).toEqual(expect.arrayContaining(['import_batch_id', 'row_json']));
		expect(inserts('import_transactions')).toHaveLength(2);
		const cursor = state.calls.find((c) => /INSERT INTO wallet_sync_state/i.test(c.sql));
		expect(cursor?.args).toEqual(['w-sol', 'solana', TENANT, 'sig-send', expect.any(String)]);
	});

	it('scopes every statement it sends by the tenant', async () => {
		await syncSolanaAddress(TENANT, wallet);
		for (const c of state.calls) expect(c.args).toContain(TENANT);
	});
});
