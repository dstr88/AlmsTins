// Diagnose and restore the restricted web role's privileges (almstins_web, the role
// WEB_DATABASE_URL connects as for signed-in pages; see POSTGRES_MIGRATION.md phase 4).
// Dropping a database role revokes the grants it made, so deleting an old owner
// credential can strip almstins_web of table access and break every signed-in page.
// NOT run by db:migrate. Connects with the OWNER url (DATABASE_URL).
//
//   node --env-file=.env src/scripts/webRoleGrants.mjs           # dry run, read-only
//   node --env-file=.env src/scripts/webRoleGrants.mjs --apply   # grant, one transaction
//
// Prints role names and counts only, never a password or row data.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const ROLE = 'almstins_web';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
async function report(label) {
	const who = (await one('select current_user as u')).u;
	const exists = (await c.query('select 1 from pg_roles where rolname = $1', [ROLE])).rows.length > 0;
	if (!exists) {
		console.log(`${label}: connected as ${who}; role ${ROLE} does not exist`);
		return { exists };
	}
	const t = await one(`select count(*)::int as total,
		count(*) filter (where not has_table_privilege($1, format('%I.%I', schemaname, tablename), 'SELECT'))::int as no_select,
		count(*) filter (where not has_table_privilege($1, format('%I.%I', schemaname, tablename), 'INSERT'))::int as no_insert
		from pg_tables where schemaname = 'public'`, [ROLE]);
	const s = await one(`select count(*)::int as total,
		count(*) filter (where not has_sequence_privilege($1, c.oid, 'USAGE'))::int as no_usage
		from pg_class c join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public' and c.relkind = 'S'`, [ROLE]);
	const owners = (await c.query(`select tableowner, count(*)::int as n from pg_tables where schemaname = 'public' group by 1 order by 2 desc`)).rows
		.map((r) => `${r.tableowner}=${r.n}`).join(' ');
	console.log(`${label}: connected as ${who}; tables=${t.total} missing_select=${t.no_select} missing_insert=${t.no_insert}; sequences=${s.total} missing_usage=${s.no_usage}; table owners: ${owners}`);
	return { exists, missing: t.no_select + t.no_insert + s.no_usage };
}

const before = await report(APPLY ? 'BEFORE' : 'DRY RUN (read-only)');
let failed = false;
if (APPLY && before.exists) {
	await c.query('BEGIN');
	try {
		await c.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
		await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
		await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
		// Tables the owner creates later (runtime CREATE TABLE IF NOT EXISTS) get the same.
		await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
		await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`);
		await c.query('COMMIT');
		console.log('applied');
	} catch (e) {
		await c.query('ROLLBACK');
		failed = true;
		console.log(`ROLLED BACK, nothing changed: ${e.message}`);
	}
	await report('AFTER');
}
await c.end();
process.exit(failed ? 1 : 0);
