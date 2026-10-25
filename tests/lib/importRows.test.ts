import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInsertColumnsExist, insertColumns, migrationColumns } from '../helpers/migrationColumns';
import { MemoryTables } from '../helpers/memoryTable';

/**
 * src/lib/importRows.ts, the one writer for import_raw_rows and import_transactions: it names only
 * columns the tables have, writes NULL for what a row leaves out (the time for imported_at and
 * created_at), skips rows the tenant already has, sends 100 statements per round trip, and saves
 * counterparties only on the tenant's own account. Every value is invented. No database.
 */

const SCHEMA = migrationColumns();
const NOW = `<to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')>`;

const state = vi.hoisted(() => ({
	tables: null as unknown as MemoryTables,
	batches: [] as Array<Array<{ sql: string; args: unknown[] }>>,
	calls: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/db', () => {
	const run = (sql: string, args: unknown[]) => {
		state.calls.push({ sql, args });
		assertInsertColumnsExist(sql, SCHEMA);
		if (/information_schema/i.test(sql)) return { rows: [{ name: 'import_transactions' }, { name: 'sui_transactions' }], rowsAffected: 0 };
		const n = state.tables.run(sql, args);
		return { rows: [], rowsAffected: n ?? 0 };
	};
	return {
		db: {
			execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, stmt.args ?? []),
			batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
				state.batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })));
				return stmts.map((s) => run(s.sql, s.args ?? []));
			},
		},
	};
});

import { insertImportBatch, IMPORT_BATCH_SIZE, type ImportTxRow } from '../../src/lib/importRows';

const TENANT = 'tenant-w';
const base = { tenantId: TENANT, accountId: 'acct-w', source: 'testsource', batchId: 'batch-w' };
const tx = (n: number, extra: Partial<ImportTxRow> = {}): ImportTxRow => ({
	timestampUtc: `2025-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, direction: 'in', rowHash: `h${n}`, ...extra,
});

beforeEach(() => {
	state.tables = new MemoryTables({
		import_raw_rows: [['id'], ['tenant_id', 'account_id', 'row_hash']],
		import_transactions: [['id'], ['tenant_id', 'account_id', 'row_hash']],
	});
	state.batches = [];
	state.calls = [];
});

describe('insertImportBatch', () => {
	it('names only columns the tables have and skips nothing but conflicts', async () => {
		const res = await insertImportBatch({ ...base, rawRows: [{ rowJson: '{"a":1}', rowHash: 'h1' }], rows: [tx(1)] });
		expect(res).toEqual({ rawInserted: [true], inserted: [true], insertedRaw: 1, insertedNormalized: 1 });
		for (const c of state.calls) {
			expect(c.sql).toMatch(/ON CONFLICT DO NOTHING/);
			expect(c.args).toContain(TENANT);
		}
		expect(insertColumns(state.calls[0].sql)!.table).toBe('import_raw_rows');
		expect(insertColumns(state.calls[1].sql)!.table).toBe('import_transactions');
	});

	it('writes NULL for what a row leaves out, and the time for imported_at and created_at', async () => {
		await insertImportBatch({ ...base, rawRows: [{ rowJson: '{}', rowHash: 'h1' }], rows: [tx(1)] });
		const [raw] = state.tables.table('import_raw_rows');
		expect(raw).toMatchObject({ tenant_id: TENANT, account_id: 'acct-w', import_batch_id: 'batch-w', source: 'testsource', row_json: '{}', row_hash: 'h1', imported_at: NOW });
		const [row] = state.tables.table('import_transactions');
		expect(row).toMatchObject({
			tenant_id: TENANT, source: 'testsource', account_id: 'acct-w', wallet_id: null, import_batch_id: 'batch-w',
			timestamp_utc: '2025-01-01T00:00:01.000Z', direction: 'in', row_hash: 'h1', created_at: NOW,
			description: null, currency: null, amount: null, to_currency: null, to_amount: null, native_currency: null,
			native_amount: null, native_usd: null, fee_usd: null, kind: null, tx_hash: null, asset_symbol: null,
			group_id: null, category: null, notes: null,
		});
		expect(row).not.toHaveProperty('is_duplicate');
		expect(String(row.id)).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('keeps the values a row gives, including ids, times and empty strings', async () => {
		await insertImportBatch({
			...base, walletId: 'wallet-w',
			rawRows: [{ id: 'raw-1', rowJson: '{}', rowHash: 'h1', importedAt: '2024-01-01 00:00:00' }],
			rows: [tx(1, { id: 'tx-1', createdAt: '2024-01-02T00:00:00.000Z', description: '', amount: -2.5, feeUsd: 0.1, category: 'liquidation', notes: 'n' })],
		});
		expect(state.tables.table('import_raw_rows')[0]).toMatchObject({ id: 'raw-1', imported_at: '2024-01-01 00:00:00' });
		expect(state.tables.table('import_transactions')[0]).toMatchObject({
			id: 'tx-1', wallet_id: 'wallet-w', created_at: '2024-01-02T00:00:00.000Z', description: '', amount: -2.5, fee_usd: 0.1, category: 'liquidation', notes: 'n',
		});
	});

	it('reports a row the tenant already has as not inserted, and leaves it unchanged', async () => {
		await insertImportBatch({ ...base, rows: [tx(1, { description: 'first' })] });
		const res = await insertImportBatch({ ...base, batchId: 'batch-2', rows: [tx(1, { description: 'second' }), tx(2)] });
		expect(res.inserted).toEqual([false, true]);
		expect(res.insertedNormalized).toBe(1);
		expect(state.tables.table('import_transactions').find((r) => r.row_hash === 'h1')).toMatchObject({ description: 'first', import_batch_id: 'batch-w' });
	});

	it(`sends ${IMPORT_BATCH_SIZE} statements per round trip, raw rows first`, async () => {
		const n = 2 * IMPORT_BATCH_SIZE + 50;
		const rows = Array.from({ length: n }, (_, i) => tx(i));
		const rawRows = rows.map((r) => ({ rowJson: '{}', rowHash: r.rowHash }));
		const res = await insertImportBatch({ ...base, rawRows, rows });
		expect(state.batches.map((b) => b.length)).toEqual([100, 100, 50, 100, 100, 50]);
		expect(state.batches.slice(0, 3).flat().every((s) => /import_raw_rows/.test(s.sql))).toBe(true);
		expect(res.insertedNormalized).toBe(n);
		expect(res.inserted).toHaveLength(n);
	});

	it('saves a counterparty only on the tenant’s own account, and only while it is empty', async () => {
		state.tables.table('import_transactions').push({ id: 'theirs', tenant_id: 'tenant-other', account_id: 'acct-w', source: 'testsource', row_hash: 'h1', counterparty_address: null });
		await insertImportBatch({ ...base, rows: [tx(1, { counterparty: 'addr-1' }), tx(2)] });
		const rows = state.tables.table('import_transactions');
		expect(rows.find((r) => r.tenant_id === TENANT && r.row_hash === 'h1')?.counterparty_address).toBe('addr-1');
		expect(rows.find((r) => r.id === 'theirs')?.counterparty_address).toBeNull();
		expect(rows.find((r) => r.row_hash === 'h2')?.counterparty_address).toBeUndefined();

		await insertImportBatch({ ...base, rows: [tx(1, { counterparty: 'addr-later' })] });
		expect(rows.find((r) => r.tenant_id === TENANT && r.row_hash === 'h1')?.counterparty_address).toBe('addr-1');
	});

	it('sends no counterparty statement when no row has one, or when there is no account', async () => {
		await insertImportBatch({ ...base, rows: [tx(1)] });
		await insertImportBatch({ ...base, accountId: null, rows: [tx(2, { counterparty: 'addr-2' })] });
		expect(state.calls.some((c) => /counterparty_address|information_schema/.test(c.sql))).toBe(false);
	});

	it('refuses a batch without a tenant', async () => {
		await expect(insertImportBatch({ ...base, tenantId: '', rows: [tx(1)] })).rejects.toThrow(/tenantId/);
		expect(state.calls).toHaveLength(0);
	});
});
