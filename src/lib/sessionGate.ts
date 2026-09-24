/**
 * Session gate: which signed JWT sessions must no longer be honored.
 *
 * Sessions are stateless JWTs that last 30 days and roll forward on every
 * /api/auth/session refresh, so a sign-in rule added today does nothing to a token minted
 * last week. This module is the check that closes that gap. getAuthSession (the root of
 * every tenant route, API and page) and the Auth.js jwt refresh callback both consult it.
 *
 * A session is cut when:
 *   - unverified_password: the user's ONLY way in is a password on an email address that
 *     was never verified (an auth_credentials row, email_verified empty, no auth_accounts
 *     row). Anyone can type any address into the sign-up form, so such a session proves
 *     nothing about who holds it.
 *     NOT cut: Google/GitHub users (auth_accounts row; Auth.js leaves their email_verified
 *     NULL), magic-link users (no password row, and email_verified is set when the link
 *     creates the account), verified password users, and the demo session (no JWT subject;
 *     it is resolved before any user lookup).
 *   - password_needs_provider: a "mixed" account, an unverified password PLUS a Google/GitHub
 *     link, and the session was minted by the password, or before sessions recorded how
 *     they were minted (the `via` claim, stamped at sign-in since this gate shipped). The
 *     classic chain: someone pre-registered a password on the owner's address and signed
 *     in; the owner later signed in with Google, which linked Google to that row. The
 *     password holder's session must not ride on the owner's link. The owner's own older
 *     session is cut too, once: signing in with Google again takes the address back (see
 *     authLinkGuard) and the new session carries `via`.
 *   - revoked: auth_users.sessions_valid_after is set and the token was issued before it.
 *     Set when a verified provider sign-in takes an address back from an unverified password
 *     or an unproven provider link (see authLinkGuard), so a session minted by either stops
 *     working.
 *   - missing_user: the token's subject no longer exists (a deleted or purged account).
 *
 * Facts are cached per user for 60 seconds, so the gate costs one primary-key lookup per
 * signed-in user per minute per process.
 *
 * FAIL-OPEN on a database error or a slow database (checkSessionCut returns null, caches
 * nothing, and skips the lookup for a few seconds after a failure):
 *   - getAuthSession runs on every page through the layout and on the public login pages.
 *     Failing closed would turn a database blip into signing everyone out, and through the
 *     jwt refresh path it would actually delete their session cookies. A lookup that hangs
 *     (the pg pool has no connect timeout) would hang every page a signed-in visitor opens,
 *     so the lookup is raced against a short timeout.
 *   - New unverified password sessions are already refused at sign-in, which needs the
 *     database to succeed at all. This gate only remediates tokens minted before that rule.
 *   - A tenant route cannot serve tenant data without the database anyway.
 * isVerifiedUser, which gates outbound email, is the opposite: it FAILS CLOSED.
 */
import { db } from './db';

export type UserAuthFacts = {
	emailVerified: string | null;
	/** Epoch seconds; tokens issued before this are revoked. */
	sessionsValidAfter: number | null;
	hasPassword: boolean;
	hasAccount: boolean;
};

export type SessionCutReason = 'missing_user' | 'unverified_password' | 'password_needs_provider' | 'revoked';

/** How long a session check may wait on the database before honoring the session. */
const LOOKUP_TIMEOUT_MS = 1_500;
/** After a failed or slow lookup, skip lookups (honor sessions) for this long. */
const DEGRADED_MS = 5_000;
let degradedUntil = 0;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
	});
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_KEYS = 5_000;
const factsCache = new Map<string, { facts: UserAuthFacts | null; expiresAt: number }>();

/** True when an auth_users.email_verified value means "verified" (the column is TEXT). */
export function isEmailVerifiedValue(value: unknown): boolean {
	return value != null && String(value).trim() !== '';
}

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

let columnsEnsured: Promise<void> | null = null;

/** Columns this gate and the link guard read or write, added lazily when missing. */
const AUTH_USER_COLUMNS: Record<string, string> = {
	sessions_valid_after: 'BIGINT',
	// Normally present (the alert-email feature); the link guard clears it on a reclaim.
	alert_email: 'TEXT',
};

/**
 * Lazily add the auth_users columns above (idempotent; memoized per process, retried after
 * a failure). Looks before it alters: this runs on the first signed-in request of every
 * process, and ALTER TABLE takes an exclusive lock on auth_users even when the column
 * already exists. When it does alter, it does so under a 2s lock_timeout, so an open
 * transaction on auth_users makes this attempt fail (and retry later) instead of queueing
 * every sign-in and session check behind the ALTER.
 */
export function ensureSessionColumns(): Promise<void> {
	if (!columnsEnsured) {
		columnsEnsured = (async () => {
			const present = await db.execute({
				sql: `SELECT column_name FROM information_schema.columns
				      WHERE table_schema = current_schema() AND table_name = 'auth_users'
				        AND column_name IN ('sessions_valid_after', 'alert_email')`,
				args: [],
			});
			const have = new Set((present.rows as Record<string, unknown>[]).map((r) => String(r.column_name)));
			const missing = Object.keys(AUTH_USER_COLUMNS).filter((c) => !have.has(c));
			if (!missing.length) return;
			await db.batch(
				[
					{ sql: "SET LOCAL lock_timeout = '2s'", args: [] },
					...missing.map((c) => ({ sql: `ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS ${c} ${AUTH_USER_COLUMNS[c]}`, args: [] })),
				],
				'write',
			);
		})().catch((err: unknown) => {
			columnsEnsured = null;
			throw err;
		});
	}
	return columnsEnsured;
}

/**
 * The sign-in facts for one user, or null when the user does not exist. Cached for 60s.
 * Throws on a database error (and caches nothing).
 */
export async function getUserAuthFacts(userId: string, now = Date.now()): Promise<UserAuthFacts | null> {
	const hit = factsCache.get(userId);
	if (hit && hit.expiresAt > now) return hit.facts;

	await ensureSessionColumns();
	const res = await db.execute({
		sql: `SELECT u.email_verified, u.sessions_valid_after,
		             EXISTS (SELECT 1 FROM auth_credentials c WHERE c.user_id = u.id) AS has_password,
		             EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id) AS has_account
		      FROM auth_users u
		      WHERE u.id = ?
		      LIMIT 1`,
		args: [userId],
	});
	const row = res.rows[0] as Record<string, unknown> | undefined;
	const facts: UserAuthFacts | null = row
		? {
				emailVerified: row.email_verified == null ? null : String(row.email_verified),
				sessionsValidAfter:
					row.sessions_valid_after == null || !Number.isFinite(Number(row.sessions_valid_after))
						? null
						: Number(row.sessions_valid_after),
				hasPassword: toBool(row.has_password),
				hasAccount: toBool(row.has_account),
			}
		: null;

	if (factsCache.has(userId)) factsCache.delete(userId);
	factsCache.set(userId, { facts, expiresAt: now + CACHE_TTL_MS });
	if (factsCache.size > CACHE_MAX_KEYS) {
		for (const [k, e] of factsCache) {
			if (e.expiresAt <= now || factsCache.size > CACHE_MAX_KEYS) factsCache.delete(k);
			else break;
		}
	}
	return facts;
}

/** Drop a user's cached facts after their verification state or credentials change. */
export function invalidateUserAuthFacts(userId: string): void {
	factsCache.delete(userId);
}

/**
 * Pure decision: why a session for this user, issued at `iat` (epoch seconds) and minted by
 * `via` (the sign-in provider id, absent on tokens from before it was recorded), must be
 * cut, or null.
 */
export function classifySessionCut(facts: UserAuthFacts | null, iat: unknown, via?: unknown): SessionCutReason | null {
	if (!facts) return 'missing_user';
	if (facts.hasPassword && !isEmailVerifiedValue(facts.emailVerified)) {
		if (!facts.hasAccount) return 'unverified_password';
		const mintedBy = typeof via === 'string' ? via : '';
		if (!mintedBy || mintedBy === 'credentials') return 'password_needs_provider';
	}
	if (facts.sessionsValidAfter != null) {
		const issuedAt = Number(iat);
		if (!Number.isFinite(issuedAt) || issuedAt < facts.sessionsValidAfter) return 'revoked';
	}
	return null;
}

/**
 * Why this session must be cut, or null to honor it. FAIL-OPEN: a database error, or a
 * lookup slower than LOOKUP_TIMEOUT_MS, returns null, and for DEGRADED_MS afterwards every
 * check returns null without touching the database.
 */
export async function checkSessionCut(userId: string, iat: unknown, via?: unknown, now = Date.now()): Promise<SessionCutReason | null> {
	if (now < degradedUntil) return null;
	try {
		return classifySessionCut(await withTimeout(getUserAuthFacts(userId), LOOKUP_TIMEOUT_MS), iat, via);
	} catch (err) {
		degradedUntil = Date.now() + DEGRADED_MS;
		console.warn('[sessionGate] auth facts lookup failed; honoring the session (fail-open)', {
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
}

/**
 * True when the account is accountable enough to make Almstins email someone else: its
 * email was verified, or it signs in through a Google/GitHub account. FAIL-CLOSED: a
 * missing user, a database error or a timed-out lookup returns false.
 */
export async function isVerifiedUser(userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	try {
		const facts = await withTimeout(getUserAuthFacts(String(userId)), LOOKUP_TIMEOUT_MS);
		return !!facts && (isEmailVerifiedValue(facts.emailVerified) || facts.hasAccount);
	} catch (err) {
		console.warn('[sessionGate] verified-user lookup failed; refusing (fail-closed)', {
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}

/** Test hook: forget every cached fact, the column memo and the degraded window. */
export function __resetSessionGateForTests(): void {
	factsCache.clear();
	columnsEnsured = null;
	degradedUntil = 0;
}
