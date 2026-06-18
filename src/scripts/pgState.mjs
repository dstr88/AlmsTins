// Read-only Postgres state probe for the migration. Prints table/FK/RLS state
// and row counts for key tables. No writes.
//   node --env-file=.env src/scripts/pgState.mjs
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const tabs = (await c.query(
  "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
)).rows.map((r) => r.table_name);

const fks = (await c.query(
  "select count(*)::int n from information_schema.table_constraints where table_schema='public' and constraint_type='FOREIGN KEY'",
)).rows[0].n;

const rls = (await c.query(
  "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
)).rows[0].n;

// Total rows across all public tables (is data loaded yet?)
let totalRows = 0;
const nonEmpty = [];
for (const t of tabs) {
  try {
    const n = (await c.query(`select count(*)::int n from "${t}"`)).rows[0].n;
    totalRows += n;
    if (n > 0) nonEmpty.push(`${t}=${n}`);
  } catch (e) { nonEmpty.push(`${t}=ERR`); }
}

console.log('TABLES: ' + tabs.length);
console.log('FKS: ' + fks);
console.log('RLS_TABLES: ' + rls);
console.log('TOTAL_ROWS: ' + totalRows);
console.log('NONEMPTY: ' + (nonEmpty.length ? nonEmpty.join('  ') : '(all empty)'));
console.log('TABLELIST: ' + tabs.join(','));
await c.end();
