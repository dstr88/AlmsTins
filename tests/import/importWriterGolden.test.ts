import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables, type MemRow } from '../helpers/memoryTable';

/**
 * Every importer and sync that writes import_raw_rows / import_transactions, run on a fixed
 * fixture, and the rows it stores compared column by column with a saved copy
 * (tests/import/__golden__/*.json). The copies were recorded from the inline INSERTs each writer
 * had before src/lib/importRows.ts existed, so moving a writer onto the shared one must leave
 * them unchanged: same columns, same values, same counts in the response.
 *
 * A stored row lists every column of the table. One the INSERT left out holds the table default
 * (imported_at and created_at: the UTC time as `<to_char(…)>`, the expression the Postgres schema
 * has, src/scripts/sqliteSchemaToPg.mjs; is_duplicate: 0; anything else: null). Random ids are
 * replaced by `<uuid:N>` in order of first appearance, so a row's id, its batch and its account
 * are still told apart. Rerecord (only on purpose) with UPDATE_IMPORT_GOLDEN=1.
 *
 * Every address, amount and hash here is invented. No database, no network.
 */

// Pinned to UTC, the zone the server and CI run in: some exports (Venmo) carry times without a
// zone, which the importer reads in the process's local zone, so a recording made on a machine in
// another zone would not match CI.
process.env.TZ = 'UTC';

const SCHEMA = migrationColumns();
const TABLES = ['import_raw_rows', 'import_transactions'] as const;
const NOW = `<to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')>`;
const DEFAULTS: Record<string, Record<string, unknown>> = {
	import_raw_rows: { imported_at: NOW },
	import_transactions: { created_at: NOW, is_duplicate: 0 },
};
const GOLDEN_DIR = path.resolve(__dirname, '__golden__');

const TENANT = 'tenant-golden';
const ACCT = 'acct-golden';

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	fetch: (async () => new Response('not found', { status: 404 })) as (url: string, init?: { body?: string }) => Promise<Response>,
	claude: '' as string,
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		assertInsertColumnsExist(sql, SCHEMA);
		if (/information_schema/i.test(sql)) return { rows: [{ name: 'import_transactions' }, { name: 'sui_transactions' }], rowsAffected: 0 };
		const n = state.tables.run(sql, args);
		if (n !== null) return { rows: [], rowsAffected: n };
		if (/FROM exchange_accounts/i.test(sql)) return { rows: [{ id: ACCT }], rowsAffected: 0 };
		if (/FROM transaction_screenshots/i.test(sql)) return { rows: [{ id: 'shot-1', mime_type: 'image/png', data: 'aGVsbG8=' }], rowsAffected: 0 };
		if (/^\s*SELECT/i.test(sql)) return { rows: [], rowsAffected: 0 };
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
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT, isDemo: false }) }));
vi.mock('@/lib/cexSnapshot', () => ({ snapshotCexAccount: vi.fn(async () => {}) }));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/lifecycle', () => ({ rebuildAssetLifecycles: vi.fn(async () => {}) }));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: async () => [{ symbol: 'BTC', quotes: { USD: { price: 50_000 } } }] }));
vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = { create: async () => ({ content: [{ type: 'text', text: state.claude }] }) };
	},
}));

beforeEach(() => {
	state.tables = new MemoryTables({
		import_raw_rows: [['id'], ['row_hash']],
		import_transactions: [['id'], ['row_hash']],
	});
	vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => state.fetch(String(url), init)));
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every column of each table, defaults filled, rows in a stable order, random ids numbered. */
function stored(response: unknown) {
	const out: Record<string, unknown> = { response };
	for (const t of TABLES) {
		const cols = [...SCHEMA.get(t)!].sort();
		out[t] = state.tables
			.table(t)
			.map((r: MemRow) => Object.fromEntries(cols.map((c) => [c, c in r ? r[c] : (DEFAULTS[t][c] ?? null)])))
			.sort((a, b) => `${a.row_hash}|${a.direction ?? ''}`.localeCompare(`${b.row_hash}|${b.direction ?? ''}`));
	}
	const ids = new Map<string, string>();
	const text = JSON.stringify(out, (_k, v) => {
		if (typeof v !== 'string' || !UUID.test(v)) return v;
		if (!ids.has(v)) ids.set(v, `<uuid:${ids.size + 1}>`);
		return ids.get(v);
	}, '\t');
	return JSON.parse(text) as Record<string, unknown>;
}

function expectGolden(name: string, value: Record<string, unknown>) {
	const file = path.join(GOLDEN_DIR, `${name}.json`);
	if (process.env.UPDATE_IMPORT_GOLDEN === '1') {
		mkdirSync(GOLDEN_DIR, { recursive: true });
		writeFileSync(file, JSON.stringify(value, null, '\t') + '\n');
	}
	const golden = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	expect(value).toEqual(golden);
	// A fixture that stored nothing would prove nothing.
	expect((value.import_transactions as unknown[]).length).toBeGreaterThan(0);
}

async function upload(route: { POST: (ctx: never) => Promise<Response> | Response }, csv: string, name = 'export.csv') {
	const form = new FormData();
	form.set('file', new File([csv], name, { type: 'text/csv' }));
	form.set('accountId', ACCT);
	const res = await route.POST({ request: new Request('https://almstins.test/api/import', { method: 'POST', body: form }) } as never);
	expect(res.status).toBe(200);
	return res.json();
}

/** The CSV file each exchange importer reads, with a duplicate row to exercise the skip count. */
const CSV: Record<string, string> = {
	coinbase: [
		'Transactions',
		'User,tester',
		'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
		'a1,2025-01-02 03:04:05 UTC,Buy,BTC,0.002,USD,$40000.00,$80.00,$81.50,$1.50,Bought 0.002 BTC',
		'a2,2025-02-03 04:05:06 UTC,Sell,ETH,0.5,USD,$2000.00,"$1,000.00","$990.00",$10.00,Sold 0.5 ETH',
		'a3,2025-03-04 05:06:07 UTC,Retail Staking Transfer,SOL,-3,USD,$100.00,$300.00,$300.00,$0.00,',
		'a4,2025-03-04 05:06:07 UTC,Retail Staking Transfer,SOL,3,USD,$100.00,$300.00,$300.00,$0.00,',
		'a5,2025-01-02 03:04:05 UTC,Buy,BTC,0.002,USD,$40000.00,$80.00,$81.50,$1.50,Bought 0.002 BTC',
	].join('\n'),
	cashapp: [
		'Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Asset Type,Asset Price,Asset Amount,Status',
		'ca1,2025-01-05 10:00:00 EST,Bitcoin Buy,USD,-$97.75,-$2.25,-$100.00,BTC,"$48,875.00",0.002 BTC,COMPLETE',
		'ca2,2025-02-06 11:00:00 PST,Bitcoin Withdrawal,USD,,,,BTC,"$50,000.00",0.001 BTC,COMPLETE',
		'ca3,2025-03-07 12:00:00 UTC,Bitcoin Sold,USD,$55.00,-$1.00,$54.00,BTC,"$55,000.00",0.001 BTC,COMPLETE',
		'ca4,2025-03-08 12:00:00 UTC,Cash Card Debit,USD,-$5.00,,,,,,COMPLETE',
		'ca1,2025-01-05 10:00:00 EST,Bitcoin Buy,USD,-$97.75,-$2.25,-$100.00,BTC,"$48,875.00",0.002 BTC,COMPLETE',
	].join('\n'),
	'crypto-com': [
		'Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash',
		'2025-01-10 08:00:00,Buy BTC,USD,-100,BTC,0.002,USD,100,100,crypto_purchase,',
		'2025-01-11 09:00:00,ETH -> SOL,ETH,-0.1,SOL,2,USD,250,250,crypto_exchange,',
		'2025-01-12 10:00:00,Withdraw ETH,ETH,-0.05,,,USD,120,120,crypto_withdrawal,0x' + 'ab'.repeat(32),
		'2025-01-13 11:00:00,Card Top Up,USD,50,,,USD,50,50,card_top_up,',
		'2025-01-10 08:00:00,Buy BTC,USD,-100,BTC,0.002,USD,100,100,crypto_purchase,',
	].join('\n'),
	exodus: [
		'DATE,TYPE,FROMPORTFOLIO,TOPORTFOLIO,OUTAMOUNT,OUTCURRENCY,FEEAMOUNT,FEECURRENCY,TOADDRESS,OUTTXID,OUTTXURL,INAMOUNT,INCURRENCY,INTXID,INTXURL,ORDERID,PERSONALNOTE',
		'2025-04-01T10:00:00.000Z,exchange,,,0.01,BTC,0.0001,BTC,,txout1,,0.2,ETH,txin1,,ord1,',
		'2025-04-02T10:00:00.000Z,deposit,,,,,,,,,,1.5,SOL,txin2,,,',
		'2025-04-03T10:00:00.000Z,withdrawal,,,0.3,SOL,0.001,SOL,,txout3,,,,,,,',
		'2025-04-02T10:00:00.000Z,deposit,,,,,,,,,,1.5,SOL,txin2,,,',
	].join('\n'),
	gemini: [
		'Date,Time (UTC),Type,Symbol,Specification,Liquidity Indicator,Trading Fee Rate (bps),USD Amount USD,Fee (USD) USD,USD Balance USD,BTC Amount BTC,Fee (BTC) BTC,BTC Balance BTC,Tx Hash',
		'2025-05-01,10:00:00.000,Buy,BTCUSD,Exchange,Taker,35,($100.00),$0.35,$900.00,0.002 BTC,,0.002 BTC,',
		'2025-05-02,11:00:00.000,Credit,BTC,Staking Reward,,,,,,0.0001 BTC,,0.0021 BTC,',
		'2025-05-03,12:00:00.000,Debit,BTC,Withdrawal (BTC),,,,,,(0.001 BTC),,0.0011 BTC,' + 'cd'.repeat(32),
		'2025-05-04,13:00:00.000,Credit,USD,Deposit (ACH),,,$500.00,,"$1,400.00",,,,',
		'2025-05-01,10:00:00.000,Buy,BTCUSD,Exchange,Taker,35,($100.00),$0.35,$900.00,0.002 BTC,,0.002 BTC,',
	].join('\n'),
	kraken: [
		'"txid","refid","time","type","subtype","aclass","asset","amount","fee","balance"',
		'"L1","R1","2025-06-01 10:00:00","trade","","currency","ZUSD","-100.0000","0.2600","900.0000"',
		'"L2","R1","2025-06-01 10:00:00","trade","","currency","XXBT","0.0020000000","0.0000000000","0.0020000000"',
		'"L3","R2","2025-06-02 10:00:00","staking","","currency","DOT.S","0.5000000000","0.0000000000","0.5000000000"',
		'"L4","R3","2025-06-03 10:00:00","withdrawal","","currency","XETH","-0.0500000000","0.0010000000","0.0000000000"',
	].join('\n'),
	robinhood: [
		'Date,Transaction,Symbol,Quantity,Price,Amount',
		'2025-07-01T10:00:00Z,Buy,DOGE,100,0.10,$10.00',
		'2025-07-02T10:00:00Z,Sell,DOGE,40,0.12,$4.80',
		'2025-07-01T10:00:00Z,Buy,DOGE,100,0.10,$10.00',
	].join('\n'),
	venmo: [
		'DateTime,Transaction Type,Asset In (Quantity),Asset In (Currency),Asset Out (Quantity),Asset Out (Currency),Transaction Fee (Quantity),Transaction Fee (Currency),Market Value (USD)',
		'2025-08-01 10:00:00,BUY,0.001,BTC,50,USD,0.5,USD,50',
		'2025-08-02 10:00:00,SELL,25,USD,0.0005,BTC,0.25,USD,25',
		'2025-08-01 10:00:00,BUY,0.001,BTC,50,USD,0.5,USD,50',
	].join('\n'),
	'wallet-fa58b': [
		'Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash',
		'2025-09-01 08:00:00,Received CRO,CRO,100,,,USD,9,9,crypto_deposit,',
		'2025-09-02 09:00:00,Sent CRO,CRO,-40,,,USD,3.6,3.6,crypto_withdrawal,0x' + 'ef'.repeat(32),
		'2025-09-01 08:00:00,Received CRO,CRO,100,,,USD,9,9,crypto_deposit,',
	].join('\n'),
};

describe('exchange importers store the same rows as before the shared writer', () => {
	for (const name of Object.keys(CSV)) {
		it(name, async () => {
			const route = await import(`../../src/pages/api/import/${name}.ts`);
			const body = await upload(route, CSV[name]);
			expectGolden(`import-${name}`, stored(body));
		});
	}
});

describe('Avalanche importers', () => {
	const OWN = '0x' + 'a1'.repeat(20);
	const SENDER = '0x' + 'b2'.repeat(20);
	const SHOP = '0x' + 'c3'.repeat(20);

	it('snowtrace (CSV)', async () => {
		const header = [
			'Transaction Hash', 'Blockno', 'UnixTimestamp', 'DateTime (UTC)', 'From', 'To', 'ContractAddress',
			'Value_IN(AVAX)', 'Value_OUT(AVAX)', 'CurrentValue/AVAX', 'TxnFee(AVAX)', 'TxnFee(USD)',
			'Historical $Price/AVAX', 'Status', 'ErrCode', 'Method', 'ChainId', 'Chain', 'Value(AVAX)',
		];
		const line = (hash: string, from: string, to: string, valueIn: string, valueOut: string, status = '') =>
			[hash, '1', '1760000000', '2025-10-09T08:53:20.000Z', from, to, '', valueIn, valueOut, '', '0', '0', '20', status, '', 'Transfer', '43114', 'C', ''].join('\t');
		const tsv = [
			header.join('\t'),
			line('0x' + '1'.repeat(64), SENDER, OWN, '2', '0'),
			line('0x' + '2'.repeat(64), OWN, SHOP, '0', '0.5'),
			line('0x' + '3'.repeat(64), OWN, SHOP, '0', '0.7', 'FALSE'),
			line('0x' + '1'.repeat(64), SENDER, OWN, '2', '0'),
		].join('\n');
		const route = await import('../../src/pages/api/import/snowtrace');
		expectGolden('import-snowtrace', stored(await upload(route, tsv)));
	});

	it('snowtrace-sync (Routescan)', async () => {
		vi.stubEnv('SNOWTRACE_API_KEY', 'test-key');
		const txlist = [
			{ hash: '0x' + '4'.repeat(64), timeStamp: '1760000000', from: SENDER, to: OWN, value: '2000000000000000000', isError: '0', txreceipt_status: '1', functionName: 'transfer(address,uint256)' },
			{ hash: '0x' + '5'.repeat(64), timeStamp: '1760000060', from: OWN, to: SHOP, value: '500000000000000000', isError: '0', txreceipt_status: '1' },
			{ hash: '0x' + '6'.repeat(64), timeStamp: '1760000120', from: OWN, to: SHOP, value: '0', isError: '0', txreceipt_status: '1' },
		];
		state.fetch = async () => new Response(JSON.stringify({ status: '1', message: 'OK', result: txlist }));
		const route = await import('../../src/pages/api/import/snowtrace-sync');
		const res = await route.POST({
			request: new Request('https://almstins.test/api/import/snowtrace-sync', { method: 'POST', body: JSON.stringify({ address: OWN }) }),
		} as never);
		expect(res.status).toBe(200);
		expectGolden('import-snowtrace-sync', stored(await res.json()));
	});
});

describe('chain syncs', () => {
	it('Bitcoin', async () => {
		const own = 'bc1qmywa11etqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
		const payer = 'bc1qpayerssssssssssssssssssssssssssssss';
		const shop = '1ShopLegacyMixedCaseAddr2345678';
		const txs = [
			{ txid: 'aa'.repeat(32), status: { confirmed: true, block_time: 1_760_000_000 },
				vin: [{ prevout: { scriptpubkey_address: payer, value: 60_000 } }],
				vout: [{ scriptpubkey_address: own, value: 50_000 }, { scriptpubkey_address: payer, value: 9_000 }] },
			{ txid: 'bb'.repeat(32), status: { confirmed: true, block_time: 1_760_000_600 },
				vin: [{ prevout: { scriptpubkey_address: own, value: 50_000 } }],
				vout: [{ scriptpubkey_address: own, value: 20_000 }, { scriptpubkey_address: shop, value: 29_000 }] },
		];
		state.fetch = async (url) => {
			if (url.endsWith(`/address/${own}`)) return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: 50_000, spent_txo_sum: 30_000 } }));
			if (url.endsWith(`/address/${own}/txs`)) return new Response(JSON.stringify(txs));
			// Each row's day price (CoinGecko, src/lib/sync/utxoHistoricalPrice.ts), the same $50,000.
			if (url.includes('/coins/bitcoin/market_chart/range')) return new Response(JSON.stringify({ prices: [[1_760_011_200_000, 50_000]] }));
			return new Response('[]');
		};
		const { syncBtcAddress } = await import('../../src/lib/sync/syncBtcAddress');
		// Within the public CoinGecko API's 365 days, so the day price is looked up.
		vi.useFakeTimers({ toFake: ['Date'], now: new Date('2025-10-20T00:00:00Z') });
		const result = await syncBtcAddress(TENANT, own, 'wallet-btc').finally(() => vi.useRealTimers());
		expectGolden('sync-bitcoin', stored(result));
	});

	it('Solana', async () => {
		const own = 'Wa11etMine' + 'A'.repeat(34);
		const sender = 'SenderXyz' + 'B'.repeat(35);
		const shop = 'ShopQrs' + 'C'.repeat(37);
		const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
		const txs: Record<string, unknown> = {
			'sig-receive': {
				blockTime: 1_760_000_000,
				meta: { err: null, fee: 5_000, preBalances: [10_000_000_000, 1_000_000_000], postBalances: [7_999_995_000, 3_000_000_000], preTokenBalances: [], postTokenBalances: [] },
				transaction: { message: { accountKeys: [{ pubkey: sender }, { pubkey: own }] } },
			},
			'sig-send': {
				blockTime: 1_760_000_060,
				meta: {
					err: null, fee: 5_000, preBalances: [1_000_000_000, 2_039_280, 2_039_280], postBalances: [999_995_000, 2_039_280, 2_039_280],
					preTokenBalances: [
						{ accountIndex: 1, mint: usdc, owner: own, uiTokenAmount: { uiAmount: 100, decimals: 6 } },
						{ accountIndex: 2, mint: usdc, owner: shop, uiTokenAmount: { uiAmount: 5, decimals: 6 } },
					],
					postTokenBalances: [
						{ accountIndex: 1, mint: usdc, owner: own, uiTokenAmount: { uiAmount: 75, decimals: 6 } },
						{ accountIndex: 2, mint: usdc, owner: shop, uiTokenAmount: { uiAmount: 30, decimals: 6 } },
					],
				},
				transaction: { message: { accountKeys: [{ pubkey: own }, { pubkey: 'OwnUsdcAta' }, { pubkey: 'ShopUsdcAta' }] } },
			},
		};
		state.fetch = async (_url, init) => {
			const { method, params } = JSON.parse(init?.body ?? '{}') as { method: string; params: unknown[] };
			if (method === 'getSignaturesForAddress') return new Response(JSON.stringify({ result: [{ signature: 'sig-send' }, { signature: 'sig-receive' }] }));
			if (method === 'getTransaction') return new Response(JSON.stringify({ result: txs[String(params[0])] ?? null }));
			return new Response(JSON.stringify({ result: null }));
		};
		const { syncSolanaAddress } = await import('../../src/lib/sync/syncSolanaTransactions');
		const result = await syncSolanaAddress(TENANT, { id: 'wallet-sol', address: own } as never);
		expectGolden('sync-solana', stored(result));
	});
});

describe('other writers', () => {
	it('Aave liquidations', async () => {
		const item = (txHash: string, timestamp: number) => ({
			__typename: 'UserLiquidationCallTransaction',
			txHash,
			timestamp,
			blockExplorerUrl: 'https://explorer.test/tx',
			collateral: { amount: { amount: { value: '5000000000000000', decimals: 18 }, usd: '14.00', usdPerToken: '2800' }, reserve: { underlyingToken: { symbol: 'WETH', address: '0x' + 'e'.repeat(40) } } },
			debtRepaid: { amount: { amount: { value: '13300000', decimals: 6 }, usd: '13.30' }, reserve: { underlyingToken: { symbol: 'USDC' } } },
		});
		state.fetch = async (_url, init) => {
			const chainId = (JSON.parse(init?.body ?? '{}') as { variables: { request: { chainId: number } } }).variables.request.chainId;
			const items = chainId === 1 ? [item('0x' + '7'.repeat(64), 1_760_000_000)] : chainId === 43114 ? [item('0x' + '8'.repeat(64), 1_760_100_000)] : [];
			return new Response(JSON.stringify({ data: { userTransactionHistory: { items, pageInfo: { next: null } } } }));
		};
		const { syncLiquidationsToImportTransactions } = await import('../../src/lib/aave/syncAaveLiquidations');
		const imported = await syncLiquidationsToImportTransactions(TENANT, '0x' + 'f'.repeat(40));
		const again = await syncLiquidationsToImportTransactions(TENANT, '0x' + 'f'.repeat(40));
		expectGolden('aave-liquidations', stored({ imported, again }));
	});

	const parsedShot = {
		source: 'Crypto.com', timestampUtc: '2025-10-01T12:00:00Z', description: 'Bitcoin Purchase', currency: 'BTC',
		amount: 0.001, direction: 'in', kind: 'crypto_purchase', nativeUsd: 60, feeUsd: 0.5, txHash: null,
	};

	it('portfolio screenshot import', async () => {
		state.claude = JSON.stringify(parsedShot);
		const route = await import('../../src/pages/api/portfolio/import-screenshot');
		const send = async () => {
			const form = new FormData();
			form.set('file', new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
			const res = await route.POST({ request: new Request('https://almstins.test/x', { method: 'POST', body: form }) } as never);
			expect(res.status).toBe(200);
			return res.json();
		};
		expectGolden('screenshot-portfolio', stored({ first: await send(), second: await send() }));
	});

	it('transaction screenshot parse', async () => {
		state.claude = JSON.stringify({ ...parsedShot, source: 'coinbase', txHash: 'cb-123', feeUsd: null });
		const route = await import('../../src/pages/api/transactions/screenshots/parse');
		const res = await route.POST({
			request: new Request('https://almstins.test/x', { method: 'POST', body: JSON.stringify({ screenshotId: 'shot-1' }) }),
		} as never);
		expect(res.status).toBe(200);
		expectGolden('screenshot-parse', stored(await res.json()));
	});
});

describe('demo seed', () => {
	it('stores the demo account’s imported transactions', async () => {
		vi.doMock('../../src/lib/authSession', () => ({ getAuthSession: async () => null }));
		vi.doMock('../../src/lib/tursoCache', () => ({ setCache: async () => {} }));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { GET } = await import('../../src/pages/api/demo/start');
		const res = (await GET({ request: new Request('https://almstins.test/api/demo/start') } as never)) as Response;
		expect(res.status).toBe(302);
		expectGolden('demo-start', stored(null));
	});
});
