// ─────────────────────────────────────────────────────────────────────────────
// Google Analytics sign-up count: is this signed-in visit the one that created the account?
//
// An account becomes real at its first successful sign-in, when the Auth.js jwt callback
// creates the user's first tenant membership (src/lib/tenants.ts). The dashboard layout
// already reads that membership's created_at for the account menu, so a membership only
// minutes old means this visit is the account's first. The layout then hands the timestamp
// to <Analytics newAccount>, and AnalyticsPageContext.astro sends one bare sign_up event per
// device: a count, never who.
// ─────────────────────────────────────────────────────────────────────────────

/** How young a first membership can be and still count as this visit's sign-up. */
export const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

// The database clock and this server's clock can disagree by a few seconds.
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * Parses a stored timestamp: 'YYYY-MM-DD HH:MM:SS' in UTC (the to_char format the inserts
 * use) or full ISO 8601. Returns epoch milliseconds, or null when it can't be read.
 */
export function parseUtcTimestamp(raw: string | null | undefined): number | null {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	const iso = s.includes('T') ? s : s.replace(' ', 'T');
	const ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * The first membership's timestamp when the account is new enough to count as signing up on
 * this visit, else null. The timestamp doubles as the per-device "already counted" mark; it is
 * never sent to Google.
 */
export function newAccountKey(memberSince: string | null | undefined, now: number = Date.now()): string | null {
	const created = parseUtcTimestamp(memberSince);
	if (created === null) return null;
	const age = now - created;
	return age > -CLOCK_SKEW_MS && age < NEW_ACCOUNT_WINDOW_MS ? String(memberSince).trim() : null;
}
