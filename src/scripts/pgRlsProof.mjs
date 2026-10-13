// Phase 4 — prove the RLS policy *logic* in isolation, against real Postgres RLS
// semantics. Uses temp tables with FORCE ROW LEVEL SECURITY (so the connecting
// owner is itself subject to the policy) to exercise the exact policy expressions
// the migration attaches to real tables: tenant_id, user_id, and the FK subquery.
// Everything is inside one transaction and ROLLED BACK — the database is untouched.
//   node --env-file=.env src/scripts/pgRlsProof.mjs
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label); } };
const setT = (t) => c.query("select set_config('app.tenant_id', $1, true)", [t]);
const setU = (u) => c.query("select set_config('app.user_id', $1, true)", [u]);
const ids = async (sql) => (await c.query(sql)).rows.map((r) => r.id);
// A statement that violates a policy raises an error, which aborts the whole
// transaction. Wrap expected-failures in a savepoint so the proof can continue.
const expectBlocked = async (sql) => {
	await c.query('SAVEPOINT sp');
	try { await c.query(sql); await c.query('RELEASE SAVEPOINT sp'); return false; }
	catch { await c.query('ROLLBACK TO SAVEPOINT sp'); return true; }
};

await c.query('BEGIN');
try {
	// ── tenant_id policy (67 tables use this exact expression) ──
	console.log('— tenant_isolation (tenant_id = app.tenant_id) —');
	await c.query(`CREATE TEMP TABLE _t (id text primary key, tenant_id text, v text) ON COMMIT DROP`);
	await c.query(`ALTER TABLE _t ENABLE ROW LEVEL SECURITY`);
	await c.query(`ALTER TABLE _t FORCE ROW LEVEL SECURITY`);
	await c.query(`CREATE POLICY p ON _t USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`);
	await setT('A'); await c.query(`INSERT INTO _t VALUES ('a','A','x')`);
	await setT('B'); await c.query(`INSERT INTO _t VALUES ('b','B','x')`);
	await setT('A'); ok((await ids('select id from _t')).join() === 'a', 'tenant A sees only its own row');
	await setT('B'); ok((await ids('select id from _t')).join() === 'b', 'tenant B sees only its own row');
	await setT('NOPE'); ok((await ids('select id from _t')).length === 0, 'tenant with no data sees nothing');
	await c.query('RESET app.tenant_id'); ok((await ids('select id from _t')).length === 0, 'UNSET tenant sees nothing (fail-closed)');
	await setT('A');
	ok(await expectBlocked(`INSERT INTO _t VALUES ('z','B','x')`), "WITH CHECK blocks inserting another tenant's row");
	ok(await expectBlocked(`UPDATE _t SET tenant_id='B' WHERE id='a'`) && (await ids("select id from _t where tenant_id='A'")).join() === 'a', "WITH CHECK blocks moving a row to another tenant");

	// ── user_id policy (alert_preferences, tracked_assets, pinned_watchlist) ──
	console.log('— user_isolation (user_id = app.user_id) —');
	await c.query(`CREATE TEMP TABLE _u (id text primary key, user_id text) ON COMMIT DROP`);
	await c.query(`ALTER TABLE _u ENABLE ROW LEVEL SECURITY`);
	await c.query(`ALTER TABLE _u FORCE ROW LEVEL SECURITY`);
	await c.query(`CREATE POLICY p ON _u USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true))`);
	await setU('u1'); await c.query(`INSERT INTO _u VALUES ('p','u1')`);
	await setU('u2'); await c.query(`INSERT INTO _u VALUES ('q','u2')`);
	await setU('u1'); ok((await ids('select id from _u')).join() === 'p', 'user u1 sees only its own row');
	await c.query('RESET app.user_id'); ok((await ids('select id from _u')).length === 0, 'UNSET user sees nothing (fail-closed)');

	// ── FK-subquery policy (protocol_events via wallets.tenant_id) ──
	console.log('— tenant_via_wallets (wallet_id IN tenant wallets) —');
	await c.query(`CREATE TEMP TABLE _w (id text primary key, tenant_id text) ON COMMIT DROP`);
	await c.query(`CREATE TEMP TABLE _e (id text primary key, wallet_id text) ON COMMIT DROP`);
	await c.query(`INSERT INTO _w VALUES ('wA','A'),('wB','B')`);
	await c.query(`ALTER TABLE _e ENABLE ROW LEVEL SECURITY`);
	await c.query(`ALTER TABLE _e FORCE ROW LEVEL SECURITY`);
	await c.query(`CREATE POLICY p ON _e USING (wallet_id IN (SELECT id FROM _w WHERE tenant_id = current_setting('app.tenant_id', true))) WITH CHECK (wallet_id IN (SELECT id FROM _w WHERE tenant_id = current_setting('app.tenant_id', true)))`);
	await setT('A'); await c.query(`INSERT INTO _e VALUES ('eA','wA')`);
	await setT('B'); await c.query(`INSERT INTO _e VALUES ('eB','wB')`);
	await setT('A'); ok((await ids('select id from _e')).join() === 'eA', "tenant A sees only its own wallet's events");
	await c.query('RESET app.tenant_id'); ok((await ids('select id from _e')).length === 0, 'UNSET tenant sees no events (fail-closed)');

	await c.query('ROLLBACK');
	console.log('  (rolled back — PG untouched)');
} catch (e) {
	fail++; await c.query('ROLLBACK').catch(() => {});
	console.log('  FAIL  proof block ERROR: ' + e.message);
}

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
await c.end();
process.exit(fail ? 1 : 0);
