/**
 * Email statement (approved 2026-11-28): the pure half. What the statement of the emails about one
 * claim says, from rows the server half (server/emailStatementStore.ts) read out of the email logs.
 * No database and no clock: `now` is a parameter, as in notices.ts.
 *
 * Four groups, each "label, count, dates" (Donnie's format):
 *   Scheduled           the aging notices (day 9, 15, 20, the lapse warning, the lapse), each
 *                       recipient's email counted (receivable_notice_log).
 *   Interested parties  the lender's daily summaries of anonymous update requests that covered
 *                       this claim; a summary counts once however many requests it rolled up.
 *   Client              the client's update requests, each emailed to the lender at once.
 *   Lender acted        the emails to the client when the lender released, extended, marked
 *                       unpaid or the receivable was settled.
 *
 * The next-scheduled line (E1) is a forecast from the same schedule the notices job runs
 * (dueNotices), and it is never counted.
 */
import { agingStateOf } from './aging';
import { dueNotices, type NoticeKind } from './notices';
import { fillCopy } from './fillCopy';
import { formatFileDate } from '@/lib/format';
import {
	ES_AND,
	ES_EMAIL_LINE,
	ES_GROUP,
	ES_HEAD,
	ES_HISTORY,
	ES_LINE,
	ES_LINE_NONE,
	ES_NEXT,
	ES_SAME_DAY,
	ES_TEMPLATE,
	ES_TEMPLATE_FILES,
	ES_TEMPLATE_NOT_RECORDED,
	ES_TO,
	ES_TYPE,
} from './copy/emailStatement';

export const EMAIL_GROUPS = ['scheduled', 'interested', 'client', 'lender_acted'] as const;
export type EmailGroup = (typeof EMAIL_GROUPS)[number];

/** One email Almstins sent about the claim: its day, type, recipient role and template version. */
export interface EmailEntry {
	/** YYYY-MM-DD (UTC) the email was sent. */
	day: string;
	/** The log's own key: a notice kind, 'summary', 'client_request' or a client action kind. */
	type: string;
	to: 'lender' | 'client';
	/** The template version written on send, or null for a row sent before versions were kept. */
	template: string | null;
}

export type EmailGroups = Record<EmailGroup, EmailEntry[]>;

/** The forecast: the next notice the schedule would send, and on which day. */
export interface NextScheduled {
	type: NoticeKind;
	day: string;
}

/** The schedule's view of the claim (the registry's public status supplies it). */
export interface ForecastFacts {
	/** Whether the schedule still runs for this claim: an active claim on a live, real record. */
	open: boolean;
	promisedDate: string | null;
	lastOwnerTouchAt: string | null;
	/** Notice kinds already in the notice log for this claim (to the lender). */
	sent: ReadonlySet<string>;
}

const DAY_MS = 86_400_000;
/** How far ahead the forecast looks: past the lapse (180 days of silence) with room to spare. */
const FORECAST_HORIZON_DAYS = 400;

/**
 * The next notice the daily job would send if nothing changes: day by day from `now`, the same
 * aging and dueNotices the job runs, assuming no owner update, skipping notices already logged.
 * Null when the claim is closed or nothing more is scheduled. The plan-lock email is account
 * mail, never forecast here.
 */
export function forecastNext(facts: ForecastFacts, now: Date): NextScheduled | null {
	if (!facts.open) return null;
	for (let k = 0; k <= FORECAST_HORIZON_DAYS; k++) {
		const at = new Date(now.getTime() + k * DAY_MS);
		const aging = agingStateOf(facts.promisedDate, [], 'active', facts.lastOwnerTouchAt, at);
		const due = dueNotices({ aging, promisedDate: facts.promisedDate, lastOwnerTouchAt: facts.lastOwnerTouchAt }, at);
		const next = due.find((n) => !facts.sent.has(n));
		if (next) return { type: next, day: at.toISOString().slice(0, 10) };
		if (aging === 'lapsed') return null; // the lapse is the schedule's last word
	}
	return null;
}

/** `Oct 5`, or `Oct 5, 2025` when the year is not the statement's own. */
export function dayText(day: string, asOfYear: string): string {
	const full = formatFileDate(day, { style: 'medium' });
	return day.slice(0, 4) === asOfYear ? full.replace(`, ${asOfYear}`, '') : full;
}

/** `a`, `a and b`, `a, b and c`. */
function joinList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')}${ES_AND}${items[items.length - 1]}`;
}

/** One group's line: `Interested parties: 5, on Oct 4, Oct 8, Oct 15 and Nov 3 (2).` */
export function groupLine(group: EmailGroup, entries: readonly EmailEntry[], asOfYear: string): string {
	const label = ES_GROUP[group];
	if (!entries.length) return fillCopy(ES_LINE_NONE, { label });
	const byDay = new Map<string, number>();
	for (const e of [...entries].sort((a, b) => a.day.localeCompare(b.day))) byDay.set(e.day, (byDay.get(e.day) ?? 0) + 1);
	const dates = [...byDay].map(([d, n]) => {
		const t = dayText(d, asOfYear);
		return n > 1 ? fillCopy(ES_SAME_DAY, { date: t, count: String(n) }) : t;
	});
	return fillCopy(ES_LINE, { label, count: String(entries.length), dates: joinList(dates) });
}

/** The as-of line: `Emails about this claim, as of November 28, 2026`. */
export function headLine(asOf: string): string {
	return fillCopy(ES_HEAD, { date: formatFileDate(asOf, { style: 'long' }) });
}

export function nextLine(next: NextScheduled | null, asOfYear: string): string | null {
	if (!next) return null;
	return fillCopy(ES_NEXT, { notice: ES_TYPE[next.type] ?? next.type, date: dayText(next.day, asOfYear) });
}

/** Where each log's history starts, as one line. */
export function historyLine(since: Record<EmailGroup, string>): string {
	const v = (g: EmailGroup) => formatFileDate(since[g], { style: 'medium' });
	return fillCopy(ES_HISTORY, { scheduled: v('scheduled'), interested: v('interested'), client: v('client'), lender_acted: v('lender_acted') });
}

/** One email in the list under the summary: `Oct 5: day-15 notice, to the client. Template notices/1.` */
export function emailLine(e: EmailEntry, asOfYear: string): string {
	return fillCopy(ES_EMAIL_LINE, {
		date: dayText(e.day, asOfYear),
		type: ES_TYPE[e.type] ?? e.type,
		to: ES_TO[e.to] ?? e.to,
		template: e.template ? fillCopy(ES_TEMPLATE, { version: e.template }) : ES_TEMPLATE_NOT_RECORDED,
	});
}

/** The source file of a template version (`notices/1` → its copy file), or null when unknown. */
export function templateFile(version: string): string | null {
	return ES_TEMPLATE_FILES[version.split('/')[0]] ?? null;
}

/** Everything the statement shows, in order. The manifest carries these same lines. */
export interface StatementView {
	head: string;
	lines: string[];
	next: string | null;
	history: string;
	emails: string[];
}

export function statementView(
	asOf: string,
	groups: EmailGroups,
	next: NextScheduled | null,
	since: Record<EmailGroup, string>,
): StatementView {
	const year = asOf.slice(0, 4);
	const all = EMAIL_GROUPS.flatMap((g) => groups[g]).sort((a, b) => a.day.localeCompare(b.day));
	return {
		head: headLine(asOf),
		lines: EMAIL_GROUPS.map((g) => groupLine(g, groups[g], year)),
		next: nextLine(next, year),
		history: historyLine(since),
		emails: all.map((e) => emailLine(e, year)),
	};
}

/** Reads a statement view back from JSON (the route's answer), field by field. */
export function readStatementView(x: unknown): StatementView | null {
	if (!x || typeof x !== 'object') return null;
	const o = x as Record<string, unknown>;
	const strs = (v: unknown) => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null);
	const lines = strs(o.lines);
	const emails = strs(o.emails);
	if (typeof o.head !== 'string' || !lines || !emails || typeof o.history !== 'string') return null;
	return { head: o.head, lines, next: typeof o.next === 'string' ? o.next : null, history: o.history, emails };
}
