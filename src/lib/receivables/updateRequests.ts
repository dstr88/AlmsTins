/**
 * Update requests (Part A, approved 2026-11-28) — the pure half: who may ask the lender to update
 * a claim, when, how the public line counts, how the daily summary groups, and what the lender's
 * emails say. No database and no clock in here: `now` and every fact are parameters.
 *
 * Who may ask (decision A1):
 *   - anyone holding the receivable ID: only while the claim reads past_due_not_updated or
 *     lapsed. A record with no promised date never reads past due, so it is client-only until it
 *     lapses, which falls out of the aging state itself.
 *   - the client (the accepted borrower account on the record): any time the claim is open.
 *   - never on a settled or released claim, never on a withdrawn record, never by the lender.
 * The public line counts distinct UTC days a request came in, never clicks, so one person
 * cannot inflate it. The lender's daily summary is one email per lender, every claim in it.
 */
import { fillCopy } from './fillCopy';
import { formatMoney } from '@/lib/format';
import { AGING_STATE_LABELS } from './copy/aging';
import {
	NOTICE_FACTS_DATED,
	NOTICE_FACTS_UNDATED,
	NOTICE_FOOTER,
	NOTICE_LENDER_DEAL,
	NOTICE_LENDER_OPEN,
} from './copy/notices';
import {
	UR_EMAIL_ANSWER,
	UR_EMAIL_CLIENT,
	UR_EMAIL_CLIENT_NOTE,
	UR_EMAIL_SUMMARY_ITEM,
	UR_EMAIL_SUMMARY_LEAD,
	UR_REQUESTED_MANY,
	UR_REQUESTED_ONE,
	UR_SUBJECT_CLIENT,
	UR_SUBJECT_SUMMARY,
} from './copy/updateRequests';
import type { ClaimAgingState } from './aging';

export const UPDATE_REQUEST_NOTE_MAX = 280;
/** Requests older than this are no longer summarized (a stale queue never mails late news). */
export const SUMMARY_LOOKBACK_DAYS = 14;

export type RequestViewer = 'public' | 'client' | 'lender';
export type RequestSource = 'public' | 'client';

const PUBLIC_ASKABLE: ReadonlySet<string> = new Set(['past_due_not_updated', 'lapsed']);

/** Whether this viewer may ask for an update on this claim right now. */
export function canAskUpdate(
	viewer: RequestViewer,
	rcv: { settled: boolean; withdrawn?: boolean },
	claim: { status: string; aging: string },
): boolean {
	if (viewer === 'lender') return false;
	if (rcv.settled || rcv.withdrawn) return false;
	if (claim.status !== 'active' || claim.aging === 'settled') return false;
	if (viewer === 'client') return true;
	return PUBLIC_ASKABLE.has(claim.aging);
}

/** A client's optional note: trimmed, null when empty, 'too_long' past the cap. */
export function cleanRequestNote(x: unknown): string | null | 'too_long' {
	if (typeof x !== 'string') return null;
	const s = x.replace(/\s+/g, ' ').trim();
	if (!s) return null;
	return [...s].length > UPDATE_REQUEST_NOTE_MAX ? 'too_long' : s;
}

/** The UTC day of a stored timestamp ('YYYY-MM-DD HH:MM:SS' or ISO), or null. */
export function dayOf(ts: string | null | undefined): string | null {
	return typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null;
}

export interface RequestDays {
	/** Distinct UTC days with at least one request. */
	days: number;
	first: string | null;
	last: string | null;
}

/** Distinct days among request days (YMD), oldest first. */
export function requestDaysOf(days: ReadonlyArray<string | null | undefined>): RequestDays {
	const set = [...new Set(days.map((d) => dayOf(d ?? null)).filter((d): d is string => !!d))].sort();
	return { days: set.length, first: set[0] ?? null, last: set[set.length - 1] ?? null };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' as 'Nov 26' (the year too when it is not `thisYear`). */
export function shortDay(ymd: string, thisYear?: number): string {
	const [y, m, d] = ymd.split('-').map(Number);
	if (!y || !m || !d) return ymd;
	const base = `${MONTHS[m - 1]} ${d}`;
	return thisYear !== undefined && y !== thisYear ? `${base}, ${y}` : base;
}

/** The public record line ("Update requested on 4 days since Nov 26; last Nov 28."), or ''. */
export function requestedLine(r: RequestDays, thisYear?: number): string {
	if (!r.days || !r.first || !r.last) return '';
	if (r.days === 1) return fillCopy(UR_REQUESTED_ONE, { first: shortDay(r.first, thisYear) });
	return fillCopy(UR_REQUESTED_MANY, {
		days: String(r.days), first: shortDay(r.first, thisYear), last: shortDay(r.last, thisYear),
	});
}

// ── The lender's emails ─────────────────────────────────────────────────────────

/** One claim's identifier facts for the lender's email, the aging notices' block. */
export interface RequestDeal {
	receivableId: string;
	invoiceNo: string;
	face: number;
	currency: string;
	promisedDate: string | null;
	recordedDay: string;
	aging: ClaimAgingState | string;
}

function dealLine(deal: RequestDeal): string {
	const amount = formatMoney(deal.face, deal.currency);
	const facts = deal.promisedDate
		? fillCopy(NOTICE_FACTS_DATED, { amount, promised: deal.promisedDate })
		: fillCopy(NOTICE_FACTS_UNDATED, { amount });
	return fillCopy(NOTICE_LENDER_DEAL, { invoice: deal.invoiceNo, facts, recorded: deal.recordedDay.slice(0, 10) });
}
const stateOf = (aging: string): string =>
	(AGING_STATE_LABELS as Record<string, string>)[aging] ?? aging;
const deskUrl = (base: string, id: string) =>
	`${base.replace(/\/+$/, '')}/verify/desk?id=${encodeURIComponent(id)}`;

/** The email a client request sends the lender at once. The note is lender-only (A2). */
export function buildClientRequestEmail(deal: RequestDeal, note: string | null, base: string): { subject: string; text: string } {
	const parts = [fillCopy(UR_EMAIL_CLIENT, { deal: dealLine(deal), state: stateOf(deal.aging) })];
	if (note) parts.push(fillCopy(UR_EMAIL_CLIENT_NOTE, { note }));
	parts.push(fillCopy(NOTICE_LENDER_OPEN, { url: deskUrl(base, deal.receivableId) }), UR_EMAIL_ANSWER, NOTICE_FOOTER);
	return { subject: UR_SUBJECT_CLIENT, text: parts.join('\n\n') };
}

/** One claim in a lender's daily summary: its deal and the days it was asked for. */
export interface SummaryItem {
	deal: RequestDeal;
	days: readonly string[];
}

/** The lender's one summary email of anonymous requests: every claim, one email. */
export function buildRequestSummaryEmail(items: readonly SummaryItem[], base: string): { subject: string; text: string } {
	const blocks = items.map((it) => {
		const days = [...new Set(it.days)].sort();
		const line = fillCopy(UR_EMAIL_SUMMARY_ITEM, {
			deal: dealLine(it.deal),
			state: stateOf(it.deal.aging),
			count: days.length === 1 ? '1 day' : `${days.length} days`,
			days: days.join(', '),
		});
		return `${line}\n${fillCopy(NOTICE_LENDER_OPEN, { url: deskUrl(base, it.deal.receivableId) })}`;
	});
	return { subject: UR_SUBJECT_SUMMARY, text: [UR_EMAIL_SUMMARY_LEAD, ...blocks, UR_EMAIL_ANSWER, NOTICE_FOOTER].join('\n\n') };
}

/** Group pending anonymous request rows into one bucket per lender, one item per claim. */
export function groupForSummary<T extends { lenderTenantId: string; claimId: string; day: string }>(
	rows: readonly T[],
): Map<string, Map<string, T[]>> {
	const out = new Map<string, Map<string, T[]>>();
	for (const r of rows) {
		const byClaim = out.get(r.lenderTenantId) ?? new Map<string, T[]>();
		if (!out.has(r.lenderTenantId)) out.set(r.lenderTenantId, byClaim);
		const list = byClaim.get(r.claimId) ?? [];
		if (!byClaim.has(r.claimId)) byClaim.set(r.claimId, list);
		list.push(r);
	}
	return out;
}
