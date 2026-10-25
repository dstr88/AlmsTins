import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The columns each table has, read from migrations/*.sql and then migrations-pg/*.sql (the
 * Postgres-only additions): every CREATE TABLE's column list plus every later ALTER TABLE … ADD
 * COLUMN. Only tables that have a CREATE TABLE there are known; the rest (wallets,
 * wallet_snapshots) predate the migrations folder. Trust it only for tables with a plain history:
 * one rebuilt through a copy table (address_labels) reads short here.
 */
export function migrationColumns(): Map<string, Set<string>> {
	const files = ['migrations', 'migrations-pg'].flatMap((d) => {
		const dir = path.resolve(__dirname, '../..', d);
		return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
	});
	const created = new Map<string, Set<string>>();
	const added: Array<[string, string]> = [];
	for (const f of files) {
		const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
		for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
			const cols = created.get(m[1]) ?? new Set<string>();
			for (const line of m[2].split('\n')) {
				const word = line.trim().match(/^"?(\w+)"?\s+\w/)?.[1];
				if (word && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(word)) cols.add(word.toLowerCase());
			}
			created.set(m[1], cols);
		}
		for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)/gi)) added.push([m[1], m[2].toLowerCase()]);
	}
	for (const [table, col] of added) created.get(table)?.add(col);
	return created;
}

/** The table and column list an `INSERT INTO t (a, b, …)` names, or null for any other statement. */
export function insertColumns(sql: string): { table: string; columns: string[] } | null {
	const m = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]*)\)/i);
	if (!m) return null;
	return { table: m[1], columns: m[2].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) };
}

/** Throws the way Postgres does when an INSERT names a column the table doesn't have. */
export function assertInsertColumnsExist(sql: string, schema: Map<string, Set<string>>): void {
	const ins = insertColumns(sql);
	if (!ins) return;
	const known = schema.get(ins.table);
	if (!known) return;
	for (const c of ins.columns) {
		if (!known.has(c)) throw new Error(`column "${c}" of relation "${ins.table}" does not exist`);
	}
}
