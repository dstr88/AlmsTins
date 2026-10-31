/**
 * Status events — the vocabulary of a claim's one-click updates (receivables aging, A1).
 *
 * Two kinds ride the append-only receivable_status_events table: `extended` (a new promised
 * date, with a mandatory structured reason) and `unpaid` (the lender flags it; optional note).
 * "Settled" is NOT an event kind — it is the existing dischargeClaim, which already signs and
 * stamps a dated claim_discharge record.
 *
 * Import-free on purpose (the anchorSpec.ts convention): pages and copy modules read these
 * constants without pulling in the database.
 */

export const STATUS_EVENT_KINDS = ['extended', 'unpaid'] as const;
export type StatusEventKind = (typeof STATUS_EVENT_KINDS)[number];

/**
 * The structured reasons an extension must carry (locked 2026-10-31). Stored per signed, dated
 * event — never one overwritten field — so three extensions are three dated reasons in the
 * lifecycle. The reason describes the deal, never the debtor (no debtor PII).
 */
export const EXTENSION_REASON_CODES = [
	'debtor_requested',
	'partial_payment_received',
	'renegotiated_terms',
	'awaiting_delivery',
	'other',
] as const;
export type ExtensionReasonCode = (typeof EXTENSION_REASON_CODES)[number];

export function isExtensionReasonCode(x: unknown): x is ExtensionReasonCode {
	return typeof x === 'string' && (EXTENSION_REASON_CODES as readonly string[]).includes(x);
}
