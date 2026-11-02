/**
 * Aging notices (A4 / D8) — the pure half: which notice emails a claim is due, and what each
 * one says. No database and no clock in here — `now` is always a parameter, exactly like
 * aging.ts, so the daily cron, the tests and any later surface compute the same answer.
 *
 * The schedule (locked 2026-10-31). The clock is days after the promised payment date, per
 * claim; an extension restarts it at the new date with a fresh grace window, because the
 * effective promised date itself moves:
 *
 *   day 9      LENDER only — grace ends tomorrow; settled / extended / unpaid, one click.
 *              Lender-only on purpose: the record still publicly reads "due, in grace", and an
 *              email never says more than the record shows.
 *   day 15     BOTH — lender: the record reads past due, not updated; client: the actor-voiced
 *              freshness line, with a link to check the record.
 *   day 20     BOTH — final; says it is the last reminder.
 *   lapse−14d  LENDER only — measured on the OTHER clock, owner silence (lastOwnerTouch): the
 *              claim lapses on <date> and is then no longer counted.
 *   at lapse   BOTH — lapsed, record not maintained; one dated update counts it again.
 *
 * Any owner update stops the promised-date sequence: a touch after the promised day means the
 * financier has spoken since the promise passed (a discharge or settlement ends it through the
 * aging state itself, and an extension moves the promised date, which is the restart). The
 * lapse pair runs on owner silence alone, so an unpaid flag yesterday silences day-15 nagging
 * while a half-year of silence still draws the lapse warning.
 *
 * Catch-up never backfills: per clock, only the LATEST due notice is returned, so a claim
 * first seen at day 23 gets one day-20 email, not three. Idempotency (one email per claim per
 * notice per recipient, ever) is the notice log's job, not this module's.
 */
import {
	GRACE_DAYS,
	LAPSE_AFTER_DAYS,
	timestampToUtcMs,
	ymdToUtcMs,
	type ClaimAgingState,
} from './aging';
import { fillCopy } from './fillCopy';
import { formatMoney } from '@/lib/format';
import {
	NOTICE_CLIENT_CHECK,
	NOTICE_CLIENT_DAY15,
	NOTICE_CLIENT_DAY20,
	NOTICE_CLIENT_LAPSED,
	NOTICE_FACTS_DATED,
	NOTICE_FACTS_UNDATED,
	NOTICE_FOOTER,
	NOTICE_LENDER_DAY9,
	NOTICE_LENDER_DAY15,
	NOTICE_LENDER_DAY20,
	NOTICE_LENDER_DEAL,
	NOTICE_LENDER_LAPSE_WARN,
	NOTICE_LENDER_LAPSED,
	NOTICE_LENDER_OPEN,
	NOTICE_OPTOUT_LINE,
	NOTICE_SUBJECT_CLIENT,
	NOTICE_SUBJECT_LENDER,
} from './copy/notices';

/** The promised-date clock's notice days (Donnie's 9 / 15 / 20, locked 2026-10-31). */
export const DAY9_AFTER_PROMISE = 9;
export const DAY15_AFTER_PROMISE = 15;
export const DAY20_AFTER_PROMISE = 20;
/** The lapse warning leads the lapse itself by this many days of owner silence (~day 166). */
export const LAPSE_WARN_LEAD_DAYS = 14;

export type NoticeKind = 'day9' | 'day15' | 'day20' | 'lapse_warn' | 'lapsed';
export type NoticeRole = 'lender' | 'client';

/** Who each notice reaches. Day 9 and the lapse warning are lender-only (see the header). */
export const NOTICE_RECIPIENTS: Readonly<Record<NoticeKind, readonly NoticeRole[]>> = {
	day9: ['lender'],
	day15: ['lender', 'client'],
	day20: ['lender', 'client'],
	lapse_warn: ['lender'],
	lapsed: ['lender', 'client'],
};

/** What the schedule reads about one claim — the registry's aging loader supplies all three. */
export interface NoticeClaimFacts {
	aging: ClaimAgingState;
	/** The effective promised date (the last extension wins), or null for an undated record. */
	promisedDate: string | null;
	lastOwnerTouchAt: string | null;
}

const DAY_MS = 86_400_000;

/** Whole UTC calendar days since the promised date (negative while it is still ahead), or null
 *  without one. The same floor-per-day math as agingStateOf, so day boundaries never disagree. */
export function daysPastPromised(promisedDate: string | null, now: Date): number | null {
	const ms = ymdToUtcMs(promisedDate);
	if (ms === null) return null;
	return Math.floor(now.getTime() / DAY_MS) - Math.floor(ms / DAY_MS);
}

/** The day a claim lapses on its current silence (lastOwnerTouch + LAPSE_AFTER_DAYS), YMD, or
 *  null when the touch is missing or unparseable (such a claim never lapses — aging.ts's fail
 *  direction — so there is no date to warn about either). */
export function lapseDayOf(lastOwnerTouchAt: string | null): string | null {
	const ms = timestampToUtcMs(lastOwnerTouchAt);
	if (ms === null) return null;
	return new Date(ms + LAPSE_AFTER_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The notices a claim is due right now: at most one from the promised-date clock and one
 * from the lapse clock. The caller drops those already in the notice log.
 */
export function dueNotices(facts: NoticeClaimFacts, now: Date): NoticeKind[] {
	if (facts.aging === 'settled') return [];
	if (facts.aging === 'lapsed') return ['lapsed'];

	const out: NoticeKind[] = [];
	const days = daysPastPromised(facts.promisedDate, now);
	const touchMs = timestampToUtcMs(facts.lastOwnerTouchAt);
	const promisedMs = ymdToUtcMs(facts.promisedDate);
	// A touch after the promised calendar day = the financier has spoken since the promise
	// passed, so the promised-date sequence is stopped. (An extension moves promisedMs itself
	// forward past the touch, which is exactly the restart.)
	const spokenSincePromise = touchMs !== null && promisedMs !== null && touchMs >= promisedMs + DAY_MS;

	if (days !== null && !spokenSincePromise) {
		if (facts.aging === 'past_due_not_updated') {
			if (days >= DAY20_AFTER_PROMISE) out.push('day20');
			else if (days >= DAY15_AFTER_PROMISE) out.push('day15');
			// Days 11–14: past due, but between notices — nothing is due yet.
		} else if (facts.aging === 'due_in_grace' && days >= DAY9_AFTER_PROMISE && days <= GRACE_DAYS) {
			out.push('day9');
		}
	}

	// The lapse clock runs on owner silence alone. At LAPSE_AFTER_DAYS the state above is
	// already 'lapsed', so this branch only ever adds the warning.
	if (touchMs !== null && now.getTime() - touchMs >= (LAPSE_AFTER_DAYS - LAPSE_WARN_LEAD_DAYS) * DAY_MS) {
		out.push('lapse_warn');
	}
	return out;
}

// ── Building the emails ─────────────────────────────────────────────────────────

/** One claim's deal-identifier facts, already resolved by the registry. No party name is in
 *  here by design: the templates have no slot for one (D8's misdelivery rule). */
export interface NoticeDeal {
	receivableId: string;
	invoiceNo: string;
	/** The receivable's face value — the figure the client knows the invoice by. */
	face: number;
	currency: string;
	promisedDate: string | null;
	/** The day the claim was recorded (claim row created_at), YMD. */
	recordedDay: string;
	lastOwnerTouchAt: string | null;
}

const day = (ts: string | null): string => (ts ? ts.slice(0, 10) : '');

/** The parenthetical facts block: amount + currency, and the promised date when one exists. */
function factsOf(deal: NoticeDeal): string {
	const amount = formatMoney(deal.face, deal.currency);
	return deal.promisedDate
		? fillCopy(NOTICE_FACTS_DATED, { amount, promised: deal.promisedDate })
		: fillCopy(NOTICE_FACTS_UNDATED, { amount });
}

/**
 * One deal's paragraph in a notice email: the notice line (identifier block embedded),
 * then the role's link — the lender's goes to his desk with the record open, the client's to
 * the public check page. Returns null for a (notice, role) pair the schedule never sends,
 * so a caller cannot accidentally mail day 9 to a client.
 */
export function noticeBlock(
	notice: NoticeKind,
	role: NoticeRole,
	deal: NoticeDeal,
	base: string,
	now: Date,
): string | null {
	if (!NOTICE_RECIPIENTS[notice].includes(role)) return null;
	const facts = factsOf(deal);
	const origin = base.replace(/\/+$/, '');
	if (role === 'lender') {
		const vars = {
			deal: fillCopy(NOTICE_LENDER_DEAL, { invoice: deal.invoiceNo, facts, recorded: deal.recordedDay }),
			touched: day(deal.lastOwnerTouchAt),
			lapse: lapseDayOf(deal.lastOwnerTouchAt) ?? '',
		};
		const line =
			notice === 'day9' ? fillCopy(NOTICE_LENDER_DAY9, vars)
			: notice === 'day15' ? fillCopy(NOTICE_LENDER_DAY15, vars)
			: notice === 'day20' ? fillCopy(NOTICE_LENDER_DAY20, vars)
			: notice === 'lapse_warn' ? fillCopy(NOTICE_LENDER_LAPSE_WARN, vars)
			: fillCopy(NOTICE_LENDER_LAPSED, vars);
		const url = `${origin}/verify/desk?id=${encodeURIComponent(deal.receivableId)}`;
		return `${line}\n${fillCopy(NOTICE_LENDER_OPEN, { url })}`;
	}
	const days = daysPastPromised(deal.promisedDate, now);
	const vars = {
		recorded: deal.recordedDay,
		invoice: deal.invoiceNo,
		facts,
		days: String(days ?? ''),
	};
	const line =
		notice === 'day15' ? fillCopy(NOTICE_CLIENT_DAY15, vars)
		: notice === 'day20' ? fillCopy(NOTICE_CLIENT_DAY20, vars)
		: fillCopy(NOTICE_CLIENT_LAPSED, vars);
	const url = `${origin}/verify/registry?id=${encodeURIComponent(deal.receivableId)}`;
	return `${line}\n${fillCopy(NOTICE_CLIENT_CHECK, { url })}`;
}

/**
 * One recipient's email for the day (the digest rule): every qualifying deal becomes one block
 * in ONE email, so a neglectful lender's client is informed, not flooded. The subject stays
 * generic whatever is inside. Client emails end on the opt-out link that backs the suppression
 * flag; lender emails are account mail and end on the boundary line alone.
 */
export function buildNoticeEmail(
	role: NoticeRole,
	blocks: readonly string[],
	opts: { optoutUrl?: string } = {},
): { subject: string; text: string } {
	const subject = role === 'lender' ? NOTICE_SUBJECT_LENDER : NOTICE_SUBJECT_CLIENT;
	const parts = [...blocks, NOTICE_FOOTER];
	if (role === 'client' && opts.optoutUrl) parts.push(fillCopy(NOTICE_OPTOUT_LINE, { url: opts.optoutUrl }));
	return { subject, text: parts.join('\n\n') };
}
