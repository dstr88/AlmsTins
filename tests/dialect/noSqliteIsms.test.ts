import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard against SQLite-only SQL coming back into runtime code. Postgres is the only engine
 * (src/lib/db.ts -> db.pg.ts), and its shim rewrites nothing but `?` -> `$n`, so each of these
 * fails at query time or silently changes a result, usually inside a catch that hides it:
 *   - SQLite date, string and JSON functions, INSERT OR ..., PRAGMA, COLLATE NOCASE and
 *     `LIMIT offset, count` do not exist in Postgres (42883 / 42601);
 *   - a parameter Postgres cannot type fails with 42P18: one that is only tested for NULL
 *     (`? IS NULL`; use `col IS NOT DISTINCT FROM ?` or `CAST(? AS TEXT) IS NULL`), or a bare
 *     `?` passed to a function that takes "any" (jsonb_build_object, concat, format);
 *   - two-argument ROUND exists only for numeric, so ROUND(double, n) fails (42883);
 *   - REAL is a 4-byte float on Postgres (8-byte on SQLite): CAST(x AS REAL) loses precision
 *     and throws above ~3.4e38;
 *   - a `?` or an odd number of apostrophes inside a SQL comment (`-- ...` or a block comment)
 *     throws off the shim's quote tracking, so later placeholders are misnumbered.
 *
 * No database: this only reads source files under src/, skipping src/scripts (one-off,
 * hand-run tools, some of which read the retired SQLite database on purpose) and the retired
 * SQLite engine itself.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const ROOT = path.dirname(SRC);
const SKIP_DIRS = [path.join(SRC, 'scripts')];
const SKIP_FILES = [path.join(SRC, 'lib', 'db.turso.ts')];
const EXTENSIONS = /\.(ts|tsx|astro|js|mjs)$/;

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'strftime()', re: /\bstrftime\s*\(/i },
  { name: 'julianday()', re: /\bjulianday\s*\(/i },
  // A call, not prose such as "ISO datetime (UTC)": the first argument is a placeholder, a
  // string literal or a lowercase column reference.
  { name: 'datetime()', re: /\b(?:datetime|DATETIME)\s*\(\s*(?:\?|'|[a-z_][a-z0-9_.]*\s*[,)])/ },
  // date()/time() with 'now' or a SQLite modifier. One-argument date(col) is a valid Postgres
  // cast, and JS `new Date(...)` / `x.date(...)` are not SQL.
  { name: "date()/time() with 'now' or a modifier", re: /(?<![\w.$])(?<!new\s)(?:date|time|DATE|TIME)\s*\(\s*(?:'now'|[^()'`]*,\s*'[^']*')/ },
  { name: 'SQLite-only function', re: /(?<![\w.$])(?:unixepoch|iif|instr|printf|randomblob|last_insert_rowid|total_changes|json_group_array|json_group_object)\s*\(/i },
  { name: 'IFNULL()', re: /\bIFNULL\s*\(/i },
  { name: 'GROUP_CONCAT()', re: /\bGROUP_CONCAT\s*\(/i },
  { name: 'json_extract()', re: /\bjson_extract\s*\(/i },
  { name: 'INSERT OR ...', re: /\bINSERT\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\b/i },
  { name: 'PRAGMA', re: /\bPRAGMA\s+[a-z_]+/i },
  { name: 'COLLATE NOCASE', re: /\bCOLLATE\s+NOCASE\b/i },
  { name: 'LIMIT offset, count', re: /\bLIMIT\s+(?:\?|\d+)\s*,\s*(?:\?|\d+)/i },
  { name: "datetime('now')", re: /\bdatetime\s*\(\s*'now'/i },
  { name: "date('now')", re: /\bdate\s*\(\s*'now'/i },
  { name: 'sqlite_master', re: /\bsqlite_master\b/i },
  { name: 'REAL cast', re: /\bAS\s+REAL\s*\)|::\s*real\b/i },
  { name: 'untyped ? IS [NOT] NULL', re: /\?\s*\)?\s*IS\s+(NOT\s+)?NULL\b/i },
];

// Known, reviewed exceptions: [repo-relative file, pattern name, why].
const ALLOW: Array<[string, string, string]> = [
  // SUM(ms_total) is bigint, so the expression is numeric and round(numeric, int) resolves.
  ['src/pages/dashboard/analytics.astro', 'ROUND(double, n)', 'numeric argument'],
  // Sign and zero tests on sui_transactions.amount; left for the tax-engine precision audit.
  ['src/lib/annualBreakdown.ts', 'REAL cast', 'pending tax-engine audit'],
];

// ── Call-argument helpers (for checks a regex cannot express) ───────────────────────────────

// The top-level, comma-separated arguments of the call whose `(` is at `open`, or null when
// the parentheses do not close. Quotes are skipped so a ',' or ')' in a literal is ignored.
function callArgs(text: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      current += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '(') depth++;
    if (c === ')') {
      if (depth === 0) { args.push(current.trim()); return args; }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
  }
  return null;
}

// Functions that take "any": Postgres cannot type a bare `?` passed straight to them.
const VARIADIC_ANY = /(?<![\w.$])(?:jsonb?_build_(?:object|array)|concat_ws|concat|format)\s*\(/gi;
function bareParamInVariadicAny(text: string): number[] {
  const hits: number[] = [];
  for (const m of text.matchAll(VARIADIC_ANY)) {
    const args = callArgs(text, (m.index ?? 0) + m[0].length - 1);
    if (args?.some((a) => a === '?')) hits.push(m.index ?? 0);
  }
  return hits;
}

// Uppercase SQL ROUND with a precision argument whose value is not visibly numeric. (JS
// Math.round and lowercase helpers are not SQL.)
function roundOnNonNumeric(text: string): number[] {
  const hits: number[] = [];
  for (const m of text.matchAll(/(?<![\w.$])ROUND\s*\(/g)) {
    const args = callArgs(text, (m.index ?? 0) + m[0].length - 1);
    if (args && args.length === 2 && !/numeric/i.test(args[0])) hits.push(m.index ?? 0);
  }
  return hits;
}

// ── SQL comments vs. the shim's placeholder numbering ────────────────────────────────────────

// Where db.pg.ts toPg() puts $n: every `?` outside a single-quoted literal. It knows nothing
// about comments or quoted identifiers.
function shimPlaceholders(sql: string): number[] {
  const out: number[] = [];
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") inStr = !inStr;
    else if (sql[i] === '?' && !inStr) out.push(i);
  }
  return out;
}

// Where Postgres actually sees placeholders: string literals, quoted identifiers, `--` line
// comments and block comments all hide a `?`.
function realPlaceholders(sql: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      if (end === -1) break;
      i = end; // '' inside a literal just closes and reopens it
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) break;
      i = end;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (c === '?') {
      out.push(i);
    }
  }
  return out;
}

// True when a comment (or a quoted identifier) makes the shim number placeholders differently
// from how Postgres reads the statement.
function commentBreaksPlaceholders(sql: string): boolean {
  return JSON.stringify(shimPlaceholders(sql)) !== JSON.stringify(realPlaceholders(sql));
}

const LOOKS_LIKE_SQL = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|UNIQUE\s+INDEX|INDEX)|ALTER\s+TABLE)\b/;

// Template-literal bodies in JS/TS source, each ${...} replaced by `0`, with the offset of the
// opening backtick. A small tokenizer: skips comments, quoted strings and regex literals, and
// follows ${...} into nested code and nested templates.
function templateLiterals(src: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^']);
  const REGEX_AFTER_WORD = /^(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

  function readTemplate(start: number): number {
    let text = '';
    let i = start + 1;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out.push({ text, start }); return i + 1; }
      if (c === '$' && src[i + 1] === '{') { i = readCode(i + 2, true); text += '0'; continue; }
      text += c;
      i++;
    }
    return i;
  }

  // Reads code from `start`. With `inExpr`, stops after the `}` that closes a ${...}.
  function readCode(start: number, inExpr: boolean): number {
    let depth = 0;
    let prev = '';
    let prevWord = '';
    let i = start;
    while (i < src.length) {
      const c = src[i];
      const next = src[i + 1];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && next === '/') { const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; continue; }
      if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue; }
      if (c === "'" || c === '"') {
        i++;
        while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
        i++;
        prev = c; prevWord = '';
        continue;
      }
      if (c === '`') { i = readTemplate(i); prev = '`'; prevWord = ''; continue; }
      if (c === '/' && (prev === '' || REGEX_AFTER.has(prev) || REGEX_AFTER_WORD.test(prevWord))) {
        let inClass = false;
        i++;
        while (i < src.length && src[i] !== '\n') {
          const r = src[i];
          if (r === '\\') { i += 2; continue; }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) { i++; break; }
          i++;
        }
        while (i < src.length && /[a-z]/i.test(src[i])) i++;
        prev = '/'; prevWord = '';
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < src.length && /[\w$]/.test(src[j])) j++;
        prevWord = src.slice(i, j);
        prev = src[j - 1];
        i = j;
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (inExpr && depth === 0) return i + 1;
        depth--;
      }
      prev = c; prevWord = '';
      i++;
    }
    return i;
  }

  readCode(0, false);
  return out;
}

// The code segments of a file: the whole file, or for .astro its frontmatter and <script>s.
function codeSegments(file: string, text: string): Array<{ code: string; offset: number }> {
  if (!file.endsWith('.astro')) return [{ code: text, offset: 0 }];
  const segments: Array<{ code: string; offset: number }> = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (fm) segments.push({ code: fm[1], offset: fm.index + fm[0].indexOf(fm[1]) });
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    segments.push({ code: m[1], offset: (m.index ?? 0) + m[0].indexOf(m[1]) });
  }
  return segments;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.includes(full)) walk(full, out);
    } else if (EXTENSIONS.test(entry.name) && !SKIP_FILES.includes(full)) {
      out.push(full);
    }
  }
  return out;
}

function scan(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    const lineOf = (index: number) => text.slice(0, index).split('\n').length;
    const add = (name: string, index: number) => {
      if (!ALLOW.some(([f, n]) => f === rel && n === name)) hits.push(`${rel}:${lineOf(index)}: ${name}`);
    };
    // Whole-file matching, so a pattern split across lines (`?` on one line, `IS NULL` on
    // the next) is still caught.
    for (const { name, re } of PATTERNS) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g'))) add(name, m.index ?? 0);
    }
    for (const i of bareParamInVariadicAny(text)) add('bare ? passed to a function taking "any"', i);
    for (const i of roundOnNonNumeric(text)) add('ROUND(double, n)', i);
    for (const { code, offset } of codeSegments(file, text)) {
      for (const lit of templateLiterals(code)) {
        if (LOOKS_LIKE_SQL.test(lit.text) && commentBreaksPlaceholders(lit.text)) {
          add('a ? or apostrophe in a SQL comment breaks placeholder numbering', offset + lit.start);
        }
      }
    }
  }
  return hits;
}

describe('no SQLite-only SQL in runtime code', () => {
  const files = walk(SRC);

  it('walks the runtime source tree', () => {
    const rel = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(files.length).toBeGreaterThan(600);
    expect(rel).toContain('src/pages/api/account/alert-preferences.ts');
    expect(rel).toContain('src/pages/dashboard/yearEnd/report.astro');
    expect(rel.some((f) => f.startsWith('src/scripts/'))).toBe(false);
    expect(rel).not.toContain('src/lib/db.turso.ts');
  });

  it('finds SQL template literals to check, including .astro frontmatter', () => {
    const report = path.join(SRC, 'pages', 'dashboard', 'yearEnd', 'report.astro');
    const text = fs.readFileSync(report, 'utf8');
    const sql = codeSegments(report, text)
      .flatMap(({ code }) => templateLiterals(code))
      .filter((l) => LOOKS_LIKE_SQL.test(l.text));
    expect(sql.length).toBeGreaterThan(5);
  });

  it('finds none of the patterns', () => {
    expect(scan(files)).toEqual([]);
  });
});

// Canaries: each check must still catch what it is for, and must not flag the Postgres
// forms that replaced it.
describe('guard patterns (canaries)', () => {
  const matches = (s: string) => PATTERNS.filter(({ re }) => re.test(s)).map(({ name }) => name);

  it.each([
    ["SELECT DISTINCT strftime('%Y', timestamp_utc) AS y", 'strftime()'],
    ['ABS(julianday(a) - julianday(b)) <= 30', 'julianday()'],
    ["WHERE created_at > datetime(?, '-7 days')", 'datetime()'],
    ['ORDER BY datetime(created_at) DESC', 'datetime()'],
    ["GROUP BY date(timestamp_utc, 'start of month')", "date()/time() with 'now' or a modifier"],
    ["WHERE day = date('now')", "date()/time() with 'now' or a modifier"],
    ['SELECT unixepoch(created_at)', 'SQLite-only function'],
    ["SELECT iif(amount > 0, 'in', 'out')", 'SQLite-only function'],
    ['WHERE instr(description, ?) > 0', 'SQLite-only function'],
    ['SELECT json_group_array(symbol)', 'SQLite-only function'],
    ['SELECT last_insert_rowid()', 'SQLite-only function'],
    ['SELECT IFNULL(amount, 0)', 'IFNULL()'],
    ["SELECT GROUP_CONCAT(symbol, ',')", 'GROUP_CONCAT()'],
    ['INSERT OR IGNORE INTO address_labels', 'INSERT OR ...'],
    ['insert or replace into kv', 'INSERT OR ...'],
    ['INSERT OR ABORT INTO kv', 'INSERT OR ...'],
    ['PRAGMA table_info(wallets)', 'PRAGMA'],
    ['WHERE label = ? COLLATE NOCASE', 'COLLATE NOCASE'],
    ['ORDER BY ts LIMIT ?, ?', 'LIMIT offset, count'],
    ['LIMIT 20, 10', 'LIMIT offset, count'],
    ["json_extract(snapshot_json, '$.timestamp')", 'json_extract()'],
    ["created_at TEXT DEFAULT (datetime('now'))", "datetime('now')"],
    ["SELECT name FROM sqlite_master WHERE type = 'table'", 'sqlite_master'],
    ['SELECT CAST(value AS REAL) AS qty', 'REAL cast'],
    ['WHERE value::real > 0', 'REAL cast'],
    ['AND (wallet_id = ? OR (? IS NULL AND wallet_id IS NULL))', 'untyped ? IS [NOT] NULL'],
    ['AND (? IS NOT NULL)', 'untyped ? IS [NOT] NULL'],
    ['AND (wallet_id = ? OR (?\n        IS NULL AND wallet_id IS NULL))', 'untyped ? IS [NOT] NULL'],
  ])('flags %s', (sql, name) => {
    expect(matches(sql)).toContain(name);
  });

  it.each([
    'AND wallet_id IS NOT DISTINCT FROM ?',
    'SELECT DISTINCT substr(timestamp_utc, 1, 4) AS y',
    'AND (wallet_id = ? OR (CAST(? AS TEXT) IS NULL AND wallet_id IS NULL))',
    'AND (?::text IS NULL OR folder = ?)',
    'AND col IS NULL',
    "substr(COALESCE(snapshot_json::jsonb ->> 'timestamp', created_at), 1, 4) = ?",
    'SELECT CAST(value AS double precision) AS qty',
    "SELECT date_trunc('day', now())",
    'WHERE date(created_at) = CURRENT_DATE',
    '/** ISO datetime (UTC) the destination was proven */',
    "  Transaction Hash, DateTime (UTC), From, To",
    'const d = new Date(year, 0, 1);',
    "const s = format(d, 'yyyy-MM-dd');",
    'ORDER BY ts LIMIT ? OFFSET ?',
    'The instructions: select a wallet, then (optionally) a date.',
  ])('allows %s', (sql) => {
    expect(matches(sql)).toEqual([]);
  });

  it('flags a bare ? passed to a function taking "any", not a typed one', () => {
    expect(bareParamInVariadicAny("SELECT jsonb_build_object('wallet', ?)")).toHaveLength(1);
    expect(bareParamInVariadicAny("SELECT concat('x', ?, 'y')")).toHaveLength(1);
    expect(bareParamInVariadicAny("SELECT jsonb_build_object('wallet', CAST(? AS text))")).toEqual([]);
    expect(bareParamInVariadicAny("SELECT json_build_object('wallet', ?::text)")).toEqual([]);
    expect(bareParamInVariadicAny('const all = list.concat(a ? b : c);')).toEqual([]);
  });

  it('flags ROUND(x, n) unless x is numeric', () => {
    expect(roundOnNonNumeric('ROUND(SUM(ABS(COALESCE(native_usd,0))),0) AS value_usd')).toHaveLength(1);
    expect(roundOnNonNumeric('ROUND(p.max_price, 8) AS max_price')).toHaveLength(1);
    expect(roundOnNonNumeric('ROUND(CAST(SUM(native_usd) AS numeric), 0)')).toEqual([]);
    expect(roundOnNonNumeric('ROUND(AVG(duration_s))')).toEqual([]);
    expect(roundOnNonNumeric('Math.round(x * 100) / 100')).toEqual([]);
  });

  it('flags a SQL comment that would break placeholder numbering', () => {
    expect(commentBreaksPlaceholders("SELECT a,\n  -- Wallet label: match the user's wallet\n  b FROM t WHERE id = ?")).toBe(true);
    expect(commentBreaksPlaceholders('SELECT a -- which row? the latest\n FROM t WHERE id = ?')).toBe(true);
    expect(commentBreaksPlaceholders("SELECT a --the user's wallet\n FROM t WHERE id = ?")).toBe(true);
    expect(commentBreaksPlaceholders("SELECT a /* the user's wallet */ FROM t WHERE id = ?")).toBe(true);
    expect(commentBreaksPlaceholders('SELECT a /* why? */ FROM t WHERE id = ?')).toBe(true);
  });

  it('allows balanced quotes in comments, quoted literals and identifiers', () => {
    expect(commentBreaksPlaceholders("discount TEXT NOT NULL, -- 'free_year' | 'half_off'\n WHERE id = ?")).toBe(false);
    expect(commentBreaksPlaceholders("SELECT 'it''s', ? FROM t")).toBe(false);
    expect(commentBreaksPlaceholders(`SELECT to_char(now(), 'YYYY-MM-DD"T"HH24') WHERE a = ?`)).toBe(false);
    expect(commentBreaksPlaceholders('SELECT a -- Personal label for from_address\n WHERE id = ?')).toBe(false);
    expect(commentBreaksPlaceholders("SELECT '-- not a comment?' , ? FROM t")).toBe(false);
  });

  it('extracts template literals, skipping comments, strings and regex literals', () => {
    const src = [
      "// the user's wallet? (a JS comment, not SQL)",
      'const a = await db.execute(`SELECT a -- the user\'s\n FROM t WHERE id = ?`);',
      "const re = /'`/g; const s = \"it's `not` a template\";",
      'const b = `SELECT 1 FROM t WHERE x = ${ok ? `AND y = ?` : \'\'} AND z = ?`;',
      'const half = total / 2; const c = `plain ${half}`;',
    ].join('\n');
    const lits = templateLiterals(src).map((l) => l.text);
    expect(lits).toEqual([
      "SELECT a -- the user's\n FROM t WHERE id = ?",
      'AND y = ?',
      'SELECT 1 FROM t WHERE x = 0 AND z = ?',
      'plain 0',
    ]);
    const flagged = lits.filter((t) => LOOKS_LIKE_SQL.test(t) && commentBreaksPlaceholders(t));
    expect(flagged).toEqual([lits[0]]);
  });
});
