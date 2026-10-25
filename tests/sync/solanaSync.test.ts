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
 * Also: each row keeps its counterparty (counterparty_address, for the address details modal)
 * only when the transaction names exactly one other party, filled by an UPDATE that touches only
 * that column, only while it is NULL, only on the tenant's own row.
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
const RELAYER = 'Re1ayerFee' + 'D'.repeat(34);
const PAYEE_2 = 'PayeeTwo' + 'E'.repeat(36);

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

import { soleCounterparty, syncSolanaAddress } from '../../src/lib/sync/syncSolanaTransactions';

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

/** A SOL receive whose fee a relayer paid: the relayer only lost the fee, SENDER sent the SOL. */
const relayedReceive = {
	blockTime: BLOCK_TIME + 120,
	meta: {
		err: null,
		fee: 5_000,
		preBalances: [1_000_000_000, 5_000_000_000, 0],
		postBalances: [999_995_000, 4_000_000_000, 1_000_000_000],
		preTokenBalances: [],
		postTokenBalances: [],
	},
	transaction: { message: { accountKeys: [RELAYER, SENDER, OWN] } },
};

/** A SOL payout to two payees: no single counterparty. */
const splitSend = {
	blockTime: BLOCK_TIME + 180,
	meta: {
		err: null,
		fee: 5_000,
		preBalances: [9_000_000_000, 0, 0],
		postBalances: [6_999_995_000, 1_000_000_000, 1_000_000_000],
		preTokenBalances: [],
		postTokenBalances: [],
	},
	transaction: { message: { accountKeys: [{ pubkey: OWN }, { pubkey: SHOP }, { pubkey: PAYEE_2 }] } },
};

const TXS: Record<string, unknown> = {};
const SIGS = ['sig-send', 'sig-receive'];

beforeEach(() => {
	state.calls = [];
	state.cursor = null;
	for (const k of Object.keys(TXS)) delete TXS[k];
	Object.assign(TXS, { 'sig-receive': receiveSol, 'sig-send': sendUsdc, 'sig-relayed': relayedReceive, 'sig-split': splitSend });
	SIGS.splice(0, SIGS.length, 'sig-send', 'sig-receive');
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: { body: string }) => {
			const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
			if (method === 'getSignaturesForAddress') {
				return new Response(JSON.stringify({ result: SIGS.map((signature) => ({ signature })) }));
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
		// The schema check for counterparty_address (once per process) reads no row.
		const rowStatements = state.calls.filter((c) => !/information_schema|^\s*ALTER TABLE/i.test(c.sql));
		expect(rowStatements.length).toBeGreaterThan(0);
		for (const c of rowStatements) expect(c.args).toContain(TENANT);
	});
});

const updates = () => state.calls.filter((c) => /^\s*UPDATE import_transactions/i.test(c.sql));

describe('Solana counterparty', () => {
	it('keeps the full sender of a receive and the payee of a token send, exactly as written', async () => {
		await syncSolanaAddress(TENANT, wallet);

		const u = updates();
		expect(u.map((c) => c.args[0]).sort()).toEqual([SENDER, SHOP].sort());
		for (const c of u) {
			expect(c.sql).toMatch(/SET counterparty_address = \?\s+WHERE tenant_id = \? AND source = \? AND account_id = \? AND row_hash = \? AND counterparty_address IS NULL/);
			expect(c.args.slice(1, 4)).toEqual([TENANT, 'solana', 'acct-sol']);
		}
		// Each update targets a row this run inserted.
		const hashes = inserts('import_transactions').map((c) => c.args[insertColumns(c.sql)!.columns.indexOf('row_hash')]);
		expect(u.map((c) => c.args[4]).sort()).toEqual([...hashes].sort());
	});

	it('names the sender, not the relayer that only paid the fee', async () => {
		SIGS.splice(0, SIGS.length, 'sig-relayed');
		await syncSolanaAddress(TENANT, wallet);
		expect(updates().map((c) => c.args[0])).toEqual([SENDER]);
	});

	it('keeps none when the transaction pays more than one party', async () => {
		SIGS.splice(0, SIGS.length, 'sig-split');
		await syncSolanaAddress(TENANT, wallet);
		expect(inserts('import_transactions')).toHaveLength(1);
		expect(updates()).toEqual([]);
	});
});

describe('soleCounterparty', () => {
	const m = (entries: Array<[string, number]>) => new Map(entries);
	it('is the one other party that moved the opposite way', () => {
		expect(soleCounterparty(m([[OWN, 2], [SENDER, -2.001]]), OWN, 2, 0.001)).toBe(SENDER);
		expect(soleCounterparty(m([[OWN, -2], [SHOP, 2], [RELAYER, -0.000005]]), OWN, -2, 0.001)).toBe(SHOP);
	});
	it('is null for none, several, or only dust', () => {
		expect(soleCounterparty(m([[OWN, 2]]), OWN, 2, 0.001)).toBeNull();
		expect(soleCounterparty(m([[OWN, -2], [SHOP, 1], [PAYEE_2, 1]]), OWN, -2, 0.001)).toBeNull();
		expect(soleCounterparty(m([[OWN, 2], [RELAYER, -0.0001]]), OWN, 2, 0.001)).toBeNull();
	});
});
