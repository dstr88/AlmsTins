// REAL-POSTGRES TEST, opt-in (RUN_PG_VERIFY_WELCOME_DRIP=1 + a DATABASE_URL on localhost); it WRITES
// and CREATES TABLES. The unit step of CI skips it (vitest.ci.config.ts excludes tests/pg*.test.ts).
//
// Proves on a real Postgres what the in-memory tests cannot: that the drip engine's enrollment and
// due-list statements, with the Verify welcome rules in them, are valid Postgres and do what
// tests/verify/welcomeDrip.test.ts says. It runs all three campaigns, the business series' own
// three-table enrollment included, so the hand-over from the welcome series to the business series
// is seen end to end. It also runs the real lazy ALTER TABLE that adds signup_service to an
// auth_users that lacks it.
//
// It sends nothing: it stops at the list of who is due, and never loads the cron route or the mail
// sender's network call.
//
// Point it at an EMPTY, THROWAWAY database: it creates small stand-ins for the tables these
// queries read, which would clash with the app's real tables if they were created later in the
// same database.
//
//   RUN_PG_VERIFY_WELCOME_DRIP=1 DATABASE_URL=postgres://postgres@127.0.0.1:54331/verify_welcome_test \
//     npx vitest run tests/pgVerifyWelcomeDrip.test.ts
//
// Skips without the opt-in. With the opt-in but a DATABASE_URL that is not on this machine it
// throws, so a real database is never written to by mistake. Every account and address is
// invented and unique to the run, and its rows are deleted at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const OPT_IN = process.env.RUN_PG_VERIFY_WELCOME_DRIP === '1';
const URL_HOST = (() => {
	try {
		return new URL(process.env.DATABASE_URL ?? '').hostname;
	} catch {
		return '';
	}
})();
if (OPT_IN && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(URL_HOST)) {
	throw new Error('RUN_PG_VERIFY_WELCOME_DRIP=1 needs DATABASE_URL on localhost or 127.0.0.1: this test writes rows and creates tables.');
}

const d = OPT_IN ? describe : describe.skip;
type Arg = string | number | null;
const DAY_MS = 86_400_000;
/** A stored timestamp `days` before now, as the app writes them (UTC, to the second). */
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString().replace('T', ' ').slice(0, 19);

d('the drip campaigns with the Verify welcome rules, on a real Postgres', () => {
	const run = randomUUID().slice(0, 8);
	const id = (name: string) => `pg-drip-${run}-${name}`;
	let db: typeof import('../src/lib/db').db;
	let drip: typeof import('../src/lib/onboardingDrip');

	const insert = (table: string, row: Record<string, Arg>) => {
		const cols = Object.keys(row);
		return db.execute({ sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, args: Object.values(row) });
	};
	/** One account with its own tenant, signed up an hour ago unless told otherwise. */
	async function account(name: string, a: { signupService?: string; proof?: 'google' | 'verified-email' | 'none'; createdAt?: string } = {}): Promise<string> {
		const proof = a.proof ?? 'google';
		const createdAt = a.createdAt ?? daysAgo(1 / 24);
		await insert('auth_users', {
			id: id(name), email: `${name}.${run}@example.test`, created_at: createdAt,
			email_verified: proof === 'verified-email' ? createdAt : null,
			...(a.signupService ? { signup_service: a.signupService } : {}),
		});
		if (proof === 'google') await insert('auth_accounts', { id: randomUUID(), user_id: id(name), type: 'oauth', provider: 'google', provider_account_id: `google-${run}-${name}` });
		await insert('tenant_memberships', { id: randomUUID(), tenant_id: id(`t-${name}`), user_id: id(name), role: 'owner', created_at: createdAt });
		return id(name);
	}
	const wallet = (name: string) => insert('wallets', { id: randomUUID(), tenant_id: id(`t-${name}`) });
	const destination = (name: string, kind = 'address') =>
		insert('verify_destinations', { id: randomUUID(), tenant_id: id(`t-${name}`), kind, rail: 'ethereum', value: `0x${run}${randomUUID().replace(/-/g, '')}`, registered_at: daysAgo(0) });
	const removeDestinations = (name: string) => db.execute({ sql: `DELETE FROM verify_destinations WHERE tenant_id = ?`, args: [id(`t-${name}`)] });

	const enrollAll = async () => {
		for (const campaign of drip.CAMPAIGN_IDS) await drip.enrollForCampaign(campaign);
	};
	const mine = (userId: string) => userId.startsWith(`pg-drip-${run}-`);
	const enrolledIn = async (campaign: string) =>
		(await db.execute({ sql: `SELECT user_id FROM campaign_drip WHERE campaign = ? AND user_id LIKE ? ORDER BY user_id`, args: [campaign, `pg-drip-${run}-%`] })).rows.map((r: any) => String(r.user_id));
	const due = async (campaign: (typeof drip.CAMPAIGN_IDS)[number]) =>
		(await drip.getDueDrips(campaign, 1000)).filter((x) => mine(x.userId)).map((x) => `${x.userId}:${x.nextStep}`).sort();
	/** Age an enrollment, in place of waiting: the engine measures days from enrolled_at. */
	const enrolledDaysAgo = (campaign: string, userId: string, days: number) =>
		db.execute({ sql: `UPDATE campaign_drip SET enrolled_at = ? WHERE campaign = ? AND user_id = ?`, args: [daysAgo(days), campaign, userId] });

	beforeAll(async () => {
		({ db } = await import('../src/lib/db'));
		drip = await import('../src/lib/onboardingDrip');

		// auth_users as it stood before the sign-up product was kept: no signup_service, no lang.
		await db.execute(`CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified TEXT, image TEXT, created_at TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS auth_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT, provider TEXT, provider_account_id TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT, created_at TEXT)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, tenant_id TEXT)`);
		// Verify's own tables, as the app makes them.
		await (await import('../src/lib/verifyRegistry')).ensureVerifyTables();
	});

	afterAll(async () => {
		const like = `pg-drip-${run}-%`;
		for (const [table, column] of [
			['campaign_drip', 'user_id'], ['wallets', 'tenant_id'], ['verify_destinations', 'tenant_id'],
			['tenant_memberships', 'user_id'], ['auth_accounts', 'user_id'], ['auth_users', 'id'],
		]) {
			await db.execute({ sql: `DELETE FROM ${table} WHERE ${column} LIKE ?`, args: [like] });
		}
	});

	it('adds the sign-up product column to an auth_users that lacks it, before any rule reads it', async () => {
		const has = async () =>
			(await db.execute({ sql: `SELECT 1 AS present FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'auth_users' AND column_name = 'signup_service'`, args: [] })).rows.length > 0;
		const before = await has();
		await drip.enrollForCampaign('verify-welcome');
		expect(await has()).toBe(true);
		// On a database this file made, it was missing until now.
		if (!before) expect(before).toBe(false);
	});

	it('a Verify sign-up with no destination is in the welcome series and not in the wallet and tax series', async () => {
		const verify = await account('verify', { signupService: 'verify' });
		await enrollAll();
		expect(await enrolledIn('verify-welcome')).toContain(verify);
		expect(await enrolledIn('onboarding')).not.toContain(verify);
		expect(await enrolledIn('business')).not.toContain(verify);
	});

	it('it is due email 1 at once, then nothing until day 3, then email 2, then nothing', async () => {
		const verify = id('verify');
		expect(await due('verify-welcome')).toEqual([`${verify}:1`]);
		await drip.markStepSent('verify-welcome', verify, 1);
		expect(await due('verify-welcome')).toEqual([]);

		await enrolledDaysAgo('verify-welcome', verify, 2.9);
		expect(await due('verify-welcome')).toEqual([]);
		await enrolledDaysAgo('verify-welcome', verify, 3.01);
		expect(await due('verify-welcome')).toEqual([`${verify}:2`]);
		await drip.markStepSent('verify-welcome', verify, 2);
		await enrolledDaysAgo('verify-welcome', verify, 40);
		expect(await due('verify-welcome')).toEqual([]);
	});

	it('registering a destination ends the welcome series, and the business series takes the account', async () => {
		const shop = await account('shop', { signupService: 'verify' });
		await enrollAll();
		expect(await due('verify-welcome')).toEqual([`${shop}:1`]);
		await drip.markStepSent('verify-welcome', shop, 1);
		await enrolledDaysAgo('verify-welcome', shop, 3.01);
		expect(await due('verify-welcome')).toEqual([`${shop}:2`]);

		await destination('shop');
		// Checked at send time: no cron enrollment has run since the destination went in.
		expect(await due('verify-welcome')).toEqual([]);

		await enrollAll();
		expect(await enrolledIn('business')).toContain(shop);
		expect(await due('business')).toEqual([`${shop}:1`]);
		expect(await due('verify-welcome')).toEqual([]);
		expect(await enrolledIn('onboarding')).not.toContain(shop);
	});

	it('the welcome series stays ended when the destination is removed again', async () => {
		await removeDestinations('shop');
		await enrollAll();
		expect(await due('verify-welcome')).toEqual([]);
		expect(await due('business')).toEqual([`${id('shop')}:1`]);
	});

	it('an account that registered before the first cron run goes straight to the business series', async () => {
		const quick = await account('quick', { signupService: 'verify' });
		await destination('quick', 'qr');
		await enrollAll();
		expect(await enrolledIn('verify-welcome')).not.toContain(quick);
		expect(await enrolledIn('business')).toContain(quick);
		expect(await enrolledIn('onboarding')).not.toContain(quick);
	});

	it('a Verify sign-up that adds a wallet becomes eligible for the wallet and tax series', async () => {
		const both = await account('both', { signupService: 'verify' });
		await enrollAll();
		expect(await enrolledIn('onboarding')).not.toContain(both);
		await wallet('both');
		await enrollAll();
		expect(await enrolledIn('onboarding')).toContain(both);
		expect(await due('onboarding')).toContain(`${both}:1`);
	});

	it('an account part-way through the wallet and tax series gets no further email from it once it is Verify-only', async () => {
		const midway = await account('midway', { signupService: 'verify', createdAt: daysAgo(6) });
		await insert('campaign_drip', { campaign: 'onboarding', user_id: midway, email: `midway.${run}@example.test`, lang: 'en', enrolled_at: daysAgo(6), last_step: 2, unsubscribed: 0, unsub_token: randomUUID(), updated_at: daysAgo(4) });
		expect(await due('onboarding')).not.toContain(`${midway}:3`);
		await wallet('midway');
		expect(await due('onboarding')).toContain(`${midway}:3`);
	});

	it('an account with no stored sign-up product behaves as before, with or without a Verify destination', async () => {
		const older = await account('older');
		const olderShop = await account('oldershop');
		await destination('oldershop');
		await enrollAll();
		expect(await enrolledIn('onboarding')).toEqual(expect.arrayContaining([older, olderShop]));
		expect(await enrolledIn('verify-welcome')).not.toContain(older);
		expect(await enrolledIn('verify-welcome')).not.toContain(olderShop);
		expect(await enrolledIn('business')).toContain(olderShop);
		expect(await due('onboarding')).toEqual(expect.arrayContaining([`${older}:1`, `${olderShop}:1`]));
	});

	it('an unverified password sign-up gets nothing until it confirms its address', async () => {
		const typed = await account('typed', { signupService: 'verify', proof: 'none' });
		await enrollAll();
		for (const campaign of drip.CAMPAIGN_IDS) expect(await enrolledIn(campaign)).not.toContain(typed);
		await db.execute({ sql: `UPDATE auth_users SET email_verified = ? WHERE id = ?`, args: [daysAgo(0), typed] });
		await enrollAll();
		expect(await enrolledIn('verify-welcome')).toContain(typed);
		expect(await enrolledIn('onboarding')).not.toContain(typed);
	});

	it('an account that signed up days ago is anchored to its enrollment, so its two emails are three days apart', async () => {
		const waiting = await account('waiting', { signupService: 'verify', createdAt: daysAgo(5) });
		await enrollAll();
		const row = (await db.execute({ sql: `SELECT enrolled_at FROM campaign_drip WHERE campaign = 'verify-welcome' AND user_id = ?`, args: [waiting] })).rows[0] as Record<string, any>;
		expect(Math.abs(Date.parse(String(row.enrolled_at).replace(' ', 'T') + 'Z') - Date.now())).toBeLessThan(120_000);
		expect(await due('verify-welcome')).toContain(`${waiting}:1`);
		await drip.markStepSent('verify-welcome', waiting, 1);
		expect(await due('verify-welcome')).not.toContain(`${waiting}:2`);
		await enrolledDaysAgo('verify-welcome', waiting, 3.01);
		expect(await due('verify-welcome')).toContain(`${waiting}:2`);
	});

	it('a second pass enrolls nobody twice', async () => {
		const count = async () => Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM campaign_drip WHERE user_id LIKE ?`, args: [`pg-drip-${run}-%`] })).rows[0].n);
		const before = await count();
		await enrollAll();
		expect(await count()).toBe(before);
	});
});
