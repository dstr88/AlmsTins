/**
 * The duplicate check's answer (S3): whether another record at Almstins matches this receivable's
 * fingerprint, on which key, and whether that record is recorded as financed or settled.
 *
 * Pure and client-safe. The registry finds the matching rows (findFingerprintTwins) and this turns
 * them into the answer. The answer is the same whoever asks: state, basis and the financed/settled
 * booleans never depend on the viewer. Only ownMatches does, and it lists the viewer's own records.
 * How much of it a caller sees is tiered (owner decision 9): the full answer for a verified
 * account, the state alone for any other account (stateOnly), and the state plus hasDebtorReference
 * on the public lookup (publicDuplicateCheck).
 *
 * Never in any answer: a count, another record's ID, invoice number or label, or a tenant. The
 * answer warns; the person decides. "unavailable" (no key, fingerprints not yet computed for every
 * record, or a store error) carries no financed boolean at all, so "unknown" never reads as "not
 * financed".
 */

/** Which key matched, strongest first. */
export type DuplicateBasis =
	/** Both keys: the debtor's reference and the supplier's invoice number. */
	| 'invoice_and_reference'
	/** The supplier, its invoice number, the debtor, amount and currency. */
	| 'invoice_number'
	/** The debtor, its own reference, amount and currency only: it may be another installment under one order. */
	| 'debtor_reference_only'
	/** The debtor, the supplier and the transport document number only, at any amount: the same
	 *  shipment, which often carries several genuine invoices (part deliveries, split billing, a
	 *  provisional and a final invoice). Weakest, so any other basis outranks it. */
	| 'same_shipment';

export type DuplicateState = 'unavailable' | 'no_match' | 'possible_duplicate';

export type DuplicateCheck =
	| { state: 'unavailable'; hasDebtorReference: boolean }
	| { state: 'no_match'; basis: null; encumbered: false; anySettled: false; hasDebtorReference: boolean }
	| { state: 'possible_duplicate'; basis: DuplicateBasis; encumbered: boolean; anySettled: boolean; hasDebtorReference: boolean };

/** One of the viewer's own matching records. */
export interface OwnMatch {
	id: string;
	invoiceNo: string;
	withdrawn: boolean;
}

/** A matching row, as the registry reads it. tenantId and id stay inside the registry. */
export interface TwinRow {
	id: string;
	tenantId: string;
	invoiceNo: string;
	matchedRef: boolean;
	matchedInv: boolean;
	/** The shipment key matched (fingerprint_doc). Optional so a row read without it is no match. */
	matchedDoc?: boolean;
	/** An active claim stands against it (ENCUMBRANCE_SQL). */
	encumbered: boolean;
	settled: boolean;
	withdrawn: boolean;
}

export const OWN_MATCHES_MAX = 10;

const BASIS_RANK: Record<DuplicateBasis, number> = { invoice_and_reference: 3, invoice_number: 2, debtor_reference_only: 1, same_shipment: 0 };

function basisOf(t: TwinRow): DuplicateBasis | null {
	if (t.matchedRef && t.matchedInv) return 'invoice_and_reference';
	if (t.matchedInv) return 'invoice_number';
	if (t.matchedRef) return 'debtor_reference_only';
	if (t.matchedDoc) return 'same_shipment';
	return null;
}

export function unavailableCheck(hasDebtorReference: boolean): DuplicateCheck {
	return { state: 'unavailable', hasDebtorReference };
}

/** The answer for a set of matching rows. */
export function summarizeTwins(
	rows: readonly TwinRow[],
	opts: { viewerTenantId?: string | null; hasDebtorReference: boolean },
): { check: DuplicateCheck; ownMatches: OwnMatch[] } {
	let basis: DuplicateBasis | null = null;
	// Financed and settled are read from the rows that matched on the debtor reference or the
	// invoice key, and from shipment-only rows only when nothing stronger matched: a financed record
	// that shares only the shipment must never make a stronger match read "recorded as financed".
	const strong = { encumbered: false, anySettled: false };
	const shipment = { encumbered: false, anySettled: false };
	for (const t of rows) {
		const b = basisOf(t);
		if (!b) continue;
		if (!basis || BASIS_RANK[b] > BASIS_RANK[basis]) basis = b;
		const into = b === 'same_shipment' ? shipment : strong;
		into.encumbered ||= t.encumbered;
		into.anySettled ||= t.settled;
	}
	const { encumbered, anySettled } = basis === 'same_shipment' ? shipment : strong;
	const viewer = opts.viewerTenantId ?? null;
	const ownMatches: OwnMatch[] = viewer === null ? [] : rows
		.filter((t) => basisOf(t) !== null && t.tenantId === viewer)
		.slice(0, OWN_MATCHES_MAX)
		.map((t) => ({ id: t.id, invoiceNo: t.invoiceNo, withdrawn: t.withdrawn }));
	const check: DuplicateCheck = basis
		? { state: 'possible_duplicate', basis, encumbered, anySettled, hasDebtorReference: opts.hasDebtorReference }
		: { state: 'no_match', basis: null, encumbered: false, anySettled: false, hasDebtorReference: opts.hasDebtorReference };
	return { check, ownMatches };
}

/** The state alone: what an account that is not verified sees. */
export function stateOnly(check: DuplicateCheck): { state: DuplicateState } {
	return { state: check.state };
}

/**
 * What the public check (the lookup by receivable ID, open to anyone holding it) carries: the state
 * and whether this record itself has a debtor reference (already public there, in its details).
 * Never the basis or the financed and settled booleans: those go only to a verified account (owner
 * decision 9, 2026-10-10), and a record ID is easy to come by (any account gets one back from its
 * own create), so the lookup must not answer more than an account that is not verified gets.
 */
export interface PublicDuplicateCheck {
	state: DuplicateState;
	hasDebtorReference: boolean;
}

export function publicDuplicateCheck(check: DuplicateCheck): PublicDuplicateCheck {
	return { state: check.state, hasDebtorReference: check.hasDebtorReference };
}

/** True when the check found a match that is recorded as financed: the claim-time warning. */
export function financedDuplicate(check: DuplicateCheck): boolean {
	return check.state === 'possible_duplicate' && check.encumbered;
}

/** True when the strongest match is the shipment key alone. */
export function sameShipmentOnly(check: DuplicateCheck): boolean {
	return check.state === 'possible_duplicate' && check.basis === 'same_shipment';
}

/**
 * Whether a claim raises possible_duplicate. For a verified account, a match recorded as financed,
 * and every shipment-only match, financed or not: its warning leaves out whether the other record
 * is financed (a shipment often carries several genuine invoices), so asking only when it is would
 * say it anyway. For any other account, any match: raising it only for a financed match would tell
 * that account, by the warning alone, what its tier withholds (whether the match is financed).
 */
export function claimRaisesDuplicate(check: DuplicateCheck, verifiedViewer: boolean): boolean {
	return verifiedViewer ? financedDuplicate(check) || sameShipmentOnly(check) : check.state === 'possible_duplicate';
}
