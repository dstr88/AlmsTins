/**
 * Account-linking guard, run from the Auth.js signIn callback before any linking.
 *
 * Why the signIn callback: in @auth/core it is the only hook that runs in every flow
 * (Google/GitHub, the magic-link callback, password) BEFORE the session is minted, and it
 * sees the Google ID-token claims and the GitHub access token. events.linkAccount misses
 * both our own email-based linking (the callback's "Layer 1") and the whole magic-link flow,
 * which never links an account row.
 *
 * Our sign-in links by email address: the signIn callback's Layer 1 inserts the account row
 * itself, and authAdapter.createUser returns the EXISTING user for a known address (the
 * adapter's getUserByEmail always returns null, so allowDangerousEmailAccountLinking is
 * never even consulted). Every takeover below comes from keying an account on an address
 * nobody proved; the guard closes them:
 *
 *   1. Pre-registered password. Someone signs up with a password on an address they don't
 *      own and waits. When the owner later signs in with Google, GitHub or a magic link,
 *      the owner lands in that account and the squatter's password still works.
 *   2. Unverified provider address, owner first. A GitHub account can carry an unverified
 *      primary email, and Google can report email_verified=false. Linking that onto an
 *      existing row would hand the row to whoever typed the address at the provider.
 *   3. Unverified provider address, attacker first. The same provider account signs in
 *      BEFORE any row has the address, so createUser keys a new row on it; when the owner
 *      later arrives, createUser hands the owner that very row, still linked to the
 *      attacker's provider account.
 *
 * So:
 *   - A provider account that is not linked to anyone yet may sign in with an address only
 *     when the provider verified it (cases 2 and 3). Otherwise the sign-in is refused and
 *     sent to /login?error=provider_unverified. That costs one GitHub API call on a GitHub
 *     account's first sign-in.
 *   - A provider account that is already linked signs in as its linked user (Auth.js
 *     getUserByAccount). If that user is not the row holding the address, the caller must
 *     skip email-based linking (providerLinked tells it so).
 *   - When a provider (or a redeemed magic link) proves an address whose row is still
 *     unverified, the row is taken back. If anyone else could have had a way in (a password,
 *     or a provider account other than the one proving the address now), in one
 *     transaction: revoke every session issued before now (sessions_valid_after; the new
 *     session is issued after), clear alert_email (whoever set it may have pointed the
 *     owner's alerts at their own inbox), unlink those other provider accounts (none of them
 *     proved the address), delete the password. Then mark the address verified. A row whose
 *     only way in is the provider account proving it now is just marked verified: no one
 *     else can hold a session on it.
 *   - When a proven sign-in CREATES the row, it is marked verified right after (Auth.js
 *     creates OAuth users with emailVerified null), via markProvenAddressVerified from the
 *     jwt callback. Otherwise the next provider to prove the address would treat the first
 *     one's link as unproven.
 *
 * What counts as provider-verified:
 *   - Google: the ID token's email_verified claim is true.
 *   - GitHub: /user/emails lists this exact address with verified: true (the provider's own
 *     fallback picks the primary address WITHOUT checking it, so it is re-checked here).
 *   - Magic link: the callback, after the emailed token was redeemed. Never the first
 *     signIn call (verificationRequest), which runs before anything is proven.
 * Password sign-in is never touched here.
 *
 * Returning users whose row is verified and whose provider account is linked to that row
 * pass without a provider call.
 *
 * The magic-link REQUEST (nothing proven yet) is also throttled per address here: it makes
 * Almstins mail whatever address is typed in, and the per-IP brake in the auth route does
 * nothing for many IPs aiming at one inbox.
 */
import { db } from './db';
import { ensureSessionColumns, invalidateUserAuthFacts, isEmailVerifiedValue } from './sessionGate';
import { normalizeSignupEmail } from './emailAddress';
import { createFixedWindowLimiter } from './rateLimit';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SignInParams = {
	user?: { id?: unknown; email?: unknown } | null;
	account?: {
		type?: string;
		provider?: string;
		providerAccountId?: unknown;
		access_token?: string;
	} | null;
	profile?: { email?: unknown; email_verified?: unknown } | null;
	email?: { verificationRequest?: boolean } | null;
};

export type GuardDeps = { fetchImpl?: FetchLike; now?: () => number };

/**
 * allow: true  -> continue. providerLinked: this provider account is already linked to a
 *                 user, so Auth.js signs in as that user and the caller must NOT link by
 *                 email. addressProven: this sign-in proved the address (the provider
 *                 verified it, or the magic link was redeemed); only then may the caller
 *                 write the address onto an account (the signIn callback's email backfill).
 * allow: false -> refuse; redirect (a same-origin path) when there is something to say.
 */
export type GuardDecision =
	| { allow: true; providerLinked: boolean; addressProven: boolean }
	| { allow: false; redirect: string | null };

export const PROVIDER_UNVERIFIED_REDIRECT = '/login?error=provider_unverified';
export const MAGIC_LINK_THROTTLED_REDIRECT = '/login?error=rate_limited';

const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

// Magic-link requests per address: in memory at most 3 per 15 minutes; durably at most 5
// tokens issued in the last hour (read back from auth_verification_tokens, whose expires is
// issued + the Email provider's maxAge, 24h by default).
const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MAGIC_LINK_MAX_PER_HOUR = 5;
const magicLinkPerAddress = createFixedWindowLimiter({ windowMs: 15 * 60 * 1000, max: 3 });

// Sign-ins whose address the provider proved, keyed by the Auth.js account object (the
// same object reaches the signIn and jwt callbacks of one sign-in). Weak: nothing leaks.
const provenSignIns = new WeakMap<object, string>();

const ALLOW = (providerLinked = false, addressProven = false): GuardDecision => ({ allow: true, providerLinked, addressProven });
const REFUSE = (redirect: string | null = null): GuardDecision => ({ allow: false, redirect });

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** The address this sign-in claims: the provider profile's, else the Auth.js user's. */
export function signInAddress(params: SignInParams): string {
	return lower(params.profile?.email) || lower(params.user?.email);
}

/**
 * The lowercased address the provider itself has verified for this sign-in, or null.
 * Any error (a GitHub API failure, a timeout) means "not verified".
 */
export async function providerVerifiedEmail(params: SignInParams, fetchImpl: FetchLike = fetch): Promise<string | null> {
	const { account, profile, email } = params;
	const address = signInAddress(params);
	if (!account || !address) return null;

	if (account.type === 'email') {
		return email?.verificationRequest ? null : address;
	}

	if (account.type === 'oidc' && account.provider === 'google') {
		const claim = profile?.email_verified;
		return claim === true || claim === 'true' ? address : null;
	}

	if (account.type === 'oauth' && account.provider === 'github') {
		if (!account.access_token) return null;
		try {
			const res = await fetchImpl(GITHUB_EMAILS_URL, {
				headers: {
					Authorization: `Bearer ${account.access_token}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'almstins-auth',
				},
				signal: AbortSignal.timeout(5000),
			});
			if (!res.ok) return null;
			const list = (await res.json()) as unknown;
			if (!Array.isArray(list)) return null;
			const match = list.some(
				(e) => e && typeof e === 'object' && lower((e as { email?: unknown }).email) === address && (e as { verified?: unknown }).verified === true,
			);
			return match ? address : null;
		} catch {
			return null;
		}
	}

	return null;
}

/** Who else might have had a way into a row being taken back: everything but this. */
type KeepAccount = { provider: string; providerAccountId: string } | null;

/**
 * Take an address back for the party that just proved it, in one transaction (see the
 * header). Order matters: each statement matches only while the row is still unverified,
 * and the "anyone else?" test runs before the password and links it looks at are deleted.
 */
async function reclaimAddress(userId: string, address: string, keep: KeepAccount, nowMs: number): Promise<void> {
	await ensureSessionColumns();
	const unverified = `(email_verified IS NULL OR email_verified = '')`;
	const keepArgs = [keep?.provider ?? '', keep?.providerAccountId ?? ''];
	await db.batch(
		[
			{
				sql: `UPDATE auth_users SET sessions_valid_after = ?, alert_email = NULL
				      WHERE id = ? AND ${unverified}
				        AND (EXISTS (SELECT 1 FROM auth_credentials c WHERE c.user_id = auth_users.id)
				             OR EXISTS (SELECT 1 FROM auth_accounts a
				                        WHERE a.user_id = auth_users.id AND NOT (a.provider = ? AND a.provider_account_id = ?)))`,
				args: [Math.floor(nowMs / 1000), userId, ...keepArgs],
			},
			{
				sql: `DELETE FROM auth_accounts
				      WHERE user_id IN (SELECT id FROM auth_users WHERE id = ? AND ${unverified})
				        AND NOT (provider = ? AND provider_account_id = ?)`,
				args: [userId, ...keepArgs],
			},
			{
				sql: `DELETE FROM auth_credentials
				      WHERE user_id IN (SELECT id FROM auth_users WHERE id = ? AND ${unverified})`,
				args: [userId],
			},
			{
				sql: `UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
				      WHERE id = ? AND ${unverified}`,
				args: [userId],
			},
			{
				sql: 'DELETE FROM signup_verification_tokens WHERE identifier = ?',
				args: [`signup:${address}`],
			},
		],
		'write',
	);
	invalidateUserAuthFacts(userId);
}

/** True when this address has asked for too many magic links recently. */
async function magicLinkThrottled(address: string, now: number): Promise<boolean> {
	if (magicLinkPerAddress.hit(address, now)) return true;
	const res = await db.execute({
		sql: 'SELECT expires FROM auth_verification_tokens WHERE identifier = ?',
		args: [address],
	});
	const recent = (res.rows as Record<string, unknown>[])
		.map((r) => Date.parse(String(r.expires ?? '')) - MAGIC_LINK_TTL_MS)
		.filter((issuedAt) => Number.isFinite(issuedAt) && issuedAt > now - 60 * 60 * 1000);
	return recent.length >= MAGIC_LINK_MAX_PER_HOUR;
}

/**
 * Decide whether this sign-in may continue, taking an address back first when the sign-in
 * proves it. Database errors propagate (the sign-in fails rather than linking unchecked).
 */
export async function guardSignIn(params: SignInParams, deps: GuardDeps = {}): Promise<GuardDecision> {
	const { account, email } = params;
	const type = account?.type;
	if (type !== 'oauth' && type !== 'oidc' && type !== 'email') return ALLOW();

	const address = signInAddress(params);
	if (!address) return ALLOW();
	const now = (deps.now ?? Date.now)();

	// Magic-link REQUEST: nothing is proven yet. Refuse to mail an address the sign-up form
	// would reject, unless it already belongs to an account (older, unusual addresses), and
	// throttle per address.
	if (type === 'email' && email?.verificationRequest) {
		if (!normalizeSignupEmail(address)) {
			const known = await db.execute({ sql: 'SELECT 1 AS ok FROM auth_users WHERE email = ? LIMIT 1', args: [address] });
			if (!known.rows.length) return REFUSE();
		}
		if (await magicLinkThrottled(address, now)) {
			console.warn('[authLinkGuard] magic-link request throttled for this address');
			return REFUSE(MAGIC_LINK_THROTTLED_REDIRECT);
		}
		return ALLOW();
	}

	// Magic-link CALLBACK: the emailed token was redeemed, so the address is proven. Nothing
	// is linked in this flow; an unverified row is taken back from everyone else.
	if (type === 'email') {
		const found = await db.execute({ sql: 'SELECT id, email_verified FROM auth_users WHERE email = ? LIMIT 1', args: [address] });
		const row = found.rows[0] as Record<string, unknown> | undefined;
		if (row && !isEmailVerifiedValue(row.email_verified)) {
			await reclaimAddress(String(row.id), address, null, now);
			console.log('[authLinkGuard] address proven by email link; row taken back', { userId: String(row.id) });
		}
		return ALLOW(false, true);
	}

	// Google / GitHub. linked_here: this provider account belongs to the row holding the
	// address. linked_any: it belongs to some user (Auth.js signs in as that user), whose
	// address is linked_email.
	const provider = String(account?.provider ?? '');
	const providerAccountId = String(account?.providerAccountId ?? '');
	const found = await db.execute({
		sql: `SELECT u.id, u.email_verified,
		             EXISTS (SELECT 1 FROM auth_accounts a
		                     WHERE a.user_id = u.id AND a.provider = ? AND a.provider_account_id = ?) AS linked_here,
		             EXISTS (SELECT 1 FROM auth_accounts a
		                     WHERE a.provider = ? AND a.provider_account_id = ?) AS linked_any,
		             (SELECT l.email FROM auth_accounts a JOIN auth_users l ON l.id = a.user_id
		              WHERE a.provider = ? AND a.provider_account_id = ? LIMIT 1) AS linked_email
		      FROM (SELECT 1 AS one) AS probe
		      LEFT JOIN auth_users u ON u.email = ?
		      LIMIT 1`,
		args: [provider, providerAccountId, provider, providerAccountId, provider, providerAccountId, address],
	});
	const hit = found.rows[0] as Record<string, unknown> | undefined;
	const rowId = hit?.id == null ? null : String(hit.id);
	const rowVerified = rowId !== null && isEmailVerifiedValue(hit?.email_verified);
	const linkedHere = rowId !== null && toBool(hit?.linked_here);
	const linkedAny = toBool(hit?.linked_any);
	const fetchImpl = deps.fetchImpl ?? fetch;

	// A returning user on its own, verified row: nothing to prove or take back.
	if (linkedHere && rowVerified) return ALLOW(true, true);
	// Linked to a different user (or no row has this address): Auth.js signs in as the
	// linked user. No email-based linking may happen, and nothing here is taken back. The
	// one thing the caller may still do is fill in that user's address when it has none
	// (accounts created before GitHub shared private emails), and only a proven one.
	if (linkedAny && !linkedHere) {
		if (rowId !== null || String(hit?.linked_email ?? '').trim()) return ALLOW(true, false);
		const provenForBackfill = (await providerVerifiedEmail(params, fetchImpl)) === address;
		if (provenForBackfill && account) provenSignIns.set(account, address);
		return ALLOW(true, provenForBackfill);
	}

	const proven = (await providerVerifiedEmail(params, fetchImpl)) === address;
	if (!proven) {
		// A returning user whose row was never verified keeps signing in; the row is taken
		// back from this account when anyone proves the address.
		if (linkedHere) return ALLOW(true, false);
		console.warn('[authLinkGuard] refused: provider did not verify the address of a new link', {
			provider: account?.provider ?? null,
			existingRow: rowId !== null,
		});
		return REFUSE(PROVIDER_UNVERIFIED_REDIRECT);
	}

	if (account) provenSignIns.set(account, address);
	if (rowId !== null && !rowVerified) {
		await reclaimAddress(rowId, address, { provider, providerAccountId }, now);
		console.log('[authLinkGuard] address verified by provider; row taken back', {
			provider: account?.provider ?? null,
			userId: rowId,
		});
	}
	return ALLOW(linkedAny, true);
}

/**
 * After a sign-in the guard proved, mark the signed-in user's address verified if it is
 * still the proven one and unverified (the case where the sign-in just created the row).
 * Call from the jwt callback's first-sign-in branch. Best-effort: a failure leaves the row
 * unverified, and the next proven sign-in marks it.
 */
export async function markProvenAddressVerified(userId: unknown, account: unknown): Promise<void> {
	if (!userId || !account || typeof account !== 'object') return;
	const address = provenSignIns.get(account);
	if (!address) return;
	provenSignIns.delete(account);
	try {
		const res = await db.execute({
			sql: `UPDATE auth_users SET email_verified = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
			      WHERE id = ? AND email = ? AND (email_verified IS NULL OR email_verified = '')`,
			args: [String(userId), address],
		});
		if (Number(res.rowsAffected ?? 0) > 0) invalidateUserAuthFacts(String(userId));
	} catch (err) {
		console.warn('[authLinkGuard] could not mark the proven address verified', {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/** Test hook: clear the in-memory magic-link limiter. */
export function __resetAuthLinkGuardForTests(): void {
	magicLinkPerAddress.reset();
}
