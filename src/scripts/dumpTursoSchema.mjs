// Dump the live Turso schema (tables + indexes) as CREATE statements.
// Ground-truth source for the Postgres DDL translation in the migration.
//
//   node --env-file=.env src/scripts/dumpTursoSchema.mjs > /tmp/turso-schema.sql
//
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (run with --env-file=.env)');
  process.exit(1);
}

const db = createClient({ url, authToken });
const r = await db.execute(
  "SELECT type, name, tbl_name, sql FROM sqlite_master " +
  "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' " +
  "ORDER BY (type='table') DESC, tbl_name, name",
);

const parts = r.rows.map((row) => `-- ${row.type}: ${row.name}\n${row.sql};`);
process.stdout.write(parts.join('\n\n') + '\n');
console.error(`[dump] ${r.rows.length} objects (${r.rows.filter((x) => x.type === 'table').length} tables)`);
process.exit(0);
