import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The account-linking guard in the Auth.js signIn callback. Pinned here:
 *   - a provider that VERIFIED the address takes an unverified row back: when anyone else
 *     could have had a way in (a password, or another provider link), sessions are revoked,
 *     alert_email is cleared, the other links and the password are deleted, in one batch and
 *     in that order; the row is then marked verified;
 *   - a row whose only way in is the provider proving it now is just marked verified;
 *   - a provider account not linked to anyone may never sign in with an address the
 *     provider did not verify, whether or not a row has it: owner-first AND attacker-first;
 *   - the attacker-first chain end to end: the owner's proven sign-in unlinks the attacker's
 *     account, and the attacker's next sign-in is refused;
 *   - "already linked" means linked to THE ROW holding the address; linked elsewhere means
 *     the caller must skip email linking, and nothing is taken back;
 *   - a proven sign-in that creates the row gets it marked verified afterwards;
 *   - the magic-link request proves nothing, writes nothing, and is throttled per address;
 *   - password sign-in is never touched.
 */
type User = { id: string; email: string; email_verified: string | null; sessions_valid_after: number | null; alert_email: string | null };
const mem = vi.hoisted(() => ({
	users: [] as any[],
	credentials: new Set<string>(),
	accounts: [] as { user_id: string; provider: string; provider_account_id: string }[],
	tokens: [] as string[],
	magicTokens: [] as { identifier: string; expires: string }[],
	batches: [] as string[][],
	queries: 0,
}));

vi.mock('@/lib/db', () => {
	const norm = (stmt: any) => ({
		sql: String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim(),
		args: ((typeof stmt === 'string' ? [] : stmt.args) ?? []) as any[],
	});
	const unverified = (u: any) => u.email_verified == null || u.email_verified === '';
	const isKept = (a: any, kp: string, kid: string) => a.provider === kp && a.provider_account_id === kid;
	const execute = async (stmt: any) => {
		mem.queries += 1;
		const { sql, args } = norm(stmt);
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			return { rows: [{ column_name: 'sessions_valid_after' }, { column_name: 'alert_email' }], rowsAffected: 0 };
		}
		if (sql.startsWith('SELECT u.id, u.email_verified, EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id AND a.provider = ? AND a.provider_account_id = ?) AS linked_here, EXISTS (SELECT 1 FROM auth_accounts a WHERE a.provider = ? AND a.provider_account_id = ?) AS linked_any, (SELECT l.email FROM auth_accounts a JOIN auth_users l ON l.id = a.user_id WHERE a.provider = ? AND a.provider_account_id = ? LIMIT 1) AS linked_email FROM (SELECT 1 AS one) AS probe LEFT JOIN auth_users u ON u.email = ? LIMIT 1')) {
			const [provider, pid, provider2, pid2, provider3, pid3, email] = args;
			const u = mem.users.find((x) => x.email === email);
			const here = !!u && mem.accounts.some((a) => a.user_id === u.id && a.provider === provider && a.provider_account_id === pid);
			const any = mem.accounts.some((a) => a.provider === provider2 && a.provider_account_id === pid2);
			const link = mem.accounts.find((a) => a.provider === provider3 && a.provider_account_id === pid3);
			const linkedEmail = link ? (mem.users.find((x) => x.id === link.user_id)?.email ?? null) : null;
			return { rows: [{ id: u?.id ?? null, email_verified: u?.email_verified ?? null, linked_here: here, linked_any: any, linked_email: linkedEmail }], rowsAffected: 0 };
		}
		if (sql === 'SELECT id, email_verified FROM auth_users WHERE email = ? LIMIT 1') {
			return { rows: mem.users.filter((x) => x.email === args[0]).map((u) => ({ id: u.id, email_verified: u.email_verified })), rowsAffected: 0 };
		}
		if (sql === 'SELECT 1 AS ok FROM auth_users WHERE email = ? LIMIT 1') {
			return { rows: mem.users.filter((x) => x.email === args[0]).map(() => ({ ok: 1 })), rowsAffected: 0 };
		}
		if (sql === 'SELECT expires FROM auth_verification_tokens WHERE identifier = ?') {
			return { rows: mem.magicTokens.filter((t) => t.identifier === args[0]).map((t) => ({ expires: t.expires })), rowsAffected: 0 };
		}
		if (sql.startsWith("UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND email = ?")) {
			const u = mem.users.find((x) => x.id === args[0] && x.email === args[1]);
			const hit = u && unverified(u);
			if (hit) u.email_verified = '2026-09-23 12:00:00';
			return { rows: [], rowsAffected: hit ? 1 : 0 };
		}
		if (sql === 'SELECT to_regclass(?) AS r') {
			return { rows: [{ r: String(args[0]) }], rowsAffected: 0 }; // token tables present (tests/auth/signupTokenTable.test.ts covers creation)
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	const batch = async (stmts: any[]) => {
		const out = [];
		const seen: string[] = [];
		for (const s of stmts) {
			const { sql, args } = norm(s);
			seen.push(sql);
			if (sql.startsWith('UPDATE auth_users SET sessions_valid_after = ?, alert_email = NULL')) {
				const [sec, id, kp, kid] = args;
				const u = mem.users.find((x) => x.id === id);
				const contested = !!u && (mem.credentials.has(u.id) || mem.accounts.some((a) => a.user_id === u.id && !isKept(a, kp, kid)));
				const hit = u && unverified(u) && contested;
				if (hit) { u.sessions_valid_after = sec; u.alert_email = null; }
				out.push({ rows: [], rowsAffected: hit ? 1 : 0 });
			} else if (sql.startsWith('DELETE FROM auth_accounts WHERE user_id IN (SELECT id FROM auth_users WHERE id = ?')) {
				const [id, kp, kid] = args;
				const u = mem.users.find((x) => x.id === id);
				const before = mem.accounts.length;
				if (u && unverified(u)) mem.accounts = mem.accounts.filter((a) => a.user_id !== id || isKept(a, kp, kid));
				out.push({ rows: [], rowsAffected: before - mem.accounts.length });
			} else if (sql.startsWith('DELETE FROM auth_credentials WHERE user_id IN (SELECT id FROM auth_users WHERE id = ?')) {
				const u = mem.users.find((x) => x.id === args[0]);
				const hit = u && unverified(u) && mem.credentials.delete(u.id);
				out.push({ rows: [], rowsAffected: hit ? 1 : 0 });
			} else if (sql.startsWith('UPDATE auth_users SET email_verified = to_char(')) {
				const u = mem.users.find((x) => x.id === args[0]);
				const hit = u && unverified(u);
				if (hit) u.email_verified = '2026-09-23 12:00:00';
				out.push({ rows: [], rowsAffected: hit ? 1 : 0 });
			} else if (sql === 'DELETE FROM signup_verification_tokens WHERE identifier = ?') {
				const before = mem.tokens.length;
				mem.tokens = mem.tokens.filter((t) => t !== args[0]);
				out.push({ rows: [], rowsAffected: before - mem.tokens.length });
			} else {
				throw new Error(`unexpected batch SQL in test: ${sql}`);
			}
		}
		mem.batches.push(seen);
		return out;
	};
	return { db: { execute, batch } };
});

import {
	guardSignIn,
	providerVerifiedEmail,
	markProvenAddressVerified,
	PROVIDER_UNVERIFIED_REDIRECT,
	MAGIC_LINK_THROTTLED_REDIRECT,
	__resetAuthLinkGuardForTests,
} from '../../src/lib/authLinkGuard';
import { __resetSessionGateForTests } from '../../src/lib/sessionGate';

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const NOW_SEC = Math.floor(NOW / 1000);
const noFetch = () => vi.fn(async () => { throw new Error('fetch not expected'); });
const deps = (fetchImpl?: any) => ({ fetchImpl: fetchImpl ?? noFetch(), now: () => NOW });
const user = (id: string) => mem.users.find((u) => u.id === id) as User;
const ALLOW = (providerLinked: boolean, addressProven: boolean) => ({ allow: true, providerLinked, addressProven });

const google = (email: string, verified: unknown, sub = 'g-1') => ({
	user: { id: 'random-1', email },
	account: { type: 'oidc', provider: 'google', providerAccountId: sub, access_token: 'ya29' },
	profile: { email, email_verified: verified },
});
const github = (email: string, id = 'gh-1') => ({
	user: { id: 'random-2', email },
	account: { type: 'oauth', provider: 'github', providerAccountId: id, access_token: 'gho_x' },
	profile: { email },
});
const magicCallback = (email: string) => ({
	user: { id: 'random-3', email },
	account: { type: 'email', provider: 'email', providerAccountId: email },
});
const ghEmails = (list: any[]) => vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));

beforeEach(() => {
	mem.users = [
		{ id: 'victim', email: 'owner@company.dev', email_verified: null, sessions_valid_after: null, alert_email: 'squatter@evil.dev' },
		{ id: 'solid', email: 'solid@company.dev', email_verified: '2026-01-01 00:00:00', sessions_valid_after: null, alert_email: null },
	];
	mem.credentials = new Set(['victim', 'solid']);
	mem.accounts = [];
	mem.tokens = ['signup:owner@company.dev'];
	mem.magicTokens = [];
	mem.batches = [];
	mem.queries = 0;
	__resetSessionGateForTests();
	__resetAuthLinkGuardForTests();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('guardSignIn: a provider-verified address takes a pre-registered password row back', () => {
	it('Google email_verified=true: revoke + clear alert_email, unlink others, delete password, verify, in that order', async () => {
		expect(await guardSignIn(google('Owner@Company.dev', true), deps())).toEqual(ALLOW(false, true));
		expect(mem.credentials.has('victim')).toBe(false);
		expect(user('victim').email_verified).not.toBeNull();
		expect(user('victim').sessions_valid_after).toBe(NOW_SEC);
		expect(user('victim').alert_email).toBeNull();
		expect(mem.tokens).toEqual([]);
		expect(mem.batches).toHaveLength(1);
		const order = mem.batches[0];
		expect(order[0]).toMatch(/^UPDATE auth_users SET sessions_valid_after = \?, alert_email = NULL/);
		expect(order[1]).toMatch(/^DELETE FROM auth_accounts/);
		expect(order[2]).toMatch(/^DELETE FROM auth_credentials/);
		expect(order[3]).toMatch(/^UPDATE auth_users SET email_verified/);
		expect(order[4]).toMatch(/^DELETE FROM signup_verification_tokens/);
	});

	it('Google email_verified as the string "true" counts too', async () => {
		expect((await guardSignIn(google('owner@company.dev', 'true'), deps())).allow).toBe(true);
		expect(mem.credentials.has('victim')).toBe(false);
	});

	it('GitHub: verified only when /user/emails lists this exact address as verified', async () => {
		const f = ghEmails([{ email: 'other@x.io', primary: true, verified: true }, { email: 'OWNER@company.dev', primary: false, verified: true }]);
		expect((await guardSignIn(github('owner@company.dev'), deps(f))).allow).toBe(true);
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0] as any[];
		expect(url).toBe('https://api.github.com/user/emails');
		expect(init.headers.Authorization).toBe('Bearer gho_x');
		expect(mem.credentials.has('victim')).toBe(false);
	});

	it('magic-link callback (the token was redeemed): password AND every provider link removed, sessions revoked', async () => {
		mem.accounts.push({ user_id: 'victim', provider: 'github', provider_account_id: 'gh-attacker' });
		expect(await guardSignIn(magicCallback('owner@company.dev'), deps())).toEqual(ALLOW(false, true));
		expect(mem.credentials.has('victim')).toBe(false);
		expect(mem.accounts).toEqual([]);
		expect(user('victim').sessions_valid_after).toBe(NOW_SEC);
		expect(user('victim').email_verified).not.toBeNull();
	});

	it('a row whose only way in is the provider proving it now is just marked verified (no revocation)', async () => {
		mem.users.push({ id: 'legacy', email: 'legacy@company.dev', email_verified: null, sessions_valid_after: null, alert_email: 'mine@company.dev' });
		mem.accounts.push({ user_id: 'legacy', provider: 'google', provider_account_id: 'g-legacy' });
		expect(await guardSignIn(google('legacy@company.dev', true, 'g-legacy'), deps())).toEqual(ALLOW(true, true));
		expect(user('legacy').email_verified).not.toBeNull();
		expect(user('legacy').sessions_valid_after).toBeNull();
		expect(user('legacy').alert_email).toBe('mine@company.dev');
		expect(mem.accounts).toHaveLength(1);
	});
});

describe('guardSignIn: attacker first (an unverified provider address creates the row)', () => {
	it('a GitHub account whose address is unverified cannot create a row for it', async () => {
		const f = ghEmails([{ email: 'new-victim@company.dev', primary: true, verified: false }]);
		expect(await guardSignIn(github('new-victim@company.dev', 'gh-attacker'), deps(f))).toEqual({ allow: false, redirect: PROVIDER_UNVERIFIED_REDIRECT });
		expect(f).toHaveBeenCalledTimes(1);
		expect(mem.batches).toHaveLength(0);
	});

	it('Google email_verified=false cannot create a row either', async () => {
		expect(await guardSignIn(google('new-victim@company.dev', false), deps())).toEqual({ allow: false, redirect: PROVIDER_UNVERIFIED_REDIRECT });
		expect(await guardSignIn(google('new-victim@company.dev', undefined), deps())).toMatchObject({ allow: false });
	});

	it('a row an unverified GitHub account created before this guard: the owner takes it back, the attacker is then refused', async () => {
		// State left by the old code: row R keyed on the owner's address, linked only to the
		// attacker's GitHub account, never verified, with the attacker's alert_email.
		mem.users.push({ id: 'R', email: 'mark@company.dev', email_verified: null, sessions_valid_after: null, alert_email: 'attacker@evil.dev' });
		mem.accounts.push({ user_id: 'R', provider: 'github', provider_account_id: 'gh-attacker' });

		// Until the owner shows up, the attacker's linked account keeps signing in (nothing to take back).
		const unverifiedGh = ghEmails([{ email: 'mark@company.dev', primary: true, verified: false }]);
		expect(await guardSignIn(github('mark@company.dev', 'gh-attacker'), deps(unverifiedGh))).toEqual(ALLOW(true, false));
		expect(mem.batches).toHaveLength(0);

		// The owner signs in with Google, which verified the address.
		expect(await guardSignIn(google('mark@company.dev', true, 'g-owner'), deps())).toEqual(ALLOW(false, true));
		expect(mem.accounts.filter((a) => a.user_id === 'R')).toEqual([]); // attacker unlinked
		expect(user('R').sessions_valid_after).toBe(NOW_SEC);             // attacker's sessions revoked
		expect(user('R').alert_email).toBeNull();                           // alerts no longer go to the attacker
		expect(user('R').email_verified).not.toBeNull();

		// (Layer 1 / the adapter now link g-owner to R.) The attacker comes back: refused.
		mem.accounts.push({ user_id: 'R', provider: 'google', provider_account_id: 'g-owner' });
		const again = ghEmails([{ email: 'mark@company.dev', primary: true, verified: false }]);
		expect(await guardSignIn(github('mark@company.dev', 'gh-attacker'), deps(again))).toEqual({ allow: false, redirect: PROVIDER_UNVERIFIED_REDIRECT });
	});
});

describe('guardSignIn: a proven sign-in that creates the row marks it verified afterwards', () => {
	it('remembers the proof per account object and marks only that user and that address', async () => {
		const params = google('fresh@company.dev', true, 'g-fresh');
		expect(await guardSignIn(params, deps())).toEqual(ALLOW(false, true));
		expect(mem.batches).toHaveLength(0);
		// Auth.js now creates the row (emailVerified null) and calls the jwt callback.
		mem.users.push({ id: 'fresh', email: 'fresh@company.dev', email_verified: null, sessions_valid_after: null, alert_email: null });
		await markProvenAddressVerified('fresh', { ...params.account }); // a different object: nothing
		expect(user('fresh').email_verified).toBeNull();
		await markProvenAddressVerified('fresh', params.account);
		expect(user('fresh').email_verified).not.toBeNull();
	});

	it('never marks a different user (e.g. a signed-in user the provider was linked to) with that address', async () => {
		const params = google('fresh2@company.dev', true, 'g-fresh2');
		await guardSignIn(params, deps());
		mem.users.push({ id: 'fresh2', email: 'fresh2@company.dev', email_verified: null, sessions_valid_after: null, alert_email: null });
		mem.users.push({ id: 'signed-in', email: 'me@company.dev', email_verified: null, sessions_valid_after: null, alert_email: null });
		await markProvenAddressVerified('signed-in', params.account);
		expect(user('signed-in').email_verified).toBeNull();
		// The proof is spent either way.
		await markProvenAddressVerified('fresh2', params.account);
		expect(user('fresh2').email_verified).toBeNull();
	});

	it('an unproven sign-in leaves nothing to mark', async () => {
		mem.accounts.push({ user_id: 'victim', provider: 'google', provider_account_id: 'g-9' });
		const params = google('owner@company.dev', false, 'g-9');
		await guardSignIn(params, deps());
		await markProvenAddressVerified('victim', params.account);
		expect(user('victim').email_verified).toBeNull();
	});
});

describe('guardSignIn: "linked" means linked to the row holding the address', () => {
	it('a provider account linked to ANOTHER user, with an unverified address: allowed as that user, email linking must be skipped, nothing taken back', async () => {
		mem.users.push({ id: 'goog', email: 'someone@gmail.com', email_verified: '2026-01-01', sessions_valid_after: null, alert_email: null });
		mem.accounts.push({ user_id: 'goog', provider: 'google', provider_account_id: 'g-other' });
		const d = await guardSignIn(google('owner@company.dev', false, 'g-other'), deps());
		expect(d).toEqual(ALLOW(true, false));
		expect(mem.credentials.has('victim')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});

	it('a linked account with no address of its own may have one filled in, but only a proven one', async () => {
		// An old GitHub sign-in that shared no email: linked, but the user row's email is ''.
		mem.users.push({ id: 'noemail', email: '', email_verified: null, sessions_valid_after: null, alert_email: null });
		mem.accounts.push({ user_id: 'noemail', provider: 'github', provider_account_id: 'gh-old' });
		const unproven = ghEmails([{ email: 'claimed@company.dev', primary: true, verified: false }]);
		expect(await guardSignIn(github('claimed@company.dev', 'gh-old'), deps(unproven))).toEqual(ALLOW(true, false));
		const proven = ghEmails([{ email: 'claimed@company.dev', primary: true, verified: true }]);
		const params = github('claimed@company.dev', 'gh-old');
		expect(await guardSignIn(params, deps(proven))).toEqual(ALLOW(true, true));
		expect(mem.batches).toHaveLength(0);
		// A linked user that already has an address needs no provider call.
		mem.accounts.push({ user_id: 'solid', provider: 'github', provider_account_id: 'gh-solid' });
		const none = vi.fn();
		expect(await guardSignIn(github('new-address@company.dev', 'gh-solid'), deps(none))).toEqual(ALLOW(true, false));
		expect(none).not.toHaveBeenCalled();
	});

	it('...and a proven one takes nothing back from the other row either', async () => {
		mem.accounts.push({ user_id: 'solid', provider: 'google', provider_account_id: 'g-other' });
		expect(await guardSignIn(google('owner@company.dev', true, 'g-other'), deps())).toEqual(ALLOW(true, false));
		expect(mem.credentials.has('victim')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});
});

describe('guardSignIn: nothing is written when nothing needs taking back', () => {
	it('an already-verified row keeps its password', async () => {
		expect(await guardSignIn(google('solid@company.dev', true), deps())).toEqual(ALLOW(false, true));
		expect(mem.credentials.has('solid')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});

	it('a returning, verified, already-linked user passes without a provider call', async () => {
		mem.accounts.push({ user_id: 'solid', provider: 'github', provider_account_id: 'gh-1' });
		const f = vi.fn();
		expect(await guardSignIn(github('solid@company.dev'), deps(f))).toEqual(ALLOW(true, true));
		expect(f).not.toHaveBeenCalled();
		expect(mem.batches).toHaveLength(0);
	});

	it('a provider-verified brand-new address passes (one GitHub call, nothing written)', async () => {
		const f = ghEmails([{ email: 'fresh@company.dev', primary: true, verified: true }]);
		expect(await guardSignIn(github('fresh@company.dev'), deps(f))).toEqual(ALLOW(false, true));
		expect(f).toHaveBeenCalledTimes(1);
		expect(mem.batches).toHaveLength(0);
	});

	it('password sign-in is a no-op (no queries at all)', async () => {
		const d = await guardSignIn(
			{ user: { id: 'victim', email: 'owner@company.dev' }, account: { type: 'credentials', provider: 'credentials', providerAccountId: 'victim' } },
			deps(),
		);
		expect(d).toEqual(ALLOW(false, false));
		expect(mem.queries).toBe(0);
	});
});

describe('guardSignIn: an unverified provider address never lands on an existing row', () => {
	it('GitHub lists the address as verified:false -> refused, nothing written', async () => {
		const f = ghEmails([{ email: 'owner@company.dev', primary: true, verified: false }]);
		expect(await guardSignIn(github('owner@company.dev'), deps(f))).toEqual({ allow: false, redirect: PROVIDER_UNVERIFIED_REDIRECT });
		expect(mem.credentials.has('victim')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});

	it('the GitHub API failing counts as unverified -> refused', async () => {
		const f = vi.fn(async () => { throw new Error('ETIMEDOUT'); });
		expect((await guardSignIn(github('solid@company.dev'), deps(f))).allow).toBe(false);
		const f500 = vi.fn(async () => new Response('nope', { status: 500 }));
		expect((await guardSignIn(github('solid@company.dev'), deps(f500))).allow).toBe(false);
		expect(mem.batches).toHaveLength(0);
	});

	it('Google email_verified=false on an existing row -> refused', async () => {
		expect((await guardSignIn(google('solid@company.dev', false), deps())).allow).toBe(false);
		expect((await guardSignIn(google('owner@company.dev', undefined), deps())).allow).toBe(false);
		expect(mem.credentials.has('victim')).toBe(true);
	});

	it('...unless this provider account is already linked to that row (a returning user), which is allowed but takes nothing back', async () => {
		mem.accounts.push({ user_id: 'victim', provider: 'google', provider_account_id: 'g-9' });
		expect(await guardSignIn(google('owner@company.dev', false, 'g-9'), deps())).toEqual(ALLOW(true, false));
		expect(mem.credentials.has('victim')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});
});

describe('guardSignIn: the magic-link request proves nothing', () => {
	const request = (email: string) => ({
		user: { id: 'random-4', email },
		account: { type: 'email', provider: 'email', providerAccountId: email },
		email: { verificationRequest: true },
	});

	it('writes nothing for an unverified row', async () => {
		expect(await guardSignIn(request('owner@company.dev'), deps())).toEqual(ALLOW(false, false));
		expect(mem.credentials.has('victim')).toBe(true);
		expect(mem.batches).toHaveLength(0);
	});

	it('refuses to mail a junk address unless an account already has it', async () => {
		expect((await guardSignIn(request(`testing@example.com'"`), deps())).allow).toBe(false);
		mem.users.push({ id: 'legacy', email: "o'brien@company.dev", email_verified: '2026-01-01', sessions_valid_after: null, alert_email: null });
		expect((await guardSignIn(request("o'brien@company.dev"), deps())).allow).toBe(true);
	});

	it('throttles one address in memory: the 4th request in 15 minutes is refused, another address is not', async () => {
		for (let i = 0; i < 3; i++) expect((await guardSignIn(request('inbox@company.dev'), deps())).allow).toBe(true);
		expect(await guardSignIn(request('inbox@company.dev'), deps())).toEqual({ allow: false, redirect: MAGIC_LINK_THROTTLED_REDIRECT });
		expect((await guardSignIn(request('other@company.dev'), deps())).allow).toBe(true);
	});

	it('throttles durably: 5 links issued for the address in the last hour (a restart forgets the memory, not the table)', async () => {
		const issued = (minsAgo: number) => new Date(NOW - minsAgo * 60_000 + 24 * 3600_000).toISOString();
		mem.magicTokens = [10, 20, 30, 40, 50].map((m) => ({ identifier: 'inbox@company.dev', expires: issued(m) }));
		expect(await guardSignIn(request('inbox@company.dev'), deps())).toEqual({ allow: false, redirect: MAGIC_LINK_THROTTLED_REDIRECT });
		// Older than an hour no longer counts.
		mem.magicTokens = [10, 20, 30, 40, 90].map((m) => ({ identifier: 'inbox@company.dev', expires: issued(m) }));
		__resetAuthLinkGuardForTests();
		expect((await guardSignIn(request('inbox@company.dev'), deps())).allow).toBe(true);
	});
});

describe('providerVerifiedEmail', () => {
	it('is null for unknown providers and for credentials', async () => {
		expect(await providerVerifiedEmail({ user: { email: 'a@x.io' }, account: { type: 'oidc', provider: 'someidp' }, profile: { email: 'a@x.io', email_verified: true } })).toBeNull();
		expect(await providerVerifiedEmail({ user: { email: 'a@x.io' }, account: { type: 'credentials', provider: 'credentials' } })).toBeNull();
	});
	it('is null for GitHub without an access token', async () => {
		expect(await providerVerifiedEmail({ user: { email: 'a@x.io' }, account: { type: 'oauth', provider: 'github' }, profile: { email: 'a@x.io' } }, vi.fn())).toBeNull();
	});
	it('is null for the magic-link request, the address for its callback', async () => {
		const account = { type: 'email', provider: 'email' };
		expect(await providerVerifiedEmail({ user: { email: 'a@x.io' }, account, email: { verificationRequest: true } })).toBeNull();
		expect(await providerVerifiedEmail({ user: { email: 'A@x.io' }, account })).toBe('a@x.io');
	});
});
