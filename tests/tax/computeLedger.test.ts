/**
 * computeLedger: which engine a tenant reads, one run of the ledger over the whole history with a
 * snapshot at the end of every year, and the short-lived memo that keeps a page's several reads of
 * it (one per year, for the carryforward) from running it again. The database is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeLedger, engineForTenant, invalidateLedger, ledgerMemo } from '../../src/lib/tax/computeLedger';
import { db } from '../../src/lib/db';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const T1 = 'tenant-1';
const T2 = 'tenant-2';

function events() {
	const base = { asset_symbol: 'ETH', group_id: 'g', tx_hash: null, source_type: 'import', import_source: 'coinbase', import_account_id: 'acct-1' };
	return [
		{ ...base, direction: 'in', amount: 2, native_usd: 4_000, timestamp_utc: '2021-05-01T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'b1', import_kind: 'Buy' },
		{ ...base, direction: 'out', amount: 1, native_usd: 3_000, timestamp_utc: '2023-02-01T00:00:00Z', transaction_class: 'other', source_id: 's1', import_kind: 'Sell' },
	];
}

let lifecycleReads = 0;
function setup(opts: { runs?: object[]; runsError?: Error } = {}) {
	lifecycleReads = 0;
	mockExecute.mockImplementation((arg: { sql?: string } | string) => {
		const sql = typeof arg === 'string' ? arg : arg.sql ?? '';
		if (sql.includes('/* tax:source */')) return opts.runsError ? Promise.reject(opts.runsError) : Promise.resolve({ rows: opts.runs ?? [] });
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) {
			lifecycleReads++;
			return Promise.resolve({ rows: events() });
		}
		return Promise.resolve({ rows: [] });
	});
}

describe('engineForTenant', () => {
	beforeEach(() => vi.resetAllMocks());

	it('is the pipeline for a tenant with a successful run, scoped to that tenant', async () => {
		setup({ runs: [{ one: 1 }] });
		expect(await engineForTenant(T1)).toBe('pipeline');
		const call = mockExecute.mock.calls.find(([a]) => String((a as { sql: string }).sql).includes('/* tax:source */'))?.[0] as { sql: string; args: unknown[] };
		expect(call.args).toEqual([T1]);
		expect(call.sql).toMatch(/status = 'success'/);
	});

	it('is the lifecycle for a tenant that has never run it, or whose runs table is missing', async () => {
		setup({ runs: [] });
		expect(await engineForTenant(T1)).toBe('lifecycle');
		setup({ runsError: new Error('relation "tax_pipeline_runs" does not exist') });
		expect(await engineForTenant(T1)).toBe('lifecycle');
	});
});

describe('computeLedger', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		ledgerMemo.enabled = false;
	});
	afterEach(() => {
		ledgerMemo.enabled = process.env.NODE_ENV !== 'test';
	});

	it('runs the whole history once and snapshots the end of every year from the first event through this year', async () => {
		setup();
		const { engine, result } = await computeLedger(T1, 'lifecycle');
		expect(engine).toBe('lifecycle');
		const thisYear = new Date().getUTCFullYear();
		const years = result.snapshots.map((s) => Number(s.at.slice(0, 4)));
		expect(years[0]).toBe(2021);
		expect(years[years.length - 1]).toBe(thisYear);
		expect(years).toEqual([...Array(thisYear - 2021 + 1).keys()].map((i) => 2021 + i));
		// 2 ETH bought in 2021, 1 sold in 2023: 2 held at the end of 2021 and 2022, 1 from 2023 on.
		const held = (y: number) => result.snapshots.find((s) => s.at.startsWith(`${y}-`))?.lots.reduce((a, l) => a + l.qty, 0);
		expect([held(2021), held(2022), held(2023), held(thisYear)]).toEqual([2, 2, 1, 1]);
	});

	it('reads the lifecycle rows of the whole history, not one year', async () => {
		setup();
		await computeLedger(T1, 'lifecycle');
		const q = mockExecute.mock.calls.map(([a]) => a as { sql: string; args?: unknown[] }).find((a) => a.sql?.includes('LEFT JOIN asset_lifecycle_groups'));
		expect(q?.args).toEqual([T1]);
		expect(q?.sql).not.toMatch(/timestamp_utc\s*(<=|>=|<|>)\s*\?/);
	});

	it('scopes every join to the tenant', async () => {
		setup();
		await computeLedger(T1, 'lifecycle');
		const q = mockExecute.mock.calls.map(([a]) => a as { sql: string }).find((a) => a.sql?.includes('LEFT JOIN asset_lifecycle_groups'));
		for (const alias of ['g', 'i', 't']) expect(q?.sql).toMatch(new RegExp(`${alias}\\.tenant_id = e\\.tenant_id`));
	});

	describe('the memo', () => {
		beforeEach(() => {
			ledgerMemo.enabled = true;
			invalidateLedger(T1);
			invalidateLedger(T2);
		});

		it('serves a second read of the same tenant, engine, method and pins without reading again', async () => {
			setup();
			const a = await computeLedger(T1, 'lifecycle');
			const b = await computeLedger(T1, 'lifecycle');
			expect(b).toBe(a);
			expect(lifecycleReads).toBe(1);
		});

		it('keeps results apart by method, pins and tenant', async () => {
			setup();
			await computeLedger(T1, 'lifecycle', 'fifo');
			await computeLedger(T1, 'lifecycle', 'hifo');
			await computeLedger(T1, 'lifecycle', 'spec_id', new Map([['s1', { acquiredAt: '2021-05-01T00:00:00Z', amountHint: 1 }]]));
			await computeLedger(T2, 'lifecycle', 'fifo');
			expect(lifecycleReads).toBe(4);
		});

		it('drops a tenant\'s results when its data changes, and only that tenant\'s', async () => {
			setup();
			await computeLedger(T1, 'lifecycle');
			await computeLedger(T2, 'lifecycle');
			expect(lifecycleReads).toBe(2);
			invalidateLedger(T1);
			await computeLedger(T1, 'lifecycle');
			await computeLedger(T2, 'lifecycle');
			expect(lifecycleReads).toBe(3);
		});

		it('does not keep a run that failed', async () => {
			mockExecute.mockImplementation(() => Promise.reject(new Error('db down')));
			await expect(computeLedger(T1, 'lifecycle')).rejects.toThrow('db down');
			setup();
			await expect(computeLedger(T1, 'lifecycle')).resolves.toBeDefined();
			expect(lifecycleReads).toBe(1);
		});
	});
});
