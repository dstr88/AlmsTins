// REAL-POSTGRES TEST, opt-in (RUN_PG_ADMIN_ACCOUNTS=1 + a DATABASE_URL on localhost); it WRITES and
// CREATES TABLES. The unit step of CI skips it (vitest.ci.config.ts excludes tests/pg*.test.ts).
//
// Proves on a real Postgres what the in-memory tests cannot: that the statements behind the
// owner's New accounts list, the Accounts by country count, the Verify steps table, the
// abandoned-account outline and the sign-in and activity writes are valid Postgres and do what
// their unit tests say (tests/admin/*.test.ts, tests/auth/accountActivity.test.ts,
// tests/auth/signInRecorded.test.ts, tests/auth/signupServiceSaved.test.ts). It also runs the
// real lazy ALTER TABLE that adds signup_service and last_active_on to an auth_users that lacks
// them, the way the first signed-in request after a deploy will.
//
// Point it at an EMPTY, THROWAWAY database: it creates small stand-ins for the tables these
// queries read (auth_users without the two new columns, the tables a person's records live in),
// which would clash with the app's real tables if they were created later in the same database.
//
//   RUN_PG_ADMIN_ACCOUNTS=1 DATABASE_URL=postgres://postgres@127.0.0.1:54329/admin_accounts_test \
//     npx vitest run tests/pgAdminAccounts.test.ts
//
// Skips without the opt-in. With the opt-in but a DATABASE_URL that is not on this machine it
// throws, so a real database is never written to by mistake. Every account and address is
// invented and unique to the run, and its rows are deleted at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const OPT_IN = process.env.RUN_PG_ADMIN_ACCOUNTS === '1';
const URL_HOST = (() => {
	try {
		return new URL(process.env.DATABASE_URL ?? '').hostname;
	} catch {
		return '';
	}
})();
if (OPT_IN && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(URL_HOST)) {
	throw new Error('RUN_PG_ADMIN_ACCOUNTS=1 needs DATABASE_URL on localhost or 127.0.0.1: this test writes rows and creates tables.');
}

const d = OPT_IN ? describe : describe.skip;
/** A value a statement takes. */
type Arg = string | number | null;

d('the admin account queries and the activity writes, on a real Postgres', () => {
	const run = randomUUID().slice(0, 8);
	const id = (name: string) => `pg-acct-${run}-${name}`;
	let db: typeof import('../src/lib/db').db;
	let activity: typeof import('../src/lib/accountActivity');
	let signup: typeof import('../src/lib/signupService');
	let accounts: typeof import('../src/lib/adminNewAccounts');
	let steps: typeof import('../src/lib/adminVerifySteps');
	let records: typeof import('../src/lib/personRecords');

	const one = async (sql: string, args: Arg[] = []) => (await db.execute({ sql, args })).rows[0] as Record<string, any>;
	const user = (userId: string) => one('SELECT * FROM auth_users WHERE id = ?', [userId]);
	const columns = async () =>
		(await db.execute({
			sql: `SELECT column_name FROM information_schema.columns
			      WHERE table_schema = current_schema() AND table_name = 'auth_users' AND column_name IN ('signup_service', 'last_active_on')
			      ORDER BY column_name`,
			args: [],
		})).rows.map((r: any) => String(r.column_name));
	const addUser = (name: string, fields: Record<string, Arg> = {}) => {
		const row: Record<string, Arg> = { id: id(name), email: `${name}.${run}@example.test`, ...fields };
		const cols = Object.keys(row);
		return db.execute({ sql: `INSERT INTO auth_users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: Object.values(row) });
	};
	const join = (userName: string, tenant: string) =>
		db.execute({ sql: `INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', '2026-11-01 10:00:00')`, args: [randomUUID(), id(tenant), id(userName)] });
	const destination = (tenant: string, n: number, f: Record<string, Arg>) => {
		const row: Record<string, Arg> = { id: randomUUID(), tenant_id: id(tenant), kind: 'address', rail: 'ethereum', value: `0x${run}${String(n).padStart(32, '0')}`, ...f };
		const cols = Object.keys(row);
		return db.execute({ sql: `INSERT INTO verify_destinations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: Object.values(row) });
	};

	beforeAll(async () => {
		({ db } = await import('../src/lib/db'));
		activity = await import('../src/lib/accountActivity');
		signup = await import('../src/lib/signupService');
		accounts = await import('../src/lib/adminNewAccounts');
		steps = await import('../src/lib/adminVerifySteps');
		records = await import('../src/lib/personRecords');

		// auth_users as it stands before this change: no signup_service, no last_active_on.
		await db.execute(`CREATE TABLE IF NOT EXISTS auth_users (
			id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified TEXT, image TEXT, active_tenant_id TEXT,
			last_login TEXT, last_login_service TEXT, last_login_country TEXT, created_at TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT, provider TEXT, provider_account_id TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS auth_credentials (user_id TEXT PRIMARY KEY, password_hash TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT, created_at TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS receivable_invites (id TEXT PRIMARY KEY, accepted_by TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS cairn_invites (id TEXT PRIMARY KEY, accepted_by TEXT)`);
		// Verify's own tables, as the app makes them; then a stand-in for every other table a person's records live in.
		await (await import('../src/lib/verifyRegistry')).ensureVerifyTables();
		for (const table of records.PERSON_RECORD_TABLES) {
			await db.execute(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT, tenant_id TEXT)`);
		}
	});

	afterAll(async () => {
		const mine = `pg-acct-${run}-%`;
		for (const [table, column] of [
			['wallets', 'tenant_id'], ['verify_destinations', 'tenant_id'], ['verify_subscriptions', 'tenant_id'],
			['tenant_memberships', 'user_id'], ['auth_accounts', 'user_id'], ['auth_credentials', 'user_id'], ['auth_users', 'id'],
		]) {
			await db.execute({ sql: `DELETE FROM ${table} WHERE ${column} LIKE ?`, args: [mine] });
		}
	});

	it('adds the two columns to an auth_users that lacks them, once', async () => {
		const before = await columns();
		await activity.ensureAccountActivityColumns();
		expect(await columns()).toEqual(['last_active_on', 'signup_service']);
		// A new process finds them and alters nothing.
		activity.__resetAccountActivityForTests();
		await activity.ensureAccountActivityColumns();
		expect(await columns()).toEqual(['last_active_on', 'signup_service']);
		// On a database this file made, they were missing until now.
		if (before.length === 0) expect(before).toEqual([]);
	});

	it('a sign-in records the time, the product, the country and the active day', async () => {
		await addUser('signin', { created_at: '2026-11-05 09:00:00' });
		await signup.runWithSignInContext('/dashboard/verify', () => activity.stampSignIn(id('signin'), new Date('2026-11-05T09:00:02Z')), 'SG');
		expect(await user(id('signin'))).toMatchObject({
			last_login: '2026-11-05T09:00:02.000Z', last_login_service: 'verify', last_login_country: 'SG', last_active_on: '2026-11-05',
		});
	});

	it('a visit moves the active day once a day, and never the last sign-in', async () => {
		activity.__resetAccountActivityForTests();
		const visit = (at: string) => activity.noteRequestActivity({ userId: id('signin'), pathname: '/dashboard/verify', demoSession: false }, new Date(at));
		expect(await visit('2026-11-06T08:00:00Z')).toBe(true);
		expect(await user(id('signin'))).toMatchObject({ last_active_on: '2026-11-06', last_login: '2026-11-05T09:00:02.000Z' });
		// A new process the same day sends the statement, and Postgres writes no row.
		activity.__resetAccountActivityForTests();
		expect(await visit('2026-11-06T20:00:00Z')).toBe(false);
		// An older day never moves it back.
		activity.__resetAccountActivityForTests();
		expect(await visit('2026-11-04T20:00:00Z')).toBe(false);
		expect((await user(id('signin'))).last_active_on).toBe('2026-11-06');
	});

	it('the product signed up for is saved once', async () => {
		await signup.runWithSignInContext('/dashboard/verify', () => activity.saveSignupService(id('signin')));
		await signup.runWithSignInContext('/dashboard/agentics', () => activity.saveSignupService(id('signin')));
		expect((await user(id('signin'))).signup_service).toBe('verify');
	});

	it('the New accounts list: order, sign-in methods and tags, from real rows', async () => {
		// A company account that signs in with Google and GitHub, has a wallet, and holds two addresses on Free.
		await addUser('shop', { email: `ap.${run}@northwind-traders.example`, created_at: '2026-11-05 11:00:00', active_tenant_id: id('t-shop'), last_login: '2026-11-05T11:00:01.000Z', last_login_country: 'US', signup_service: 'verify', last_active_on: '2026-11-05' });
		await join('shop', 't-shop');
		for (const provider of ['github', 'google']) {
			await db.execute({ sql: `INSERT INTO auth_accounts (id, user_id, type, provider, provider_account_id) VALUES (?, ?, 'oauth', ?, ?)`, args: [randomUUID(), id('shop'), provider, `${provider}-${run}`] });
		}
		await db.execute({ sql: `INSERT INTO wallets (id, tenant_id) VALUES (?, ?)`, args: [randomUUID(), id('t-shop')] });
		await destination('t-shop', 1, { proof_method: 'none', proof_status: 'unproven' });
		await destination('t-shop', 2, { proof_method: 'micro_deposit', proof_status: 'proven', proven_at: '2026-11-05 11:30:00' });
		// A password sign-up that never confirmed its address, with nothing set up.
		await addUser('pw', { created_at: '2026-11-04 08:00:00' });
		await db.execute({ sql: `INSERT INTO auth_credentials (user_id, password_hash) VALUES (?, 'not-a-real-hash')`, args: [id('pw')] });
		// An account from before sign-up times were kept, reached by an emailed link.
		await addUser('early', { created_at: null, email_verified: '2026-09-01 10:00:00' });

		const view = await accounts.listNewAccounts(500);
		expect(view.recordsKnown).toBe(true);
		expect(view.verifyKnown).toBe(true);
		const mine = view.rows.filter((r) => r.id.startsWith(`pg-acct-${run}-`));
		expect(mine.map((r) => r.id)).toEqual([id('shop'), id('signin'), id('pw'), id('early')]);

		const [shop, , pw, early] = mine;
		expect(shop).toMatchObject({ methods: ['google', 'github'], lastLoginCountry: 'US', signupService: 'verify', lastActiveDay: '2026-11-05', verify: { plan: 'free', addresses: 2, qrs: 0 } });
		expect(shop.tags.map((t) => t.id)).toEqual(['proven-sign-in', 'company-email', 'set-up', 'at-limit']);
		// The invented addresses are at example.test, which is no free-mail provider, so every row
		// carries the company-email tag; what differs is the rest.
		expect(pw).toMatchObject({ methods: ['credentials'], lastActiveDay: null, verify: null });
		expect(pw.tags.map((t) => t.id)).toEqual(['company-email']);
		expect(early).toMatchObject({ methods: ['email'], createdAt: null });
		expect(early.tags.map((t) => t.id)).toEqual(['proven-sign-in', 'company-email']);
	});

	it('a paid Verify plan shows as its tag and lifts the limit', async () => {
		await db.execute({ sql: `INSERT INTO verify_subscriptions (tenant_id, plan, status) VALUES (?, 'business', 'active')`, args: [id('t-shop')] });
		const shop = (await accounts.listNewAccounts(500)).rows.find((r) => r.id === id('shop'))!;
		expect(shop.verify?.plan).toBe('business');
		expect(shop.tags.map((t) => t.id)).toEqual(['proven-sign-in', 'company-email', 'set-up', 'verify-plan']);
		await db.execute({ sql: `DELETE FROM verify_subscriptions WHERE tenant_id = ?`, args: [id('t-shop')] });
	});

	it('accounts by country counts each account under its last sign-in country, unknown included', async () => {
		const counts = await accounts.countAccountsByCountry();
		const of = (country: string | null) => counts.find((c) => c.country === country)?.accounts ?? 0;
		expect(of('SG')).toBeGreaterThanOrEqual(1);
		expect(of('US')).toBeGreaterThanOrEqual(1);
		expect(of(null)).toBeGreaterThanOrEqual(2);
		expect(counts.map((c) => c.accounts)).toEqual([...counts.map((c) => c.accounts)].sort((a, b) => b - a));
	});

	it('the Verify steps table: registered, claimed and verified, with totals', async () => {
		// A third address, verified: anchored to a domain and confirmed inside the last 24 hours.
		// (The suite's clock is 2026-11-05 12:00 UTC, so the cutoff is 2026-11-04 12:00.)
		await destination('t-shop', 3, {
			proof_method: 'well_known', proof_status: 'proven', proof_domain: `shop-${run}.example`,
			proven_at: '2026-11-05 11:40:00', domain_anchored_at: '2026-11-05 11:40:00', last_confirmed_at: '2026-11-05 11:45:00',
		});
		const view = await steps.listVerifySteps();
		const shop = view.rows.find((r) => r.userId === id('shop'))!;
		expect(shop.counts).toEqual({ registered: 3, claimed: 2, verified: 1, qrs: 0 });
		// Signed up through Verify with nothing registered yet: in the table, at the first step.
		const signin = view.rows.find((r) => r.userId === id('signin'))!;
		expect(signin).toMatchObject({ signupService: 'verify', counts: { registered: 0, claimed: 0, verified: 0, qrs: 0 } });
		// Never signed up through Verify and holds no destination: not in the table.
		expect(view.rows.find((r) => r.userId === id('pw'))).toBeUndefined();
		expect(view.totals.accounts).toBeGreaterThanOrEqual(2);
		expect(view.totals.verified).toBeGreaterThanOrEqual(1);
		expect(view.totals.addresses.registered).toBeGreaterThanOrEqual(3);
	});

	it('the abandoned-account outline: came back by a later active day, or by a later sign-in, or never', async () => {
		const made = '2026-11-01 10:00:00';
		const signedIn = '2026-11-01T10:05:00.000Z';
		await addUser('gone', { created_at: made, last_login: signedIn });
		await addUser('gone-same-day', { created_at: made, last_login: signedIn, last_active_on: '2026-11-01' });
		await addUser('never-in', { created_at: made });
		await addUser('back-by-visit', { created_at: made, last_login: signedIn, last_active_on: '2026-11-02' });
		await addUser('back-by-sign-in', { created_at: made, last_login: '2026-11-03T08:00:00.000Z' });
		await addUser('has-wallet', { created_at: made, last_login: signedIn, active_tenant_id: id('t-wallet') });
		await join('has-wallet', 't-wallet');
		await db.execute({ sql: `INSERT INTO wallets (id, tenant_id) VALUES (?, ?)`, args: [randomUUID(), id('t-wallet')] });

		const abandoned = await records.listAbandonedAccountIds();
		const marked = (name: string) => abandoned.has(id(name));
		expect([marked('gone'), marked('gone-same-day'), marked('never-in')]).toEqual([true, true, true]);
		expect([marked('back-by-visit'), marked('back-by-sign-in'), marked('has-wallet')]).toEqual([false, false, false]);
		// An account with no sign-up time is never marked.
		expect(marked('early')).toBe(false);
	});
});
