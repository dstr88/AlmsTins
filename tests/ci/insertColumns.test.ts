import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { migrationColumns } from '../helpers/migrationColumns';

/**
 * Every literal `INSERT INTO <table> (…)` in src names only columns the table has.
 *
 * Four importers wrote import_raw_rows with batch_id and raw_json, columns that never existed
 * (the table has import_batch_id and row_json), so the Bitcoin sync, the Solana sync and both
 * Avalanche importers saved nothing. Postgres refuses such an INSERT only when it runs; this test
 * refuses it when it is written.
 *
 * A table's columns are what tests/helpers/migrationColumns.ts reads from migrations/ and
 * migrations-pg/, plus every literal `ALTER TABLE t ADD COLUMN c` in src, since the app adds some
 * columns itself on first use (auth_users.created_at, global_address_labels.category, …).
 * Only tables with a CREATE TABLE in the migrations are checked; a table created only by the
 * app's own lazy `ensure…Tables()` code is not known here and is left out. A column list built
 * with `${…}` is not literal and is left out too.
 */

const ROOT = path.resolve(__dirname, '../..');
const walk = (dir: string, out: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|astro|js|mjs)$/.test(name)) out.push(p);
	}
	return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** Tables whose columns the migrations folder cannot tell reliably, each with the reason. */
const SKIPPED: Record<string, string> = {
	wallets: 'predates the migrations folder; no CREATE TABLE there',
	wallet_snapshots: 'predates the migrations folder; no CREATE TABLE there',
	address_labels: 'rebuilt through a copy table (20260416_address_label_phone.sql), so it reads short',
};

/**
 * KNOWN BUGS: INSERTs that name a column the table really does not have, found by this test and
 * not fixed yet, as 'file table.column'. Each fails whenever it runs. This list only shrinks.
 */
const KNOWN_BUGS: string[] = [];

const SRC_FILES = walk(path.join(ROOT, 'src'));

function schema(): Map<string, Set<string>> {
	const cols = migrationColumns();
	for (const f of SRC_FILES) {
		const text = readFileSync(f, 'utf8');
		for (const m of text.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)/gi)) {
			cols.get(m[1])?.add(m[2].toLowerCase());
		}
	}
	return cols;
}

type Insert = { file: string; line: number; table: string; columns: string[] };

function literalInserts(): Insert[] {
	const out: Insert[] = [];
	for (const f of SRC_FILES) {
		const text = readFileSync(f, 'utf8');
		for (const m of text.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)/gi)) {
			if (m[2].includes('${')) continue;
			const line = text.slice(0, m.index).split('\n').length;
			const columns = m[2].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);
			out.push({ file: rel(f), line, table: m[1], columns });
		}
	}
	return out;
}

describe('INSERT column lists', () => {
	const cols = schema();
	const checked = literalInserts().filter((i) => cols.has(i.table) && !(i.table in SKIPPED));

	const unknownColumns = () =>
		checked.flatMap((i) => i.columns.filter((c) => !cols.get(i.table)!.has(c)).map((c) => ({ key: `${i.file} ${i.table}.${c}`, line: i.line })));

	it('name only columns the table has', () => {
		const bad = unknownColumns().filter((b) => !KNOWN_BUGS.includes(b.key)).map((b) => `${b.key} (line ${b.line})`);
		expect(bad).toEqual([]);
	});

	it('still checks the import tables and a real share of the inserts', () => {
		// Guards against a parser change that quietly checks nothing.
		const tables = new Set(checked.map((i) => i.table));
		for (const t of ['import_raw_rows', 'import_transactions', 'exchange_accounts', 'auth_users']) expect(tables).toContain(t);
		expect(checked.length).toBeGreaterThan(100);
	});

	it('the skip list and the known-bug list hold only entries that still apply', () => {
		for (const t of Object.keys(SKIPPED)) expect(literalInserts().some((i) => i.table === t)).toBe(true);
		const found = unknownColumns().map((b) => b.key);
		for (const k of KNOWN_BUGS) expect(found, `${k} is fixed; take it off KNOWN_BUGS`).toContain(k);
	});

	it('would have caught the import_raw_rows bug', () => {
		const old = 'INSERT INTO import_raw_rows (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)';
		const m = old.match(/INSERT INTO\s+(\w+)\s*\(([^)]*)\)/)!;
		const missing = m[2].split(',').map((c) => c.trim()).filter((c) => !cols.get(m[1])!.has(c));
		expect(missing).toEqual(['batch_id', 'raw_json']);
	});
});
