import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The session gate decides which signed JWT sessions stop being honored. Pinned here:
 *   - exactly the password-only, never-verified accounts are cut, NOT Google/GitHub users
 *     (Auth.js leaves their email_verified NULL) and NOT magic-link users;
 *   - on a "mixed" account (unverified password + provider link) a session minted by the
 *     password, or before `via` was recorded, is cut; one minted by the provider is not;
 *   - sessions issued before sessions_valid_after are revoked; later ones are not;
 *   - a deleted user's session is cut;
 *   - a database error OR a hung lookup fails OPEN (session honored), is never cached, and
 *     skips lookups for a few seconds;
 *   - a missing column is added under a lock_timeout, in one transaction;
 *   - isVerifiedUser, which gates outbound email, fails CLOSED.
 */
const mem = vi.hoisted(() => ({
	users: new Map<string, Record<string, any>>(),
	fail: false,
	hang: false,
	selects: 0,
	columnPresent: true,
	alters: 0,
	alterBatches: [] as string[][],
}));

vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (sql.startsWith('SELECT column_name FROM information_schema.columns')) {
			if (mem.fail) throw new Error('connection refused');
			return { rows: mem.columnPresent ? [{ column_name: 'sessions_valid_after' }, { column_name: 'alert_email' }] : [{ column_name: 'alert_email' }], rowsAffected: 0 };
		}
		if (sql.startsWith('SELECT u.email_verified, u.sessions_valid_after, EXISTS (SELECT 1 FROM auth_credentials c')) {
			mem.selects += 1;
			if (mem.hang) return new Promise(() => {});
			if (mem.fail) throw new Error('connection refused');
			const u = mem.users.get(String(args[0]));
			return {
				rows: u ? [{ email_verified: u.email_verified, sessions_valid_after: u.sessions_valid_after, has_password: u.has_password, has_account: u.has_account }] : [],
				rowsAffected: 0,
			};
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	const batch = async (stmts: any[]) => {
		const seen = stmts.map((st) => String(st.sql).replace(/\s+/g, ' ').trim());
		mem.alterBatches.push(seen);
		if (seen.some((q) => q.startsWith('ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS sessions_valid_after'))) {
			mem.alters += 1;
			mem.columnPresent = true;
		}
		return seen.map(() => ({ rows: [], rowsAffected: 0 }));
	};
	return { db: { execute, batch } };
});

import {
	classifySessionCut,
	checkSessionCut,
	isVerifiedUser,
	invalidateUserAuthFacts,
	__resetSessionGateForTests,
	type UserAuthFacts,
} from '../../src/lib/sessionGate';

const facts = (f: Partial<UserAuthFacts>): UserAuthFacts => ({
	emailVerified: null,
	sessionsValidAfter: null,
	hasPassword: false,
	hasAccount: false,
	...f,
});

beforeEach(() => {
	mem.users.clear();
	mem.fail = false;
	mem.hang = false;
	mem.selects = 0;
	mem.columnPresent = true;
	mem.alters = 0;
	mem.alterBatches = [];
	__resetSessionGateForTests();
});

describe('classifySessionCut (pure)', () => {
	it('cuts a password-only account whose email was never verified', () => {
		expect(classifySessionCut(facts({ hasPassword: true }), 100)).toBe('unverified_password');
		expect(classifySessionCut(facts({ hasPassword: true, emailVerified: '' }), 100)).toBe('unverified_password');
		expect(classifySessionCut(facts({ hasPassword: true, emailVerified: '   ' }), 100)).toBe('unverified_password');
	});

	it('does NOT cut a Google/GitHub user even though Auth.js leaves email_verified NULL', () => {
		expect(classifySessionCut(facts({ hasAccount: true }), 100)).toBeNull();
		expect(classifySessionCut(facts({ hasAccount: true }), 100, 'google')).toBeNull();
	});

	it('mixed account (unverified password + provider link): only a provider-minted session survives', () => {
		const mixed = facts({ hasAccount: true, hasPassword: true });
		expect(classifySessionCut(mixed, 100, 'google')).toBeNull();
		expect(classifySessionCut(mixed, 100, 'github')).toBeNull();
		expect(classifySessionCut(mixed, 100, 'credentials')).toBe('password_needs_provider');
		// Minted before `via` was recorded: can't tell, so cut (the owner signs in again once).
		expect(classifySessionCut(mixed, 100)).toBe('password_needs_provider');
		expect(classifySessionCut(mixed, 100, '')).toBe('password_needs_provider');
		// Once verified, the password is no longer a concern.
		expect(classifySessionCut(facts({ hasAccount: true, hasPassword: true, emailVerified: '2026-09-23' }), 100)).toBeNull();
	});

	it('does NOT cut a magic-link user or a verified password user', () => {
		expect(classifySessionCut(facts({ emailVerified: '2026-09-01T00:00:00.000Z' }), 100)).toBeNull();
		expect(classifySessionCut(facts({ emailVerified: null }), 100)).toBeNull(); // no password row
		expect(classifySessionCut(facts({ hasPassword: true, emailVerified: '2026-09-01 10:00:00' }), 100)).toBeNull();
	});

	it('cuts a session for a user that no longer exists', () => {
		expect(classifySessionCut(null, 100)).toBe('missing_user');
	});

	it('revokes tokens issued before sessions_valid_after, keeps later ones', () => {
		const f = facts({ hasAccount: true, emailVerified: '2026-09-01 10:00:00', sessionsValidAfter: 1_000 });
		expect(classifySessionCut(f, 999)).toBe('revoked');
		expect(classifySessionCut(f, 1_000)).toBeNull();
		expect(classifySessionCut(f, 1_001)).toBeNull();
		expect(classifySessionCut(f, undefined)).toBe('revoked');
	});
});

describe('checkSessionCut (cached, fail-open)', () => {
	it('reads the facts from the database and classifies them', async () => {
		mem.users.set('u-pw', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		mem.users.set('u-google', { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true });
		mem.users.set('u-link', { email_verified: '2026-09-20T12:00:00.000Z', sessions_valid_after: null, has_password: false, has_account: false });
		expect(await checkSessionCut('u-pw', 1)).toBe('unverified_password');
		expect(await checkSessionCut('u-google', 1)).toBeNull();
		expect(await checkSessionCut('u-link', 1)).toBeNull();
		expect(await checkSessionCut('u-gone', 1)).toBe('missing_user');
	});

	it('a cache hit avoids a second query; invalidation forces one', async () => {
		mem.users.set('u', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		expect(await checkSessionCut('u', 1)).toBe('unverified_password');
		expect(await checkSessionCut('u', 1)).toBe('unverified_password');
		expect(mem.selects).toBe(1);

		// The user verifies; verify-email invalidates the cached verdict.
		mem.users.get('u')!.email_verified = '2026-09-23 10:00:00';
		invalidateUserAuthFacts('u');
		expect(await checkSessionCut('u', 1)).toBeNull();
		expect(mem.selects).toBe(2);
	});

	it('adds the sessions_valid_after column only when it is missing, once per process, under a lock_timeout', async () => {
		mem.users.set('u', { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true });
		await checkSessionCut('u', 1);
		expect(mem.alters).toBe(0);
		expect(mem.alterBatches).toHaveLength(0);
		__resetSessionGateForTests();
		mem.columnPresent = false;
		await checkSessionCut('u', 1);
		invalidateUserAuthFacts('u');
		await checkSessionCut('u', 1);
		expect(mem.alters).toBe(1);
		expect(mem.alterBatches).toEqual([
			["SET LOCAL lock_timeout = '2s'", 'ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS sessions_valid_after BIGINT'],
		]);
	});

	it('a database error honors the session, is not cached, and skips lookups for a few seconds', async () => {
		mem.users.set('u', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		mem.fail = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await checkSessionCut('u', 1)).toBeNull();
		warn.mockRestore();
		mem.fail = false;
		const selects = mem.selects;
		// Inside the degraded window: honored without a query.
		expect(await checkSessionCut('u', 1)).toBeNull();
		expect(mem.selects).toBe(selects);
		// After it: looked up and cut.
		expect(await checkSessionCut('u', 1, undefined, Date.now() + 6_000)).toBe('unverified_password');
	});

	it('a lookup that hangs honors the session after the timeout (fail-open), instead of hanging the page', async () => {
		vi.useFakeTimers();
		try {
			mem.users.set('u', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
			mem.hang = true;
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const pending = checkSessionCut('u', 1);
			await vi.advanceTimersByTimeAsync(1_600);
			expect(await pending).toBeNull();
			warn.mockRestore();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('isVerifiedUser (gates outbound email, fail-closed)', () => {
	it('true for a verified email or a Google/GitHub account', async () => {
		mem.users.set('v', { email_verified: '2026-09-01 10:00:00', sessions_valid_after: null, has_password: true, has_account: false });
		mem.users.set('g', { email_verified: null, sessions_valid_after: null, has_password: false, has_account: true });
		expect(await isVerifiedUser('v')).toBe(true);
		expect(await isVerifiedUser('g')).toBe(true);
	});

	it('false for an unverified password account, a missing user, or no user', async () => {
		mem.users.set('p', { email_verified: null, sessions_valid_after: null, has_password: true, has_account: false });
		expect(await isVerifiedUser('p')).toBe(false);
		expect(await isVerifiedUser('nobody')).toBe(false);
		expect(await isVerifiedUser(null)).toBe(false);
		expect(await isVerifiedUser(undefined)).toBe(false);
	});

	it('false on a database error', async () => {
		mem.users.set('v', { email_verified: '2026-09-01 10:00:00', sessions_valid_after: null, has_password: true, has_account: false });
		mem.fail = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await isVerifiedUser('v')).toBe(false);
		warn.mockRestore();
	});

	it('false when the lookup hangs', async () => {
		vi.useFakeTimers();
		try {
			mem.users.set('v', { email_verified: '2026-09-01 10:00:00', sessions_valid_after: null, has_password: true, has_account: false });
			mem.hang = true;
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const pending = isVerifiedUser('v');
			await vi.advanceTimersByTimeAsync(1_600);
			expect(await pending).toBe(false);
			warn.mockRestore();
		} finally {
			vi.useRealTimers();
		}
	});
});
