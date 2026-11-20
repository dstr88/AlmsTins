/**
 * What Almstins records about an account's sign-ins and visits, for the owner's admin page.
 *
 * Three facts, all on auth_users:
 *   - The last sign-in (last_login, last_login_service, last_login_country). Stamped by
 *     `stampSignIn`, which the Auth.js jwt callback calls in its first-sign-in branch
 *     (src/lib/authRoute.ts). Every method reaches that branch after the account row exists:
 *     Google, GitHub, the emailed link and a password. The signIn callback cannot do it: Auth.js
 *     runs it before the adapter creates a new account, and hands every emailed-link sign-in a
 *     placeholder user, so a stamp there misses first sign-ins and every emailed link.
 *   - The product the account signed up for (signup_service). Written once by
 *     `saveSignupService`, when the account gets its first tenant (src/lib/tenants.ts), from the
 *     sign-in's own context (src/lib/signupService.ts). Never overwritten.
 *   - The last day the account was active (last_active_on, a UTC day, YYYY-MM-DD). Sessions last
 *     30 days, so a visit on a live session never moves last_login; this is what answers "did
 *     they come back". Written by `noteRequestActivity` from the app middleware
 *     (src/middleware/app.ts) and by a sign-in, at most once per account per day.
 *
 * Nothing here may fail or slow a request: every write is its own statement, caught and logged,
 * and the visit write is never awaited by the request that causes it.
 *
 * The two new columns are added lazily (ensureAccountActivityColumns), the way sessionGate adds
 * its own; migrations-pg/0077_auth_signup_service_last_active.sql holds the same statements.
 */
import { db } from './db';
import { getSignInContext } from './signupService';

/** The auth_users columns this file adds, in the order of ACCOUNT_ACTIVITY_DDL. */
export const ACCOUNT_ACTIVITY_COLUMNS = ['signup_service', 'last_active_on'] as const;

/** One statement per column. migrations-pg/0077 mirrors these word for word. */
export const ACCOUNT_ACTIVITY_DDL: readonly string[] = [
	'ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS signup_service TEXT',
	'ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_active_on TEXT',
];

let columnsEnsured: Promise<void> | null = null;

/**
 * Add the two columns when they are missing (idempotent; memoized per process, retried after a
 * failure). Looks before it alters, because ALTER TABLE takes an exclusive lock on auth_users
 * even when the column exists, and alters under a 2s lock_timeout so an open transaction on
 * auth_users makes this attempt fail (and retry later) instead of queueing sign-ins behind it.
 */
export function ensureAccountActivityColumns(): Promise<void> {
	if (!columnsEnsured) {
		columnsEnsured = (async () => {
			const present = await db.execute({
				sql: `SELECT column_name FROM information_schema.columns
				      WHERE table_schema = current_schema() AND table_name = 'auth_users'
				        AND column_name IN ('signup_service', 'last_active_on')`,
				args: [],
			});
			const have = new Set((present.rows as Record<string, unknown>[]).map((r) => String(r.column_name)));
			const missing = ACCOUNT_ACTIVITY_DDL.filter((_, i) => !have.has(ACCOUNT_ACTIVITY_COLUMNS[i]));
			if (!missing.length) return;
			await db.batch(
				[{ sql: "SET LOCAL lock_timeout = '2s'", args: [] }, ...missing.map((sql) => ({ sql, args: [] }))],
				'write',
			);
		})().catch((err: unknown) => {
			columnsEnsured = null;
			throw err;
		});
	}
	return columnsEnsured;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The UTC calendar day of an instant, as last_active_on stores it. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

// ── The last active day ──────────────────────────────────────────────────────

/** After a failed write, how long every account waits before the next attempt. */
const RETRY_AFTER_MS = 60_000;
/** The most accounts remembered as written today; past it the memory is dropped, not the rule. */
const SEEN_MAX = 50_000;

const seen = { day: '', users: new Set<string>() };
let quietUntil = 0;

/**
 * Record that an account was active on `now`'s UTC day. Returns whether a row was written.
 *
 * Cheap by design. An account already written today in this process costs no query at all. The
 * first request of the day (or of a new process) sends one UPDATE by primary key whose WHERE
 * matches only a row whose stored day is older, so a day already stored is not written again.
 * Never throws: a failure is logged and nothing is tried again for a minute.
 */
export async function recordActiveDay(userId: string, now: Date = new Date()): Promise<boolean> {
	if (!userId) return false;
	const day = utcDay(now);
	if (seen.day !== day) {
		seen.day = day;
		seen.users.clear();
	}
	if (seen.users.has(userId)) return false;
	if (now.getTime() < quietUntil) return false;
	if (seen.users.size >= SEEN_MAX) seen.users.clear();
	// Remembered before the write, so requests that arrive together send one statement.
	seen.users.add(userId);
	try {
		// A failed ensure is not final: the columns may have been added by hand (the migration).
		await ensureAccountActivityColumns().catch(() => {});
		const res = await db.execute({
			sql: `UPDATE auth_users SET last_active_on = ? WHERE id = ? AND (last_active_on IS NULL OR last_active_on < ?)`,
			args: [day, userId, day],
		});
		return Number(res.rowsAffected ?? 0) > 0;
	} catch (error) {
		seen.users.delete(userId);
		quietUntil = now.getTime() + RETRY_AFTER_MS;
		console.warn('[accountActivity] last active day not recorded', { error: message(error) });
		return false;
	}
}

export interface ActivityRequest {
	/** The signed-in account, or empty for a visitor. */
	userId: string | null | undefined;
	pathname: string;
	/** The request rides the demo cookie and no account (src/lib/demo.ts). */
	demoSession: boolean;
}

/**
 * Whether serving this request counts as the account being active: a page or an API request
 * served to a signed-in account. A demo session has no account, and a scheduled job
 * (/api/cron/*) is Almstins calling itself, so neither counts.
 */
export function countsAsActivity(req: ActivityRequest): boolean {
	if (!req.userId) return false;
	if (req.demoSession) return false;
	if (req.pathname.startsWith('/api/cron/')) return false;
	return true;
}

/**
 * The middleware's one call. Call it without awaiting: it never rejects, and the request it is
 * called from does not wait for the write.
 */
export function noteRequestActivity(req: ActivityRequest, now: Date = new Date()): Promise<boolean> {
	if (!countsAsActivity(req)) return Promise.resolve(false);
	return recordActiveDay(String(req.userId), now);
}

// ── The sign-in stamp ────────────────────────────────────────────────────────

/**
 * Record a sign-in: the product it was headed for and the country it came from, the time, and
 * the active day. Three statements, each on its own, so a database that lacks one column still
 * records the rest. Never throws: a failed stamp must not fail a sign-in.
 */
export async function stampSignIn(userId: string, now: Date = new Date()): Promise<void> {
	if (!userId) return;
	const ctx = getSignInContext();
	try {
		await db.execute({
			sql: `UPDATE auth_users SET last_login_service = ?, last_login_country = ? WHERE id = ?`,
			args: [ctx?.service.id ?? null, ctx?.country ?? null, userId],
		});
	} catch (error) {
		console.warn('[accountActivity] last_login service/country update failed', { userId, error: message(error) });
	}
	try {
		await db.execute({
			sql: `UPDATE auth_users SET last_login = ? WHERE id = ?`,
			args: [now.toISOString(), userId],
		});
	} catch (error) {
		console.warn('[accountActivity] last_login update failed', { userId, error: message(error) });
	}
	await recordActiveDay(userId, now);
}

// ── The product signed up for ────────────────────────────────────────────────

/**
 * Save the product this account signed up for, from the sign-in that is giving it its first
 * tenant. Written once: the WHERE leaves a stored value alone, so a later sign-in through
 * another product's door changes nothing. Outside a sign-in (the onboarding page) there is no
 * product to save, and nothing is written. Never throws.
 */
export async function saveSignupService(userId: string): Promise<void> {
	const service = getSignInContext()?.service.id;
	if (!userId || !service) return;
	try {
		await ensureAccountActivityColumns().catch(() => {});
		await db.execute({
			sql: `UPDATE auth_users SET signup_service = ? WHERE id = ? AND signup_service IS NULL`,
			args: [service, userId],
		});
	} catch (error) {
		console.warn('[accountActivity] sign-up product not saved', { userId, error: message(error) });
	}
}

/** Test hook: forget the column memo, the day's memory and the retry window. */
export function __resetAccountActivityForTests(): void {
	columnsEnsured = null;
	seen.day = '';
	seen.users.clear();
	quietUntil = 0;
}
