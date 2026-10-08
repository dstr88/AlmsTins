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

// Tracks the in-flight (then settled) "set session time zone" query for each
// pooled client. pool.on('connect', ...) alone races: the pool hands a fresh
// client to the next pool.connect() caller without waiting for 'connect'
// listeners to finish, so that caller's first query could land on the wire
// while SET TIME ZONE is still executing on the same client — the exact
// "client.query() when the client is already executing a query" deprecation.
// getClient() below awaits this before returning the client to a caller.
const tzReady = new WeakMap<pg.PoolClient, Promise<void>>();

function makePool(connectionString: string): pg.Pool {
	// SSL selection by host:
	//   • Render EXTERNAL host (a public "*.render.com" domain) REQUIRES SSL.
	//   • Render INTERNAL host is a bare name with no domain and does NOT support
	//     SSL — forcing it there fails every connection (pg-pool connect error).
	//   • localhost / local IPs need no SSL.
	// Unparseable -> default to SSL (safe for the external case).
	let host = '';
	try { host = new URL(connectionString).hostname; } catch { /* leave blank -> SSL */ }
	const noSsl = host !== '' && (/^(localhost|127\.0\.0\.1|::1)$/.test(host) || !host.includes('.'));
	const pool = new pg.Pool({
		connectionString,
		ssl: noSsl ? false : { rejectUnauthorized: false },
		max: Number(process.env.PG_POOL_MAX ?? 10),
	});
	// Every session runs in UTC, whatever the server default. Ledger timestamps are
	// ISO-8601 UTC text, and a zone-less one ('2024-04-01 00:00:00') cast to
	// timestamptz is read in the session time zone; outside UTC, a DST change would
	// shift day counts such as the wash-sale window. Set after connect rather than as a
	// startup option, so a proxy that rejects startup options can't block connections.
	// Recorded in tzReady (not just fired here) so the first real query on this
	// client always waits for it instead of racing it — see getClient() below.
	pool.on('connect', (client) => {
		tzReady.set(
			client,
			client.query("SET TIME ZONE 'UTC'")
				.then(() => {})
				.catch((e: unknown) => {
					console.error('[db] could not set session time zone', e instanceof Error ? e.message : String(e));
				}),
		);
	});
	pool.on('error', (e) => console.error('[db] postgres pool error', e instanceof Error ? e.message : String(e)));
	return pool;
}

// Checks out a client and waits for its (once-per-connection) session setup
// to finish before handing it back. A client reused from an earlier checkout
// already has a settled promise in tzReady, so this costs nothing beyond the
// first checkout of a given physical connection.
async function getClient(pool: pg.Pool): Promise<pg.PoolClient> {
	const client = await pool.connect();
	await (tzReady.get(client) ?? Promise.resolve());
	return client;
}

// Runs one query against a client checked out — and released — just for it.
// The non-transactional equivalent of execute()'s client lifecycle, so every
// path that touches a client, not only the transactional one, is tz-safe.
async function withClient<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const client = await getClient(pool);
	try {
		return await fn(client);
	} finally {
		client.release();
	}
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
	// Match db.turso.ts: in Astro/Vite dev, .env lands in import.meta.env, not
	// process.env. Merge both (import.meta.env wins) so the URL resolves in dev
	// and on Render (real process.env) alike.
	const importMetaEnv = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {});
	const env = { ...process.env, ...importMetaEnv };
	const ownerUrl = env.DATABASE_URL;
	if (!ownerUrl) {
		throw new Error('Missing DATABASE_URL (Postgres engine selected via DB_ENGINE=pg)');
	}

	const ownerPool = makePool(ownerUrl);
	const webUrl = env.WEB_DATABASE_URL;
	const webPool = webUrl ? makePool(webUrl) : ownerPool;
	const enforce = webPool !== ownerPool;

	const pingFlag = '__ledgerlense_pg_ping_logged__';
	const globalAny = globalThis as typeof globalThis & { [pingFlag]?: boolean };
	if (!globalAny[pingFlag]) {
		globalAny[pingFlag] = true;
		withClient(ownerPool, (c) => c.query('SELECT 1'))
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

	// Idempotent schema DDL (the app's lazy ensureTable/ensureIndex patterns) must
	// run as the OWNER — the RLS-constrained web role has no CREATE on schema
	// public, so these would 500 with "permission denied". DDL is trusted schema
	// management (never tenant data), so owner routing is safe and keeps any newly
	// created table owned by the migration role. (DROP/TRUNCATE deliberately not
	// routed — they would bypass RLS and destroy data.)
	const isSchemaDDL = (text: string) => /^\s*(CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)|ALTER\s+TABLE)\b/i.test(text);

	async function execute(stmt: Stmt, execArgs?: unknown[]) {
		const { text, values } = norm(stmt, execArgs);
		if (isSchemaDDL(text)) return shape(await withClient(ownerPool, (c) => c.query({ text, values })));
		const ctx = tenantCtx();
		if (!ctx) return shape(await withClient(ownerPool, (c) => c.query({ text, values })));

		const client = await getClient(webPool);
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
		const normed = stmts.map((s) => norm(s));
		// A batch containing schema DDL runs as the owner (see execute()); otherwise
		// it honors the per-request tenant context.
		const ctx = normed.some((n) => isSchemaDDL(n.text)) ? null : tenantCtx();
		const client = await getClient(ctx ? webPool : ownerPool);
		try {
			await client.query('BEGIN');
			if (ctx) await setTenantGuc(client, ctx);
			const out = [];
			for (const { text, values } of normed) {
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
