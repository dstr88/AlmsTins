/**
 * A claim's aging state, derived one way for every surface (the receivables-aging plan, locked
 * 2026-10-31). A financing record walks off its promised payment date: nothing is ever stopped
 * or hidden — staleness is made visible, dated, and the relying party revalidates.
 *
 *   active               now is on or before the promised date
 *   due_in_grace         the promised date passed, within GRACE_DAYS calendar days (a normal slip)
 *   past_due_not_updated grace expired and the financier has not updated the record
 *   no_promised_date     the record carries no date to age against (D2); still lapses (D7)
 *   lapsed               no owner-initiated dated event for LAPSE_AFTER_DAYS (D7): the record was
 *                        not maintained, so it stops counting toward headroom and the
 *                        duplicate-financing answer — the history stays visible, marked
 *   settled              the claim was discharged (or its receivable settled): nothing to age
 *
 * Pure and client-safe, like status.ts: no database, no clock — `now` is always a parameter, so
 * no caller or test ever touches the system time. The date states run on UTC calendar days; the
 * lapse backstop runs on elapsed time against the last owner touch, which the caller computes
 * (claim registration, affirmation, a status event, the claim owner's own re-verification — a
 * checker's lookup is NOT a touch).
 *
 * Fail direction: an unparseable or missing lastOwnerTouch never lapses the claim. Lapse is the
 * one state that releases headroom, so a bug in touch plumbing must keep the encumbrance, not
 * silently free it.
 */

/** Calendar days after the promised date during which the record reads as a normal slip. */
export const GRACE_DAYS = 10;

/** Days of owner silence after which a claim's record goes terminal-stale (D7). Donnie's knob:
 *  longest common tenor (90d) + grace + a quarter of silence; keep within ~120..365. */
export const LAPSE_AFTER_DAYS = 180;

export type ClaimAgingState =
	| 'active'
	| 'due_in_grace'
	| 'past_due_not_updated'
	| 'no_promised_date'
	| 'lapsed'
	| 'settled';

/** An extension event's date change, in chain order (oldest first). */
export interface AgingExtension {
	newPromisedDate: string | null;
}

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD date at UTC midnight, or null when the string is not one. */
function ymdToUtcMs(s: string | null | undefined): number | null {
	if (typeof s !== 'string') return null;
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isFinite(ms) ? ms : null;
}

/** A stored timestamp ('YYYY-MM-DD HH:MM:SS' UTC, the registry's format; ISO and bare YMD are
 *  tolerated) as epoch ms, or null when unparseable. */
function timestampToUtcMs(s: string | null | undefined): number | null {
	if (typeof s !== 'string' || !s.trim()) return null;
	const t = s.trim();
	const ms = t.includes('T') || /[zZ]$|[+-]\d{2}:\d{2}$/.test(t)
		? Date.parse(t)
		: t.includes(' ')
			? Date.parse(t.replace(' ', 'T') + 'Z')
			: ymdToUtcMs(t) ?? NaN;
	return Number.isFinite(ms) ? ms : null;
}

/**
 * The date a claim currently promises payment by: the LAST extension that carries a valid date
 * wins; without one, the receivable's own due date; null when neither exists. The original
 * due_date is never rewritten (it is inside the signed manifest and the record's ID) — extensions
 * layer on top, so the record shows the original promise AND the dated chain that moved it.
 */
export function effectivePromisedDate(
	dueDate: string | null | undefined,
	extensions: ReadonlyArray<AgingExtension>,
): string | null {
	for (let i = extensions.length - 1; i >= 0; i--) {
		const d = extensions[i]?.newPromisedDate;
		if (ymdToUtcMs(d) !== null) return d as string;
	}
	return ymdToUtcMs(dueDate) !== null ? (dueDate as string) : null;
}

/**
 * Whole UTC calendar months between a stored timestamp and `now`, for the actor-voiced freshness
 * story a relying party reads (A3): "this claim has not been updated by its lender in 4 months".
 * 0 while under a month; null when the timestamp is missing or unparseable (the caller then shows
 * the dated wording or nothing — it never invents a duration). Never negative: a future touch
 * reads 0, the same fail direction as the lapse check above.
 */
export function wholeMonthsSince(ts: string | null | undefined, now: Date): number | null {
	const ms = timestampToUtcMs(ts);
	if (ms === null) return null;
	const then = new Date(ms);
	let months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + (now.getUTCMonth() - then.getUTCMonth());
	if (now.getUTCDate() < then.getUTCDate()) months--;
	return Math.max(0, months);
}

/**
 * The aging state of one claim. `claimStatus` is the claim row's status ('active' | 'discharged');
 * anything but 'active' reads settled and short-circuits. `lastOwnerTouch` is the latest
 * owner-initiated dated event the caller found; `now` is the moment the question is asked.
 */
export function agingStateOf(
	dueDate: string | null,
	extensions: ReadonlyArray<AgingExtension>,
	claimStatus: string,
	lastOwnerTouch: string | null,
	now: Date,
): ClaimAgingState {
	if (claimStatus !== 'active') return 'settled';

	const touchMs = timestampToUtcMs(lastOwnerTouch);
	if (touchMs !== null && now.getTime() - touchMs >= LAPSE_AFTER_DAYS * DAY_MS) return 'lapsed';

	const promisedMs = ymdToUtcMs(effectivePromisedDate(dueDate, extensions));
	if (promisedMs === null) return 'no_promised_date';

	// Calendar days, not elapsed hours: on the promised date the record is active all day,
	// whatever the time of day the question is asked.
	const daysPast = Math.floor(now.getTime() / DAY_MS) - Math.floor(promisedMs / DAY_MS);
	if (daysPast <= 0) return 'active';
	if (daysPast <= GRACE_DAYS) return 'due_in_grace';
	return 'past_due_not_updated';
}
