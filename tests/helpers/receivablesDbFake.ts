/**
 * An in-memory stand-in for '@/lib/db' that runs the receivables registry's own SQL.
 *
 * Hermetic: no Postgres, no network. It parses the small SQL subset the registry uses
 * (CREATE TABLE / CREATE INDEX / ALTER TABLE ADD COLUMN, INSERT, UPDATE, and single-table or
 * one-JOIN SELECTs with AND / OR / IS NULL / LIKE in WHERE) and evaluates it against plain
 * row objects. Because the registry's real WHERE clauses run here, a dropped
 * `AND tenant_id = ?` shows up as a wrong answer in a test, not only in review.
 *
 * Postgres behaviors it keeps on purpose:
 *   - a relation exists only once its CREATE TABLE ran, and a column only once its CREATE or
 *     its ALTER ... ADD COLUMN ran. Reading either too early throws, the way Postgres does
 *     (42P01 / 42703), so "ensure before the first read" and "degrade when an ALTER failed"
 *     are both testable;
 *   - anything it does not understand throws, so an unexpected statement fails the test
 *     instead of quietly answering nothing.
 *
 * Usage (resetModules-safe):
 *   const holder = vi.hoisted(() => ({ db: null as any }));
 *   vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any) => holder.db.batch(s) } }));
 *   beforeEach(() => { holder.db = createReceivablesDbFake(); });
 */

export type Row = Record<string, any>;

export interface ReceivablesDbFakeOptions {
	/** Make a DDL statement throw, as a lock timeout or a dropped connection would. */
	failDdl?: (sql: string) => boolean;
}

export interface ExecutedStatement {
	sql: string;
	args: unknown[];
}

export interface ReceivablesDbFake {
	execute(stmt: string | { sql: string; args?: unknown[] }): Promise<{ rows: Row[]; rowsAffected: number }>;
	batch(stmts: unknown[]): Promise<never>;
	/** Rows by table. Seed directly; a relation still exists only after its CREATE ran. */
	tables: Map<string, Row[]>;
	/** Known columns by table, from CREATE TABLE and ALTER ... ADD COLUMN. */
	columns: Map<string, Set<string>>;
	/** Every statement executed, normalized, in order. */
	log: ExecutedStatement[];
	/** Push a row into a table (created lazily for seeding). */
	seed(table: string, row: Row): Row;
	/** The rows of one table. */
	rows(table: string): Row[];
	/** Statements whose normalized SQL matches. */
	statements(match: RegExp): ExecutedStatement[];
	options: ReceivablesDbFakeOptions;
}

export const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

// ── Tokenizer and WHERE-expression parser ───────────────────────────────────

type Tok = { t: 'word' | 'str' | 'num' | 'param' | 'op' | 'punct'; v: string };

function tokenize(s: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (/\s/.test(c)) { i++; continue; }
		if (c === "'") {
			let j = i + 1;
			let v = '';
			while (j < s.length) {
				if (s[j] === "'") {
					if (s[j + 1] === "'") { v += "'"; j += 2; continue; }
					break;
				}
				v += s[j]; j++;
			}
			if (j >= s.length) throw new Error(`fake db: unterminated string in: ${s}`);
			out.push({ t: 'str', v });
			i = j + 1;
			continue;
		}
		if (c === '?') { out.push({ t: 'param', v: '?' }); i++; continue; }
		if (c === '(' || c === ')' || c === ',' || c === '*') { out.push({ t: 'punct', v: c }); i++; continue; }
		if (c === '<' || c === '>' || c === '=' || c === '!') {
			const two = s.slice(i, i + 2);
			if (two === '<=' || two === '>=' || two === '<>' || two === '!=') { out.push({ t: 'op', v: two }); i += 2; continue; }
			out.push({ t: 'op', v: c }); i++; continue;
		}
		if (/[0-9]/.test(c)) {
			let j = i;
			while (j < s.length && /[0-9.]/.test(s[j])) j++;
			out.push({ t: 'num', v: s.slice(i, j) });
			i = j;
			continue;
		}
		let j = i;
		while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
		if (j === i) throw new Error(`fake db: cannot tokenize at "${s.slice(i, i + 20)}" in: ${s}`);
		out.push({ t: 'word', v: s.slice(i, j) });
		i = j;
	}
	return out;
}

type Operand = { kind: 'col'; name: string } | { kind: 'param'; index: number } | { kind: 'lit'; value: unknown };
type Expr =
	| { kind: 'and' | 'or'; left: Expr; right: Expr }
	| { kind: 'cmp'; op: string; left: Operand; right: Operand }
	| { kind: 'isnull'; not: boolean; operand: Operand }
	| { kind: 'like'; not: boolean; left: Operand; right: Operand };

class ExprParser {
	private pos = 0;
	constructor(private toks: Tok[], private paramBase: { next: number }) {}

	parse(): Expr {
		const e = this.or();
		if (this.pos !== this.toks.length) throw new Error(`fake db: trailing tokens in WHERE: ${this.toks.slice(this.pos).map((t) => t.v).join(' ')}`);
		return e;
	}
	private peekWord(w: string): boolean {
		const t = this.toks[this.pos];
		return !!t && t.t === 'word' && t.v.toUpperCase() === w;
	}
	private or(): Expr {
		let left = this.and();
		while (this.peekWord('OR')) { this.pos++; left = { kind: 'or', left, right: this.and() }; }
		return left;
	}
	private and(): Expr {
		let left = this.primary();
		while (this.peekWord('AND')) { this.pos++; left = { kind: 'and', left, right: this.primary() }; }
		return left;
	}
	private primary(): Expr {
		const t = this.toks[this.pos];
		if (t && t.t === 'punct' && t.v === '(') {
			this.pos++;
			const e = this.or();
			const close = this.toks[this.pos++];
			if (!close || close.v !== ')') throw new Error('fake db: missing ) in WHERE');
			return e;
		}
		const left = this.operand();
		if (this.peekWord('IS')) {
			this.pos++;
			let not = false;
			if (this.peekWord('NOT')) { not = true; this.pos++; }
			if (!this.peekWord('NULL')) throw new Error('fake db: IS must be followed by [NOT] NULL');
			this.pos++;
			return { kind: 'isnull', not, operand: left };
		}
		let notLike = false;
		if (this.peekWord('NOT')) { notLike = true; this.pos++; }
		if (this.peekWord('LIKE')) {
			this.pos++;
			return { kind: 'like', not: notLike, left, right: this.operand() };
		}
		if (notLike) throw new Error('fake db: NOT is only supported before LIKE');
		const op = this.toks[this.pos++];
		if (!op || op.t !== 'op') throw new Error(`fake db: expected an operator, got ${op?.v}`);
		return { kind: 'cmp', op: op.v, left, right: this.operand() };
	}
	private operand(): Operand {
		const t = this.toks[this.pos++];
		if (!t) throw new Error('fake db: expected an operand');
		if (t.t === 'param') return { kind: 'param', index: this.paramBase.next++ };
		if (t.t === 'str') return { kind: 'lit', value: t.v };
		if (t.t === 'num') return { kind: 'lit', value: Number(t.v) };
		if (t.t === 'word') {
			const u = t.v.toUpperCase();
			if (u === 'NULL') return { kind: 'lit', value: null };
			if (u === 'TRUE') return { kind: 'lit', value: true };
			if (u === 'FALSE') return { kind: 'lit', value: false };
			return { kind: 'col', name: t.v };
		}
		throw new Error(`fake db: unsupported operand ${t.v}`);
	}
}

function exprColumns(e: Expr, out: string[] = []): string[] {
	const op = (o: Operand) => { if (o.kind === 'col') out.push(o.name); };
	switch (e.kind) {
		case 'and': case 'or': exprColumns(e.left, out); exprColumns(e.right, out); break;
		case 'isnull': op(e.operand); break;
		case 'cmp': case 'like': op(e.left); op(e.right); break;
	}
	return out;
}

const norm = (v: unknown): unknown => (v === true ? 'true' : v === false ? 'false' : v);

function looseEq(a: unknown, b: unknown): boolean {
	return String(norm(a)) === String(norm(b));
}

function compare(a: unknown, b: unknown): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	const as = String(a), bs = String(b);
	return as < bs ? -1 : as > bs ? 1 : 0;
}

function likeRegex(pattern: string): RegExp {
	const body = pattern.split('').map((ch) => (ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
	return new RegExp(`^${body}$`, 's');
}

function evalExpr(e: Expr, get: (col: string) => unknown, args: unknown[]): boolean {
	const val = (o: Operand): unknown => (o.kind === 'col' ? get(o.name) : o.kind === 'param' ? args[o.index] : o.value);
	switch (e.kind) {
		case 'and': return evalExpr(e.left, get, args) && evalExpr(e.right, get, args);
		case 'or': return evalExpr(e.left, get, args) || evalExpr(e.right, get, args);
		case 'isnull': {
			const v = val(e.operand);
			const isNull = v === null || v === undefined;
			return e.not ? !isNull : isNull;
		}
		case 'like': {
			const l = val(e.left), r = val(e.right);
			if (l == null || r == null) return false;
			const m = likeRegex(String(r)).test(String(l));
			return e.not ? !m : m;
		}
		case 'cmp': {
			const l = val(e.left), r = val(e.right);
			if (l == null || r == null) return false;
			switch (e.op) {
				case '=': return looseEq(l, r);
				case '<>': case '!=': return !looseEq(l, r);
				case '<': return compare(l, r) < 0;
				case '>': return compare(l, r) > 0;
				case '<=': return compare(l, r) <= 0;
				case '>=': return compare(l, r) >= 0;
			}
			throw new Error(`fake db: unsupported operator ${e.op}`);
		}
	}
}

/** Split on commas at parenthesis depth 0, outside string literals. */
function splitTopLevel(s: string): string[] {
	const parts: string[] = [];
	let depth = 0, inStr = false, cur = '';
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "'") inStr = !inStr;
		if (!inStr) {
			if (c === '(') depth++;
			if (c === ')') depth--;
			if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
		}
		cur += c;
	}
	if (cur.trim()) parts.push(cur.trim());
	return parts;
}

// ── The fake ────────────────────────────────────────────────────────────────

export function createReceivablesDbFake(options: ReceivablesDbFakeOptions = {}): ReceivablesDbFake {
	const tables = new Map<string, Row[]>();
	const columns = new Map<string, Set<string>>();
	const log: ExecutedStatement[] = [];
	let clock = 0;
	const nextCreatedAt = () => `2026-10-01 00:00:${String(clock++).padStart(2, '0')}`;

	const rowsOf = (table: string): Row[] => {
		let r = tables.get(table);
		if (!r) { r = []; tables.set(table, r); }
		return r;
	};

	const requireTable = (table: string): Set<string> => {
		const cols = columns.get(table);
		if (!cols) throw new Error(`relation "${table}" does not exist`);
		return cols;
	};
	const requireColumn = (table: string, col: string) => {
		const cols = requireTable(table);
		const bare = col.includes('.') ? col.slice(col.indexOf('.') + 1) : col;
		if (!cols.has(bare)) throw new Error(`column "${bare}" of relation "${table}" does not exist`);
	};

	function ddl(sql: string) {
		if (options.failDdl?.(sql)) throw new Error(`fake db: DDL failed on purpose: ${sql.slice(0, 80)}`);
		let m = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+) \((.*)\)$/i);
		if (m) {
			const [, table, body] = m;
			if (!columns.has(table)) {
				const cols = new Set<string>();
				for (const part of splitTopLevel(body)) {
					const first = part.split(' ')[0];
					if (/^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK)$/i.test(first)) continue;
					cols.add(first);
				}
				columns.set(table, cols);
				rowsOf(table);
			}
			return;
		}
		m = sql.match(/^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+) /i);
		if (m) {
			requireTable(m[1]).add(m[2]);
			return;
		}
		m = sql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS \w+ ON (\w+)/i);
		if (m) {
			requireTable(m[1]);
			return;
		}
		throw new Error(`fake db: unsupported DDL: ${sql}`);
	}

	function literal(v: string, args: unknown[], cursor: { next: number }): unknown {
		if (v === '?') return args[cursor.next++];
		if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/''/g, "'");
		if (/^NULL$/i.test(v)) return null;
		if (/^TRUE$/i.test(v)) return true;
		if (/^FALSE$/i.test(v)) return false;
		if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
		throw new Error(`fake db: unsupported value expression ${v}`);
	}

	function insert(sql: string, args: unknown[]) {
		const m = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES \((.*?)\)(?: ON CONFLICT \(([^)]*)\) DO (NOTHING|UPDATE SET (.*)))?$/i);
		if (!m) throw new Error(`fake db: unsupported INSERT: ${sql}`);
		const [, table, colList, valList, conflictCols, , updateSet] = m;
		const cols = colList.split(',').map((c) => c.trim());
		cols.forEach((c) => requireColumn(table, c));
		const vals = splitTopLevel(valList);
		if (vals.length !== cols.length) throw new Error(`fake db: ${cols.length} columns but ${vals.length} values: ${sql}`);
		const cursor = { next: 0 };
		const row: Row = {};
		cols.forEach((c, i) => { row[c] = literal(vals[i], args, cursor); });
		const known = requireTable(table);
		if (known.has('created_at') && row.created_at === undefined) row.created_at = nextCreatedAt();
		if (known.has('is_test') && row.is_test === undefined) row.is_test = false;
		if (known.has('status') && row.status === undefined && table === 'receivable_claims') row.status = 'active';
		const rows = rowsOf(table);
		if (conflictCols) {
			const keys = conflictCols.split(',').map((c) => c.trim());
			const existing = rows.find((r) => keys.every((k) => looseEq(r[k], row[k])));
			if (existing) {
				if (updateSet) {
					for (const part of splitTopLevel(updateSet)) {
						const [lhs, rhs] = part.split('=').map((x) => x.trim());
						const src = rhs.replace(/^excluded\./i, '');
						existing[lhs] = row[src];
					}
					return { rows: [], rowsAffected: 1 };
				}
				return { rows: [], rowsAffected: 0 };
			}
		} else {
			const pk = known.has('id') ? 'id' : known.has('token') ? 'token' : null;
			if (pk && rows.some((r) => looseEq(r[pk], row[pk]))) {
				throw new Error(`duplicate key value violates unique constraint on ${table}.${pk}`);
			}
		}
		rows.push(row);
		return { rows: [], rowsAffected: 1 };
	}

	function update(sql: string, args: unknown[]) {
		const m = sql.match(/^UPDATE (\w+) SET (.*?) WHERE (.*)$/i);
		if (!m) throw new Error(`fake db: unsupported UPDATE: ${sql}`);
		const [, table, setList, where] = m;
		requireTable(table);
		const assignments = splitTopLevel(setList).map((part) => {
			const eq = part.indexOf('=');
			return { col: part.slice(0, eq).trim(), expr: part.slice(eq + 1).trim() };
		});
		assignments.forEach((a) => requireColumn(table, a.col));
		const setCursor = { next: 0 };
		const values = assignments.map((a) => literal(a.expr, args, setCursor));
		const whereBase = { next: setCursor.next };
		const expr = new ExprParser(tokenize(where), whereBase).parse();
		exprColumns(expr).forEach((c) => requireColumn(table, c));
		let n = 0;
		for (const row of rowsOf(table)) {
			if (!evalExpr(expr, (c) => row[c], args)) continue;
			assignments.forEach((a, i) => { row[a.col] = values[i]; });
			n++;
		}
		return { rows: [], rowsAffected: n };
	}

	function select(sql: string, args: unknown[]) {
		const fromAt = sql.toUpperCase().indexOf(' FROM ');
		if (!sql.toUpperCase().startsWith('SELECT ') || fromAt < 0) throw new Error(`fake db: unsupported SELECT: ${sql}`);
		const selectList = sql.slice(7, fromAt).trim();
		let rest = sql.slice(fromAt + 6).trim();

		let limit: number | null = null;
		let limitParam = false;
		const lm = rest.match(/ LIMIT (\?|\d+)$/i);
		if (lm) { limitParam = lm[1] === '?'; if (!limitParam) limit = Number(lm[1]); rest = rest.slice(0, lm.index); }
		let order: { col: string; desc: boolean } | null = null;
		const om = rest.match(/ ORDER BY ([\w.]+)(?: (ASC|DESC))?$/i);
		if (om) { order = { col: om[1], desc: (om[2] || '').toUpperCase() === 'DESC' }; rest = rest.slice(0, om.index); }
		let where: string | null = null;
		const wAt = rest.toUpperCase().indexOf(' WHERE ');
		if (wAt >= 0) { where = rest.slice(wAt + 7); rest = rest.slice(0, wAt); }

		// FROM: "t" | "t a" | "t a JOIN u b ON b.x = a.y"
		const jm = rest.match(/^(\w+) (\w+) JOIN (\w+) (\w+) ON ([\w.]+) = ([\w.]+)$/i);
		const sm = rest.match(/^(\w+)(?: (\w+))?$/);
		type Source = { table: string; alias: string };
		let sources: Source[];
		let candidates: Array<Record<string, Row>>;
		if (jm) {
			const [, t1, a1, t2, a2, lhs, rhs] = jm;
			requireTable(t1); requireTable(t2);
			sources = [{ table: t1, alias: a1 }, { table: t2, alias: a2 }];
			candidates = [];
			for (const r1 of rowsOf(t1)) for (const r2 of rowsOf(t2)) candidates.push({ [a1]: r1, [a2]: r2 });
			const resolveIn = (pair: Record<string, Row>, ref: string) => { const [a, c] = ref.split('.'); return pair[a]?.[c]; };
			candidates = candidates.filter((pair) => looseEq(resolveIn(pair, lhs), resolveIn(pair, rhs)) && resolveIn(pair, lhs) != null);
		} else if (sm) {
			requireTable(sm[1]);
			sources = [{ table: sm[1], alias: sm[2] || sm[1] }];
			candidates = rowsOf(sm[1]).map((r) => ({ [sources[0].alias]: r }));
		} else {
			throw new Error(`fake db: unsupported FROM clause: ${rest}`);
		}

		// Resolve every column reference up front, so a missing column throws even when the
		// table is empty, the way Postgres plans a query before it reads a row.
		const resolve = (ref: string): { alias: string; col: string } => {
			if (ref.includes('.')) {
				const [a, c] = ref.split('.');
				const src = sources.find((s) => s.alias === a);
				if (!src) throw new Error(`fake db: unknown alias ${a}`);
				requireColumn(src.table, c);
				return { alias: a, col: c };
			}
			const owners = sources.filter((s) => columns.get(s.table)?.has(ref));
			if (!owners.length) throw new Error(`column "${ref}" does not exist`);
			if (owners.length > 1) throw new Error(`column reference "${ref}" is ambiguous`);
			return { alias: owners[0].alias, col: ref };
		};
		const getter = (pair: Record<string, Row>) => (ref: string): unknown => {
			const { alias, col } = resolve(ref);
			return pair[alias]?.[col];
		};

		const paramBase = { next: 0 };
		let matched = candidates;
		if (where) {
			const expr = new ExprParser(tokenize(where), paramBase).parse();
			exprColumns(expr).forEach(resolve);
			matched = matched.filter((pair) => evalExpr(expr, getter(pair), args));
		}
		if (order) resolve(order.col);
		if (limitParam) limit = Number(args[paramBase.next++]);
		if (order) {
			const o = order;
			matched = [...matched].sort((x, y) => {
				const c = compare(getter(x)(o.col), getter(y)(o.col));
				return o.desc ? -c : c;
			});
		}

		const items = splitTopLevel(selectList);
		const agg = items.length === 1 && items[0].match(/^(COUNT\(\*\)|COALESCE\(SUM\((\w+)\), 0\)) AS (\w+)$/i);
		for (const item of items) {
			if (agg || item === '*' || item === '1') continue;
			const am = item.match(/^([\w.]+)(?: AS (\w+))?$/i);
			if (!am) throw new Error(`fake db: unsupported select item: ${item}`);
			resolve(am[1]);
		}
		if (agg && agg[2]) resolve(agg[2]);
		if (agg) {
			const [, fn, sumCol, as] = agg;
			const value = fn.toUpperCase().startsWith('COUNT')
				? matched.length
				: matched.reduce((s, pair) => s + Number(getter(pair)(sumCol) ?? 0), 0);
			return { rows: [{ [as]: value }], rowsAffected: 0 };
		}
		if (limit != null) matched = matched.slice(0, limit);
		const rows = matched.map((pair) => {
			const out: Row = {};
			for (const item of items) {
				if (item === '*') {
					for (const s of sources) Object.assign(out, pair[s.alias]);
					continue;
				}
				if (item === '1') { out['?column?'] = 1; continue; }
				const am = item.match(/^([\w.]+)(?: AS (\w+))?$/i);
				if (!am) throw new Error(`fake db: unsupported select item: ${item}`);
				const key = am[2] || (am[1].includes('.') ? am[1].split('.')[1] : am[1]);
				const v = getter(pair)(am[1]);
				out[key] = v === undefined ? null : v;
			}
			return out;
		});
		return { rows, rowsAffected: 0 };
	}

	const fake: ReceivablesDbFake = {
		tables,
		columns,
		log,
		options,
		seed(table, row) {
			const r = { ...row };
			rowsOf(table).push(r);
			return r;
		},
		rows: (table) => rowsOf(table),
		statements: (match) => log.filter((s) => match.test(s.sql)),
		async execute(stmt) {
			const sql = normalizeSql(typeof stmt === 'string' ? stmt : stmt.sql);
			const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
			log.push({ sql, args });
			const head = sql.slice(0, 12).toUpperCase();
			if (head.startsWith('CREATE ') || head.startsWith('ALTER ')) { ddl(sql); return { rows: [], rowsAffected: 0 }; }
			if (head.startsWith('INSERT ')) return insert(sql, args);
			if (head.startsWith('UPDATE ')) return update(sql, args);
			if (head.startsWith('SELECT ')) return select(sql, args);
			throw new Error(`fake db: unsupported statement: ${sql}`);
		},
		async batch() {
			throw new Error('fake db: batch is not supported yet');
		},
	};
	return fake;
}
