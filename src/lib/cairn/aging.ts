/**
 * A milestone's state on the work paper, derived one way for every surface (receivables tier T5,
 * decisions D13 and D14 of Nov 7, 2026). Pure and client-safe: no database, no clock; `now` is
 * always a parameter.
 *
 * The work paper has no clock that runs out. Nothing here ever expires, lapses or ages out: a
 * milestone whose target date passed with no update reads exactly that, "target date passed, no
 * update recorded since <date>", for as long as it is true. The gap IS the information the funder
 * needs when deciding whether to release the next tranche. Only a signature changes the state: the
 * inspector's attestation, a dispute, the funder's record that the tranche was paid, or the close
 * of the whole project (cairnRegistry.ts closeProject).
 *
 *   scheduled              the target date is ahead, or it is today
 *   due_in_grace           the target date passed within MILESTONE_GRACE_DAYS, nothing signed yet
 *   past_target_no_update  grace ran out and nothing has been signed on this milestone
 *   no_target_date         the milestone carries no date to measure against
 *   attested               the inspector attested the milestone reached
 *   disputed               the inspector disputed it
 *   paid                   the funder recorded the tranche as paid (the last signature a milestone takes)
 */

/** Calendar days after the target date during which a milestone reads as a normal slip. */
export const MILESTONE_GRACE_DAYS = 10;

export type MilestoneAgingState =
	| 'scheduled'
	| 'due_in_grace'
	| 'past_target_no_update'
	| 'no_target_date'
	| 'attested'
	| 'disputed'
	| 'paid';

export interface MilestoneAgingFacts {
	/** YYYY-MM-DD, or null when the schedule set none. */
	targetDate: string | null;
	/** The milestone row's status: pending, claimed, attested or disputed. */
	status: string;
	/** When the funder recorded the tranche paid; null until then. */
	paidAt: string | null;
}

export type CloseKind = 'completed' | 'terminated' | 'abandoned';
export const CLOSE_KINDS: readonly CloseKind[] = ['completed', 'terminated', 'abandoned'];
export function isCloseKind(x: unknown): x is CloseKind {
	return typeof x === 'string' && (CLOSE_KINDS as readonly string[]).includes(x);
}

const DAY_MS = 86_400_000;

function ymdToUtcMs(s: string | null | undefined): number | null {
	if (typeof s !== 'string') return null;
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isFinite(ms) ? ms : null;
}

/** Whole UTC calendar days since the target date (negative while it is ahead), or null without one. */
export function daysPastTarget(targetDate: string | null, now: Date): number | null {
	const ms = ymdToUtcMs(targetDate);
	if (ms === null) return null;
	return Math.floor(now.getTime() / DAY_MS) - Math.floor(ms / DAY_MS);
}

export function milestoneAgingOf(f: MilestoneAgingFacts, now: Date): MilestoneAgingState {
	if (f.paidAt) return 'paid';
	if (f.status === 'attested') return 'attested';
	if (f.status === 'disputed') return 'disputed';
	const days = daysPastTarget(f.targetDate, now);
	if (days === null) return 'no_target_date';
	if (days <= 0) return 'scheduled';
	if (days <= MILESTONE_GRACE_DAYS) return 'due_in_grace';
	return 'past_target_no_update';
}

/** What a screen says for each state. Verbs only: recorded, attested, disputed, paid. No judgment words. */
export const MILESTONE_STATE_LABEL: Readonly<Record<MilestoneAgingState, string>> = {
	scheduled: 'scheduled',
	due_in_grace: 'target date passed, within grace',
	past_target_no_update: 'target date passed, no update recorded',
	no_target_date: 'no target date on the schedule',
	attested: 'attested reached',
	disputed: 'disputed',
	paid: 'tranche recorded paid',
};

/**
 * The one line under a milestone whose target passed: how long it has read that way, dated. The
 * date given is the last signature on the milestone, or the target date itself when nothing has
 * been signed since the schedule was sealed. Null for every other state (the pill says it).
 */
export function milestoneAgingLine(state: MilestoneAgingState, f: { targetDate: string | null; lastSignedAt: string | null }): string | null {
	if (state !== 'past_target_no_update' && state !== 'due_in_grace') return null;
	const since = (f.lastSignedAt ?? f.targetDate ?? '').slice(0, 10);
	return since ? `Target date passed; no update recorded since ${since}.` : 'Target date passed; no update recorded.';
}
