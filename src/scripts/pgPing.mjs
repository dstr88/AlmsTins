// Verify DATABASE_URL connects to Render Postgres. Prints host (not credentials).
//   node --env-file=.env src/scripts/pgPing.mjs
import pg from 'pg';

const u = process.env.DATABASE_URL;
if (!u) { console.log('MISSING: DATABASE_URL is not set in .env'); process.exit(0); }
const host = (u.match(/@([^/:?]+)/) || [])[1] || '(unparseable)';
const internal = /\.render\.com/.test(host) ? '' : (/dpg-\w+(-a)?$/.test(host) ? '  ⚠ looks like the INTERNAL host (use the External URL)' : '');

const c = new pg.Client({ connectionString: u, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const v = await c.query('select version()');
  const t = await c.query("select count(*)::int n from information_schema.tables where table_schema='public'");
  console.log('CONNECTED  host=' + host + internal);
  console.log(' ' + v.rows[0].version.split(/\s+/).slice(0, 2).join(' '));
  console.log(' public tables already present: ' + t.rows[0].n);
} catch (e) {
  console.log('CONNECT FAILED: ' + e.message + '  (host=' + host + internal + ')');
} finally {
  await c.end();
}
