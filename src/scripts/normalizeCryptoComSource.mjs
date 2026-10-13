// One-time, idempotent fix for rows the screenshot parsers saved with source 'crypto-com'
// (hyphen) instead of 'crypto_com', the value every other writer stores and pass1 reads
// (see src/lib/importSource.ts). NOT run by db:migrate.
//
//   node --env-file=.env src/scripts/normalizeCryptoComSource.mjs           # dry run, read-only
//   node --env-file=.env src/scripts/normalizeCryptoComSource.mjs --apply   # write
//
// Per tenant, each tenant in its own transaction, it rewrites only these values:
//   import_transactions.source, import_raw_rows.source, exchange_accounts.source
//       'crypto-com' → 'crypto_com'
//   wallets.address, address_labels.address
//       'cex:crypto-com:<account id>' → 'cex:crypto_com:<account id>'
//       (otherwise the next Sync All makes a second wallet for the account, and the old
//       wallet's last snapshot keeps counting in net worth)
//   address_labels where source = 'auto' AND label = 'crypto-com'
//       → label 'Crypto.com', category 'exchange', what the transfer matcher writes for a
//       crypto_com row. The hyphen made it write category 'own_wallet', which lets
//       autoClassify resolve transfers to that address without review.
//
// It never moves a row to another account or tenant, never deletes, and never touches a
// name or label a user typed (source = 'user'). A screenshot-made account stays its own
// account: it now shows in the Crypto.com tin with its name, wallet, snapshots and labels.
// Merging it into the CSV account is the user's decision, not this script's.
//
// Fails closed: if a tenant already has the 'crypto_com' twin of a wallet or cex label it
// would rename, that tenant is skipped and reported, and none of its rows change.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const OLD = 'crypto-com';
const NEW = 'crypto_com';
const OLD_CEX = `cex:${OLD}:`;
const NEW_CEX = `cex:${NEW}:`;
// Prefix compare with left(), not LIKE: '_' in 'crypto_com' is a LIKE wildcard.
const isOldCex = `left(address, ${OLD_CEX.length}) = '${OLD_CEX}'`;
const renamedCex = `'${NEW_CEX}' || substr(address, ${OLD_CEX.length + 1})`;

// [label, count query, update statement]; every statement is scoped by tenant_id = $1.
const STEPS = [
	['import_transactions',
		`select count(*)::int n from import_transactions where tenant_id = $1 and source = '${OLD}'`,
		`update import_transactions set source = '${NEW}' where tenant_id = $1 and source = '${OLD}'`],
	['import_raw_rows',
		`select count(*)::int n from import_raw_rows where tenant_id = $1 and source = '${OLD}'`,
		`update import_raw_rows set source = '${NEW}' where tenant_id = $1 and source = '${OLD}'`],
	['exchange_accounts',
		`select count(*)::int n from exchange_accounts where tenant_id = $1 and source = '${OLD}'`,
		`update exchange_accounts set source = '${NEW}' where tenant_id = $1 and source = '${OLD}'`],
	['wallets',
		`select count(*)::int n from wallets where tenant_id = $1 and ${isOldCex}`,
		`update wallets set address = ${renamedCex} where tenant_id = $1 and ${isOldCex}`],
	['cex_labels',
		`select count(*)::int n from address_labels where tenant_id = $1 and ${isOldCex}`,
		`update address_labels set address = ${renamedCex},
		        updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
		  where tenant_id = $1 and ${isOldCex}`],
	['auto_labels',
		`select count(*)::int n from address_labels where tenant_id = $1 and source = 'auto' and label = '${OLD}'`,
		`update address_labels set label = 'Crypto.com', category = 'exchange',
		        updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
		  where tenant_id = $1 and source = 'auto' and label = '${OLD}'`],
];

// Renames that would collide with a row the tenant already has (unique on tenant + address).
const CONFLICTS = `
	select (select count(*)::int from wallets w
	         where w.tenant_id = $1 and left(w.address, ${OLD_CEX.length}) = '${OLD_CEX}'
	           and exists (select 1 from wallets t where t.tenant_id = w.tenant_id
	                         and t.address = '${NEW_CEX}' || substr(w.address, ${OLD_CEX.length + 1})))
	     + (select count(*)::int from address_labels a
	         where a.tenant_id = $1 and left(a.address, ${OLD_CEX.length}) = '${OLD_CEX}'
	           and exists (select 1 from address_labels t where t.tenant_id = a.tenant_id
	                         and t.address = '${NEW_CEX}' || substr(a.address, ${OLD_CEX.length + 1})
	                         and coalesce(t.phone_number, '') = coalesce(a.phone_number, ''))) as n`;

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const tenants = (await c.query(`
	select tenant_id from import_transactions where source = '${OLD}'
	union select tenant_id from import_raw_rows where source = '${OLD}'
	union select tenant_id from exchange_accounts where source = '${OLD}'
	union select tenant_id from wallets where ${isOldCex}
	union select tenant_id from address_labels where ${isOldCex} or (source = 'auto' and label = '${OLD}')
	order by 1`)).rows.map((r) => String(r.tenant_id));

console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}: ${tenants.length} tenant(s) with '${OLD}' rows`);

let failed = 0;
for (const tenantId of tenants) {
	const plan = {};
	for (const [label, count] of STEPS) plan[label] = (await c.query(count, [tenantId])).rows[0].n;
	const summary = Object.entries(plan).map(([k, n]) => `${k}=${n}`).join(' ');

	const clashes = (await c.query(CONFLICTS, [tenantId])).rows[0].n;
	if (clashes > 0) {
		failed++;
		console.log(`  ${tenantId}  ${summary}  SKIPPED: ${clashes} rename(s) would collide with an existing '${NEW}' row`);
		continue;
	}
	if (!APPLY) {
		console.log(`  ${tenantId}  ${summary}`);
		continue;
	}

	await c.query('BEGIN');
	try {
		for (const [label, , update] of STEPS) {
			const { rowCount } = await c.query(update, [tenantId]);
			if (rowCount !== plan[label]) throw new Error(`${label}: updated ${rowCount}, planned ${plan[label]}`);
		}
		await c.query('COMMIT');
		console.log(`  ${tenantId}  ${summary}  applied`);
	} catch (e) {
		await c.query('ROLLBACK');
		failed++;
		console.log(`  ${tenantId}  ${summary}  ROLLED BACK, nothing changed: ${e.message}`);
	}
}

await c.end();
if (failed) {
	console.log(`${failed} tenant(s) not normalized; see above.`);
	process.exit(1);
}
