/**
 * An in-memory stand-in for '@/lib/db' that runs the receivables registry's own SQL.
 *
 * Hermetic: no Postgres, no network. It parses the small SQL subset the registry uses
 * (CREATE TABLE / CREATE INDEX / ALTER TABLE ADD COLUMN, INSERT [ON CONFLICT], UPDATE, DELETE,
 * and single-table or one-[LEFT] JOIN SELECTs with AND / OR / IS NULL / LIKE / IN (?, ...) and a
 * correlated EXISTS (SELECT 1 FROM t c WHERE ...) in WHERE and ON, select items that are columns,
 * COALESCE(a, b, ...) AS x or a parenthesized comparison or EXISTS ((a = ?) AS x,
 * (EXISTS (...)) AS x) or a correlated sum ((SELECT COALESCE(SUM(c.col), 0) FROM t c WHERE ...)
 * AS x), ordered by one or more columns, COALESCE terms or parenthesized
 * expressions with ASC / DESC and NULLS FIRST / LAST) and evaluates it against
 * plain row objects. It also runs the Agent Vault's capped insert, INSERT INTO t (cols) SELECT ?, ... WHERE
 * (SELECT COUNT(*) FROM u WHERE ...) < ? (a row goes in only while the count is under the cap), and
 * accepts SELECT pg_advisory_xact_lock(<n>, hashtext(?)) as a lock that does nothing: with no
 * concurrency here, the real race is proved on a real Postgres, not in this stand-in.
 * db.batch runs its statements in order as one transaction: when one throws,
 * every table is put back the way it was before the batch. SET LOCAL lock_timeout is accepted and
 * does nothing (there are no locks here). Because the registry's real WHERE clauses run here, a dropped
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
	/** Make a DDL statement throw, as a lock timeout or a dropped connection would. Return true for
	 *  the fake's own error, or an Error to throw that one (e.g. carrying a SQLSTATE code). */
	failDdl?: (sql: string) => boolean | Error;
	/** Make an INSERT, UPDATE, DELETE or SELECT throw (normalized SQL and its arguments), e.g. mid-batch. */
	failDml?: (sql: string, args: unknown[]) => boolean;
}

export interface ExecutedStatement {
	sql: string;
	args: unknown[];
}

export interface ReceivablesDbFake {
	execute(stmt: string | { sql: string; args?: unknown[] }): Promise<{ rows: Row[]; rowsAffected: number }>;
	/** Runs the statements in order as one transaction: all of them land, or none do. */
	batch(stmts: Array<string | { sql: string; args?: unknown[] }>, mode?: string): Promise<Array<{ rows: Row[]; rowsAffected: number }>>;
	/** Rows by table. Seed directly; a relation still exists only after its CREATE ran. */
	tables: Map<string, Row[]>;
	/** Known columns by table, from CREATE TABLE and ALTER ... ADD COLUMN. */
	columns: Map<string, Set<string>>;
	/** Every statement executed, normalized, in order (batched statements included). */
	log: ExecutedStatement[];
	/** The statements of each db.batch call, in order, one list per call. */
	batches: ExecutedStatement[][];
	/** The db.batch calls that write data: every batch but the schema ensure's own (each column add
	 *  and index runs as a batch of SET LOCAL lock_timeout and the DDL statement). */
	dataBatches(): ExecutedStatement[][];
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
	| { kind: 'like'; not: boolean; left: Operand; right: Operand }
	| { kind: 'in'; left: Operand; items: Operand[] }
	/** NOT EXISTS (...) or NOT ( ... ): the negation of a whole condition. */
	| { kind: 'not'; inner: Expr }
	/** EXISTS (SELECT 1 FROM table alias WHERE ...): `where` may name the outer query's columns. */
	| { kind: 'exists'; table: string; alias: string; where: Expr };

/** What an EXISTS subquery reads: the fake's tables. */
interface Env {
	rowsOf(table: string): Row[];
	columns: Map<string, Set<string>>;
}

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
	private expect(v: string): void {
		const t = this.toks[this.pos++];
		if (!t || (t.t === 'word' ? t.v.toUpperCase() : t.v) !== v) throw new Error(`fake db: expected ${v} in WHERE, got ${t?.v}`);
	}
	/** EXISTS ( SELECT 1 FROM table [alias] WHERE <expr> ), after the EXISTS word. */
	private exists(): Expr {
		this.expect('(');
		this.expect('SELECT');
		const one = this.toks[this.pos++];
		if (!one || one.v !== '1') throw new Error('fake db: EXISTS supports only SELECT 1');
		this.expect('FROM');
		const table = this.toks[this.pos++];
		if (!table || table.t !== 'word') throw new Error('fake db: EXISTS needs a table');
		let alias = table.v;
		if (!this.peekWord('WHERE')) {
			const a = this.toks[this.pos++];
			if (!a || a.t !== 'word') throw new Error('fake db: EXISTS needs WHERE');
			alias = a.v;
		}
		this.expect('WHERE');
		const where = this.or();
		this.expect(')');
		return { kind: 'exists', table: table.v, alias, where };
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
		if (this.peekWord('NOT')) {
			const next = this.toks[this.pos + 1];
			if (next && ((next.t === 'word' && next.v.toUpperCase() === 'EXISTS') || (next.t === 'punct' && next.v === '('))) {
				this.pos++;
				return { kind: 'not', inner: this.primary() };
			}
		}
		if (this.peekWord('EXISTS')) { this.pos++; return this.exists(); }
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
		if (this.peekWord('IN')) {
			this.pos++;
			this.expect('(');
			const items: Operand[] = [this.operand()];
			while (this.toks[this.pos]?.v === ',') { this.pos++; items.push(this.operand()); }
			this.expect(')');
			return { kind: 'in', left, items };
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

/** The columns an expression names, outside any EXISTS (see existsNodes). */
function exprColumns(e: Expr, out: string[] = []): string[] {
	const op = (o: Operand) => { if (o.kind === 'col') out.push(o.name); };
	switch (e.kind) {
		case 'and': case 'or': exprColumns(e.left, out); exprColumns(e.right, out); break;
		case 'not': exprColumns(e.inner, out); break;
		case 'isnull': op(e.operand); break;
		case 'cmp': case 'like': op(e.left); op(e.right); break;
		case 'in': op(e.left); e.items.forEach(op); break;
		case 'exists': break;
	}
	return out;
}

/** The EXISTS subqueries in an expression, so their columns can be checked up front. */
function existsNodes(e: Expr, out: Array<Extract<Expr, { kind: 'exists' }>> = []): Array<Extract<Expr, { kind: 'exists' }>> {
	if (e.kind === 'and' || e.kind === 'or') { existsNodes(e.left, out); existsNodes(e.right, out); }
	if (e.kind === 'not') existsNodes(e.inner, out);
	if (e.kind === 'exists') out.push(e);
	return out;
}

/**
 * The rows of a correlated subquery's table that its WHERE keeps, for one outer row: an EXISTS, or
 * a scalar SUM in a select list. Inner names first (alias.col, or a bare column of the inner
 * table), then the outer row.
 */
function subqueryRows(q: { table: string; alias: string; where: Expr }, get: (col: string) => unknown, args: unknown[], env: Env): Row[] {
	const cols = env.columns.get(q.table);
	if (!cols) throw new Error(`relation "${q.table}" does not exist`);
	return env.rowsOf(q.table).filter((row) => evalExpr(q.where, (ref) => {
		if (ref.includes('.')) {
			const [a, c] = ref.split('.');
			return a === q.alias ? row[c] : get(ref);
		}
		return cols.has(ref) ? row[ref] : get(ref);
	}, args, env));
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

function evalExpr(e: Expr, get: (col: string) => unknown, args: unknown[], env?: Env): boolean {
	const val = (o: Operand): unknown => (o.kind === 'col' ? get(o.name) : o.kind === 'param' ? args[o.index] : o.value);
	switch (e.kind) {
		case 'and': return evalExpr(e.left, get, args, env) && evalExpr(e.right, get, args, env);
		case 'or': return evalExpr(e.left, get, args, env) || evalExpr(e.right, get, args, env);
		case 'not': return !evalExpr(e.inner, get, args, env);
		case 'exists': {
			if (!env) throw new Error('fake db: EXISTS is supported only in SELECT');
			return subqueryRows(e, get, args, env).length > 0;
		}
		case 'isnull': {
			const v = val(e.operand);
			const isNull = v === null || v === undefined;
			return e.not ? !isNull : isNull;
		}
		case 'in': {
			const l = val(e.left);
			return l != null && e.items.some((o) => { const r = val(o); return r != null && looseEq(l, r); });
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
		const fail = options.failDdl?.(sql);
		if (fail instanceof Error) throw fail;
		if (fail) throw new Error(`fake db: DDL failed on purpose: ${sql.slice(0, 80)}`);
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
		// INSERT INTO t (cols) SELECT ?, ... WHERE <guard> [AND (SELECT COUNT(*) FROM u [alias] WHERE <expr>) < ?]
		// The row goes in only while the guard holds (an EXISTS about another table, such as "the agent is
		// still live") and, when there is a count, while the count is under the cap; otherwise nothing is written.
		const cappedHead = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) SELECT (.*?) WHERE (.*)$/is);
		if (cappedHead) {
			const [, table, colList, valList, whereSrc] = cappedHead;
			const countAt = whereSrc.lastIndexOf('(SELECT COUNT(*) FROM ');
			const guardSrc = (countAt >= 0 ? whereSrc.slice(0, countAt) : whereSrc).replace(/\s+AND\s*$/i, '').trim();
			const placeholders = splitTopLevel(valList);
			const cursor = { next: placeholders.length };
			const guard = guardSrc ? new ExprParser(tokenize(guardSrc), cursor).parse() : null;
			if (guard && !evalExpr(guard, () => undefined, args, env)) return { rows: [], rowsAffected: 0 };
			if (countAt >= 0) {
				const count = whereSrc.slice(countAt).match(/^\(SELECT COUNT\(\*\) FROM (\w+)(?: (\w+))? WHERE (.*)\) < \?$/is);
				if (!count) throw new Error(`fake db: unsupported INSERT: ${sql}`);
				const [, countTable, countAlias = countTable, countWhere] = count;
				const where = new ExprParser(tokenize(countWhere), cursor).parse();
				const capIndex = cursor.next;
				const bare = (ref: string, row: Row): unknown => {
					if (!ref.includes('.')) return row[ref];
					const [a, c] = ref.split('.');
					return a === countAlias ? row[c] : undefined;
				};
				const used = rowsOf(countTable).filter((row) => evalExpr(where, (ref) => bare(ref, row), args, env)).length;
				const cap = Number(args[capIndex]);
				if (!(used < cap)) return { rows: [], rowsAffected: 0 };
			} else if (!guard) {
				throw new Error(`fake db: unsupported INSERT: ${sql}`);
			}
			return insert(`INSERT INTO ${table} (${colList}) VALUES (${valList})`, args.slice(0, placeholders.length));
		}
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
						// "col = <table>.col + 1": a counter bumped from the existing row.
						const inc = rhs.match(/^(?:\w+\.)?(\w+) \+ (\d+)$/);
						if (inc) { existing[lhs] = Number(existing[inc[1]] ?? 0) + Number(inc[2]); continue; }
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

	function del(sql: string, args: unknown[]) {
		const m = sql.match(/^DELETE FROM (\w+)(?: WHERE (.*))?$/i);
		if (!m) throw new Error(`fake db: unsupported DELETE: ${sql}`);
		const [, table, where] = m;
		requireTable(table);
		const expr = where ? new ExprParser(tokenize(where), { next: 0 }).parse() : null;
		if (expr) exprColumns(expr).forEach((c) => requireColumn(table, c));
		const rows = rowsOf(table);
		const keep = rows.filter((row) => expr && !evalExpr(expr, (c) => row[c], args));
		const n = rows.length - keep.length;
		rows.splice(0, rows.length, ...keep);
		return { rows: [], rowsAffected: n };
	}

	const env: Env = { rowsOf, columns };

	/** A value in a select list or ORDER BY: a column, a literal, ?, COALESCE(...), (<comparison>),
	 *  or a correlated (SELECT COALESCE(SUM(...), 0) ...). */
	type Value = { cols: string[]; exists: Array<Extract<Expr, { kind: 'exists' }>>; eval: (get: (c: string) => unknown, args: unknown[]) => unknown };
	function compileValue(src: string, paramBase: { next: number }): Value {
		const s = src.trim();
		const co = s.match(/^COALESCE\((.*)\)$/is);
		if (co) {
			const parts = splitTopLevel(co[1]).map((p) => compileValue(p, paramBase));
			return {
				cols: parts.flatMap((p) => p.cols),
				exists: parts.flatMap((p) => p.exists),
				eval: (get, args) => {
					for (const p of parts) {
						const v = p.eval(get, args);
						if (v !== null && v !== undefined) return v;
					}
					return null;
				},
			};
		}
		// A correlated scalar sum, (SELECT COALESCE(SUM(x.col), 0) FROM t x WHERE ...), evaluated per
		// outer row like an EXISTS: its WHERE may name the outer query's columns. No other scalar
		// subquery is understood, so (SELECT MAX(...) ...) or IN (SELECT ...) still throws.
		const sum = s.match(/^\(SELECT COALESCE\(SUM\(([\w.]+)\), 0\) FROM (\w+)(?: (\w+))? WHERE (.*)\)$/is);
		if (sum) {
			const [, sumRef, table, alias = table, whereSrc] = sum;
			let col = sumRef;
			if (sumRef.includes('.')) {
				const [a, c] = sumRef.split('.');
				if (a !== alias) throw new Error(`fake db: SUM must name the subquery's own table: ${s}`);
				col = c;
			}
			requireColumn(table, col);
			const where = new ExprParser(tokenize(whereSrc), paramBase).parse();
			// Its WHERE is scoped exactly like an EXISTS's, so select() checks it as one.
			const scope: Extract<Expr, { kind: 'exists' }> = { kind: 'exists', table, alias, where };
			return {
				cols: [],
				exists: [scope],
				eval: (get, args) => subqueryRows(scope, get, args, env)
					.reduce((total, row) => (row[col] == null ? total : total + Number(row[col])), 0),
			};
		}
		const paren = s.match(/^\((.*)\)$/s);
		if (paren) {
			const expr = new ExprParser(tokenize(paren[1]), paramBase).parse();
			return { cols: exprColumns(expr), exists: existsNodes(expr), eval: (get, args) => evalExpr(expr, get, args, env) };
		}
		if (s === '?') {
			const i = paramBase.next++;
			return { cols: [], exists: [], eval: (_get, args) => args[i] };
		}
		if (/^'.*'$/s.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /^(NULL|TRUE|FALSE)$/i.test(s)) {
			const v = literal(s, [], { next: 0 });
			return { cols: [], exists: [], eval: () => v };
		}
		if (/^[\w.]+$/.test(s)) return { cols: [s], exists: [], eval: (get) => get(s) };
		throw new Error(`fake db: unsupported value expression: ${s}`);
	}

	/** Where `kw` first appears at parenthesis depth 0, outside string literals, or -1. */
	function topLevelIndexOf(s: string, kw: string): number {
		const upper = s.toUpperCase();
		let depth = 0, inStr = false;
		for (let i = 0; i < s.length; i++) {
			const c = s[i];
			if (c === "'") inStr = !inStr;
			if (inStr) continue;
			if (c === '(') depth++;
			else if (c === ')') depth--;
			else if (depth === 0 && upper.startsWith(kw, i)) return i;
		}
		return -1;
	}

	function select(sql: string, args: unknown[]) {
		// The outer FROM: a select item may hold its own (EXISTS (SELECT 1 FROM ...)).
		const fromAt = topLevelIndexOf(sql, ' FROM ');
		if (!sql.toUpperCase().startsWith('SELECT ') || fromAt < 0) throw new Error(`fake db: unsupported SELECT: ${sql}`);
		const selectList = sql.slice(7, fromAt).trim();
		let rest = sql.slice(fromAt + 6).trim();

		let limit: number | null = null;
		let limitParam = false;
		const lm = rest.match(/ LIMIT (\?|\d+)$/i);
		if (lm) { limitParam = lm[1] === '?'; if (!limitParam) limit = Number(lm[1]); rest = rest.slice(0, lm.index); }
		let orderSrc: Array<{ expr: string; desc: boolean; nullsFirst: boolean }> = [];
		const oAt = rest.toUpperCase().lastIndexOf(' ORDER BY ');
		if (oAt >= 0) {
			orderSrc = splitTopLevel(rest.slice(oAt + 10)).map((term) => {
				const tm = term.match(/^(.+?)(?: (ASC|DESC))?(?: NULLS (FIRST|LAST))?$/is);
				if (!tm) throw new Error(`fake db: unsupported ORDER BY term: ${term}`);
				const desc = (tm[2] || '').toUpperCase() === 'DESC';
				// Postgres sorts NULL above every value: last when ascending, first when descending.
				return { expr: tm[1], desc, nullsFirst: tm[3] ? tm[3].toUpperCase() === 'FIRST' : desc };
			});
			rest = rest.slice(0, oAt);
		}
		let where: string | null = null;
		const wAt = rest.toUpperCase().indexOf(' WHERE ');
		if (wAt >= 0) { where = rest.slice(wAt + 7); rest = rest.slice(0, wAt); }

		// FROM: "t" | "t a" | "t a [LEFT] JOIN u b ON <condition>"
		const jm = rest.match(/^(\w+) (\w+) (LEFT )?JOIN (\w+) (\w+) ON (.+)$/i);
		const sm = rest.match(/^(\w+)(?: (\w+))?$/);
		type Source = { table: string; alias: string };
		let sources: Source[];
		let candidates: Array<Record<string, Row>>;
		let joinOn: { on: string; left: boolean; a1: string; a2: string; t1: string; t2: string } | null = null;
		if (jm) {
			const [, t1, a1, left, t2, a2, on] = jm;
			requireTable(t1); requireTable(t2);
			sources = [{ table: t1, alias: a1 }, { table: t2, alias: a2 }];
			candidates = [];
			joinOn = { on, left: !!left, a1, a2, t1, t2 };
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
		// An EXISTS names its own table's columns (by its alias, or bare), then those of any EXISTS it
		// sits inside (innermost first), then the outer query's: the order the rows are read in below.
		const checkExists = (nodes: Array<Extract<Expr, { kind: 'exists' }>>, enclosing: Array<Extract<Expr, { kind: 'exists' }>> = []) => {
			for (const n of nodes) {
				const inner = requireTable(n.table);
				const chain = [n, ...enclosing];
				for (const ref of exprColumns(n.where)) {
					if (ref.includes('.')) {
						const [a, c] = ref.split('.');
						const scope = chain.find((s) => s.alias === a);
						if (scope) requireColumn(scope.table, c); else resolve(ref);
					} else if (!inner.has(ref) && !enclosing.some((s) => requireTable(s.table).has(ref))) resolve(ref);
				}
				checkExists(existsNodes(n.where), chain);
			}
		};
		const getter = (pair: Record<string, Row>) => (ref: string): unknown => {
			const { alias, col } = resolve(ref);
			return pair[alias]?.[col];
		};

		// Parameters bind in the order they appear: the select list, then ON, WHERE, LIMIT.
		const paramBase = { next: 0 };
		const items = splitTopLevel(selectList);
		const agg = items.length === 1 && items[0].match(/^(COUNT\(\*\)|COALESCE\(SUM\((\w+)\), 0\)) AS (\w+)$/i);
		const compiled: Array<{ key: string; star?: true; one?: true; value?: Value }> = [];
		if (!agg) {
			for (const item of items) {
				if (item === '*') { compiled.push({ key: '*', star: true }); continue; }
				if (item === '1') { compiled.push({ key: '?column?', one: true }); continue; }
				const col = item.match(/^([\w.]+)(?: AS (\w+))?$/i);
				if (col) {
					resolve(col[1]);
					compiled.push({ key: col[2] || (col[1].includes('.') ? col[1].split('.')[1] : col[1]), value: compileValue(col[1], paramBase) });
					continue;
				}
				const computed = item.match(/^(.+) AS (\w+)$/is);
				if (!computed) throw new Error(`fake db: unsupported select item: ${item}`);
				const value = compileValue(computed[1], paramBase);
				value.cols.forEach(resolve);
				checkExists(value.exists);
				compiled.push({ key: computed[2], value });
			}
		}

		if (joinOn) {
			const on = new ExprParser(tokenize(joinOn.on), paramBase).parse();
			exprColumns(on).forEach(resolve);
			checkExists(existsNodes(on));
			for (const r1 of rowsOf(joinOn.t1)) {
				let hit = false;
				for (const r2 of rowsOf(joinOn.t2)) {
					const pair = { [joinOn.a1]: r1, [joinOn.a2]: r2 };
					if (evalExpr(on, getter(pair), args, env)) { candidates.push(pair); hit = true; }
				}
				if (!hit && joinOn.left) candidates.push({ [joinOn.a1]: r1 });
			}
		}
		let matched = candidates;
		if (where) {
			const expr = new ExprParser(tokenize(where), paramBase).parse();
			exprColumns(expr).forEach(resolve);
			checkExists(existsNodes(expr));
			matched = matched.filter((pair) => evalExpr(expr, getter(pair), args, env));
		}
		const order = orderSrc.map((o) => {
			const value = compileValue(o.expr, paramBase);
			value.cols.forEach(resolve);
			return { ...o, value };
		});
		if (limitParam) limit = Number(args[paramBase.next++]);
		if (order.length) {
			matched = [...matched].sort((x, y) => {
				for (const o of order) {
					const a = o.value.eval(getter(x), args), b = o.value.eval(getter(y), args);
					const an = a == null, bn = b == null;
					if (an || bn) {
						if (an && bn) continue;
						return an === o.nullsFirst ? -1 : 1;
					}
					const c = compare(a, b);
					if (c) return o.desc ? -c : c;
				}
				return 0;
			});
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
			for (const c of compiled) {
				if (c.star) {
					for (const s of sources) Object.assign(out, pair[s.alias]);
					continue;
				}
				if (c.one) { out['?column?'] = 1; continue; }
				const v = c.value!.eval(getter(pair), args);
				out[c.key] = v === undefined ? null : v;
			}
			return out;
		});
		return { rows, rowsAffected: 0 };
	}

	async function run(stmt: string | { sql: string; args?: unknown[] }) {
		const sql = normalizeSql(typeof stmt === 'string' ? stmt : stmt.sql);
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		const entry = { sql, args };
		log.push(entry);
		const head = sql.slice(0, 12).toUpperCase();
		if (head.startsWith('CREATE ') || head.startsWith('ALTER ')) { ddl(sql); return { entry, result: { rows: [], rowsAffected: 0 } }; }
		if (head.startsWith('SET ')) {
			if (!/^SET LOCAL lock_timeout = '\d+(ms|s)'$/i.test(sql)) throw new Error(`fake db: unsupported SET: ${sql}`);
			return { entry, result: { rows: [], rowsAffected: 0 } };
		}
		if (options.failDml?.(sql, args)) throw new Error(`fake db: statement failed on purpose: ${sql.slice(0, 80)}`);
		if (head.startsWith('INSERT ')) return { entry, result: insert(sql, args) };
		if (head.startsWith('UPDATE ')) return { entry, result: update(sql, args) };
		if (/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/i.test(sql)) {
			return { entry, result: { rows: [{ pg_advisory_xact_lock: '' }], rowsAffected: 0 } };
		}
		// The "look before you alter" lookup (src/lib/sessionGate.ts and src/lib/agenticsSignup.ts): which of these columns does the table have?
		const known = sql.match(/^SELECT column_name FROM information_schema\.columns WHERE table_schema = current_schema\(\) AND table_name = '(\w+)' AND column_name IN \(([^)]*)\)$/i);
		if (known) {
			const have = columns.get(known[1]);
			const wanted = known[2].split(',').map((c) => c.trim().replace(/^'|'$/g, ''));
			return { entry, result: { rows: wanted.filter((c) => have?.has(c)).map((c) => ({ column_name: c })), rowsAffected: 0 } };
		}
		if (head.startsWith('SELECT ')) return { entry, result: select(sql, args) };
		if (head.startsWith('DELETE ')) return { entry, result: del(sql, args) };
		throw new Error(`fake db: unsupported statement: ${sql}`);
	}

	const batches: ExecutedStatement[][] = [];

	const fake: ReceivablesDbFake = {
		tables,
		columns,
		log,
		batches,
		options,
		seed(table, row) {
			const r = { ...row };
			rowsOf(table).push(r);
			return r;
		},
		rows: (table) => rowsOf(table),
		statements: (match) => log.filter((s) => match.test(s.sql)),
		dataBatches: () => batches.filter((b) => !b.some((s) => /^(CREATE|ALTER|SET) /i.test(s.sql))),
		async execute(stmt) {
			return (await run(stmt)).result;
		},
		async batch(stmts) {
			// One transaction: remember every row's fields (and which rows and relations exist), and
			// put them back in place if any statement throws, so held row objects stay the live ones.
			const saved = new Map([...tables].map(([t, rows]) => [t, rows.map((r) => [r, { ...r }] as const)]));
			const savedColumns = new Map([...columns].map(([t, c]) => [t, new Set(c)]));
			const mine: ExecutedStatement[] = [];
			batches.push(mine);
			const out: Array<{ rows: Row[]; rowsAffected: number }> = [];
			try {
				for (const stmt of stmts) {
					const { entry, result } = await run(stmt);
					mine.push(entry);
					out.push(result);
				}
				return out;
			} catch (e) {
				for (const t of [...tables.keys()]) if (!saved.has(t)) tables.delete(t);
				for (const [t, pairs] of saved) {
					const live = rowsOf(t);
					live.splice(0, live.length, ...pairs.map(([row, fields]) => {
						for (const k of Object.keys(row)) delete row[k];
						return Object.assign(row, fields);
					}));
				}
				columns.clear();
				for (const [t, c] of savedColumns) columns.set(t, c);
				throw e;
			}
		},
	};
	return fake;
}
