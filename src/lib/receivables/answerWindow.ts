/**
 * How long an answered emailed request keeps reading (receivables downloads, Part B).
 *
 * The rule, approved by Donnie on Nov 28, 2026: the person who answered can download their answer
 * and the receivable it is about until six months after the date the client is paid and expected
 * to repay. That date is the receivable's due date, or a later promised date if the financier who
 * sent the link recorded an extension. With no due date at all, the six months count from the day
 * the link stopped taking answers (its 7-day expiry).
 *
 * Worked out on every read, never stored, so an extension recorded after the answer moves it.
 * Pure: dates in, date out, all UTC.
 */

export const ANSWER_READ_MONTHS = 6;

export type AnswerWindowBasis = 'due_date' | 'extension' | 'link_expiry';

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The YYYY-MM-DD at the start of a stored date or timestamp, or null when it has none. */
export function dayOf(value: string | null | undefined): string | null {
	const m = DAY.exec(String(value ?? '').trim());
	if (!m) return null;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** `day` plus `months` calendar months, held to the last day of a shorter month (Aug 31 + 6 = Feb 28/29). */
export function addMonths(day: string, months: number): string {
	const [y, m, d] = day.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay));
	return target.toISOString().slice(0, 10);
}

/** Today's date in UTC, YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/** The last day the link reads (inclusive), and which date it counted from. */
export function answerReadWindow(input: {
	dueDate: string | null;
	latestExtension: string | null;
	linkExpiresAt: string;
}): { readUntil: string; basis: AnswerWindowBasis } {
	const due = dayOf(input.dueDate);
	const ext = dayOf(input.latestExtension);
	if (ext && (!due || ext > due)) return { readUntil: addMonths(ext, ANSWER_READ_MONTHS), basis: 'extension' };
	if (due) return { readUntil: addMonths(due, ANSWER_READ_MONTHS), basis: 'due_date' };
	const expiry = dayOf(input.linkExpiresAt) ?? todayUtc();
	return { readUntil: addMonths(expiry, ANSWER_READ_MONTHS), basis: 'link_expiry' };
}
