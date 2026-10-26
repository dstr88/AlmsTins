import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The tables the app has, read from every place that defines one: migrations/*.sql, then
 * migrations-pg/*.sql (applied in that order), then the SQL string literals in src, where the app
 * creates about half its tables itself on first use (`ensure…Tables()` with CREATE TABLE IF NOT
 * EXISTS) and adds columns (ALTER TABLE … ADD COLUMN IF NOT EXISTS).
 *
 * For each table it records the column names and the required columns: NOT NULL (or PRIMARY KEY)
 * with no DEFAULT, not GENERATED and not SERIAL, so an INSERT that leaves one out fails.
 *
 * It reads only what it fully understands and says why it skips the rest:
 * - a CREATE TABLE body it cannot parse (a `${…}` inside it, a string built with `+`, a column
 *   type it does not know) is not used, and the table is skipped;
 * - a table the migrations drop, or rebuild through a copy table (create t_new, copy, drop t,
 *   rename t_new to t), is skipped; a plain rename carries the table's columns over;
 * - a table defined in more than one place is used only when every definition, with the ALTERs
 *   applied, has the same columns; its required columns only when those agree too.
 */

const ROOT = path.resolve(__dirname, '../..');

export type ColumnDef = { notNull: boolean; filled: boolean };
/** NOT NULL with nothing to fill it in: an INSERT that leaves the column out fails. */
export const isRequired = (c: ColumnDef) => c.notNull && !c.filled;
export type TableDef = Map<string, ColumnDef>;

export type AppTable = {
	columns: Set<string>;
	required: Set<string>;
	/** Where the table is created: 'migrations' or a src path. */
	definedIn: string[];
	/** Set when the column names cannot be trusted; the table is then not checked at all. */
	skip?: string;
	/** Set when the names agree but the required columns do not; only the names are checked. */
	requiredSkip?: string;
	/** Columns added in ways the reader cannot see (named with ${…}), each with where. */
	unseen: string[];
};

/** Column types the reader knows. A column whose type is not one of these makes its table unreadable. */
const TYPE = /^(?:text|varchar|character varying|char|character|citext|integer|int|int2|int4|int8|bigint|smallint|serial|bigserial|smallserial|real|double precision|float4|float8|float|numeric|decimal|boolean|bool|timestamptz|timestamp|datetime|date|time|interval|jsonb|json|uuid|bytea|blob|inet)\b(?:\s+with(?:out)?\s+time\s+zone)?(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s*\[\s*\])?/i;
const TABLE_CONSTRAINT = /^(?:CONSTRAINT\s+\S+|PRIMARY\s+KEY\s*\(|UNIQUE\s*(?:NULLS\s+(?:NOT\s+)?DISTINCT\s*)?\(|FOREIGN\s+KEY\s*\(|CHECK\s*\(|EXCLUDE\b)/i;
const NAME = String.raw`(?:"?\w+"?\.)?"?(?!IF\b)(\w+)"?`;

/** Splits on commas that are not inside parentheses or SQL quotes. */
function splitTopLevel(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote = '';
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === "'" || c === '"') quote = c;
		else if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === ',' && depth === 0) {
			parts.push(s.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(s.slice(start));
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** The index of the parenthesis that closes the one at `open`, or -1. */
function closingParen(s: string, open: number): number {
	let depth = 0;
	let quote = '';
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === "'" || c === '"') quote = c;
		else if (c === '(') depth++;
		else if (c === ')' && --depth === 0) return i;
	}
	return -1;
}

/** Drops `-- …` comments that are not inside SQL quotes. */
function stripSqlComments(sql: string): string {
	let out = '';
	let quote = '';
	for (let i = 0; i < sql.length; i++) {
		const c = sql[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === "'" || c === '"') quote = c;
		else if (c === '-' && sql[i + 1] === '-') {
			while (i < sql.length && sql[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		out += c;
	}
	return out;
}

/** One column definition (`name TYPE …constraints`), or an error saying why it cannot be read. */
export function readColumn(def: string): { name: string; col: ColumnDef } | { error: string } {
	const m = def.match(/^"?(\w+)"?\s+([\s\S]*)$/);
	if (!m) return { error: `cannot read column definition "${def}"` };
	const rest = m[2];
	const type = rest.match(TYPE);
	if (!type) return { error: `unknown column type in "${def}"` };
	const constraints = rest.slice(type[0].length);
	const notNull = /\bNOT\s+NULL\b/i.test(constraints) || /\bPRIMARY\s+KEY\b/i.test(constraints);
	const filled = /\bDEFAULT\b/i.test(constraints) || /\bGENERATED\b/i.test(constraints) || /\bAUTOINCREMENT\b/i.test(constraints) || /serial$/i.test(type[0]);
	return { name: m[1].toLowerCase(), col: { notNull, filled } };
}

/** The columns a CREATE TABLE body defines, or an error saying why it cannot be read. */
export function readTableBody(body: string): TableDef | { error: string } {
	if (body.includes('${')) return { error: 'the column list is built with ${…}' };
	const cols: TableDef = new Map();
	const pk: string[] = [];
	for (const part of splitTopLevel(body)) {
		if (TABLE_CONSTRAINT.test(part)) {
			const key = part.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i);
			if (key) pk.push(...key[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()));
			continue;
		}
		const read = readColumn(part);
		if ('error' in read) return read;
		cols.set(read.name, read.col);
	}
	// A table-level PRIMARY KEY (a, b) makes a and b NOT NULL, the same as a column-level one.
	for (const c of pk) {
		const col = cols.get(c);
		if (!col) return { error: `PRIMARY KEY names ${c}, which is not a column` };
		col.notNull = true;
	}
	return cols;
}

/** One statement that changes a table, in the order it was read. */
export type Ddl =
	| { kind: 'create'; table: string; ifNotExists: boolean; def: TableDef }
	| { kind: 'unreadable'; table: string; reason: string }
	| { kind: 'unseen'; table: string; reason: string }
	| { kind: 'add'; table: string; column: string; col: ColumnDef }
	| { kind: 'alter'; table: string; column: string; change: 'drop not null' | 'set default' | 'drop default' | 'set not null' | 'type' }
	| { kind: 'drop column'; table: string; column: string }
	| { kind: 'rename column'; table: string; from: string; to: string }
	| { kind: 'rename'; table: string; to: string }
	| { kind: 'drop'; table: string };

/** Every CREATE TABLE, ALTER TABLE and DROP TABLE in a piece of SQL text. */
export function readDdl(sqlText: string): Ddl[] {
	const sql = stripSqlComments(sqlText);
	const out: Array<{ at: number; ddl: Ddl }> = [];

	for (const m of sql.matchAll(new RegExp(String.raw`\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}\s*(\(|AS\b)?`, 'gi'))) {
		const table = m[2].toLowerCase();
		if (m[3] !== '(') {
			out.push({ at: m.index!, ddl: { kind: 'unreadable', table, reason: 'created without a column list' } });
			continue;
		}
		const open = m.index! + m[0].length - 1;
		const close = closingParen(sql, open);
		if (close < 0) {
			out.push({ at: m.index!, ddl: { kind: 'unreadable', table, reason: 'the column list does not close in the same string' } });
			continue;
		}
		const def = readTableBody(sql.slice(open + 1, close));
		out.push({ at: m.index!, ddl: 'error' in def ? { kind: 'unreadable', table, reason: def.error } : { kind: 'create', table, ifNotExists: !!m[1], def } });
	}

	for (const m of sql.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${NAME}\s+([^;]*)`, 'gi'))) {
		const table = m[1].toLowerCase();
		for (const action of splitTopLevel(m[2])) {
			const ddl = readAlterAction(table, action);
			if (ddl) out.push({ at: m.index!, ddl });
		}
	}

	for (const m of sql.matchAll(new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
		out.push({ at: m.index!, ddl: { kind: 'drop', table: m[1].toLowerCase() } });
	}

	return out.sort((a, b) => a.at - b.at).map((o) => o.ddl);
}

function readAlterAction(table: string, action: string): Ddl | null {
	let m = action.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
	if (m && !TABLE_CONSTRAINT.test(m[1])) {
		const read = readColumn(m[1].trim());
		if ('error' in read) {
			// A column named with ${…} (a loop over a map of columns) is one the reader cannot see,
			// unless ddlBySource finds the map. The table is still read, with a note: the name
			// check may then report a column the table has, and the required check may miss one.
			if (/^"?\$\{/.test(m[1])) return { kind: 'unseen', table, reason: `adds a column named with \${…}: ${m[1].trim()}` };
			return { kind: 'unreadable', table, reason: `ALTER TABLE ADD: ${read.error}` };
		}
		return { kind: 'add', table, column: read.name, col: read.col };
	}
	m = action.match(/^ALTER\s+(?:COLUMN\s+)?"?(\w+)"?\s+(DROP\s+NOT\s+NULL|SET\s+NOT\s+NULL|SET\s+DEFAULT|DROP\s+DEFAULT|(?:SET\s+DATA\s+)?TYPE)\b/i);
	if (m) {
		const change = m[2].toLowerCase().replace(/\s+/g, ' ').replace('set data type', 'type') as 'drop not null' | 'set default' | 'drop default' | 'set not null' | 'type';
		return { kind: 'alter', table, column: m[1].toLowerCase(), change };
	}
	m = action.match(/^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
	if (m && !/^DROP\s+CONSTRAINT\b/i.test(action)) return { kind: 'drop column', table, column: m[1].toLowerCase() };
	m = action.match(/^RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?/i);
	if (m && m[1].toUpperCase() !== 'TO') return { kind: 'rename column', table, from: m[1].toLowerCase(), to: m[2].toLowerCase() };
	m = action.match(/^RENAME\s+TO\s+"?(\w+)"?/i);
	if (m) return { kind: 'rename', table, to: m[1].toLowerCase() };
	// ADD CONSTRAINT, DROP CONSTRAINT, ENABLE ROW LEVEL SECURITY, OWNER TO, …: no column changes.
	return null;
}

/**
 * The string literals in TypeScript or JavaScript source, comments left out. A template literal's
 * `${name}` part comes back as written and any other `${…}` part as the text `${}`, so a
 * statement built from them can be told apart.
 */
export function stringLiterals(code: string): string[] {
	const out: string[] = [];
	let i = 0;
	let prev = ''; // the last significant character outside strings and comments, to tell a regex from a division

	const readQuoted = (q: string): string => {
		let s = '';
		i++;
		while (i < code.length && code[i] !== q) {
			if (code[i] === '\\') {
				const e = code[i + 1];
				s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\n' ? '' : e;
				i += 2;
			} else s += code[i++];
		}
		i++;
		return s;
	};

	const readTemplate = (): string => {
		let s = '';
		i++;
		while (i < code.length && code[i] !== '`') {
			if (code[i] === '\\') {
				const e = code[i + 1];
				s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
				i += 2;
			} else if (code[i] === '$' && code[i + 1] === '{') {
				i += 2;
				const start = i;
				skipCode('}');
				const expr = code.slice(start, i).trim();
				i++;
				s += /^\w+$/.test(expr) ? `\${${expr}}` : '${}';
			} else s += code[i++];
		}
		i++;
		return s;
	};

	const readRegex = () => {
		i++;
		let inClass = false;
		while (i < code.length && code[i] !== '\n') {
			const c = code[i];
			if (c === '\\') i += 2;
			else {
				if (c === '[') inClass = true;
				else if (c === ']') inClass = false;
				else if (c === '/' && !inClass) break;
				i++;
			}
		}
		i++;
		while (/\w/.test(code[i] ?? '')) i++;
	};

	// Reads code until the unmatched `stop` brace (or the end), collecting the strings it passes.
	function skipCode(stop: string) {
		let depth = 0;
		while (i < code.length) {
			const c = code[i];
			if (c === '/' && code[i + 1] === '/') {
				while (i < code.length && code[i] !== '\n') i++;
			} else if (c === '/' && code[i + 1] === '*') {
				const end = code.indexOf('*/', i + 2);
				i = end < 0 ? code.length : end + 2;
			} else if (c === "'" || c === '"') {
				out.push(readQuoted(c));
				prev = 'a';
			} else if (c === '`') {
				out.push(readTemplate());
				prev = 'a';
			} else if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(code.slice(Math.max(0, i - 12), i).trimEnd()))) {
				readRegex();
				prev = 'a';
			} else {
				if (c === '{') depth++;
				else if (c === '}') {
					if (depth === 0 && stop === '}') return;
					depth--;
				}
				if (!/\s/.test(c)) prev = c;
				i++;
			}
		}
	}

	skipCode('');
	return out;
}

const walk = (dir: string, out: string[] = []): string[] => {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** The src files whose string literals are read for table definitions. */
export function ddlSourceFiles(): string[] {
	return walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|js|mjs)$/.test(f));
}

/** The DDL each migration file and each src file holds, migrations first and in the order they run. */
export function ddlBySource(): Array<{ source: string; migration: boolean; ddl: Ddl[] }> {
	const migrations = ['migrations', 'migrations-pg'].flatMap((d) => {
		const dir = path.join(ROOT, d);
		return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
	});
	return [
		...migrations.map((f) => ({ source: rel(f), migration: true, ddl: readDdl(readFileSync(f, 'utf8')) })),
		...ddlSourceFiles().map((f) => {
			const code = readFileSync(f, 'utf8');
			const consts = fileConstants(code);
			const ddl = stringLiterals(code).flatMap((s) => readDdl(s.replace(/\$\{(\w+)\}/g, (all, name: string) => consts.get(name) ?? all)));
			// `ADD COLUMN IF NOT EXISTS ${name} ${type}` run over the file's one map of column → type.
			const maps = columnMaps(code);
			const read = ddl.flatMap((d): Ddl[] => (d.kind === 'unseen' && maps.length === 1 ? maps[0].map(([column, col]) => ({ kind: 'add', table: d.table, column, col })) : [d]));
			return { source: rel(f), migration: false, ddl: read };
		}),
	];
}

/**
 * The file's `const NAME: Record<string, string> = { column: 'TYPE', … }` maps whose every entry
 * reads as a column definition (sessionGate.ts AUTH_USER_COLUMNS, agenticsSignup.ts ADDED_COLUMNS).
 */
export function columnMaps(code: string): Array<Array<[string, ColumnDef]>> {
	const out: Array<Array<[string, ColumnDef]>> = [];
	for (const m of code.matchAll(/^(?:export\s+)?const\s+\w+\s*:\s*(?:Readonly<)?Record<string,\s*string>>?\s*=\s*\{([^}]*)\}/gm)) {
		const entries = [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map((e) => readColumn(`${e[1]} ${e[2]}`));
		if (entries.length && entries.every((e) => !('error' in e))) out.push(entries.map((e) => [(e as { name: string }).name, (e as { col: ColumnDef }).col]));
	}
	return out;
}

/**
 * The file's own `const NAME = '…'` strings, so a `${NAME}` inside a definition can be read
 * (`created_at TEXT NOT NULL ${TS_DEFAULT}`). A constant built from other values is not used.
 */
export function fileConstants(code: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of code.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2\s*;/gm)) {
		if (m[2] === '`' && m[3].includes('${')) continue;
		out.set(m[1], m[3]);
	}
	return out;
}

const sameKeys = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

/** Every table the reader found, with its columns and required columns, or why it is skipped. */
export function appSchema(sources = ddlBySource()): Map<string, AppTable> {
	// The migrations run in order, changing each table as they go. A table one migration creates and
	// a later one creates again without dropping it (migrations-pg/0048 recreates two SQLite-era
	// tables "if missing") gets a second definition, since a database may hold either.
	const migrated = new Map<string, Array<{ source: string; def: TableDef }>>();
	const migrationSkip = new Map<string, string>();
	const dropped = new Map<string, string>();
	// The app's own CREATE TABLE IF NOT EXISTS: one definition per place, any of which may run first.
	const appDefs = new Map<string, Array<{ source: string; def: TableDef }>>();
	const appSkip = new Map<string, string>();
	// The app's own ALTERs run after whichever CREATE made the table.
	const appAlters: Ddl[] = [];
	const unseen = new Map<string, string[]>();
	const copy = (def: TableDef): TableDef => new Map([...def].map(([k, v]) => [k, { ...v }]));

	for (const { source, migration, ddl } of sources) {
		for (const d of ddl) {
			if (d.kind === 'unseen') {
				unseen.set(d.table, [...(unseen.get(d.table) ?? []), `${source} ${d.reason}`]);
				continue;
			}
			if (!migration) {
				if (d.kind === 'create') {
					const defs = appDefs.get(d.table) ?? [];
					defs.push({ source, def: copy(d.def) });
					appDefs.set(d.table, defs);
				} else if (d.kind === 'unreadable') appSkip.set(d.table, `${source}: ${d.reason}`);
				else if (d.kind === 'drop' || d.kind === 'rename') appSkip.set(d.table, `${source} drops or renames it at run time`);
				else appAlters.push(d);
				continue;
			}
			const defs = migrated.get(d.table);
			switch (d.kind) {
				case 'create':
					if (dropped.has(d.table)) migrationSkip.set(d.table, `dropped in ${dropped.get(d.table)} and created again in ${source}`);
					migrated.set(d.table, [...(defs ?? []), { source, def: copy(d.def) }]);
					break;
				case 'unreadable':
					migrationSkip.set(d.table, `${source}: ${d.reason}`);
					break;
				case 'drop':
					dropped.set(d.table, source);
					migrated.delete(d.table);
					break;
				case 'rename':
					// Renamed onto a table that was just dropped: rebuilt through a copy table.
					if (dropped.has(d.to)) migrationSkip.set(d.to, `rebuilt through a copy table (${d.table}) in ${source}`);
					if (defs) migrated.set(d.to, defs);
					migrated.delete(d.table);
					break;
				default:
					for (const { def } of defs ?? []) applyAlter(def, d);
			}
		}
	}

	const tables = new Map<string, AppTable>();
	const names = new Set([...migrated.keys(), ...appDefs.keys(), ...migrationSkip.keys(), ...appSkip.keys()]);
	for (const name of names) {
		if (!migrated.has(name) && !appDefs.has(name) && dropped.has(name)) continue;
		const defs = [...(migrated.get(name) ?? []), ...(appDefs.get(name) ?? [])];
		for (const { def } of defs) for (const a of appAlters) if (a.table === name) applyAlter(def, a);

		const table: AppTable = {
			columns: new Set(defs[0] ? defs[0].def.keys() : []),
			required: new Set(defs[0] ? [...defs[0].def].filter(([, c]) => isRequired(c)).map(([k]) => k) : []),
			definedIn: defs.map((d) => d.source),
			unseen: unseen.get(name) ?? [],
		};
		const skip = migrationSkip.get(name) ?? appSkip.get(name);
		if (skip) table.skip = skip;
		else if (!defs.length) table.skip = 'no readable CREATE TABLE';
		for (const other of defs.slice(1)) {
			if (table.skip) break;
			const cols = new Set(other.def.keys());
			const req = new Set([...other.def].filter(([, c]) => isRequired(c)).map(([k]) => k));
			if (!sameKeys(cols, table.columns)) {
				const onlyHere = [...cols].filter((c) => !table.columns.has(c));
				const onlyFirst = [...table.columns].filter((c) => !cols.has(c));
				table.skip = `defined differently in ${defs[0].source} and ${other.source} (${[...onlyFirst.map((c) => `-${c}`), ...onlyHere.map((c) => `+${c}`)].join(' ')})`;
			} else if (!table.requiredSkip && !sameKeys(req, table.required)) {
				table.requiredSkip = `required columns differ between ${defs[0].source} and ${other.source}`;
			}
		}
		tables.set(name, table);
	}
	return tables;
}

function applyAlter(def: TableDef, d: Ddl) {
	if (d.kind === 'add') {
		if (!def.has(d.column)) def.set(d.column, { ...d.col });
	} else if (d.kind === 'alter') {
		const col = def.get(d.column);
		if (!col) return;
		if (d.change === 'drop not null') col.notNull = false;
		else if (d.change === 'set not null') col.notNull = true;
		else if (d.change === 'set default') col.filled = true;
		// DROP DEFAULT leaves a GENERATED or SERIAL column filled; the reader cannot tell those
		// apart from a plain DEFAULT here, so it keeps the column filled rather than guess.
	} else if (d.kind === 'drop column') def.delete(d.column);
	else if (d.kind === 'rename column') {
		const col = def.get(d.from);
		if (col) {
			def.delete(d.from);
			def.set(d.to, col);
		}
	}
}
