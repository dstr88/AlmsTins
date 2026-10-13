// Read-only check: does import_transactions (or import_raw_rows) still carry a GLOBAL unique
// constraint on row_hash? NOT run by db:migrate, changes nothing, has no --apply.
//
//   node --env-file=.env src/scripts/checkImportRowHashUnique.mjs
//
// Why: migrations/0001_crypto_com.sql declared `row_hash TEXT NOT NULL UNIQUE` on both tables.
// 0009_exchange_accounts.sql added the per-account unique index (tenant_id, account_id,
// row_hash) but never dropped that inline UNIQUE, and the Postgres schema was converted from
// the Turso one. Every importer inserts with a bare `ON CONFLICT DO NOTHING`, so if the global
// constraint is still there, an identical row in a second account (or a second account
// holder) is skipped without a word, and the history by wallet export undercounts it.
//
// Prints, for both tables:
//   - every unique index or constraint and its columns, flagging a global row_hash one and a
//     (tenant_id, row_hash) one that ignores the account;
//   - how many row_hash values appear under more than one account within the same tenant
//     (always 0 while a global unique exists), and in more than one tenant;
//   - how many imported rows have no account (they land in the "unassigned" bucket).
// Counts and schema names only: never a row, a hash, a tenant or an account id.
//
// Runs inside a READ ONLY transaction that is rolled back.
import pg from 'pg';

if (process.argv.includes('--apply')) {
	console.error('This script is read-only; there is nothing to apply.');
	process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const TABLES = ['import_transactions', 'import_raw_rows'];
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);
const c = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
await c.connect();

let failed = false;
try {
	await c.query('BEGIN READ ONLY');

	const idx = await c.query(
		`SELECT t.relname AS table_name, i.relname AS index_name, ix.indisprimary AS is_primary,
		        (SELECT array_agg(a.attname ORDER BY k.ord)
		           FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
		           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS columns
		   FROM pg_index ix
		   JOIN pg_class t ON t.oid = ix.indrelid
		   JOIN pg_class i ON i.oid = ix.indexrelid
		   JOIN pg_namespace n ON n.oid = t.relnamespace
		  WHERE ix.indisunique AND n.nspname = current_schema() AND t.relname = ANY($1)
		  ORDER BY t.relname, i.relname`,
		[TABLES],
	);

	let globalFound = false;
	for (const table of TABLES) {
		const rows = idx.rows.filter((r) => r.table_name === table);
		console.log(`\n${table}: ${rows.length} unique index(es)`);
		for (const r of rows) {
			const cols = Array.isArray(r.columns) ? r.columns : String(r.columns ?? '').replace(/[{}]/g, '').split(',');
			const shape = cols.join(', ');
			let flag = '';
			if (cols.length === 1 && cols[0] === 'row_hash') {
				flag = '  <-- GLOBAL unique on row_hash (identical rows in two accounts or two tenants are skipped)';
				globalFound = true;
			} else if (cols.length === 2 && cols.includes('tenant_id') && cols.includes('row_hash')) {
				flag = '  <-- per-tenant unique that ignores the account (identical rows in two accounts are skipped)';
				globalFound = true;
			}
			console.log(`  ${r.index_name}${r.is_primary ? ' (primary key)' : ''}: (${shape})${flag}`);
		}
	}

	for (const table of TABLES) {
		const cols = await c.query(
			`SELECT column_name FROM information_schema.columns
			  WHERE table_schema = current_schema() AND table_name = $1 AND column_name IN ('tenant_id', 'account_id', 'row_hash')`,
			[table],
		);
		if (cols.rowCount < 3) {
			console.log(`\n${table}: missing tenant_id, account_id or row_hash, skipping the counts`);
			continue;
		}
		const shared = await c.query(
			`SELECT count(*)::int AS hashes, coalesce(sum(n), 0)::int AS rows, count(DISTINCT tenant_id)::int AS tenants
			   FROM (SELECT tenant_id, row_hash, count(*) AS n
			           FROM ${table}
			          GROUP BY tenant_id, row_hash
			         HAVING count(DISTINCT coalesce(account_id, '')) > 1) x`,
		);
		const crossTenant = await c.query(
			`SELECT count(*)::int AS hashes
			   FROM (SELECT row_hash FROM ${table} GROUP BY row_hash HAVING count(DISTINCT tenant_id) > 1) x`,
		);
		const unassigned = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE account_id IS NULL`);
		const s = shared.rows[0];
		console.log(`\n${table}:`);
		console.log(`  row_hash values shared by 2+ accounts in the same tenant: ${s.hashes} (${s.rows} rows, ${s.tenants} tenant(s))`);
		console.log(`  row_hash values present in 2+ tenants: ${crossTenant.rows[0].hashes}`);
		console.log(`  rows with no account (unassigned): ${unassigned.rows[0].n}`);
	}

	console.log(
		globalFound
			? '\nRESULT: a unique constraint that ignores the account EXISTS. Do not change it from this script; see the PR.'
			: '\nRESULT: no global row_hash unique constraint; uniqueness includes the account.',
	);
} catch (e) {
	failed = true;
	console.error('FAILED:', e.message);
} finally {
	await c.query('ROLLBACK').catch(() => {});
	await c.end();
}
process.exit(failed ? 1 : 0);
