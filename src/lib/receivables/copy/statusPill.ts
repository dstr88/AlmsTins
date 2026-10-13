/**
 * Labels for the receivables status pill (StatusPill/statusPill.ts). Pure and import-free, like
 * every module under src/lib/receivables/copy/. Each string is held to the bright-line rules by
 * tests/receivables/copy.test.ts. Exported as separate strings so the copy test sees each one.
 */

// Record pill: the one-glance financing state of a receivable (ragState in ../status.ts).
export const PILL_TEST = 'TEST RECORD — not a real receivable';
export const PILL_DISPUTED = '⚠ Disputed';
export const PILL_SETTLED = 'Settled / paid';
export const PILL_PARTIAL = 'Partially encumbered';
export const PILL_FULL = 'Fully encumbered';
export const PILL_OPEN = 'Available to finance';

// Tag pill: a short marker beside a row in a list.
export const TAG_TEST = 'test';
export const TAG_CLAIMED_ONLY = 'claimed only';
export const TAG_CLAIMED_ONLY_TITLE = 'You hold a claim against this receivable, but did not create it -- settle, invite and document actions belong to whoever did';
