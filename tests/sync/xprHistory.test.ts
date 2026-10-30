import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables, type MemRow } from '../helpers/memoryTable';
import { ALICE, BOB, CAROL, NOW, TXID, action, actionsPage, chainServer, fakeFetch, hyperionServer, tokens } from '../xpr/fixtures';
import { resetXprServerProofs } from '@/lib/xpr/client';

/**
 * An XPR Network account gets a balance snapshot and its full transfer history.
 *
 *   - Rows go through the shared writer into import_transactions with source `xpr`, the chain's own
 *     coin as XPR in its 4 decimals (signed: a send is negative), its USD value at the XPR price of
 *     its UTC day, an `xpr` row_hash, the other account as the counterparty and the transaction id.
 *     A transfer with a staking, payout, lock or swap account is stored as send_review / receive_review
 *     with a plain "needs review" note. The memo stays in the raw row, never in the notes.
 *   - A token of any other contract is stored as SYMBOL@contract and is not valued.
 *   - Rows sit under one `xpr` exchange account; two of the tenant's own accounts keep separate rows
 *     per wallet even for one transaction.
 *   - Every statement names the session's tenant; another tenant's row with the same row_hash is
 *     never touched.
 *   - A second sync adds nothing and asks the server only for what is new (from the newest stored
 *     row, less a few days).
 *   - A balance snapshot holds the coin (liquid + staked, priced) and every token (listed, unpriced).
 *   - When no server can answer, no snapshot is written and nothing reads as zero: the routes say so.
 *   - Every way in syncs XPR: Sync Tins (POST /api/import/xpr-sync), the weekly cron, and the wallet's
 *     own sync (which must not send an XPR wallet to the EVM sync). The EVM weekly cron skips it.
 *
 * The database stub keeps the tables in memory (tests/helpers/memoryTable.ts). Every account name,
 * amount and transaction is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const XPR_PRICE = 0.002;
const SERVER = 'https://proton.eosusa.io';

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	wallets: [] as Array<Record<string, unknown>>,
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
			state.snapshots.push({ tenant_id, wallet_id, chain, totals_usd, payload_json, captured_at: '2026-10-30 16:30:00' });
			return { rows: [], rowsAffected: 1 };
		}
		if (/FROM exchange_accounts/i.test(sql)) {
			return { rows: state.accounts.filter((a) => a.tenant_id === args[0] && a.source === args[1]), rowsAffected: 0 };
		}
		if (/SELECT MAX\(timestamp_utc\) AS newest FROM import_transactions/i.test(sql)) {
			const [tenant, source, walletId] = args;
			const times = state.tables.table('import_transactions').filter((r) => r.tenant_id === tenant && r.source === source && r.wallet_id === walletId).map((r) => String(r.timestamp_utc));
			return { rows: [{ newest: times.sort().at(-1) ?? null }], rowsAffected: 0 };
		}
		if (/SELECT row_hash, native_usd FROM import_transactions/i.test(sql)) {
			const [tenant, source, accountId, ...hashes] = args;
			const rows = state.tables.table('import_transactions').filter((r) => r.tenant_id === tenant && r.source === source && r.account_id === accountId && hashes.includes(r.row_hash));
			return { rows: rows.map((r) => ({ row_hash: r.row_hash, native_usd: r.native_usd ?? null })), rowsAffected: 0 };
		}
		if (/SELECT MAX\(captured_at\) AS last_snap FROM wallet_snapshots/i.test(sql)) {
			const [walletId, tenant] = args;
			const times = state.snapshots.filter((s) => s.wallet_id === walletId && s.tenant_id === tenant).map((s) => String(s.captured_at));
			return { rows: [{ last_snap: times.sort().at(-1) ?? null }], rowsAffected: 0 };
		}
		if (/SELECT id FROM wallets WHERE tenant_id = \? AND address = \?/i.test(sql)) {
			return { rows: state.wallets.filter((w) => w.tenant_id === args[0] && w.address === args[1]), rowsAffected: 0 };
		}
		if (/FROM wallets/i.test(sql)) {
			let rows = state.wallets.filter((w) => /wallet_type = 'onchain'/.test(sql) || w.tenant_id === args[0]);
			if (/chains LIKE '%"xpr"%'/.test(sql)) rows = rows.filter((w) => String(w.chains).includes('"xpr"'));
			if (/AND id = \?/.test(sql)) rows = rows.filter((w) => w.id === args[1]);
			return { rows, rowsAffected: 0 };
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
const feed = vi.hoisted(() => ({ down: false }));
vi.mock('@/lib/prices/coingecko', () => ({
	getSimplePricesById: async (ids: string[]) => {
		if (feed.down) throw new Error('rate limited');
		return ids.includes('proton') ? { proton: { usd: 0.002 } } : {};
	},
}));
// Each row's day price (src/lib/sync/utxoHistoricalPrice.ts): the same as the spot price here.
vi.mock('@/lib/coingeckoHistorical', () => ({
	getCoingeckoIdBySymbol: async (symbol: string) => (symbol === 'XPR' ? 'proton' : null),
	getUsdUnitPriceAtTimestampCoinGecko: async () => ({ unitPriceUsd: 0.002, pricedAtIso: '', source: 'coingecko:range', confidence: 'historical' }),
	coingeckoReaches: () => true,
}));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT }) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: async () => {} }));
const evmSync = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/sync/syncTransactions', () => ({ syncWalletTransactions: vi.fn(async () => { evmSync.calls += 1; throw new Error('EVM sync called'); }) }));
vi.mock('@/lib/wallets', () => ({
	getAllActiveWallets: async () =>
		state.wallets.map((w) => ({ id: w.id, address: w.address, label: w.label, chains: JSON.parse(String(w.chains)) })),
}));

// ── The chain, as the servers answer ─────────────────────────────────────────

const RX = action({ seq: 1001, at: '2026-03-01T10:00:00.000', from: BOB, to: ALICE, quantity: '1000.0000 XPR', memo: 'payment for work', trx: TXID(0xa1) });
const TX = action({ seq: 1002, at: '2026-03-02T11:30:00.500', from: ALICE, to: CAROL, quantity: '250.5000 XPR', trx: TXID(0xa2) });
const STAKE = action({ seq: 1003, at: '2026-03-03T09:00:00.000', from: ALICE, to: 'stake.proton', quantity: '500.0000 XPR', memo: 'Stake', trx: TXID(0xa3) });
const REWARD = action({ seq: 1004, at: '2026-03-04T04:00:00.000', from: 'eosio.vpay', to: ALICE, quantity: '3.2500 XPR', memo: 'producer vote pay', trx: TXID(0xa4) });
const TOKEN_IN = action({ seq: 1005, at: '2026-03-05T12:00:00.000', from: BOB, to: ALICE, quantity: '12.500000 XUSDC', contract: 'xtokens', trx: TXID(0xa5) });
const FAKE_XPR = action({ seq: 1006, at: '2026-03-06T12:00:00.000', from: BOB, to: ALICE, quantity: '999.0000 XPR', contract: 'scamtoken1', trx: TXID(0xa6) });
const OTHERS = action({ seq: 1007, at: '2026-03-07T12:00:00.000', from: BOB, to: CAROL, quantity: '1.0000 XPR', trx: TXID(0xa7) });
const NFT = action({ seq: 1008, at: '2026-03-08T12:00:00.000', from: BOB, to: ALICE, quantity: '', contract: 'atomicassets', trx: TXID(0xa8), data: { from: BOB, to: ALICE, asset_ids: ['1099'], memo: '' } });
const ALL_ACTIONS = [RX, TX, STAKE, REWARD, TOKEN_IN, FAKE_XPR, OTHERS, NFT];

const env = { actions: ALL_ACTIONS as unknown[], list: [] as Array<{ symbol: string; contract: string; amount: number; precision?: number }>, down: false, queries: [] as string[] };

function installChain() {
	const chain = chainServer({
		'/v1/chain/get_currency_balance': () => ({ json: ['700.0000 XPR'] }),
		'/v1/chain/get_account': (b) => ({ json: { account_name: b.account_name, voter_info: { staked: '5000000' }, refund_request: null } }),
	});
	const hyper = hyperionServer({
		'/v2/state/get_tokens': () => ({ json: tokens(env.list) }),
		'/v2/history/get_actions': (q) => {
			env.queries.push(q.toString());
			const after = q.get('after');
			const from = after ? env.actions.filter((a) => Date.parse(`${(a as { timestamp: string }).timestamp}Z`) >= Date.parse(`${after}Z`)) : env.actions;
			return { json: actionsPage(from) };
		},
	});
	const { fetchImpl } = fakeFetch({ [SERVER]: (path, init) => (env.down ? new Error('connect ECONNREFUSED') : path.startsWith('/v2/') ? hyper(path, init) : chain(path, init)) });
	vi.stubGlobal('fetch', fetchImpl);
}

const wallet = (id: string, address: string, chains: string[], tenantId = TENANT) => ({
	id, tenant_id: tenantId, address, label: id, chains: JSON.stringify(chains), wallet_type: 'onchain', created_at: '2026-01-01',
});
const importRows = (tenantId = TENANT) => state.tables.table('import_transactions').filter((r) => r.tenant_id === tenantId);
const bySeq = (seq: number, walletId = 'w-alice') => importRows().find((r) => r.wallet_id === walletId && (JSON.parse(String(state.tables.table('import_raw_rows').find((x) => x.row_hash === r.row_hash)?.row_json ?? '{}')).globalSequence === String(seq)))!;
const json = (body: unknown) => new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
	vi.resetModules();
	resetXprServerProofs();
	// The servers' answers carry their own clock (the freshness check): freeze ours at the recorded moment.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	state.tables = new MemoryTables({
		import_raw_rows: [['id']],
		import_transactions: [['id'], ['tenant_id', 'account_id', 'row_hash']],
	});
	state.accounts = [];
	state.snapshots = [];
	state.calls = [];
	state.wallets = [];
	env.actions = [...ALL_ACTIONS];
	env.list = [{ symbol: 'XPR', contract: 'eosio.token', amount: 700 }, { symbol: 'XUSDC', contract: 'xtokens', amount: 12.5, precision: 6 }];
	env.down = false;
	feed.down = false;
	env.queries = [];
	evmSync.calls = 0;
	installChain();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const load = () => import('../../src/lib/sync/syncXprAddress');

describe('the XPR sync', () => {
	it('stores every transfer the account sent or received as an xpr row, and nothing else', async () => {
		const { syncXprAddress } = await load();
		const result = await syncXprAddress(TENANT, ALICE, 'w-alice');

		// 8 actions read; the transfer between two other accounts and the NFT transfer are not rows.
		expect(result).toEqual({ inserted: 6, skipped: 0, txCount: 6, snapshotWritten: true, complete: true });
		expect(importRows()).toHaveLength(6);
		expect(importRows().every((r) => r.source === 'xpr' && r.wallet_id === 'w-alice')).toBe(true);
		expect(state.tables.table('import_raw_rows').map((r) => r.source)).toEqual(Array(6).fill('xpr'));
	});

	it('a receive and a send: XPR, signed amounts in 4 decimals, the day\'s price, counterparty, tx id', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		expect(bySeq(1001)).toMatchObject({
			currency: 'XPR', asset_symbol: 'XPR', amount: 1000, native_currency: 'USD', native_usd: 1000 * XPR_PRICE,
			kind: 'receive', direction: 'in', tx_hash: TXID(0xa1), counterparty_address: BOB,
			description: 'receive', timestamp_utc: '2026-03-01T10:00:00.000Z',
		});
		// The memo is text a stranger wrote and the tax passes read notes for keywords: it is kept with the raw row only.
		expect(bySeq(1001).notes).toBeNull();
		const raw = state.tables.table('import_raw_rows').find((r) => r.row_hash === bySeq(1001).row_hash);
		expect(JSON.parse(String(raw?.row_json))).toMatchObject({ memo: 'payment for work', counterparty: BOB, account: ALICE });
		expect(bySeq(1002)).toMatchObject({
			amount: -250.5, native_usd: Math.round(250.5 * XPR_PRICE * 100) / 100, kind: 'send', direction: 'out', counterparty_address: CAROL,
			description: 'send', timestamp_utc: '2026-03-02T11:30:00.500Z',
		});
		expect(bySeq(1002).notes).toBeNull();
	});

	it('records staking and reward accounts faithfully, with a plain label to review, and decides nothing', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		const stake = bySeq(1003);
		expect(stake).toMatchObject({ kind: 'send_review', direction: 'out', amount: -500, counterparty_address: 'stake.proton', category: null, description: 'send' });
		expect(String(stake.notes)).toMatch(/^Needs review: this transfer was with stake\.proton, the XPR Network stake contract\./);
		expect(String(stake.notes)).not.toContain('Stake,');
		const reward = bySeq(1004);
		expect(reward).toMatchObject({ kind: 'receive_review', direction: 'in', amount: 3.25, counterparty_address: 'eosio.vpay', category: null });
		expect(String(reward.notes)).toMatch(/^Needs review: this transfer was with eosio\.vpay, the XPR Network voter payout account/);
	});

	it('stores a token of another contract as SYMBOL@contract, unpriced, and a look-alike XPR apart from the coin', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		expect(bySeq(1005)).toMatchObject({ currency: 'XUSDC@xtokens', asset_symbol: 'XUSDC@xtokens', amount: 12.5, native_usd: null, tx_hash: TXID(0xa5) });
		expect(bySeq(1006)).toMatchObject({ currency: 'XPR@scamtoken1', asset_symbol: 'XPR@scamtoken1', amount: 999, native_usd: null });
	});

	it('gives each row a row_hash with the xpr prefix, unique per action and per account\'s view', async () => {
		const { syncXprAddress, xprRowHash } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		const hashes = importRows().map((r) => String(r.row_hash));
		expect(new Set(hashes).size).toBe(6);
		const t = { globalSequence: '1', txId: TXID(1), timestamp: '2026-03-01T10:00:00.000Z', contract: 'eosio.token', asset: 'XPR', symbol: 'XPR', amount: 1, precision: 4, direction: 'in' as const, counterparty: BOB, memo: '' };
		expect(xprRowHash(ALICE, t)).not.toBe(xprRowHash(CAROL, t));
		expect(xprRowHash(ALICE, t)).not.toBe(xprRowHash(ALICE, { ...t, direction: 'out' }));
		expect(xprRowHash(ALICE, t)).not.toBe(xprRowHash(ALICE, { ...t, globalSequence: '2' }));
	});

	it('files the rows under one xpr exchange account, apart from the tenant\'s other accounts', async () => {
		state.accounts.push({ id: 'acct-ltc', tenant_id: TENANT, source: 'litecoin', name: 'Litecoin Wallet (ltc1q…)' });
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		const xprAccounts = state.accounts.filter((a) => a.source === 'xpr');
		expect(xprAccounts).toHaveLength(1);
		expect(xprAccounts[0]).toMatchObject({ tenant_id: TENANT, name: `XPR Network Account (${ALICE})` });
		expect(importRows().every((r) => r.account_id === xprAccounts[0].id)).toBe(true);
	});

	it('a second sync adds nothing, and reads only from the newest stored row (less a few days)', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');
		expect(env.queries.at(-1)).not.toContain('after=');

		const again = await syncXprAddress(TENANT, ALICE, 'w-alice');

		expect(again).toMatchObject({ inserted: 0, skipped: again.txCount });
		expect(importRows()).toHaveLength(6);
		// Newest stored row is 2026-03-06; three days earlier is the window start.
		expect(decodeURIComponent(env.queries.at(-1)!)).toContain('after=2026-03-03T12:00:00.000');
	});

	it('never touches another tenant\'s row with the same row_hash, and names the tenant everywhere', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');
		const hash = String(bySeq(1001).row_hash);
		const theirs: MemRow = {
			id: 'theirs', tenant_id: OTHER_TENANT, source: 'xpr', account_id: 'acct-theirs', wallet_id: 'w-theirs',
			row_hash: hash, amount: 9, currency: 'XPR', counterparty_address: null, notes: 'theirs',
		};
		state.tables.table('import_transactions').push(theirs);
		state.calls = [];
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		expect(theirs).toMatchObject({ amount: 9, counterparty_address: null, notes: 'theirs' });
		for (const c of state.calls.filter((x) => /^\s*(UPDATE|SELECT) .*import_transactions/is.test(x.sql))) expect(c.args).toContain(TENANT);
		for (const c of state.calls.filter((x) => /INSERT INTO import_transactions/i.test(x.sql))) expect(c.args).toContain(TENANT);
	});

	it('keeps two of the tenant\'s own accounts apart, row by row, for the same transaction', async () => {
		// Alice sends 40 XPR to Bob in one transaction; both are the tenant's wallets.
		const own = action({ seq: 2001, at: '2026-04-01T08:00:00.000', from: ALICE, to: BOB, quantity: '40.0000 XPR', trx: TXID(0xb1) });
		env.actions = [own];
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');
		const asBob = await (async () => {
			// The server answers for the account asked about: swap the question to Bob's.
			env.queries = [];
			return syncXprAddress(TENANT, BOB, 'w-bob');
		})();

		expect(asBob.inserted).toBe(1);
		const rows = importRows();
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.tx_hash))).toEqual(new Set([TXID(0xb1)]));
		expect(rows.map((r) => [r.wallet_id, r.direction]).sort()).toEqual([['w-alice', 'out'], ['w-bob', 'in']]);
		expect(new Set(rows.map((r) => r.row_hash)).size).toBe(2);
	});
});

describe('the balance snapshot', () => {
	it('holds the coin (liquid + staked, priced) and every token (listed, unpriced), once per sync', async () => {
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		expect(state.snapshots).toHaveLength(1);
		expect(state.snapshots[0]).toMatchObject({ tenant_id: TENANT, wallet_id: 'w-alice', chain: 'xpr' });
		// 700 liquid + 500 staked (5,000,000 units of 1/10000).
		expect(state.snapshots[0].totals_usd).toBeCloseTo(1200 * XPR_PRICE, 10);
		const payload = JSON.parse(String(state.snapshots[0].payload_json));
		expect(payload).toEqual([
			{ symbol: 'XPR', amount: 1200, priceUsd: XPR_PRICE, valueUsd: 1200 * XPR_PRICE, tokenAddress: null, liquid: 700, staked: 500, unstaking: 0 },
			{ symbol: 'XUSDC@xtokens', amount: 12.5, priceUsd: null, valueUsd: null, tokenAddress: 'xtokens' },
		]);
	});

	it('a token the coin shares a ticker with is never added to the coin or priced as it', async () => {
		env.list = [{ symbol: 'XPR', contract: 'eosio.token', amount: 700 }, { symbol: 'XPR', contract: 'scamtoken1', amount: 5_000_000 }];
		const { syncXprAddress } = await load();
		await syncXprAddress(TENANT, ALICE, 'w-alice');

		const payload = JSON.parse(String(state.snapshots[0].payload_json));
		expect(payload.map((t: { symbol: string }) => t.symbol)).toEqual(['XPR', 'XPR@scamtoken1']);
		expect(payload[1]).toMatchObject({ amount: 5_000_000, valueUsd: null });
		expect(state.snapshots[0].totals_usd).toBeCloseTo(1200 * XPR_PRICE, 10);
	});

	it('an unpriced coin (no price feed) is stored without a value, never as zero', async () => {
		feed.down = true;
		const { snapshotXprBalance } = await load();
		expect(await snapshotXprBalance(TENANT, 'w-alice', ALICE)).toBe(true);

		const payload = JSON.parse(String(state.snapshots[0].payload_json));
		expect(payload[0]).toMatchObject({ symbol: 'XPR', amount: 1200, priceUsd: null, valueUsd: null });
	});

	it('when no server can answer it writes no snapshot (the last one stands) and says so: never a zero balance', async () => {
		env.down = true;
		const { snapshotXprBalance } = await load();

		expect(await snapshotXprBalance(TENANT, 'w-alice', ALICE)).toBe(false);
		expect(state.snapshots).toHaveLength(0);
	});

	it('when only Hyperion fails the balance is not written either: it would be missing its tokens', async () => {
		const { fetchImpl } = fakeFetch({
			[SERVER]: (path, init) => (path.startsWith('/v2/') ? new Error('connect ECONNREFUSED') : chainServer({
				'/v1/chain/get_currency_balance': () => ({ json: ['700.0000 XPR'] }),
				'/v1/chain/get_account': () => ({ json: { account_name: ALICE, voter_info: { staked: 0 } } }),
			})(path, init)),
		});
		vi.stubGlobal('fetch', fetchImpl);
		const { snapshotXprBalance } = await load();

		expect(await snapshotXprBalance(TENANT, 'w-alice', ALICE)).toBe(false);
		expect(state.snapshots).toHaveLength(0);
	});
});

describe('every way in syncs XPR', () => {
	it('Sync Tins (POST /api/import/xpr-sync) imports every stored XPR wallet, found by its chain tag', async () => {
		state.wallets = [wallet('w-alice', ALICE, ['xpr']), wallet('w-evm', '0x' + 'ab'.repeat(20), ['ethereum'])];
		const { POST } = await import('../../src/pages/api/import/xpr-sync');
		const res = await POST({ request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ inserted: 6, skipped: 0, snapshots: 1, failed: 0, complete: true, wallets: 1 });
		expect(importRows().every((r) => r.source === 'xpr' && r.wallet_id === 'w-alice')).toBe(true);
		expect(state.calls.some((c) => /INSERT INTO wallets/.test(c.sql))).toBe(false);
	});

	it('Sync Tins with no XPR wallet answers 400 (nothing to do, not a failure)', async () => {
		state.wallets = [wallet('w-evm', '0x' + 'ab'.repeat(20), ['ethereum'])];
		const { POST } = await import('../../src/pages/api/import/xpr-sync');
		const res = await POST({ request: json({}) } as never);

		expect(res.status).toBe(400);
		expect(importRows()).toHaveLength(0);
	});

	it('a name that only looks like another chain\'s address is still XPR when tagged so', async () => {
		state.wallets = [wallet('w-odd', '1abc', ['xpr'])];
		env.actions = [action({ seq: 3001, at: '2026-05-01T10:00:00.000', from: BOB, to: '1abc', quantity: '2.0000 XPR', trx: TXID(0xc1) })];
		const { POST } = await import('../../src/pages/api/import/xpr-sync');
		const res = await POST({ request: json({}) } as never);

		expect((await res.json()).inserted).toBe(1);
		expect(importRows()[0]).toMatchObject({ source: 'xpr', wallet_id: 'w-odd', amount: 2 });
	});

	it('Sync Tins during an outage reports the wallet failed and writes no snapshot, never a zero', async () => {
		env.down = true;
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const { POST } = await import('../../src/pages/api/import/xpr-sync');
		const res = await POST({ request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ inserted: 0, snapshots: 0, failed: 1, complete: false });
		expect(state.snapshots).toHaveLength(0);
		expect(importRows()).toHaveLength(0);
	});

	it('the weekly cron imports it and reports it synced; a wallet synced within 6 days is skipped', async () => {
		vi.useRealTimers();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		vi.setSystemTime(NOW);
		vi.stubEnv('CRON_SECRET', 'test-secret');
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const { GET } = await import('../../src/pages/api/cron/sync-xpr');
		const call = async () => {
			const pending = GET({ request: new Request('https://app.test/api/cron/sync-xpr', { headers: { 'x-cron-secret': 'test-secret' } }) } as never) as Promise<Response>;
			await vi.runAllTimersAsync();
			return (await pending).json();
		};
		const first = await call();
		expect(first).toMatchObject({ synced: 1, failed: 0 });
		expect(first.results[0]).toMatchObject({ walletId: 'w-alice', status: 'synced', inserted: 6, complete: true });

		const second = await call();
		expect(second).toMatchObject({ synced: 0, skipped: 1 });
	});

	it('the weekly cron reports a wallet failed when no balance could be read', async () => {
		vi.useRealTimers();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		vi.setSystemTime(NOW);
		vi.stubEnv('CRON_SECRET', 'test-secret');
		env.down = true;
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const { GET } = await import('../../src/pages/api/cron/sync-xpr');
		const pending = GET({ request: new Request('https://app.test/api/cron/sync-xpr', { headers: { 'x-cron-secret': 'test-secret' } }) } as never) as Promise<Response>;
		await vi.runAllTimersAsync();

		expect(await (await pending).json()).toMatchObject({ synced: 0, failed: 1 });
	});

	it('the cron refuses a request without the secret', async () => {
		vi.stubEnv('CRON_SECRET', 'test-secret');
		const { GET } = await import('../../src/pages/api/cron/sync-xpr');
		const res = await GET({ request: new Request('https://app.test/api/cron/sync-xpr') } as never);

		expect(res.status).toBe(401);
	});

	it('the wallet\'s own sync imports it instead of calling the EVM sync', async () => {
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const { POST } = await import('../../src/pages/api/wallets/[id]/sync');
		const res = await POST({ params: { id: 'w-alice' }, request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ ok: true, walletId: 'w-alice', totalInserted: 6, totalSkipped: 0 });
		expect(body.chains[0]).toMatchObject({ chain: 'xpr', inserted: 6, ok: true });
		expect(evmSync.calls).toBe(0);
		expect(importRows()).toHaveLength(6);
	});

	it('the weekly EVM wallet cron leaves an XPR wallet to its own cron', async () => {
		vi.stubEnv('CRON_SECRET', 'test-secret');
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const { GET } = await import('../../src/pages/api/cron/sync-wallets');
		const res = await GET({ request: new Request('https://app.test/api/cron/sync-wallets', { headers: { 'x-cron-secret': 'test-secret' } }) } as never);

		expect(res.status).toBe(200);
		expect(evmSync.calls).toBe(0);
	});

	it('Sync Tins\' value pass does not hand an XPR account name to the EVM readers', async () => {
		state.wallets = [wallet('w-alice', ALICE, ['xpr'])];
		const getBalances = vi.fn(async () => []);
		vi.doMock('@/lib/balances', () => ({ getAllBalancesForWallet: getBalances }));
		vi.doMock('@/lib/networth', () => ({ insertWalletSnapshotFromValueBreakdown: vi.fn() }));
		vi.doMock('@/lib/evmTokenDiscovery', () => ({ discoverEvmBalances: vi.fn() }));
		const { syncWalletValuesForAllWallets } = await import('../../src/lib/sync/syncWalletValue');
		const result = await syncWalletValuesForAllWallets(TENANT);

		expect(getBalances).not.toHaveBeenCalled();
		expect(result.snapshotsInserted).toBe(0);
	});
});
