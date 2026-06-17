import pg from 'pg';
import type { QueryResult } from 'pg';
import type { Client } from '@libsql/client';

// Postgres engine — a thin compatibility shim over node-postgres that mimics the
// libSQL Client surface the app already uses (db.execute / db.batch returning
// { rows, rowsAffected, columns }), so the ~800 existing call sites don't change.
// Selected by db.ts when DB_ENGINE=pg.

// Parity with SQLite's numeric returns: node-postgres hands back bigint (oid 20)
// and numeric (oid 1700) as strings; SQLite gave numbers. Coerce so COUNT(*) and
// numeric columns behave the same (e.g. `if (count > 0)`, `total + 1`).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

type Stmt = string | { sql: string; args?: unknown[] };

// libSQL uses `?` placeholders; Postgres uses `$1,$2,...`. Rewrite positionally,
// skipping any `?` that sits inside a single-quoted string literal.
function toPg(sql: string): string {
  let out = '';
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      inStr = !inStr;
      out += c;
    } else if (c === '?' && !inStr) {
      out += '$' + String(++n);
    } else {
      out += c;
    }
  }
  return out;
}

function norm(stmt: Stmt): { text: string; values: unknown[] } {
  if (typeof stmt === 'string') return { text: toPg(stmt), values: [] };
  const args = stmt.args ?? [];
  if (!Array.isArray(args)) {
    throw new Error('[db.pg] named/object args are not supported by the Postgres shim');
  }
  return { text: toPg(stmt.sql), values: args };
}

function shape(r: QueryResult) {
  return {
    rows: r.rows,
    rowsAffected: r.rowCount ?? 0,
    lastInsertRowid: undefined,
    columns: (r.fields ?? []).map((f) => f.name),
  };
}

export function makePgDb(): Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL (Postgres engine selected via DB_ENGINE=pg)');
  }

  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    // Render Postgres requires SSL on external connections; rejectUnauthorized
    // is relaxed because Render presents its own CA on the public endpoint.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });
  pool.on('error', (e) => console.error('[db] postgres pool error', e instanceof Error ? e.message : String(e)));

  const pingFlag = '__ledgerlense_pg_ping_logged__';
  const globalAny = globalThis as typeof globalThis & { [pingFlag]?: boolean };
  if (!globalAny[pingFlag]) {
    globalAny[pingFlag] = true;
    pool.query('SELECT 1')
      .then(() => console.log('[db] postgres ping ok'))
      .catch((e) => console.error('[db] postgres ping failed', e instanceof Error ? e.message : String(e)));
  }

  async function execute(stmt: Stmt) {
    const { text, values } = norm(stmt);
    return shape(await pool.query({ text, values }));
  }

  async function batch(stmts: Stmt[], _mode?: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = [];
      for (const s of stmts) {
        const { text, values } = norm(s);
        out.push(shape(await client.query({ text, values })));
      }
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Cast through unknown: the shim implements the execute/batch subset the app
  // uses; the full libSQL Client type is broader but unused.
  return { execute, batch } as unknown as Client;
}
