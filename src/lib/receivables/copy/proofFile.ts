/**
 * Copy for the "Proof files for your records" block (components/receivables/ProofFiles): the
 * title, the download link, the one-line hint on how to check a file, and the name of each kind of
 * record in its row. Pure and import-free, like every module under src/lib/receivables/copy/.
 * Each string is held to the bright-line rules by tests/receivables/copy.test.ts.
 *
 * The hint names only the open-source script. The /verify-record page in the browser does not read
 * a receivables proof file yet, so no line here may send a reader there.
 *
 * {financier} is the lender's self-chosen name already shown on the claim; {day} is a YYYY-MM-DD
 * date. A statement is named by the role it was made in, not by the name it carries, so no slot
 * here takes a party's name beyond the one the copy rules already allow. Filled by
 * src/lib/receivables/fillCopy.ts.
 */

export const PROOF_FILES_TITLE = 'Proof files for your records';
export const PROOF_FILE_DOWNLOAD = 'Download proof file';
export const PROOF_FILES_HINT = 'Anyone can check a proof file with the free open-source script, without almstins.com.';
export const PROOF_FILES_HOW = 'How to check one';

/** The name of each record in its row. */
export const PROOF_FILE_ROW = {
	receivable: 'The receivable',
	settlement: 'Marked settled',
	claim: 'Claim by {financier}',
	claim_discharge: 'Claim by {financier}, released',
	status_event: {
		extended: 'Claim by {financier}, extended on {day}',
		unpaid: 'Claim by {financier}, marked unpaid on {day}',
		lapsed: 'Claim by {financier}, lapsed on {day}',
	},
	attestation: {
		buyer: 'Statement by the buyer, {day}',
		supplier: 'Statement by the supplier, {day}',
		inspector: 'Statement by an inspector, {day}',
		other: 'Statement by another party, {day}',
	},
	reverification: 'Verification on {day}',
} as const;

/** A row whose record is not on screen (it should not happen): the kind alone. */
export const PROOF_FILE_ROW_FALLBACK = {
	receivable: 'The receivable',
	settlement: 'Marked settled',
	claim: 'A claim',
	claim_discharge: 'A claim release',
	status_event: 'A claim update',
	attestation: 'A statement',
	reverification: 'A verification',
} as const;
