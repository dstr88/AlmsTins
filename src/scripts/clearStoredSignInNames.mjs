// One-time, idempotent cleanup for privacy policy v1.2 (2026-10-10): clears the names,
// photos and provider tokens that sign-in saved before the fix. NOT run by db:migrate.
//
//   node --env-file=.env src/scripts/clearStoredSignInNames.mjs           # dry run, read-only
//   node --env-file=.env src/scripts/clearStoredSignInNames.mjs --apply   # write
//
// Sets to NULL, and changes nothing else:
//   auth_users.name, auth_users.image
//       (older OAuth sign-ins and signups saved the provider's name and photo)
//   auth_accounts.id_token, auth_accounts.access_token, auth_accounts.refresh_token
//       (Google's id_token carries the person's name, photo and email; the access and
//       refresh tokens open their provider profile; nothing reads any of them back)
//
// It never deletes a row and never touches an email, a provider link or a session, so
// every sign-in keeps working. Prints counts only, never a name, email or token. One
// transaction: if any count moves between the plan and the write, it rolls back.
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

// [label, count query, update statement]
const STEPS = [
	['auth_users.name',
		`select count(*)::int n from auth_users where name is not null`,
		`update auth_users set name = null where name is not null`],
	['auth_users.image',
		`select count(*)::int n from auth_users where image is not null`,
		`update auth_users set image = null where image is not null`],
	['auth_accounts.id_token',
		`select count(*)::int n from auth_accounts where id_token is not null`,
		`update auth_accounts set id_token = null where id_token is not null`],
	['auth_accounts.access_token',
		`select count(*)::int n from auth_accounts where access_token is not null`,
		`update auth_accounts set access_token = null where access_token is not null`],
	['auth_accounts.refresh_token',
		`select count(*)::int n from auth_accounts where refresh_token is not null`,
		`update auth_accounts set refresh_token = null where refresh_token is not null`],
];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const plan = {};
for (const [label, count] of STEPS) plan[label] = (await c.query(count)).rows[0].n;
const summary = Object.entries(plan).map(([k, n]) => `${k}=${n}`).join(' ');
console.log(`${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}: ${summary}`);

let failed = false;
if (APPLY) {
	await c.query('BEGIN');
	try {
		for (const [label, , update] of STEPS) {
			const { rowCount } = await c.query(update);
			if (rowCount !== plan[label]) throw new Error(`${label}: updated ${rowCount}, planned ${plan[label]}`);
		}
		await c.query('COMMIT');
		console.log('applied');
	} catch (e) {
		await c.query('ROLLBACK');
		failed = true;
		console.log(`ROLLED BACK, nothing changed: ${e.message}`);
	}
}

await c.end();
process.exit(failed ? 1 : 0);
