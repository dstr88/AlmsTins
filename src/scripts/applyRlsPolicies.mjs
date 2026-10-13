// Phase 4 — apply the RLS policy migration to Postgres (owner connection).
// PG-only; NOT run by db:migrate. The SQL file wraps everything in a single
// BEGIN; ... COMMIT; so a failure rolls the whole thing back. Re-runnable
// (each policy is DROP POLICY IF EXISTS first).
//   node --env-file=.env src/scripts/applyRlsPolicies.mjs
import pg from 'pg';
import fs from 'node:fs';

const sqlPath = 'src/scripts/sql/20260618_rls_policies.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');

const owner = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await owner.connect();
try {
	await owner.query(sql);
	console.log('applied ' + sqlPath);
} catch (e) {
	console.error('APPLY FAILED (transaction rolled back, nothing changed): ' + e.message);
	await owner.end();
	process.exit(1);
}
const rls = (await owner.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")).rows[0].n;
const pol = (await owner.query("select count(*)::int n from pg_policies where schemaname='public'")).rows[0].n;
console.log('RLS-enabled tables: ' + rls + '  |  policies: ' + pol + '   (expect 74 / 72)');
await owner.end();

// Confirm the web role is now subject to RLS on real tables (fail-closed, no GUC set).
if (process.env.WEB_DATABASE_URL) {
	const web = new pg.Client({ connectionString: process.env.WEB_DATABASE_URL, ssl: { rejectUnauthorized: false } });
	await web.connect();
	const who = (await web.query('select current_user u')).rows[0].u;
	const visible = (await web.query('select count(*)::int n from import_transactions')).rows[0].n;
	const onTable = (await web.query("select count(*)::int n from pg_policies where schemaname='public' and tablename='import_transactions'")).rows[0].n;
	await web.end();
	console.log('VERIFY as ' + who + ' (no app.tenant_id set): import_transactions visible rows = ' + visible + '  | policies on that table = ' + onTable);
	console.log('  (0 visible + policy present = RLS active & fail-closed; full with-data isolation check comes after the data move)');
} else {
	console.log('WEB_DATABASE_URL not set — skipping web-role verification');
}
