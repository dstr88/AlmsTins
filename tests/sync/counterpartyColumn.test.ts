import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { migrationColumns } from '../helpers/migrationColumns';

/**
 * counterparty_address on import_transactions and sui_transactions: added lazily by
 * ensureCounterpartyColumns, mirrored by migrations-pg/0062_counterparty_address.sql.
 *
 *   - The migration holds exactly the statements the code runs.
 *   - The schema is read first; an ALTER runs only for a table that lacks the column, and once
 *     both have it nothing more is sent in this process.
 *   - A failure is reported as false (callers then skip the column), never thrown.
 *
 * No database: the stub answers the schema read from `present`.
 */

const ROOT = path.resolve(__dirname, '../..');

const state = vi.hoisted(() => ({
	calls: [] as string[],
	present: [] as string[],
	fail: false,
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string }) => {
			state.calls.push(stmt.sql);
			if (state.fail) throw new Error('permission denied');
			if (/information_schema/i.test(stmt.sql)) return { rows: state.present.map((name) => ({ name })), rowsAffected: 0 };
			return { rows: [], rowsAffected: 0 };
		},
	},
}));

beforeEach(() => {
	vi.resetModules();
	state.calls = [];
	state.present = [];
	state.fail = false;
});

const load = () => import('../../src/lib/counterpartyColumn');
const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

describe('counterparty_address column', () => {
	it('migrations-pg/0062 holds exactly the statements the code runs, in order', async () => {
		const { COUNTERPARTY_DDL } = await load();
		const file = squash(readFileSync(path.join(ROOT, 'migrations-pg', '0062_counterparty_address.sql'), 'utf8'))
			.split(';')
			.map((s) => s.trim())
			.filter(Boolean);
		expect(file).toEqual(COUNTERPARTY_DDL.map(squash));
		expect(file.every((s) => /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS counterparty_address TEXT$/.test(s))).toBe(true);
	});

	it('is known to the schema the sync tests check inserts against', () => {
		const schema = migrationColumns();
		expect(schema.get('import_transactions')?.has('counterparty_address')).toBe(true);
		expect(schema.get('sui_transactions')?.has('counterparty_address')).toBe(true);
	});

	it('adds only the missing column, then sends nothing more', async () => {
		const { ensureCounterpartyColumns } = await load();
		state.present = ['import_transactions'];
		expect(await ensureCounterpartyColumns()).toBe(true);
		expect(state.calls.filter((s) => /^ALTER/.test(s))).toEqual(['ALTER TABLE sui_transactions ADD COLUMN IF NOT EXISTS counterparty_address TEXT']);

		state.calls = [];
		expect(await ensureCounterpartyColumns()).toBe(true);
		expect(state.calls).toEqual([]);
	});

	it('runs no ALTER when both tables already have it', async () => {
		const { ensureCounterpartyColumns } = await load();
		state.present = ['import_transactions', 'sui_transactions'];
		expect(await ensureCounterpartyColumns()).toBe(true);
		expect(state.calls.some((s) => /^ALTER/.test(s))).toBe(false);
	});

	it('answers false on a failure, and tries again next time', async () => {
		const { ensureCounterpartyColumns } = await load();
		state.fail = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await ensureCounterpartyColumns()).toBe(false);
		warn.mockRestore();
		state.fail = false;
		expect(await ensureCounterpartyColumns()).toBe(true);
	});
});
