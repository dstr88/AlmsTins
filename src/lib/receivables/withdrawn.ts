/**
 * A withdrawn receivable (S2 soft delete), as pure view logic shared by the server and the pages.
 *
 * Client-safe: copy and fillCopy only. The registry builds its 410 message here; the desk and the
 * registry page read the note and the book marks from here, so the words and the rules are
 * unit-tested in one place (tests/receivables/withdrawn.test.ts).
 */
import { fillCopy } from './fillCopy';
import {
	WITHDRAWN_LEAD, WITHDRAWN_LEAD_DATED, WITHDRAWN_RECORD_BODY, WITHDRAWN_WRITE_MESSAGE,
} from './copy/withdrawn';

/** What these helpers read from a lookup answer or a book row. */
export interface WithdrawnView {
	withdrawn?: unknown;
	withdrawnAt?: unknown;
}

/** The YYYY-MM-DD day of a stored withdrawal time, or null when it is not one. */
export function withdrawnDay(withdrawnAt: unknown): string | null {
	const day = typeof withdrawnAt === 'string' ? withdrawnAt.slice(0, 10) : '';
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Only an explicit true counts: a missing key is a live record. */
export function isWithdrawn(rcv: WithdrawnView | null | undefined): boolean {
	return rcv?.withdrawn === true;
}

/** The sentence above a withdrawn record, or null for a live one (or none). */
export function withdrawnNote(rcv: WithdrawnView | null | undefined): string | null {
	if (!isWithdrawn(rcv)) return null;
	const day = withdrawnDay(rcv!.withdrawnAt);
	const lead = day ? fillCopy(WITHDRAWN_LEAD_DATED, { day }) : WITHDRAWN_LEAD;
	return `${lead} ${WITHDRAWN_RECORD_BODY}`;
}

/** The server's message for a new write on a record withdrawn at `withdrawnAt`. */
export function withdrawnWriteMessage(withdrawnAt: string): string {
	return fillCopy(WITHDRAWN_WRITE_MESSAGE, { day: withdrawnDay(withdrawnAt) ?? String(withdrawnAt) });
}

/** The IDs of the withdrawn rows in a book (desk "Your book", registry "Your receivables"). */
export function bookWithdrawnIds(rows: ReadonlyArray<WithdrawnView & { id?: unknown }> | null | undefined): Set<string> {
	const ids = new Set<string>();
	for (const r of rows ?? []) if (isWithdrawn(r) && typeof r.id === 'string') ids.add(r.id);
	return ids;
}
