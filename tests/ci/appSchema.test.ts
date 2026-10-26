import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appSchema, columnMaps, ddlSourceFiles, fileConstants, readDdl, stringLiterals, type Ddl } from '../helpers/appSchema';

/** The schema reader the insert-column guard (insertColumns.test.ts) stands on. */

const tables = (sources: Array<{ source: string; migration?: boolean; sql: string }>) =>
	appSchema(sources.map((s) => ({ source: s.source, migration: !!s.migration, ddl: readDdl(s.sql) })));

describe('readDdl', () => {
	it('reads a multi-line CREATE TABLE IF NOT EXISTS with constraints, quoted names and comments', () => {
		const [d] = readDdl(`
			-- CREATE TABLE ignored_in_comment (x TEXT NOT NULL)
			CREATE TABLE IF NOT EXISTS public."sample_jars" (
				id          TEXT NOT NULL PRIMARY KEY,
				"owner_id"  TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
				kind        TEXT NOT NULL DEFAULT 'jar' CHECK (kind IN ('jar', 'tin')),
				label       TEXT,                     -- free text, (with parens), and a comma
				amount      NUMERIC(18, 8) NOT NULL,
				seq         BIGSERIAL,
				n           BIGINT GENERATED ALWAYS AS IDENTITY,
				at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				tags        TEXT[] NOT NULL,
				CONSTRAINT sample_jars_label UNIQUE (owner_id, label),
				CHECK (amount >= 0)
			);`);
		expect(d.kind).toBe('create');
		if (d.kind !== 'create') return;
		expect(d.table).toBe('sample_jars');
		expect([...d.def.keys()]).toEqual(['id', 'owner_id', 'kind', 'label', 'amount', 'seq', 'n', 'at', 'tags']);
		const required = [...d.def].filter(([, c]) => c.notNull && !c.filled).map(([k]) => k);
		expect(required).toEqual(['id', 'owner_id', 'amount', 'tags']);
	});

	it('makes a table-level PRIMARY KEY column required, unless it has a default', () => {
		const [d] = readDdl(`CREATE TABLE pairs (a TEXT, b INTEGER DEFAULT 0, c TEXT, PRIMARY KEY (a, b))`);
		if (d.kind !== 'create') throw new Error(d.kind);
		expect([...d.def].filter(([, c]) => c.notNull && !c.filled).map(([k]) => k)).toEqual(['a']);
	});

	it('reads ALTER TABLE actions in order', () => {
		const ddl = readDdl(`
			ALTER TABLE jars ADD COLUMN IF NOT EXISTS colour TEXT NOT NULL DEFAULT 'red', ADD COLUMN size INTEGER NOT NULL;
			ALTER TABLE jars ALTER COLUMN size DROP NOT NULL;
			ALTER TABLE jars RENAME COLUMN colour TO hue;
			ALTER TABLE jars DROP COLUMN IF EXISTS old_note CASCADE;
			ALTER TABLE jars ADD CONSTRAINT jars_fk FOREIGN KEY (owner_id) REFERENCES owners(id);
			ALTER TABLE jars ENABLE ROW LEVEL SECURITY;
			ALTER TABLE jars RENAME TO pots;`);
		expect(ddl.map((d) => d.kind + ('column' in d ? ` ${d.column}` : ''))).toEqual([
			'add colour', 'add size', 'alter size', 'rename column', 'drop column old_note', 'rename',
		]);
	});

	it('does not read a column list it cannot fully understand', () => {
		const reasons = (sql: string) => readDdl(sql).map((d) => (d.kind === 'unreadable' ? d.reason : d.kind));
		expect(reasons('CREATE TABLE a (id TEXT, ${}')).toEqual(['the column list does not close in the same string']);
		expect(reasons('CREATE TABLE a (id TEXT, ${} TEXT)')).toEqual(['the column list is built with ${…}']);
		expect(reasons('CREATE TABLE a (id MYSTERY_TYPE)')).toEqual(['unknown column type in "id MYSTERY_TYPE"']);
		expect(reasons('CREATE TABLE a AS SELECT 1')).toEqual(['created without a column list']);
	});
});

describe('stringLiterals', () => {
	it('returns the strings in code, leaving comments and regex literals out', () => {
		const code = [
			"// const no = 'CREATE TABLE in_a_comment (x TEXT)';",
			"/* 'nor this' */",
			"const re = /CREATE TABLE\\s+\"?(\\w+)\"?/i;",
			"const half = total / 2; const q = 'it\\'s';",
			'const sql = `CREATE TABLE t (',
			'  id TEXT NOT NULL ${TS_DEFAULT},',
			"  x TEXT ${flag ? 'NOT NULL' : ''}",
			')`;',
		].join('\n');
		expect(stringLiterals(code)).toEqual(["it's", 'NOT NULL', '', 'CREATE TABLE t (\n  id TEXT NOT NULL ${TS_DEFAULT},\n  x TEXT ${}\n)']);
	});

	it('reads the file constants and column maps a definition uses', () => {
		const code = [
			"const TS_DEFAULT = `DEFAULT (now())`;",
			"const BUILT = `x ${y}`;",
			"const COLS: Readonly<Record<string, string>> = { opened_at: 'TEXT', // a comment",
			"  tries: 'INTEGER NOT NULL' };",
		].join('\n');
		expect([...fileConstants(code)]).toEqual([['TS_DEFAULT', 'DEFAULT (now())']]);
		expect(columnMaps(code)).toEqual([[['opened_at', { notNull: false, filled: false }], ['tries', { notNull: true, filled: false }]]]);
	});

	it('finds every CREATE TABLE and ALTER TABLE in src that is not in a comment', () => {
		// Two in sqliteSchemaToPg.mjs are regex literals, not SQL.
		const inRegexLiterals: Record<string, number> = { 'src/scripts/sqliteSchemaToPg.mjs': 2 };
		const count = (s: string) => s.match(/\b(?:CREATE\s+(?:TEMP\s+)?TABLE|ALTER\s+TABLE)\b/gi)?.length ?? 0;
		const off: string[] = [];
		for (const f of ddlSourceFiles()) {
			const code = readFileSync(f, 'utf8');
			const file = path.relative(path.resolve(__dirname, '../..'), f).split(path.sep).join('/');
			const raw = count(code.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n'));
			const lits = count(stringLiterals(code).join('\n'));
			if (raw - lits !== (inRegexLiterals[file] ?? 0)) off.push(`${file}: ${raw} in code, ${lits} in strings`);
		}
		expect(off).toEqual([]);
	});
});

describe('appSchema', () => {
	it('applies migrations in order and the app ALTERs to every definition', () => {
		const t = tables([
			{ source: 'm1.sql', migration: true, sql: 'CREATE TABLE jars (id TEXT PRIMARY KEY, note TEXT NOT NULL);' },
			{ source: 'm2.sql', migration: true, sql: 'ALTER TABLE jars ALTER COLUMN note DROP NOT NULL; ALTER TABLE jars ADD COLUMN size INTEGER NOT NULL;' },
			{ source: 'src/a.ts', sql: 'CREATE TABLE IF NOT EXISTS jars (id TEXT PRIMARY KEY, note TEXT, size INTEGER NOT NULL)' },
			{ source: 'src/b.ts', sql: 'ALTER TABLE jars ADD COLUMN IF NOT EXISTS colour TEXT' },
		]).get('jars')!;
		expect(t.skip).toBeUndefined();
		expect(t.requiredSkip).toBeUndefined();
		expect([...t.columns]).toEqual(['id', 'note', 'size', 'colour']);
		expect([...t.required]).toEqual(['id', 'size']);
		expect(t.definedIn).toEqual(['m1.sql', 'src/a.ts']);
	});

	it('skips a table defined with different columns in two places, and its required columns when only those differ', () => {
		const t = tables([
			{ source: 'src/a.ts', sql: 'CREATE TABLE IF NOT EXISTS jars (id TEXT PRIMARY KEY, note TEXT)' },
			{ source: 'src/b.ts', sql: 'CREATE TABLE IF NOT EXISTS jars (id TEXT PRIMARY KEY)' },
			{ source: 'src/a.ts', sql: "CREATE TABLE IF NOT EXISTS tins (id TEXT PRIMARY KEY, kind TEXT NOT NULL)" },
			{ source: 'src/b.ts', sql: "CREATE TABLE IF NOT EXISTS tins (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'debt')" },
		]);
		expect(t.get('jars')!.skip).toBe('defined differently in src/a.ts and src/b.ts (-note)');
		expect(t.get('tins')!.skip).toBeUndefined();
		expect(t.get('tins')!.requiredSkip).toBe('required columns differ between src/a.ts and src/b.ts');
	});

	it('carries a renamed table over, and skips one rebuilt through a copy table', () => {
		const t = tables([
			{ source: 'm1.sql', migration: true, sql: 'CREATE TABLE old_tins (id TEXT PRIMARY KEY); CREATE TABLE labels (id TEXT);' },
			{ source: 'm2.sql', migration: true, sql: 'ALTER TABLE old_tins RENAME TO tins;' },
			{ source: 'm3.sql', migration: true, sql: 'CREATE TABLE labels_new (id TEXT, phone TEXT); DROP TABLE labels; ALTER TABLE labels_new RENAME TO labels;' },
		]);
		expect(t.has('old_tins')).toBe(false);
		expect([...t.get('tins')!.columns]).toEqual(['id']);
		expect(t.get('tins')!.skip).toBeUndefined();
		expect(t.get('labels')!.skip).toBe('rebuilt through a copy table (labels_new) in m3.sql');
	});

	it('skips a table whose definition is unreadable anywhere', () => {
		const t = tables([
			{ source: 'm1.sql', migration: true, sql: 'CREATE TABLE jars (id TEXT PRIMARY KEY);' },
			{ source: 'src/a.ts', sql: 'CREATE TABLE IF NOT EXISTS jars (id TEXT PRIMARY KEY, ${})' },
		]);
		expect(t.get('jars')!.skip).toBe('src/a.ts: the column list is built with ${…}');
	});

	it('reads the real app-created tables (petro, receivable, cairn, Verify)', () => {
		const t = appSchema();
		for (const name of ['petro_splits', 'receivables', 'cairn_projects', 'verify_destinations']) {
			expect(t.get(name)?.skip, name).toBeUndefined();
			expect(t.get(name)!.definedIn.some((d) => d.startsWith('src/')), name).toBe(true);
		}
		expect(t.get('import_transactions')!.required).toContain('source');
		const kinds = (ddl: Ddl[]) => ddl.map((d) => d.kind);
		expect(kinds(readDdl('ALTER TABLE x ADD COLUMN IF NOT EXISTS ${n} ${}'))).toEqual(['unseen']);
	});
});
