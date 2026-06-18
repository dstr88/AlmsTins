// Phase 2 (dialect parity): execute the exact SQLite->PG translations from
// Phase 1 against the REAL (empty) Render schema, to prove Postgres accepts
// every construct. Writes are wrapped in a transaction and ROLLED BACK, so the
// database stays pristine for the Phase 3 data load.
//   node --env-file=.env src/scripts/pgParity.mjs
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let pass = 0, fail = 0;
async function check(label, sql, params = [], expect = null) {
  try {
    const r = await c.query(sql, params);
    let ok = true, got = '';
    if (expect) { got = JSON.stringify(r.rows); ok = got === JSON.stringify(expect); }
    if (ok) { pass++; console.log('  PASS  ' + label + (expect ? '  => ' + got : '')); }
    else { fail++; console.log('  FAIL  ' + label + '  expected ' + JSON.stringify(expect) + ' got ' + got); }
  } catch (e) { fail++; console.log('  FAIL  ' + label + '  ERROR: ' + e.message); }
}

console.log('— translated default/timestamp constructs —');
await check('to_char space  (datetime/CURRENT_TIMESTAMP)', `select to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') v`);
await check('to_char ISO    (strftime ISO)',               `select to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') v`);
await check('substr year    (strftime %Y)',  `select substr('2026-06-18T09:30:00Z',1,4) v`, [], [{ v: '2026' }]);
await check('substr month   (strftime %Y-%m)',`select substr('2026-06-18T09:30:00Z',1,7) v`, [], [{ v: '2026-06' }]);
await check('uuid default   (randomblob)',    `select length(lower(replace(gen_random_uuid()::text,'-',''))) v`, [], [{ v: 32 }]);
await check('relative date  (datetime -N days)', `select (now() - interval '30 days') < now() v`, [], [{ v: true }]);

console.log('— PRAGMA table_info -> information_schema —');
await check('column introspection', `select column_name AS name from information_schema.columns where table_schema='public' and table_name='import_transactions' limit 1`);

console.log('— real app queries run verbatim against real (empty) tables —');
await check('demo/stats today  (to_char)',  `SELECT COUNT(*) as n FROM demo_sessions WHERE started_at >= to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"00:00:00"Z"')`);
await check('demo/stats 7d     (to_char+interval)', `SELECT COUNT(*) as n FROM demo_sessions WHERE started_at >= to_char((now() - interval '7 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

console.log('— ON CONFLICT behavior (temp table, transactional) —');
try {
  await c.query('BEGIN');
  await c.query(`CREATE TEMP TABLE _parity_oc (id text primary key, v int, tenant_id text, address text, UNIQUE(tenant_id, address)) ON COMMIT DROP`);
  await c.query(`INSERT INTO _parity_oc (id,v,tenant_id,address) VALUES ('a',1,'t','x') ON CONFLICT DO NOTHING`);
  await c.query(`INSERT INTO _parity_oc (id,v,tenant_id,address) VALUES ('a',2,'t','x') ON CONFLICT DO NOTHING`); // no-op (id pk)
  const afterNothing = (await c.query(`select v from _parity_oc where id='a'`)).rows[0].v;
  if (afterNothing === 1) { pass++; console.log('  PASS  ON CONFLICT DO NOTHING keeps original (v=1)'); }
  else { fail++; console.log('  FAIL  ON CONFLICT DO NOTHING  v=' + afterNothing); }
  // conflict on the UNIQUE(tenant_id,address) of row a -> DO UPDATE
  await c.query(`INSERT INTO _parity_oc (id,v,tenant_id,address) VALUES ('b',5,'t','x') ON CONFLICT (tenant_id,address) DO UPDATE SET v=excluded.v`);
  const rows = (await c.query(`select id,v from _parity_oc order by id`)).rows;
  if (rows.length === 1 && rows[0].id === 'a' && rows[0].v === 5) { pass++; console.log('  PASS  ON CONFLICT (cols) DO UPDATE SET =excluded (v=5, one row)'); }
  else { fail++; console.log('  FAIL  ON CONFLICT DO UPDATE  rows=' + JSON.stringify(rows)); }
  await c.query('ROLLBACK');
  console.log('  (rolled back — PG untouched)');
} catch (e) { fail++; await c.query('ROLLBACK').catch(() => {}); console.log('  FAIL  ON CONFLICT block  ERROR: ' + e.message); }

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
await c.end();
process.exit(fail ? 1 : 0);
