/**
 * A few in-memory tables that answer the two statement shapes the chain syncs write with:
 *
 *   INSERT INTO t (a, b, …) VALUES (?, 'lit', NULL, to_char(…), …) ON CONFLICT DO NOTHING
 *   UPDATE t SET c = ? WHERE x = ? AND y = ? AND c IS NULL
 *
 * An INSERT is skipped (rowsAffected 0) when a row already holds the same values in every column
 * of one of `uniqueKeys` for that table, as Postgres does for ON CONFLICT DO NOTHING. An UPDATE
 * applies its SET to exactly the rows its WHERE matches, so a missing filter shows up as a
 * changed row. Anything else is not handled here (the caller answers it).
 */

export type MemRow = Record<string, unknown>;

/** Split on commas that are not inside parentheses or quotes. */
function splitTop(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quote = false;
	let cur = '';
	for (const ch of list) {
		if (ch === "'") quote = !quote;
		if (!quote && ch === '(') depth++;
		if (!quote && ch === ')') depth--;
		if (!quote && depth === 0 && ch === ',') {
			out.push(cur.trim());
			cur = '';
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

/** The text between the parenthesis at `open` and its match. */
function group(sql: string, open: number): string {
	let depth = 0;
	for (let i = open; i < sql.length; i++) {
		if (sql[i] === '(') depth++;
		if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
	}
	throw new Error('unbalanced parentheses');
}

export class MemoryTables {
	readonly rows = new Map<string, MemRow[]>();

	constructor(private readonly uniqueKeys: Record<string, string[][]>) {
		for (const t of Object.keys(uniqueKeys)) this.rows.set(t, []);
	}

	table(name: string): MemRow[] {
		return this.rows.get(name)!;
	}

	/** rowsAffected for a statement on a known table, or null when this class does not handle it. */
	run(sql: string, args: unknown[]): number | null {
		const ins = sql.match(/^\s*INSERT INTO\s+(\w+)\s*\(/i);
		if (ins && this.rows.has(ins[1])) return this.insert(ins[1], sql, args);
		const upd = sql.match(/^\s*UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
		if (upd && this.rows.has(upd[1])) return this.update(upd[1], upd[2], upd[3], args);
		return null;
	}

	private insert(table: string, sql: string, args: unknown[]): number {
		if (!/ON CONFLICT DO NOTHING/i.test(sql)) throw new Error(`unexpected insert into ${table}`);
		const cols = splitTop(group(sql, sql.indexOf('('))).map((c) => c.toLowerCase());
		const values = splitTop(group(sql, sql.indexOf('(', sql.search(/VALUES\s*\(/i))));
		if (cols.length !== values.length) throw new Error(`${cols.length} columns, ${values.length} values`);
		let next = 0;
		const row: MemRow = {};
		cols.forEach((c, i) => {
			const v = values[i];
			row[c] = v === '?' ? args[next++] : /^NULL$/i.test(v) ? null : /^'.*'$/.test(v) ? v.slice(1, -1) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : `<${v}>`;
		});
		if (next !== args.length) throw new Error(`${args.length} args for ${next} placeholders`);
		const rows = this.table(table);
		const clash = this.uniqueKeys[table].some((key) => rows.some((r) => key.every((k) => r[k] === row[k])));
		if (clash) return 0;
		rows.push(row);
		return 1;
	}

	private update(table: string, set: string, where: string, args: unknown[]): number {
		let next = 0;
		const sets = splitTop(set).map((s) => {
			const m = s.match(/^(\w+)\s*=\s*\?$/);
			if (!m) throw new Error(`unsupported SET ${s}`);
			return [m[1], args[next++]] as const;
		});
		const conds = where.split(/\s+AND\s+/i).map((c) => c.trim()).map((c) => {
			const eq = c.match(/^(\w+)\s*=\s*\?$/);
			if (eq) {
				const v = args[next++];
				return (r: MemRow) => r[eq[1]] === v;
			}
			const isNull = c.match(/^(\w+)\s+IS NULL$/i);
			if (isNull) return (r: MemRow) => r[isNull[1]] == null;
			throw new Error(`unsupported WHERE ${c}`);
		});
		if (next !== args.length) throw new Error(`${args.length} args for ${next} placeholders`);
		let n = 0;
		for (const r of this.table(table)) {
			if (conds.every((f) => f(r))) {
				for (const [c, v] of sets) r[c] = v;
				n++;
			}
		}
		return n;
	}
}
