import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The owner's saved January 1, 2025 allocations (src/lib/tax/allocationOverride.ts): rows are
 * validated before they are stored, every query carries the tenant id, a coin's rows are replaced
 * in one batch, and the migration holds exactly the statements the code runs. No database.
 */

const state = vi.hoisted(() => ({
	executed: [] as { sql: string; args: unknown[] }[],
	batches: [] as { sql: string; args: unknown[] }[][],
	rows: [] as Record<string, unknown>[],
	fail: false,
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args: unknown[] }) => {
			state.executed.push(stmt);
			if (state.fail && /SELECT/.test(stmt.sql)) throw new Error('relation does not exist');
			return { rows: /SELECT/.test(stmt.sql) ? state.rows : [], rowsAffected: 0 };
		},
		batch: async (stmts: { sql: string; args: unknown[] }[]) => {
			state.batches.push(stmts);
			return [];
		},
	},
}));

const load = () => import('../../src/lib/tax/allocationOverride');
const ROOT = path.resolve(__dirname, '../..');

beforeEach(() => {
	vi.resetModules();
	state.executed = [];
	state.batches = [];
	state.rows = [];
	state.fail = false;
});

describe('parseAllocationRows', () => {
	const good = { walletKey: 'cex:coinbase:acct-1', lotAcquiredAt: '2023-03-01', quantity: 0.5, costBasisUsd: 1_500, note: 'from my records' };

	it('accepts well-formed rows and keeps the note short', async () => {
		const { parseAllocationRows, NOTE_MAX } = await load();
		const out = parseAllocationRows([{ ...good, note: 'x'.repeat(NOTE_MAX + 50) }, { walletKey: 'ethereum:0xabc', lotAcquiredAt: '2023-03-01T00:00:00Z', quantity: 1 }]);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.rows[0].note).toHaveLength(NOTE_MAX);
		expect(out.rows[1]).toMatchObject({ costBasisUsd: null, note: null });
	});

	it.each([
		['nothing', undefined, 'rows_required'],
		['an empty list', [], 'rows_required'],
		['a row that is not an object', [3], 'row_invalid'],
		['no wallet key', [{ ...good, walletKey: '  ' }], 'wallet_key_invalid'],
		['an unreadable date', [{ ...good, lotAcquiredAt: 'last spring' }], 'lot_date_invalid'],
		['a quantity of zero', [{ ...good, quantity: 0 }], 'quantity_invalid'],
		['a quantity as text', [{ ...good, quantity: '1' }], 'quantity_invalid'],
		['a negative cost', [{ ...good, costBasisUsd: -1 }], 'cost_invalid'],
		['too many rows', Array.from({ length: 501 }, () => good), 'too_many_rows'],
	])('refuses %s', async (_name, input, error) => {
		const { parseAllocationRows } = await load();
		expect(parseAllocationRows(input)).toEqual({ ok: false, error });
	});
});

describe('loading and saving', () => {
	it('groups a tenant\'s rows by coin and scopes the read by tenant', async () => {
		state.rows = [
			{ asset_symbol: 'ETH', wallet_key: 'cex:coinbase:acct-1', lot_acquired_at: '2023-03-01', quantity: 0.5, cost_basis_usd: 1_500, note: 'n' },
			{ asset_symbol: 'ETH', wallet_key: 'ethereum:0xabc', lot_acquired_at: '2023-03-01', quantity: 0.25, cost_basis_usd: null, note: null },
			{ asset_symbol: 'BTC', wallet_key: 'bitcoin:bc1q', lot_acquired_at: '2022-01-01', quantity: 1, cost_basis_usd: 100, note: null },
			{ asset_symbol: 'BTC', wallet_key: 'bitcoin:bc1q', lot_acquired_at: '2022-02-01', quantity: 0, cost_basis_usd: 100, note: null },
		];
		const { loadAllocationOverrides, loadStoredAllocations } = await load();
		const overrides = await loadAllocationOverrides('tenant-a');
		expect(overrides.map((o) => [o.asset, o.rows.length])).toEqual([['ETH', 2], ['BTC', 1]]);
		expect(overrides[0].rows[0]).toEqual({ wallet: 'cex:coinbase:acct-1', acquiredAt: '2023-03-01', qty: 0.5, costUsd: 1_500 });
		expect((await loadStoredAllocations('tenant-a'))[0].rows[0].note).toBe('n');
		const reads = state.executed.filter((s) => /SELECT/.test(s.sql));
		expect(reads.length).toBeGreaterThan(0);
		for (const r of reads) {
			expect(r.sql).toMatch(/WHERE tenant_id = \?/);
			expect(r.args[0]).toBe('tenant-a');
		}
	});

	it('a table that is not there yet is no allocation, not an error', async () => {
		state.fail = true;
		const { loadAllocationOverrides } = await load();
		expect(await loadAllocationOverrides('tenant-a')).toEqual([]);
	});

	it('replaces a coin\'s rows in one batch, every statement scoped to the tenant and the coin', async () => {
		const { saveAllocation } = await load();
		await saveAllocation('tenant-a', 'eth', [
			{ walletKey: 'cex:coinbase:acct-1', lotAcquiredAt: '2023-03-01', quantity: 0.5, costBasisUsd: 1_500, note: null },
			{ walletKey: 'ethereum:0xabc', lotAcquiredAt: '2023-03-01', quantity: 0.25 },
		]);
		expect(state.batches).toHaveLength(1);
		const [del, ...inserts] = state.batches[0];
		expect(del.sql).toMatch(/DELETE FROM tax_wallet_allocation_override WHERE tenant_id = \? AND asset_symbol = \?/);
		expect(del.args).toEqual(['tenant-a', 'ETH']);
		expect(inserts).toHaveLength(2);
		for (const ins of inserts) expect(ins.args.slice(1, 3)).toEqual(['tenant-a', 'ETH']);
	});

	it('removes only the named coin of the tenant', async () => {
		const { deleteAllocation } = await load();
		await deleteAllocation('tenant-a', 'BTC');
		const del = state.executed.find((s) => /DELETE/.test(s.sql));
		expect(del?.sql).toMatch(/WHERE tenant_id = \? AND asset_symbol = \?/);
		expect(del?.args).toEqual(['tenant-a', 'BTC']);
	});
});

describe('the migration mirror', () => {
	const squash = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([(),]) ?/g, '$1').trim().toLowerCase();

	it('holds the same statements the code runs', () => {
		const sql = readFileSync(path.join(ROOT, 'migrations-pg/0063_tax_wallet_allocation_override.sql'), 'utf8');
		const code = readFileSync(path.join(ROOT, 'src/lib/tax/allocationOverride.ts'), 'utf8');
		const create = /const CREATE_TABLE = `([^`]+)`/.exec(code)?.[1] ?? '';
		const index = /const CREATE_INDEX = `([^`]+)`/.exec(code)?.[1] ?? '';
		expect(squash(sql)).toBe(squash(`${create};\n${index};`));
	});
});
