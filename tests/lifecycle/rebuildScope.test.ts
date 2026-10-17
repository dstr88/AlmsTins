import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * rebuildAssetLifecycles always rebuilds a tenant's whole history.
 *
 * It used to honor `year`: the two SELECTs read only that calendar year, but the two DELETEs that follow clear the
 * tenant's events and groups for EVERY year, so a year-scoped rebuild (the Sync buttons on Year Summary and Annual
 * Records) left only that year behind, and older lots vanished until the next full rebuild.
 *
 * Hermetic: the database and the lock are stubs that record what the rebuild sends. Every value is invented.
 */
const state = vi.hoisted(() => ({
	statements: [] as Array<{ sql: string; args: unknown[] }>,
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args?: unknown[] }) => {
			state.statements.push({ sql: stmt.sql, args: stmt.args ?? [] });
			return { rows: [] };
		},
	},
}));
vi.mock('@/lib/cacheLock', () => ({ tryAcquireLock: async () => true }));

import { rebuildAssetLifecycles } from '../../src/lib/lifecycle';

const TENANT = 'tenant-a';

const selectsFrom = (table: string) =>
	state.statements.filter((s) => new RegExp(`FROM\\s+${table}\\b`).test(s.sql) && /^\s*SELECT/i.test(s.sql));
const deletes = () => state.statements.filter((s) => /^\s*DELETE FROM/i.test(s.sql));

beforeEach(() => {
	state.statements = [];
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('rebuildAssetLifecycles: the scope of a rebuild', () => {
	it('reads the whole history of the tenant even when asked for one year', async () => {
		await rebuildAssetLifecycles(TENANT, { year: 2025, skipPricing: true });

		const [imports] = selectsFrom('import_transactions');
		const [onchain] = selectsFrom('transactions');
		expect(imports, 'the import rows were read').toBeDefined();
		expect(onchain, 'the on-chain rows were read').toBeDefined();
		for (const read of [imports, onchain]) {
			expect(read.sql).not.toMatch(/timestamp(_utc)?\s*(>=|<=|<|>)/i);
			expect(read.args).toEqual([TENANT]);
		}
	});

	it('replaces exactly what it reads: the tenant\'s events and groups for every year', async () => {
		await rebuildAssetLifecycles(TENANT, { year: 2025, skipPricing: true });

		const clears = deletes();
		expect(clears.map((d) => /asset_lifecycle_(\w+)/.exec(d.sql)?.[1]).sort()).toEqual(['events', 'groups']);
		for (const clear of clears) {
			expect(clear.sql).not.toMatch(/timestamp/i);
			expect(clear.args).toEqual([TENANT]);
		}
	});

	it('sends the same reads whether or not a year is given', async () => {
		await rebuildAssetLifecycles(TENANT, { skipPricing: true });
		const full = state.statements.map((s) => ({ sql: s.sql, args: s.args }));

		state.statements = [];
		await rebuildAssetLifecycles(TENANT, { year: 2025, skipPricing: true });
		const scoped = state.statements.map((s) => ({ sql: s.sql, args: s.args }));

		expect(scoped).toEqual(full);
	});
});
