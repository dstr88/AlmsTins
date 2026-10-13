// Catch-up sync: bring Postgres into exact agreement with Turso by truncating +
// reloading ONLY the tables whose row counts differ. Safe to re-run (idempotent) —
// intended for the final pre-cutover sync. Runs as the owner (bypasses RLS).
// FK note: reloads a drifted child fine while its parent is intact; a drifted
// PARENT (rare) would need a full reload instead.
//   node --env-file=.env src/scripts/resyncDriftFromTurso.mjs
import pg from 'pg';
import { createClient } from '@libsql/client';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const coerce = (v) => (typeof v === 'bigint' ? v.toString() : (v ?? null));

const tabs = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")).rows.map((r) => r.table_name);

const drifted = [];
for (const t of tabs) {
	const p = (await c.query(`select count(*)::int n from "${t}"`)).rows[0].n;
	let u = 0; try { u = Number((await turso.execute(`select count(*) n from "${t}"`)).rows[0].n); } catch {}
	if (p !== u) drifted.push(t);
}
if (!drifted.length) { console.log('No drift — PG already matches Turso. Nothing to do.'); await c.end(); process.exit(0); }
console.log('Drifted tables (' + drifted.length + '): ' + drifted.join(', '));

const BATCH = 200;
let ok = 0, bad = 0;
for (const t of drifted) {
	await c.query(`TRUNCATE TABLE "${t}"`);
	const res = await turso.execute(`SELECT * FROM "${t}"`);
	if (res.rows.length) {
		const cols = res.columns; const colList = cols.map((x) => `"${x}"`).join(',');
		for (let i = 0; i < res.rows.length; i += BATCH) {
			const slice = res.rows.slice(i, i + BATCH); const params = [];
			const tuples = slice.map((row) => { const ph = cols.map((x) => { params.push(coerce(row[x])); return `$${params.length}`; }); return `(${ph.join(',')})`; });
			await c.query(`INSERT INTO "${t}" (${colList}) VALUES ${tuples.join(',')}`, params);
		}
	}
	const p = (await c.query(`select count(*)::int n from "${t}"`)).rows[0].n;
	const u = Number((await turso.execute(`select count(*) n from "${t}"`)).rows[0].n);
	const match = p === u; match ? ok++ : bad++;
	console.log(`  ${t}: reloaded ${res.rows.length}  (pg=${p} turso=${u}) ${match ? 'OK' : 'MISMATCH'}`);
}

// reset identity sequences for any reloaded identity columns
const idents = (await c.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND is_identity='YES'")).rows;
for (const { table_name: t, column_name: col } of idents) {
	if (drifted.includes(t)) await c.query(`SELECT setval(pg_get_serial_sequence($1,$2), GREATEST((SELECT COALESCE(MAX("${col}"),0) FROM "${t}"),1))`, [t, col]);
}
await c.end();
console.log(`\nCatch-up complete: ${ok} tables resynced, ${bad} mismatched.`);
process.exit(bad ? 1 : 0);
