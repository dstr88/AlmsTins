/**
 * Bitcoin timestamp wording for receivables records: the anchor pill, the desk's evidence and
 * checklist rows, and what each page says after it asks for a timestamp on a record it just
 * wrote. Pure and import-free. {day} is filled with the YYYY-MM-DD block date by ../fillCopy.ts.
 */

// Anchor pill
export const ANCHOR_PILL_CONFIRMED = '⛓ Bitcoin {day}';
export const ANCHOR_PILL_PENDING_ACTION = '⏳ pending · re-check';
export const ANCHOR_PILL_NONE_ACTION = 'Anchor to Bitcoin';
/** Read-only pill states. No S1 page renders these; later read-only views do. */
export const ANCHOR_PILL_PENDING = '⏳ Bitcoin pending';
export const ANCHOR_PILL_NONE = 'Not yet anchored';

// Desk evidence row and checklist row
export const ANCHOR_TIMESTAMPED_TITLE = 'Timestamped to Bitcoin';
export const ANCHOR_PENDING_DETAIL = 'Submitted, pending a block. Once confirmed the date cannot be moved.';
export const ANCHOR_EVIDENCE_CONFIRMED_DETAIL = "Confirmed in a block on {day}. The record's date cannot be forged or backdated.";
export const ANCHOR_EVIDENCE_NONE_TITLE = 'Not yet timestamped';
export const ANCHOR_EVIDENCE_NONE_DETAIL = 'The record is signed but its date is not yet anchored publicly.';
export const ANCHOR_CHECKLIST_CONFIRMED_DETAIL = 'Confirmed in a block on {day}. The date cannot be moved.';
export const ANCHOR_CHECKLIST_NONE_LABEL = 'Timestamp pending';
export const ANCHOR_CHECKLIST_NONE_DETAIL = 'Submitted on creation. It confirms into a block within an hour or two on its own.';

// After a write
/** Shown in the status line while the timestamp request is out. */
export const ANCHOR_TIMESTAMPING = '⏳ Timestamping to Bitcoin…';
const SUBMITTED = '⏳ Timestamp submitted to Bitcoin, pending a block (~1-2h). Its date can no longer be forged or backdated.';

/** What a page says once the timestamp request answers. unreachable null: leave the line as it was. */
export interface AnchorAfterWriteCopy {
	submitted: string;
	notSubmitted: string;
	unreachable: string | null;
}

export const ANCHOR_AFTER_WRITE = {
	desk: {
		submitted: SUBMITTED,
		notSubmitted: 'Signed. The Bitcoin timestamp did not submit; you can anchor it from the workbench.',
		unreachable: null,
	},
	registry: {
		submitted: SUBMITTED,
		notSubmitted: 'Signed. The Bitcoin timestamp did not submit; you can anchor it from the status view.',
		unreachable: 'Signed. Anchor to Bitcoin from the status view when ready.',
	},
	client: {
		submitted: '⏳ Timestamp submitted to Bitcoin, pending a block (~1-2h). From now on this promise date cannot be forged or backdated.',
		notSubmitted: 'Signed and recorded. The Bitcoin timestamp did not submit; it can be anchored later.',
		unreachable: 'Signed and recorded. The Bitcoin timestamp can be added later.',
	},
} as const satisfies Record<'desk' | 'registry' | 'client', AnchorAfterWriteCopy>;
