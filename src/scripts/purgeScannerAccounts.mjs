// Remove the throwaway accounts an automated vulnerability scanner created through the
// password sign-up form (addresses starting with 'testing@example.com', never verified).
// Hand-run. DRY RUN by default: prints what it would delete, writes nothing.
//
//   read -s DATABASE_URL && export DATABASE_URL     # paste the database URL; nothing echoes
//   node src/scripts/purgeScannerAccounts.mjs                    # dry run
//   node src/scripts/purgeScannerAccounts.mjs --apply            # delete
//   node src/scripts/purgeScannerAccounts.mjs --apply --revoke-mixed
//
// Selection (all must hold): the email is exactly 'testing@example.com' or that address
// followed by a character that cannot continue a domain (a quote, a bracket, a space...),
// which is the scanner's payload shape; so testing@example.com.au or
// testing@example.company are never selected (the count of such prefix-only matches is
// printed); email_verified empty; created in the last 14 days (rows with no created_at are
// never selected); has a password row; has NO Google/GitHub account row. A user is purged
// only when every tenant it belongs to has no other member. The owner tenant, the demo
// tenant and 'default' are refused outright: if any selected user touches one, the script
// exits before writing anything.
//
// For each purged user, in ONE transaction: every row in a public table whose tenant_id /
// from_tenant is one of the user's tenants or whose user_id is the user (tables discovered
// from information_schema, so tables added later are covered), then tenant_memberships,
// tenants, auth_credentials, auth_accounts, auth_sessions (if present), the user's
// sign-up and magic-link tokens, and the auth_users row. Any failure rolls the user back.
//
// Also reports (counts only), as the pre-deploy checklist:
//   - how many accounts the new session gate cuts (password-only, unverified), and how many
//     of those belong to the owner tenant. That must be 0 before deploying: the dry run
//     exits with code 2 otherwise. If E2E_EMAIL is set, whether that account would be cut
//     (the scheduled Playwright sign-in would then fail; set its email_verified by hand);
//   - how many unverified passwords sit on accounts that ALSO have a Google/GitHub link
//     ("mixed"). After deploy the gate cuts their password sessions and every session
//     minted before deploy; --revoke-mixed (with --apply) additionally deletes those
//     passwords, clears alert_email and revokes every session issued before now, so the
//     password can't be used again even through a gap; their owners sign in again with
//     Google/GitHub. Run it right after deploying;
//   - whether auth_accounts has its UNIQUE (provider, provider_account_id) index, and how
//     many duplicate pairs exist (the adapter and sign-in code no longer rely on it).
//
// Prints ids and counts only. Never prints an email address.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMAIL_PREFIX = 'testing@example.com';
// 1-based position of the character right after the prefix, for substr().
const AFTER_PREFIX = EMAIL_PREFIX.length + 1;
const WINDOW_DAYS = 14;
const APPLY = process.argv.includes('--apply');
const REVOKE_MIXED = process.argv.includes('--revoke-mixed');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}

// ── Protected tenants, read from the app's own constants ────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const readConst = (file, name) => {
	const src = fs.readFileSync(path.join(here, '..', 'lib', file), 'utf8');
	const m = src.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
	if (!m) {
		console.error(`Could not read ${name} from src/lib/${file}; refusing to run.`);
		process.exit(1);
	}
	return m[1];
};
const OWNER_TENANT_ID = (process.env.OWNER_TENANT_ID?.trim() || readConst('owner.ts', 'DEFAULT_OWNER_TENANT_ID')).toLowerCase();
const DEMO_TENANT_ID = readConst('demo.ts', 'DEMO_TENANT_ID').toLowerCase();
const PROTECTED = new Set([OWNER_TENANT_ID, DEMO_TENANT_ID, 'default']);

// ── Connection: same SSL rule as src/lib/db.pg.ts ───────────────────────────────────
let host = '';
try { host = new URL(DATABASE_URL).hostname; } catch { /* blank -> SSL */ }
const noSsl = host !== '' && (/^(localhost|127\.0\.0\.1|::1)$/.test(host) || !host.includes('.'));
const client = new pg.Client({ connectionString: DATABASE_URL, ssl: noSsl ? false : { rejectUnauthorized: false } });

const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;
const TEXT_TYPES = new Set(['text', 'character varying', 'character']);
const EXPLICIT = new Set([
	'tenants', 'tenant_memberships', 'auth_users', 'auth_accounts', 'auth_credentials',
	'auth_sessions', 'auth_verification_tokens', 'signup_verification_tokens',
]);
const TENANT_COLUMNS = new Set(['tenant_id', 'from_tenant']);

const utcStamp = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

async function count(sql, args = []) {
	return (await client.query(sql, args)).rows[0]?.n ?? 0;
}

async function main() {
	await client.connect();
	console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${REVOKE_MIXED ? ' (+revoke-mixed)' : ''}`);

	// ── Population report ────────────────────────────────────────────────────────
	const unverified = `(u.email_verified IS NULL OR u.email_verified = '')`;
	const hasCred = `EXISTS (SELECT 1 FROM auth_credentials c WHERE c.user_id = u.id)`;
	const hasAcct = `EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id)`;
	const cut = await count(`SELECT COUNT(*)::int n FROM auth_users u WHERE ${unverified} AND ${hasCred} AND NOT ${hasAcct}`);
	const cutOwner = await count(
		`SELECT COUNT(DISTINCT u.id)::int n FROM auth_users u
		 JOIN tenant_memberships tm ON tm.user_id = u.id
		 WHERE ${unverified} AND ${hasCred} AND NOT ${hasAcct} AND lower(tm.tenant_id) = $1`,
		[OWNER_TENANT_ID],
	);
	const mixed = await count(`SELECT COUNT(*)::int n FROM auth_users u WHERE ${unverified} AND ${hasCred} AND ${hasAcct}`);
	console.log(`session gate will cut (password-only, unverified): ${cut}`);
	console.log(`  of which in the owner tenant: ${cutOwner}${cutOwner ? '   <-- PRECONDITION FAILED: verify the owner account before deploying' : ''}`);
	const e2eEmail = process.env.E2E_EMAIL?.trim().toLowerCase();
	if (e2eEmail) {
		const e2e = (await client.query(
			`SELECT ${unverified} AS unverified, ${hasCred} AS has_cred, ${hasAcct} AS has_acct FROM auth_users u WHERE u.email = $1`,
			[e2eEmail],
		)).rows[0];
		const e2eCut = e2e && e2e.unverified && e2e.has_cred;
		console.log(`E2E account: ${!e2e ? 'not found' : e2eCut ? 'WOULD BE CUT <-- set its email_verified before deploying' : 'ok'}`);
	}
	console.log(`unverified passwords on accounts that also have a Google/GitHub link (mixed): ${mixed}`);
	const uniqueIdx = await count(
		`SELECT COUNT(*)::int n FROM pg_index i
		 JOIN pg_class t ON t.oid = i.indrelid AND t.relname = 'auth_accounts'
		 JOIN pg_namespace ns ON ns.oid = t.relnamespace AND ns.nspname = current_schema()
		 WHERE i.indisunique
		   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
		        WHERE a.attrelid = t.oid AND a.attnum = ANY(i.indkey)) = ARRAY['provider', 'provider_account_id']`,
	);
	const dupPairs = await count(
		`SELECT COUNT(*)::int n FROM (SELECT 1 FROM auth_accounts GROUP BY provider, provider_account_id HAVING COUNT(*) > 1) d`,
	);
	console.log(`auth_accounts UNIQUE (provider, provider_account_id): ${uniqueIdx ? 'present' : 'MISSING'}; duplicate pairs: ${dupPairs}`);

	// ── Select the scanner accounts ─────────────────────────────────────────────
	const since = utcStamp(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
	// The scanner's shape: the bare address, or the address plus payload junk. A character
	// that can continue a domain (letter, digit, dot, hyphen) means a real, different domain.
	const scannerShape = `(u.email = $1 OR (starts_with(u.email, $1) AND substr(u.email, ${AFTER_PREFIX}, 1) !~ '[a-z0-9.-]'))`;
	const users = (await client.query(
		`SELECT u.id FROM auth_users u
		 WHERE ${scannerShape} AND ${unverified}
		   AND u.created_at IS NOT NULL AND u.created_at >= $2
		   AND ${hasCred} AND NOT ${hasAcct}
		 ORDER BY u.created_at, u.id`,
		[EMAIL_PREFIX, since],
	)).rows.map((r) => String(r.id));
	const prefixOnly = await count(
		`SELECT COUNT(*)::int n FROM auth_users u WHERE starts_with(u.email, $1) AND NOT ${scannerShape}`,
		[EMAIL_PREFIX],
	);
	console.log(`selected users: ${users.length} (created since ${since} UTC)`);
	console.log(`excluded (address only starts with the prefix, e.g. a longer real domain): ${prefixOnly}`);

	const plan = [];
	for (const userId of users) {
		const tenants = (await client.query(
			`SELECT tenant_id AS t FROM tenant_memberships WHERE user_id = $1 AND tenant_id IS NOT NULL AND tenant_id <> ''
			 UNION
			 SELECT active_tenant_id AS t FROM auth_users WHERE id = $1 AND active_tenant_id IS NOT NULL AND active_tenant_id <> ''`,
			[userId],
		)).rows.map((r) => String(r.t));
		const hit = tenants.filter((t) => PROTECTED.has(t.toLowerCase()));
		if (hit.length) {
			console.error(`REFUSING: user ${userId} belongs to protected tenant(s) ${hit.join(', ')}. Nothing was written.`);
			process.exit(1);
		}
		let shared = false;
		for (const t of tenants) {
			const others = await count(
				'SELECT COUNT(*)::int n FROM tenant_memberships WHERE tenant_id = $1 AND user_id <> $2',
				[t, userId],
			);
			if (others > 0) { shared = true; console.log(`skip user ${userId}: tenant ${t} has ${others} other member(s)`); }
		}
		if (!shared) plan.push({ userId, tenants });
	}

	// ── Discover every table that can hold their rows ──────────────────────────
	const cols = (await client.query(
		`SELECT c.table_name, c.column_name, c.data_type
		 FROM information_schema.columns c
		 JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		 WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
		 ORDER BY c.table_name, c.column_name`,
	)).rows;
	const targets = [];
	const reportOnly = [];
	for (const c of cols) {
		if (EXPLICIT.has(c.table_name)) continue;
		const cast = TEXT_TYPES.has(c.data_type) ? '' : '::text';
		if (TENANT_COLUMNS.has(c.column_name)) targets.push({ table: c.table_name, column: c.column_name, kind: 'tenant', cast });
		else if (c.column_name === 'user_id') targets.push({ table: c.table_name, column: c.column_name, kind: 'user', cast });
		else if (/tenant/.test(c.column_name) || /_by$/.test(c.column_name)) reportOnly.push({ table: c.table_name, column: c.column_name, cast });
	}
	const hasAuthSessions = (await client.query(`SELECT to_regclass('public.auth_sessions') AS r`)).rows[0].r != null;

	const where = (t) => `${qi(t.column)}${t.cast} = ANY($1::text[])`;
	const keysFor = (t, p) => (t.kind === 'user' ? [p.userId] : p.tenants);

	// ── Per user: report, then (with --apply) delete in one transaction ────────
	let purged = 0;
	for (const p of plan) {
		console.log(`\nuser ${p.userId}  tenants [${p.tenants.join(', ') || 'none'}]`);
		for (const t of targets) {
			const n = await count(`SELECT COUNT(*)::int n FROM ${qi(t.table)} WHERE ${where(t)}`, [keysFor(t, p)]);
			if (n) console.log(`  ${t.table}.${t.column}: ${n}`);
		}
		for (const t of reportOnly) {
			const n = await count(
				`SELECT COUNT(*)::int n FROM ${qi(t.table)} WHERE ${qi(t.column)}${t.cast} = ANY($1::text[])`,
				[[p.userId, ...p.tenants]],
			);
			if (n) console.log(`  (not deleted) ${t.table}.${t.column} references: ${n}`);
		}
		const explicitCounts = [
			['tenant_memberships', await count('SELECT COUNT(*)::int n FROM tenant_memberships WHERE user_id = $1 OR tenant_id = ANY($2::text[])', [p.userId, p.tenants])],
			['tenants', await count('SELECT COUNT(*)::int n FROM tenants WHERE id = ANY($1::text[])', [p.tenants])],
			['auth_credentials', await count('SELECT COUNT(*)::int n FROM auth_credentials WHERE user_id = $1', [p.userId])],
			['auth_accounts', await count('SELECT COUNT(*)::int n FROM auth_accounts WHERE user_id = $1', [p.userId])],
			...(hasAuthSessions ? [['auth_sessions', await count('SELECT COUNT(*)::int n FROM auth_sessions WHERE user_id = $1', [p.userId])]] : []),
			['signup_verification_tokens', await count(`SELECT COUNT(*)::int n FROM signup_verification_tokens WHERE identifier = (SELECT 'signup:' || email FROM auth_users WHERE id = $1)`, [p.userId])],
		];
		for (const [name, n] of explicitCounts) if (n) console.log(`  ${name}: ${n}`);
		if (!APPLY) continue;

		try {
			await client.query('BEGIN');
			const deleted = {};
			let pending = targets;
			// Multi-pass: some foreign keys have no ON DELETE CASCADE, so a child table may have
			// to go first. A SAVEPOINT per statement lets one FK failure retry in the next pass.
			for (let pass = 0; pass < 8 && pending.length; pass++) {
				const blocked = [];
				for (const t of pending) {
					await client.query('SAVEPOINT purge_step');
					try {
						const r = await client.query(`DELETE FROM ${qi(t.table)} WHERE ${where(t)}`, [keysFor(t, p)]);
						await client.query('RELEASE SAVEPOINT purge_step');
						if (r.rowCount) deleted[`${t.table}.${t.column}`] = (deleted[`${t.table}.${t.column}`] ?? 0) + r.rowCount;
					} catch (e) {
						await client.query('ROLLBACK TO SAVEPOINT purge_step');
						if (e.code !== '23503') throw e;
						blocked.push(t);
					}
				}
				if (blocked.length === pending.length) break;
				pending = blocked;
			}
			if (pending.length) {
				throw Object.assign(new Error(`foreign keys still block: ${pending.map((t) => `${t.table}.${t.column}`).join(', ')}`), { code: 'FK_BLOCKED' });
			}
			const run = async (label, sql, args) => {
				const r = await client.query(sql, args);
				if (r.rowCount) deleted[label] = (deleted[label] ?? 0) + r.rowCount;
			};
			await run('signup_verification_tokens', `DELETE FROM signup_verification_tokens WHERE identifier = (SELECT 'signup:' || email FROM auth_users WHERE id = $1)`, [p.userId]);
			await run('auth_verification_tokens', 'DELETE FROM auth_verification_tokens WHERE identifier = (SELECT email FROM auth_users WHERE id = $1)', [p.userId]);
			await run('tenant_memberships', 'DELETE FROM tenant_memberships WHERE user_id = $1 OR tenant_id = ANY($2::text[])', [p.userId, p.tenants]);
			await run('tenants', 'DELETE FROM tenants WHERE id = ANY($1::text[])', [p.tenants]);
			await run('auth_credentials', 'DELETE FROM auth_credentials WHERE user_id = $1', [p.userId]);
			await run('auth_accounts', 'DELETE FROM auth_accounts WHERE user_id = $1', [p.userId]);
			if (hasAuthSessions) await run('auth_sessions', 'DELETE FROM auth_sessions WHERE user_id = $1', [p.userId]);
			await run('auth_users', 'DELETE FROM auth_users WHERE id = $1', [p.userId]);
			await client.query('COMMIT');
			purged += 1;
			console.log(`  DELETED: ${Object.entries(deleted).map(([k, n]) => `${k}=${n}`).join(' ')}`);
		} catch (e) {
			await client.query('ROLLBACK').catch(() => {});
			console.error(`  FAILED, rolled back (code ${e.code ?? 'unknown'})`);
		}
	}

	// ── Optional: unverified passwords on accounts that also have a provider link ─
	if (REVOKE_MIXED && APPLY && mixed) {
		await client.query('ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS sessions_valid_after BIGINT');
		await client.query('ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS alert_email TEXT');
		await client.query('BEGIN');
		try {
			const ids = (await client.query(
				`SELECT u.id FROM auth_users u WHERE ${unverified} AND ${hasCred} AND ${hasAcct}`,
			)).rows.map((r) => String(r.id));
			const nowSec = Math.floor(Date.now() / 1000);
			const rv = await client.query('UPDATE auth_users SET sessions_valid_after = $1, alert_email = NULL WHERE id = ANY($2::text[])', [nowSec, ids]);
			const rc = await client.query('DELETE FROM auth_credentials WHERE user_id = ANY($1::text[])', [ids]);
			await client.query('COMMIT');
			console.log(`\nrevoke-mixed: sessions revoked and alert_email cleared for ${rv.rowCount}, unverified passwords deleted: ${rc.rowCount}`);
		} catch (e) {
			await client.query('ROLLBACK').catch(() => {});
			console.error(`revoke-mixed FAILED, rolled back (code ${e.code ?? 'unknown'})`);
		}
	}

	console.log(`\n${APPLY ? `purged ${purged} of ${plan.length}` : `would purge ${plan.length}`} user(s); skipped ${users.length - plan.length}.`);
	if (!APPLY) console.log('Dry run: nothing was written. Re-run with --apply to delete.');
	if (cutOwner > 0) {
		console.error('PRECONDITION FAILED: an owner-tenant account would be cut by the session gate. Verify it before deploying.');
		process.exitCode = 2;
	}
}

main()
	.catch((e) => {
		console.error(`error (code ${e?.code ?? 'unknown'}): ${e?.message ?? e}`);
		process.exitCode = 1;
	})
	.finally(() => client.end().catch(() => {}));
