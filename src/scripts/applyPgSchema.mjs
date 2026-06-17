// Apply a .sql file to the Render Postgres DB (DATABASE_URL).
//   node --env-file=.env src/scripts/applyPgSchema.mjs /tmp/pg-schema.sql
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }
const file = process.argv[2] || '/tmp/pg-schema.sql';
const sql = fs.readFileSync(file, 'utf8');

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query(sql); // multi-statement → single implicit transaction (all-or-nothing)
  const r = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
  console.log(`[apply] OK: ${file} — public tables now: ${r.rows[0].n}`);
} catch (e) {
  console.error('[apply] FAILED:', e.message);
  if (e.position) {
    const p = Number(e.position);
    console.error('  near:', JSON.stringify(sql.slice(Math.max(0, p - 90), p + 60)));
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
