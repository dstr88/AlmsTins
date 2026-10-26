import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertInsertColumnsExist, insertColumns, migrationColumns } from '../helpers/migrationColumns';

/**
 * Regression: no Bitcoin wallet ever got a balance snapshot, and a legacy address was stored a
 * second time in lowercase.
 *
 * - syncBtcAddress wrote import_raw_rows with columns batch_id and raw_json; the table has
 *   import_batch_id and row_json. The insert threw after the wallet row was resolved and before
 *   the snapshot, and every caller (Sync Tins, the weekly cron) caught and logged it, so the run
 *   "succeeded" and the wallet stayed "Wallet value —". The db stub below throws, as Postgres does,
 *   on any column the migrations never created.
 * - Every caller lowercased the address first. A legacy 1… / P2SH 3… address is case-sensitive
 *   base58, so Blockstream was asked about an invalid address, and ensureBtcWallet, finding no
 *   wallet with that spelling, inserted a new "Bitcoin Wallet (…)" row for it.
 * - The wallet card's refresh skipped Bitcoin and Litecoin, so a new wallet had no value until a
 *   sync ran; it now stores the balance on the first load.
 *
 * Every address and amount here is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions'].map((t) => [t, all.get(t)!]));
})();

const LEGACY = '1AbcDEFghJKLmnPQRstUVwxyz2345678';
const LEGACY_2 = '3QrsTUVwxyzABCDEFGHJKLMNPqrstuv9';
const BECH32 = 'bc1qqqqqzzzz9999xxxx8888gggg2222tttt';
const LTC = 'ltc1qqqqqzzzz9999xxxx8888gggg2222tttt';
const EVM = '0x00000000000000000000000000000000000000e1';
const OTHER = 'bc1qpppprrrryyyy7777llllaaaauuuummmm';
const TXID = 'ab'.repeat(32);
const BTC_PRICE = 50_000;
const LTC_PRICE = 80;

type Call = { sql: string; args: unknown[] };
const state = vi.hoisted(() => ({
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	wallets: [] as Array<Record<string, unknown>>,
	labels: [] as Array<Record<string, unknown>>,
	importTxs: [] as Array<Record<string, unknown>>,
	failBatch: false,
	assertColumns: (_sql: string) => {},
}));

function answer(sql: string) {
	const select = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+wallets\b/i);
	if (select) {
		const columns = select[1].split(',').map((c) => c.trim());
		return { rows: state.wallets.map((w) => Object.fromEntries(columns.map((c) => [c, w[c]]))), rowsAffected: 0 };
	}
	if (/FROM address_labels/i.test(sql)) return { rows: state.labels, rowsAffected: 0 };
	if (/FROM import_transactions/i.test(sql)) return { rows: state.importTxs, rowsAffected: 0 };
	if (/RETURNING/i.test(sql)) return { rows: [{ id: 'new-id' }], rowsAffected: 1 };
	return { rows: [], rowsAffected: 1 };
}

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
			state.calls.push({ sql, args });
			state.assertColumns(sql);
			return answer(sql);
		},
		batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
			if (state.failBatch) throw new Error('connection reset');
			return stmts.map((s) => {
				state.calls.push({ sql: s.sql, args: s.args ?? [] });
				state.assertColumns(s.sql);
				return { rows: [], rowsAffected: 1 };
			});
		},
	},
}));
vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: async () => [
		{ symbol: 'BTC', quotes: { USD: { price: BTC_PRICE } } },
		{ symbol: 'LTC', quotes: { USD: { price: LTC_PRICE } } },
	],
}));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: 't1' }) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: async () => {} }));
vi.mock('@/lib/sync/syncWalletValue', () => ({ computeWalletValue: vi.fn(async () => []) }));
vi.mock('@/lib/networth', () => ({
	insertWalletSnapshotFromValueBreakdown: vi.fn(async () => {}),
	getWalletTokenBreakdown: vi.fn(async () => ({ address: '', label: null, snapshots: [], tokens: [] })),
}));

import { syncBtcAddress, snapshotUtxoBalance } from '../../src/lib/sync/syncBtcAddress';
import { canonicalAddress } from '../../src/lib/wallets-service';
import { autoClassifyOwnWalletTransfers } from '../../src/lib/autoClassify';
import { POST as btcSyncPOST } from '../../src/pages/api/import/btc-sync';
import { GET as cronGET } from '../../src/pages/api/cron/sync-btc';
import { GET as tokensGET } from '../../src/pages/api/wallets/[id]/tokens';
import { POST as labelsPOST } from '../../src/pages/api/address-labels';

/** Esplora (Blockstream / litecoinspace): knows only these exact spellings, 400 for anything else. */
const ONCHAIN: Record<string, { sats: number; txs: unknown[] }> = {};
const VOUTS: Record<string, string[]> = {};
const fetched: string[] = [];
/** Requests to the explorers; the rest are day-price lookups (src/lib/sync/utxoHistoricalPrice.ts). */
const EXPLORER = /^https:\/\/(blockstream\.info|litecoinspace\.org)\//;
const explorerCalls = () => fetched.filter((u) => EXPLORER.test(u));
const priceCalls = () => fetched.filter((u) => !EXPLORER.test(u));

function receiveTx(to: string, sats: number) {
	return {
		txid: TXID,
		status: { confirmed: true, block_time: 1_760_000_000 },
		vin: [{ prevout: { scriptpubkey_address: OTHER, value: sats + 1_000 } }],
		vout: [{ scriptpubkey_address: to, value: sats }],
	};
}

beforeEach(() => {
	state.calls = [];
	state.wallets = [];
	state.labels = [];
	state.importTxs = [];
	state.failBatch = false;
	state.assertColumns = (sql) => assertInsertColumnsExist(sql, SCHEMA);
	fetched.length = 0;
	for (const k of Object.keys(ONCHAIN)) delete ONCHAIN[k];
	for (const k of Object.keys(VOUTS)) delete VOUTS[k];
	Object.assign(ONCHAIN, {
		[LEGACY]: { sats: 150_000, txs: [receiveTx(LEGACY, 150_000)] },
		[BECH32]: { sats: 99_000, txs: [receiveTx(BECH32, 99_000)] },
		[LTC]: { sats: 2_500_000_000, txs: [] },
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = String(input);
			fetched.push(url);
			const tx = url.match(/\/tx\/([0-9a-f]{64})$/);
			if (tx) {
				const outs = VOUTS[tx[1]];
				return outs
					? new Response(JSON.stringify({ vout: outs.map((a) => ({ scriptpubkey_address: a })) }))
					: new Response('not found', { status: 404 });
			}
			const m = url.match(/\/address\/([^/]+)(\/txs.*)?$/);
			const entry = m ? ONCHAIN[m[1]] : undefined;
			if (!m || !entry) return new Response('Invalid address', { status: 400 });
			if (m[2]?.startsWith('/txs/chain/')) return new Response('[]');
			if (m[2]) return new Response(JSON.stringify(entry.txs));
			return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: entry.sats, spent_txo_sum: 0 } }));
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

const snapshots = () =>
	state.calls
		.filter((c) => /INSERT INTO wallet_snapshots/.test(c.sql))
		.map((c) => ({ walletId: c.args[1], chain: c.args[2], totalUsd: c.args[3], tokens: JSON.parse(String(c.args[4])) }));
const walletInserts = () => state.calls.filter((c: Call) => /INSERT INTO wallets/.test(c.sql));
const wallet = (id: string, address: string, chains: string[]) => ({
	id, tenant_id: 't1', address, label: id, chains: JSON.stringify(chains), wallet_type: 'onchain', created_at: '2026-01-01',
});
const json = (body: unknown) => new Request('https://app.test/x', { method: 'POST', body: JSON.stringify(body) });

describe('canonicalAddress', () => {
	it('lowercases EVM and bech32, keeps base58 exactly', () => {
		expect(canonicalAddress(' 0x00000000000000000000000000000000000000E1 ')).toBe(EVM);
		expect(canonicalAddress(BECH32.toUpperCase())).toBe(BECH32);
		expect(canonicalAddress(LTC.toUpperCase())).toBe(LTC);
		expect(canonicalAddress(LEGACY)).toBe(LEGACY);
		expect(canonicalAddress(LEGACY_2)).toBe(LEGACY_2);
		const solana = 'bc1VwXyZabcDEFghjkMNPQrstuvWXYZ234567abcdEFG';
		expect(canonicalAddress(solana)).toBe(solana); // mixed case, so base58, not bech32
	});
});

describe('syncBtcAddress', () => {
	it('writes the balance snapshot and imports history, naming only columns the tables have', async () => {
		const result = await syncBtcAddress('t1', LEGACY, 'w-legacy');

		expect(result.snapshotWritten).toBe(true);
		expect(result.inserted).toBe(1);
		expect(snapshots()).toEqual([{
			walletId: 'w-legacy',
			chain: 'bitcoin',
			totalUsd: 0.0015 * BTC_PRICE,
			tokens: [{ symbol: 'BTC', amount: 0.0015, priceUsd: BTC_PRICE, valueUsd: 0.0015 * BTC_PRICE, tokenAddress: null }],
		}]);
		const raw = state.calls.find((c) => /INSERT INTO import_raw_rows/.test(c.sql))!;
		expect(insertColumns(raw.sql)!.columns).toEqual(expect.arrayContaining(['import_batch_id', 'row_json']));
	});

	it('asks the explorer about the exact base58 spelling and never adds a wallet row for a known wallet', async () => {
		await syncBtcAddress('t1', LEGACY, 'w-legacy');
		expect(explorerCalls().length).toBeGreaterThan(0);
		expect(explorerCalls().every((u) => u.includes(LEGACY))).toBe(true);
		expect(priceCalls().some((u) => u.includes(LEGACY))).toBe(false); // a price request never names the address
		expect(walletInserts()).toHaveLength(0);
	});

	it('keeps the balance even when importing the history fails', async () => {
		state.failBatch = true;
		await expect(syncBtcAddress('t1', BECH32, 'w-bech')).rejects.toThrow('connection reset');
		expect(snapshots().map((s) => [s.walletId, s.chain])).toEqual([['w-bech', 'bitcoin']]);
	});

	it('stores nothing when the explorer cannot answer, rather than a zero balance', async () => {
		expect(await snapshotUtxoBalance('t1', 'w-x', 'bitcoin', LEGACY.toLowerCase())).toBe(false);
		expect(snapshots()).toHaveLength(0);
	});

	it('snapshots a Litecoin balance from litecoinspace', async () => {
		expect(await snapshotUtxoBalance('t1', 'w-ltc', 'litecoin', LTC)).toBe(true);
		expect(fetched).toEqual([`https://litecoinspace.org/api/address/${LTC}`]);
		expect(snapshots()).toEqual([{
			walletId: 'w-ltc', chain: 'litecoin', totalUsd: 25 * LTC_PRICE,
			tokens: [{ symbol: 'LTC', amount: 25, priceUsd: LTC_PRICE, valueUsd: 25 * LTC_PRICE, tokenAddress: null }],
		}]);
	});
});

describe('Sync Tins (POST /api/import/btc-sync)', () => {
	it('snapshots every Bitcoin and Litecoin wallet by id, keeping base58 case, adding no wallet rows', async () => {
		state.wallets = [
			wallet('w-legacy', LEGACY, ['bitcoin']),
			wallet('w-bech', BECH32, ['bitcoin']),
			wallet('w-ltc', LTC, ['litecoin']),
			wallet('w-evm', EVM, ['ethereum', 'polygon']),
		];
		const res = await btcSyncPOST({ request: json({}) } as never);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toMatchObject({ snapshots: 3, failed: 0 });
		expect(snapshots().map((s) => [s.walletId, s.chain])).toEqual([
			['w-legacy', 'bitcoin'],
			['w-bech', 'bitcoin'],
			['w-ltc', 'litecoin'],
		]);
		expect(fetched.some((u) => u.includes(LEGACY.toLowerCase()))).toBe(false);
		expect(walletInserts()).toHaveLength(0);
	});

	it('an address passed in the body keeps its base58 case', async () => {
		await btcSyncPOST({ request: json({ address: ` ${LEGACY} ` }) } as never);
		expect(explorerCalls().length).toBeGreaterThan(0);
		expect(explorerCalls().every((u) => u.includes(LEGACY))).toBe(true);
		expect(priceCalls().some((u) => u.includes(LEGACY))).toBe(false); // a price request never names the address
	});
});

describe('weekly cron (GET /api/cron/sync-btc)', () => {
	it('snapshots Bitcoin (exact case) and Litecoin wallets and reports them synced', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		vi.stubEnv('CRON_SECRET', 'test-secret');
		state.wallets = [wallet('w-legacy', LEGACY, ['bitcoin']), wallet('w-ltc', LTC, ['litecoin'])];
		const pending = cronGET({
			request: new Request('https://app.test/api/cron/sync-btc', { headers: { 'x-cron-secret': 'test-secret' } }),
		} as never) as Promise<Response>;
		await vi.runAllTimersAsync();
		const body = await (await pending).json();

		expect(body).toMatchObject({ synced: 2, failed: 0 });
		expect(snapshots().map((s) => [s.walletId, s.chain])).toEqual([['w-legacy', 'bitcoin'], ['w-ltc', 'litecoin']]);
		expect(state.calls[0].sql).toMatch(/SELECT[\s\S]*\bchains\b[\s\S]*FROM wallets/);
		expect(walletInserts()).toHaveLength(0);
	});

	it('reports a wallet whose balance could not be read as failed, not synced', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		vi.stubEnv('CRON_SECRET', 'test-secret');
		state.wallets = [wallet('w-bad', LEGACY.toLowerCase(), ['bitcoin'])];
		const pending = cronGET({
			request: new Request('https://app.test/api/cron/sync-btc', { headers: { 'x-cron-secret': 'test-secret' } }),
		} as never) as Promise<Response>;
		await vi.runAllTimersAsync();
		expect(await (await pending).json()).toMatchObject({ synced: 0, failed: 1 });
	});
});

describe('wallet card refresh (GET /api/wallets/{id}/tokens?refreshMissing=1)', () => {
	it.each([
		['w-legacy', LEGACY, ['bitcoin'], 'bitcoin'],
		['w-ltc', LTC, ['litecoin'], 'litecoin'],
	])('stores the balance of a new %s wallet on its first load', async (id, address, chains, chain) => {
		state.wallets = [wallet(id, address, chains)];
		const url = new URL(`https://app.test/api/wallets/${id}/tokens?refreshMissing=1`);
		await tokensGET({ request: new Request(url), url, params: { id } } as never);
		expect(snapshots().map((s) => [s.walletId, s.chain])).toEqual([[id, chain]]);
	});
});

describe('POST /api/address-labels', () => {
	it('stores a base58 address with its case', async () => {
		await labelsPOST({ request: json({ address: LEGACY, label: 'Cold', category: 'own_wallet' }) } as never);
		const insert = state.calls.find((c) => /INSERT INTO address_labels/.test(c.sql))!;
		expect(insert.args[2]).toBe(LEGACY);
	});

	it('lowercases EVM and bech32', async () => {
		await labelsPOST({ request: json({ address: BECH32.toUpperCase(), label: 'Hot' }) } as never);
		expect(state.calls.find((c) => /INSERT INTO address_labels/.test(c.sql))!.args[2]).toBe(BECH32);
	});

	it('updates (and corrects) a label saved lowercased before, instead of adding a second one', async () => {
		state.labels = [{ id: 'old-label' }];
		await labelsPOST({ request: json({ address: LEGACY, label: 'Cold' }) } as never);
		const lookup = state.calls.find((c) => /SELECT id FROM address_labels/.test(c.sql))!;
		expect(lookup.sql).toMatch(/lower\(address\) = lower\(\?\)/);
		const update = state.calls.find((c) => /UPDATE address_labels/.test(c.sql))!;
		expect(update.args[0]).toBe(LEGACY);
		expect(update.args.slice(-2)).toEqual(['old-label', 't1']);
		expect(state.calls.some((c) => /INSERT INTO address_labels/.test(c.sql))).toBe(false);
	});
});

describe('autoClassify Pass 3 (Bitcoin outputs)', () => {
	it('matches a mixed-case legacy wallet and a label stored lowercased before this fix', async () => {
		const h1 = '1'.repeat(64);
		const h2 = '2'.repeat(64);
		state.wallets = [wallet('w-legacy', LEGACY, ['bitcoin'])];
		state.labels = [{ address: LEGACY_2.toLowerCase(), label: 'Old cold', category: 'own_wallet' }];
		state.importTxs = [
			{ id: 'tx1', description: 'send', tx_hash: h1, asset_symbol: 'BTC', amount: -0.1 },
			{ id: 'tx2', description: 'send', tx_hash: h2, asset_symbol: 'BTC', amount: -0.2 },
		];
		VOUTS[h1] = [OTHER, LEGACY];
		VOUTS[h2] = [LEGACY_2];

		expect(await autoClassifyOwnWalletTransfers('t1')).toBe(2);
	});
});

describe('every import_raw_rows / import_transactions insert in src names real columns', () => {
	// Same bug, other chains, out of this fix's scope (follow-up): the Snowtrace (Avalanche)
	// imports still name batch_id / raw_json. Solana's sync was fixed (tests/sync/solanaSync.test.ts).
	const KNOWN_BROKEN = new Set([
		'src/pages/api/import/snowtrace.ts',
		'src/pages/api/import/snowtrace-sync.ts',
	]);
	const ROOT = path.resolve(__dirname, '../..');
	const files: string[] = [];
	(function walk(dir: string) {
		for (const f of readdirSync(dir)) {
			const p = path.join(dir, f);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(ts|tsx|astro|mjs)$/.test(f)) files.push(p);
		}
	})(path.join(ROOT, 'src'));

	const offenders: string[] = [];
	for (const file of files) {
		const rel = path.relative(ROOT, file);
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(/INSERT INTO\s+(import_raw_rows|import_transactions)\s*\([^)]*\)/g)) {
			try {
				assertInsertColumnsExist(m[0], SCHEMA);
			} catch (e) {
				if (!KNOWN_BROKEN.has(rel)) offenders.push(`${rel}: ${(e as Error).message}`);
			}
		}
	}

	it('has no offenders outside the known follow-ups', () => {
		expect(offenders).toEqual([]);
	});
});
