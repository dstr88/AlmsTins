import { describe, it, expect } from 'vitest';
import { createReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * The parts of tests/helpers/receivablesDbFake.ts that S2 added: db.batch as one transaction, a
 * correlated EXISTS, and computed select items and ORDER BY terms. The registry tests lean on
 * these, so a fake that answers wrongly would make them pass for the wrong reason.
 */

async function withTables() {
	const db = createReceivablesDbFake();
	await db.execute('CREATE TABLE IF NOT EXISTS r (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT, updated_at TEXT, created_at TEXT)');
	await db.execute('CREATE TABLE IF NOT EXISTS c (id TEXT NOT NULL PRIMARY KEY, r_id TEXT, tenant_id TEXT, status TEXT)');
	db.seed('r', { id: 'r1', tenant_id: 'A', updated_at: null, created_at: '2026-01-01' });
	db.seed('r', { id: 'r2', tenant_id: 'B', updated_at: '2026-03-01', created_at: '2026-01-02' });
	db.seed('r', { id: 'r3', tenant_id: 'B', updated_at: null, created_at: '2026-02-01' });
	db.seed('c', { id: 'c1', r_id: 'r2', tenant_id: 'A', status: 'active' });
	db.seed('c', { id: 'c2', r_id: 'r3', tenant_id: 'A', status: 'discharged' });
	return db;
}

describe('db fake: batch', () => {
	it('runs every statement in order and records the batch', async () => {
		const db = await withTables();
		const out = await db.batch([
			{ sql: 'UPDATE r SET updated_at = ? WHERE id = ?', args: ['2026-05-01', 'r1'] },
			{ sql: 'UPDATE c SET status = ? WHERE r_id = ?', args: ['discharged', 'r2'] },
		], 'write');
		expect(out.map((o) => o.rowsAffected)).toEqual([1, 1]);
		expect(db.batches).toHaveLength(1);
		expect(db.batches[0].map((s) => s.sql)).toEqual(['UPDATE r SET updated_at = ? WHERE id = ?', 'UPDATE c SET status = ? WHERE r_id = ?']);
		expect(db.rows('r')[0].updated_at).toBe('2026-05-01');
	});

	it('puts every row back, in place, when a statement throws', async () => {
		const db = createReceivablesDbFake({ failDml: (sql) => sql.startsWith('UPDATE c') });
		await db.execute('CREATE TABLE IF NOT EXISTS r (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT)');
		await db.execute('CREATE TABLE IF NOT EXISTS c (id TEXT NOT NULL PRIMARY KEY, status TEXT)');
		const held = db.seed('r', { id: 'r1', tenant_id: 'A' });
		db.seed('c', { id: 'c1', status: 'active' });
		await expect(db.batch([
			{ sql: 'UPDATE r SET tenant_id = ? WHERE id = ?', args: ['B', 'r1'] },
			{ sql: 'INSERT INTO r (id, tenant_id) VALUES (?, ?)', args: ['r2', 'A'] },
			{ sql: 'UPDATE c SET status = ? WHERE id = ?', args: ['x', 'c1'] },
		])).rejects.toThrow(/failed on purpose/);
		expect(db.rows('r')).toHaveLength(1);
		expect(db.rows('r')[0]).toBe(held);
		expect(held.tenant_id).toBe('A');
		expect(db.rows('c')[0].status).toBe('active');
	});
});

describe('db fake: EXISTS and computed items', () => {
	it('a correlated EXISTS, with select-list parameters bound first', async () => {
		const db = await withTables();
		const r = await db.execute({
			sql: `SELECT r.id, (r.tenant_id = ?) AS mine, COALESCE(r.updated_at, r.created_at) AS last
			      FROM r r
			      WHERE (r.tenant_id = ?) OR (r.tenant_id <> ? AND EXISTS (SELECT 1 FROM c c WHERE c.r_id = r.id AND c.tenant_id = ? AND c.status = 'active'))
			      ORDER BY COALESCE(r.updated_at, r.created_at) DESC`,
			args: ['A', 'A', 'A', 'A'],
		});
		expect(r.rows).toEqual([
			{ id: 'r2', mine: false, last: '2026-03-01' },
			{ id: 'r1', mine: true, last: '2026-01-01' },
		]);
	});

	it('an EXISTS naming an unknown column throws, as Postgres would', async () => {
		const db = await withTables();
		await expect(db.execute({ sql: 'SELECT id FROM r WHERE EXISTS (SELECT 1 FROM c x WHERE x.nope = r.id)', args: [] }))
			.rejects.toThrow(/column "nope"/);
	});

	it('unknown statements still throw', async () => {
		const db = await withTables();
		await expect(db.execute({ sql: 'SELECT id FROM r WHERE id IN (SELECT r_id FROM c)', args: [] })).rejects.toThrow();
		await expect(db.execute('TRUNCATE r')).rejects.toThrow(/unsupported statement/);
	});
});

// S5: the "Seen before?" store sums each record's active claims in its one SELECT.
describe('db fake: a correlated SUM in the select list', () => {
	async function withAmounts() {
		const db = await withTables();
		await db.execute('ALTER TABLE c ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION');
		db.rows('c')[0].amount = 400;
		db.rows('c')[1].amount = 200;
		db.seed('c', { id: 'c3', r_id: 'r2', tenant_id: 'B', status: 'active', amount: 150.5 });
		db.seed('c', { id: 'c4', r_id: 'r2', tenant_id: 'B', status: 'active', amount: null });
		return db;
	}
	const SUM = `(SELECT COALESCE(SUM(c.amount), 0) FROM c c WHERE c.r_id = r.id AND c.status = 'active') AS claimed`;

	it('sums per outer row, correlated on the outer columns, skipping NULL amounts', async () => {
		const db = await withAmounts();
		const out = await db.execute({ sql: `SELECT r.id, ${SUM} FROM r r ORDER BY r.id`, args: [] });
		expect(out.rows).toEqual([
			{ id: 'r1', claimed: 0 },
			{ id: 'r2', claimed: 550.5 },
			// r3's only claim is discharged: zero, not NULL.
			{ id: 'r3', claimed: 0 },
		]);
	});

	it('is zero when no inner row exists at all', async () => {
		const db = await withAmounts();
		db.rows('c').splice(0);
		const out = await db.execute({ sql: `SELECT r.id, ${SUM} FROM r r WHERE r.id = ?`, args: ['r2'] });
		expect(out.rows).toEqual([{ id: 'r2', claimed: 0 }]);
	});

	it('binds parameters in textual order: before, inside and after the sum, then WHERE', async () => {
		const db = await withAmounts();
		const out = await db.execute({
			sql: `SELECT r.id, (r.tenant_id = ?) AS mine,
			             (SELECT COALESCE(SUM(c.amount), 0) FROM c c WHERE c.r_id = r.id AND c.tenant_id = ? AND c.status = ?) AS theirs,
			             (EXISTS (SELECT 1 FROM c c WHERE c.r_id = r.id AND c.tenant_id = ?)) AS any_b
			      FROM r r WHERE r.id <> ? ORDER BY r.id`,
			args: ['B', 'A', 'active', 'B', 'r1'],
		});
		expect(out.rows).toEqual([
			{ id: 'r2', mine: true, theirs: 400, any_b: true },
			{ id: 'r3', mine: true, theirs: 0, any_b: false },
		]);
	});

	it('an unknown column or table in the sum throws, as Postgres would', async () => {
		const db = await withTables();
		// c has no amount column until the ALTER.
		await expect(db.execute({ sql: `SELECT r.id, ${SUM} FROM r r`, args: [] })).rejects.toThrow(/column "amount"/);
		await db.execute('ALTER TABLE c ADD COLUMN IF NOT EXISTS amount DOUBLE PRECISION');
		await expect(db.execute({ sql: `SELECT r.id, (SELECT COALESCE(SUM(c.amount), 0) FROM c c WHERE c.nope = r.id) AS s FROM r r`, args: [] }))
			.rejects.toThrow(/column "nope"/);
		await expect(db.execute({ sql: `SELECT r.id, (SELECT COALESCE(SUM(x.amount), 0) FROM missing x WHERE x.r_id = r.id) AS s FROM r r`, args: [] }))
			.rejects.toThrow(/relation "missing"/);
	});

	it('other scalar subqueries still throw', async () => {
		const db = await withAmounts();
		await expect(db.execute({ sql: 'SELECT r.id, (SELECT MAX(c.amount) FROM c c WHERE c.r_id = r.id) AS m FROM r r', args: [] })).rejects.toThrow();
		await expect(db.execute({ sql: 'SELECT r.id, (SELECT SUM(c.amount) FROM c c WHERE c.r_id = r.id) AS m FROM r r', args: [] })).rejects.toThrow();
		await expect(db.execute({ sql: 'SELECT r.id FROM r r WHERE r.id IN (SELECT c.r_id FROM c c)', args: [] })).rejects.toThrow();
	});
});
