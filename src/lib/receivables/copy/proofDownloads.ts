/**
 * Copy for record downloads: the "Your signed records" list on the desk and the client page.
 * Pure and import-free, like the other copy modules. Each line names one record the viewer's own
 * account holds; nothing here describes another firm's rows.
 */

export const PROOF_LIST_TITLE = 'Your signed records';
export const PROOF_LIST_LEDE =
	'Each file holds one record, its Almstins signature and its Bitcoin timestamp. Anyone can check it at almstins.com/verify-record, or offline without Almstins.';
export const PROOF_LIST_EMPTY = 'Your account holds no signed records on this receivable yet.';
export const PROOF_DOWNLOAD = 'Download';

export const PROOF_LABEL = {
	receivable: 'The receivable, as recorded',
	settlement: 'Settlement',
	claim: 'Claim: {financier}, {amount}',
	claim_discharge: 'Claim released: {financier}',
	answer: 'Answer from {party} ({label})',
	dispute: 'Dispute from {party} ({label})',
	status_event: 'Status update: {event}',
	reverification: 'Verify now check: {verdict}',
	email_statement: 'Email statement: {financier}, {amount}, as of {date}',
} as const;

/** Who gave an answer, by the role it was filed under. */
export const PROOF_PARTY: Record<string, string> = {
	buyer: 'the debtor',
	supplier: 'the client',
	borrower: 'the client',
	inspector: 'the inspector',
	other: 'another party',
};

export const PROOF_STATUS_EVENT: Record<string, string> = {
	extended: 'due date extended',
	unpaid: 'marked unpaid',
	lapsed: 'promised date passed',
};
