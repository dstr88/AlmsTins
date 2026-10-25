import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, insertColumns, migrationColumns } from '../helpers/migrationColumns';

/**
 * Regression: neither Avalanche importer ever saved a row.
 *
 * POST /api/import/snowtrace (CSV upload) and POST /api/import/snowtrace-sync (Routescan fetch)
 * wrote import_raw_rows with columns batch_id and raw_json; the table has import_batch_id and
 * row_json (migrations/0001_crypto_com.sql), the same bug #18 fixed for Solana. The raw insert
 * runs first, so both routes threw there and stored nothing. The CSV route also left `source`
 * (NOT NULL) out of its import_transactions insert and logged an undeclared `skippedDuplicates`,
 * so even past the raw insert it could not have saved a row or answered 200.
 *
 * The db stub below throws, as Postgres does, on any column the migrations never created.
 * Every address and hash here is invented. No database, no network.
 */

const SCHEMA = (() => {
	const all = migrationColumns();
	return new Map(['import_raw_rows', 'import_transactions', 'exchange_accounts'].map((t) => [t, all.get(t)!]));
})();

const TENANT = 'tenant-avax';
const OWN = '0x' + 'a1'.repeat(20);
const SENDER = '0x' + 'b2'.repeat(20);
const SHOP = '0x' + 'c3'.repeat(20);
const HASH_IN = '0x' + '1'.repeat(64);
const HASH_OUT = '0x' + '2'.repeat(64);

const state = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; args: unknown[] }> }));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		state.calls.push({ sql, args });
		assertInsertColumnsExist(sql, SCHEMA);
		if (/FROM exchange_accounts/i.test(sql)) return { rows: [{ id: 'acct-avax' }], rowsAffected: 0 };
		if (/^\s*SELECT/i.test(sql)) return { rows: [], rowsAffected: 0 };
		return { rows: [], rowsAffected: 1 };
	};
	return {
		db: {
			execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => stmts.map((s) => run(s.sql, s.args ?? [])),
		},
	};
});
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT, isDemo: false }) }));
vi.mock('@/lib/cexSnapshot', () => ({ snapshotCexAccount: vi.fn(async () => {}) }));
vi.mock('@/lib/transferMatcher', () => ({ runTransferMatching: vi.fn(async () => {}) }));
vi.mock('@/lib/autoClassify', () => ({ autoClassifyOwnWalletTransfers: vi.fn(async () => 0) }));
vi.mock('@/lib/activityLog', () => ({ logActivity: vi.fn() }));

import { POST as uploadCsv } from '../../src/pages/api/import/snowtrace';
import { POST as syncRoutescan } from '../../src/pages/api/import/snowtrace-sync';

const inserts = (table: string) => state.calls.filter((c) => insertColumns(c.sql)?.table === table);

function expectSavedRows(count: number) {
	const raw = inserts('import_raw_rows');
	expect(raw).toHaveLength(count);
	expect(insertColumns(raw[0].sql)!.columns).toEqual(expect.arrayContaining(['import_batch_id', 'row_json', 'source']));
	const txs = inserts('import_transactions');
	expect(txs).toHaveLength(count);
	expect(insertColumns(txs[0].sql)!.columns).toEqual(expect.arrayContaining(['source', 'import_batch_id', 'direction', 'row_hash']));
	const cols = insertColumns(txs[0].sql)!.columns;
	expect(txs[0].args[cols.indexOf('source')]).toBe('avalanche_cchain');
	// Every statement the route sends is scoped by the tenant.
	for (const c of state.calls) expect(c.args).toContain(TENANT);
}

beforeEach(() => {
	state.calls = [];
});

const HEADER = [
	'Transaction Hash', 'Blockno', 'UnixTimestamp', 'DateTime (UTC)', 'From', 'To', 'ContractAddress',
	'Value_IN(AVAX)', 'Value_OUT(AVAX)', 'CurrentValue/AVAX', 'TxnFee(AVAX)', 'TxnFee(USD)',
	'Historical $Price/AVAX', 'Status', 'ErrCode', 'Method', 'ChainId', 'Chain', 'Value(AVAX)',
];
const csvLine = (hash: string, from: string, to: string, valueIn: string, valueOut: string) =>
	[hash, '1', '1760000000', '2025-10-09T08:53:20.000Z', from, to, '', valueIn, valueOut, '', '0', '0', '20', '', '', 'Transfer', '43114', 'C', ''].join('\t');

describe('POST /api/import/snowtrace (CSV upload)', () => {
	it('saves the raw rows and the transactions, naming only columns the tables have', async () => {
		const tsv = [HEADER.join('\t'), csvLine(HASH_IN, SENDER, OWN, '2', '0'), csvLine(HASH_OUT, OWN, SHOP, '0', '0.5')].join('\n');
		const form = new FormData();
		form.set('file', new File([tsv], 'export.csv', { type: 'text/csv' }));
		const res = await uploadCsv({ request: new Request('https://almstins.test/api/import/snowtrace', { method: 'POST', body: form }) } as never);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ accountId: 'acct-avax', insertedRaw: 2, insertedNormalized: 2, skippedDuplicates: 0 });
		expectSavedRows(2);
	});
});

describe('POST /api/import/snowtrace-sync (Routescan)', () => {
	it('saves the raw rows and the transactions, naming only columns the tables have', async () => {
		vi.stubEnv('SNOWTRACE_API_KEY', 'test-key');
		const txlist = [
			{ hash: HASH_IN, timeStamp: '1760000000', from: SENDER, to: OWN, value: '2000000000000000000', isError: '0', txreceipt_status: '1' },
			{ hash: HASH_OUT, timeStamp: '1760000060', from: OWN, to: SHOP, value: '500000000000000000', isError: '0', txreceipt_status: '1' },
		];
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: '1', message: 'OK', result: txlist })));
		vi.stubGlobal('fetch', fetchMock);

		const res = await syncRoutescan({
			request: new Request('https://almstins.test/api/import/snowtrace-sync', { method: 'POST', body: JSON.stringify({ address: OWN }) }),
		} as never);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ inserted: 2, fetched: 2, wallet: OWN });
		expectSavedRows(2);
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/api\.routescan\.io\//);
	});
});
