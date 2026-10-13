// Copy all table data Turso -> Postgres.
// Run AFTER applyPgSchema (tables exist) and BEFORE the foreign-key file.
//   node --env-file=.env src/scripts/migrateData.mjs
//
// Idempotent on tables with a PK/UNIQUE (ON CONFLICT DO NOTHING). Tables with no
// unique constraint (e.g. request_log) would duplicate on a re-run — run once.
import { createClient } from '@libsql/client';
import pg from 'pg';

const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const pgUrl = process.env.DATABASE_URL;
if (!pgUrl) { console.error('Missing DATABASE_URL'); process.exit(1); }
const db = new pg.Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: tbls } = await db.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");

const coerce = (v) => (typeof v === 'bigint' ? v.toString() : v); // node-pg can't serialize BigInt
const BATCH = 100; // conservative — some rows carry big base64 blobs (tax_documents, screenshots)
let total = 0;

for (const { table_name: t } of tbls) {
  let res;
  try { res = await turso.execute(`SELECT * FROM "${t}"`); }
  catch (e) { console.warn(`  skip ${t}: ${e.message}`); continue; }
  if (!res.rows.length) continue;
  const cols = res.columns;
  const colList = cols.map((c) => `"${c}"`).join(',');
  let n = 0;
  for (let i = 0; i < res.rows.length; i += BATCH) {
    const slice = res.rows.slice(i, i + BATCH);
    const params = [];
    const tuples = slice.map((row) => {
      const ph = cols.map((c) => { params.push(coerce(row[c] ?? null)); return `$${params.length}`; });
      return `(${ph.join(',')})`;
    });
    try {
      await db.query(`INSERT INTO "${t}" (${colList}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, params);
      n += slice.length;
    } catch (e) {
      console.error(`  ERROR ${t} batch @${i}: ${e.message}`);
      throw e;
    }
  }
  total += n;
  console.log(`  ${t}: ${n}`);
}

// reset identity sequences so future auto-ids (wallet_check_log.id, demo_sessions.id) don't collide
const { rows: idents } = await db.query(
  "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND is_identity='YES'");
for (const { table_name: t, column_name: c } of idents) {
  await db.query(
    `SELECT setval(pg_get_serial_sequence($1,$2), GREATEST((SELECT COALESCE(MAX("${c}"),0) FROM "${t}"),1))`,
    [t, c]);
  console.log(`  seq reset: ${t}.${c}`);
}

console.log(`[migrate] ${total} rows copied`);
await db.end();
