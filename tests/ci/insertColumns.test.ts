import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { appSchema, type AppTable } from '../helpers/appSchema';

/**
 * Every literal `INSERT INTO <table> (…)` in src names only columns the table has.
 *
 * Four importers wrote import_raw_rows with batch_id and raw_json, columns that never existed
 * (the table has import_batch_id and row_json), so the Bitcoin sync, the Solana sync and both
 * Avalanche importers saved nothing. Postgres refuses such an INSERT only when it runs; this test
 * refuses it when it is written.
 *
 * A table's columns are what tests/helpers/appSchema.ts reads from migrations/, migrations-pg/
 * and the SQL strings in src, where the app creates many tables itself on first use (petro_*,
 * receivable_*, cairn_*, the Verify tables) and adds columns (auth_users.created_at, …). A table
 * the reader cannot read reliably is skipped with its reason (READER_SKIPS below). A column list
 * built with `${…}` is not literal and is left out too.
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

/** Tables with inserts whose columns no definition here tells, each with the reason. */
const PREDATES = 'predates the migrations folder; no CREATE TABLE anywhere';
const SKIPPED: Record<string, string> = {
	wallets: PREDATES,
	wallet_snapshots: PREDATES,
	transactions: PREDATES,
	transaction_annotations: PREDATES,
	wallet_sync_state: PREDATES,
	subscriptions: PREDATES,
	tradfi_loan_payments: PREDATES,
	cache: PREDATES,
	address_labels: 'rebuilt through a copy table (20260416_address_label_phone.sql)',
};

/**
 * Tables the reader finds but does not trust, so their inserts are not checked. Pinned so a new
 * one shows up in review instead of quietly checking less. The reasons come from the reader.
 */
const READER_SKIPS = ['address_labels', 'manual_cost_basis'];

/**
 * KNOWN BUGS: INSERTs that name a column the table really does not have, found by this test and
 * not fixed yet, as 'file table.column'. Each fails whenever it runs. This list only shrinks.
 */
const KNOWN_BUGS: string[] = [];

const SRC_FILES = walk(path.join(ROOT, 'src'));

type Insert = { file: string; line: number; table: string; columns: string[] };

/**
 * Every `INSERT INTO t (a, b, …)` in the text whose column list is literal. A list with
 * `${cond ? ', c, d' : ''}` parts comes back once for each way the parts can go.
 */
function insertsIn(text: string, file: string): Insert[] {
	const out: Insert[] = [];
	for (const m of text.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)/gi)) {
		const line = text.slice(0, m.index).split('\n').length;
		for (const list of variants(m[2])) {
			const columns = list.split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);
			out.push({ file, line, table: m[1].toLowerCase(), columns });
		}
	}
	return out;
}

/** The column list with each `${x ? '…' : '…'}` taken both ways; none if any other `${…}` is in it. */
function variants(list: string): string[] {
	const m = list.match(/\$\{\s*[\w.!]+\s*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/);
	if (!m) return list.includes('${') ? [] : [list];
	return [m[1], m[2]].flatMap((part) => variants(list.replace(m[0], part)));
}

const literalInserts = (): Insert[] => SRC_FILES.flatMap((f) => insertsIn(readFileSync(f, 'utf8'), rel(f)));

/** 'file table.column' for each column the insert names that the table does not have. */
const unknownColumns = (i: Insert, t: AppTable) => i.columns.filter((c) => !t.columns.has(c)).map((c) => ({ key: `${i.file} ${i.table}.${c}`, line: i.line }));


describe('INSERT column lists', () => {
	const schema = appSchema();
	const inserts = literalInserts();
	const checked = inserts.filter((i) => schema.has(i.table) && !schema.get(i.table)!.skip && !(i.table in SKIPPED));
	const unknown = () => checked.flatMap((i) => unknownColumns(i, schema.get(i.table)!));

	it('name only columns the table has', () => {
		const bad = unknown().filter((b) => !KNOWN_BUGS.includes(b.key)).map((b) => `${b.key} (line ${b.line})`);
		expect(bad).toEqual([]);
	});

	it('still checks the import tables, the tables the app creates itself, and a real share of the inserts', () => {
		// Guards against a parser change that quietly checks nothing.
		const tables = new Set(checked.map((i) => i.table));
		for (const t of ['import_raw_rows', 'import_transactions', 'exchange_accounts', 'auth_users']) expect(tables).toContain(t);
		for (const t of ['petro_tins', 'petro_splits', 'receivables', 'receivable_claims', 'cairn_projects', 'cairn_milestones', 'verify_destinations', 'verify_deposit_challenges']) expect(tables).toContain(t);
		expect(tables.size).toBeGreaterThan(110);
		expect(checked.length).toBeGreaterThan(200);
	});

	it('every table with a literal insert is either checked or skipped with a reason', () => {
		const unchecked = [...new Set(inserts.map((i) => i.table))].filter((t) => !schema.has(t) && !(t in SKIPPED)).sort();
		expect(unchecked).toEqual([]);
	});

	it('the skip lists and the known-bug lists hold only entries that still apply', () => {
		for (const t of Object.keys(SKIPPED)) expect(inserts.some((i) => i.table === t)).toBe(true);
		const readerSkips = [...schema].filter(([t, s]) => s.skip && inserts.some((i) => i.table === t)).map(([t, s]) => `${t}: ${s.skip}`);
		expect(readerSkips.map((s) => s.split(':')[0]).sort(), readerSkips.join('\n')).toEqual([...READER_SKIPS].sort());
		const unknownKeys = unknown().map((b) => b.key);
		for (const k of KNOWN_BUGS) expect(unknownKeys, `${k} is fixed; take it off KNOWN_BUGS`).toContain(k);
	});

	it('would have caught the Avalanche CSV route column names', () => {
		// src/pages/api/import/snowtrace.ts as it was before #19, the two statements verbatim.
		const old = `
	const rawStatements  = normRows.map(r => ({
		sql: \`INSERT INTO import_raw_rows
		      (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'avalanche_cchain', ?, ?)
ON CONFLICT DO NOTHING\`,
		args: [randomUUID(), tenantId, resolvedAccountId, batchId, JSON.stringify(r), r.rowHash],
	}));

	const normStatements = normRows.map(r => ({
		sql: \`INSERT INTO import_transactions
		      (id, tenant_id, account_id, import_batch_id, timestamp_utc,
		       description, currency, amount,
		       to_currency, to_amount,
		       native_currency, native_amount, native_usd,
		       kind, tx_hash, direction, asset_symbol, row_hash, created_at)
		      VALUES (?, ?, ?, ?, ?,   ?, 'AVAX', ?,   NULL, NULL,   'USD', ?, ?,   ?, ?, ?, 'AVAX', ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING\`,
`;
		const found = insertsIn(old, 'snowtrace.ts');
		expect(found.flatMap((i) => unknownColumns(i, schema.get(i.table)!)).map((b) => b.key)).toEqual([
			'snowtrace.ts import_raw_rows.batch_id',
			'snowtrace.ts import_raw_rows.raw_json',
		]);
	});
});
