import pg from 'pg';
import type { QueryResult } from 'pg';
import type { Client } from '@libsql/client';
import { getDbContext } from './dbContext';

// Postgres engine — a thin compatibility shim over node-postgres that mimics the
// libSQL Client surface the app already uses (db.execute / db.batch returning
// { rows, rowsAffected, columns }), so the ~800 existing call sites don't change.
// Selected by db.ts when DB_ENGINE=pg.
//
// Two roles for Row-Level Security:
//   • owner pool  (DATABASE_URL)     — crons, background jobs, migrations, and any
//                                      request with no tenant context. As table
//                                      owner under RLS ENABLE (not FORCE) it
//                                      bypasses policies — the trusted-system path.
//   • web pool    (WEB_DATABASE_URL) — a NON-owner, RLS-constrained role for
//                                      authenticated tenant requests. Each query
//                                      runs in a transaction that first sets
//                                      app.tenant_id / app.user_id LOCALLY, so the
//                                      value can never leak across pooled
//                                      connections.
// Until WEB_DATABASE_URL is set the web pool IS the owner pool and nothing is
// enforced — so this shim is safe to ship before the role and policies exist.

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

// libSQL's execute accepts BOTH execute({ sql, args }) and the two-positional
// form execute(sql, args) — the app uses both. `extraArgs` carries the second
// positional argument when the statement is a bare SQL string.
function norm(stmt: Stmt, extraArgs?: unknown[]): { text: string; values: unknown[] } {
	if (typeof stmt === 'string') {
		if (extraArgs !== undefined && !Array.isArray(extraArgs)) {
			throw new Error('[db.pg] named/object args are not supported by the Postgres shim');
		}
		return { text: toPg(stmt), values: extraArgs ?? [] };
	}
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

function makePool(connectionString: string): pg.Pool {
	const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
	const pool = new pg.Pool({
		connectionString,
		// Render Postgres requires SSL on external connections; rejectUnauthorized
		// is relaxed because Render presents its own CA on the public endpoint.
		ssl: isLocal ? false : { rejectUnauthorized: false },
		max: Number(process.env.PG_POOL_MAX ?? 10),
	});
	pool.on('error', (e) => console.error('[db] postgres pool error', e instanceof Error ? e.message : String(e)));
	return pool;
}

// Set app.tenant_id / app.user_id LOCAL to this transaction (is_local = true), so
// RLS policies see the right tenant and the value is discarded at COMMIT/ROLLBACK
// — it can never bleed into the next request that reuses this pooled connection.
async function setTenantGuc(client: pg.PoolClient, ctx: { tenantId: string | null; userId: string | null }) {
	await client.query({
		text: "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
		values: [ctx.tenantId ?? '', ctx.userId ?? ''],
	});
}

export function makePgDb(): Client {
	const ownerUrl = process.env.DATABASE_URL;
	if (!ownerUrl) {
		throw new Error('Missing DATABASE_URL (Postgres engine selected via DB_ENGINE=pg)');
	}

	const ownerPool = makePool(ownerUrl);
	const webUrl = process.env.WEB_DATABASE_URL;
	const webPool = webUrl ? makePool(webUrl) : ownerPool;
	const enforce = webPool !== ownerPool;

	const pingFlag = '__ledgerlense_pg_ping_logged__';
	const globalAny = globalThis as typeof globalThis & { [pingFlag]?: boolean };
	if (!globalAny[pingFlag]) {
		globalAny[pingFlag] = true;
		ownerPool.query('SELECT 1')
			.then(() => console.log('[db] postgres ping ok' + (enforce ? ' (RLS web role active)' : ' (single role — RLS not enforced)')))
			.catch((e) => console.error('[db] postgres ping failed', e instanceof Error ? e.message : String(e)));
	}

	// Tenant context only matters when a separate web role exists. Otherwise every
	// query goes to the owner pool (unchanged pre-RLS behavior).
	function tenantCtx() {
		if (!enforce) return null;
		const ctx = getDbContext();
		return ctx?.tenantId ? ctx : null;
	}

	async function execute(stmt: Stmt, execArgs?: unknown[]) {
		const { text, values } = norm(stmt, execArgs);
		const ctx = tenantCtx();
		if (!ctx) return shape(await ownerPool.query({ text, values }));

		const client = await webPool.connect();
		try {
			await client.query('BEGIN');
			await setTenantGuc(client, ctx);
			const r = await client.query({ text, values });
			await client.query('COMMIT');
			return shape(r);
		} catch (e) {
			await client.query('ROLLBACK').catch(() => {});
			throw e;
		} finally {
			client.release();
		}
	}

	async function batch(stmts: Stmt[], _mode?: string) {
		const ctx = tenantCtx();
		const client = await (ctx ? webPool : ownerPool).connect();
		try {
			await client.query('BEGIN');
			if (ctx) await setTenantGuc(client, ctx);
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
