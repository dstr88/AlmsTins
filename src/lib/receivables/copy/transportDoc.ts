/**
 * Copy for the transport document question on the desk, registry and Client Portal create forms
 * (TransportDocField), and for how a record shows its answer. Pure and import-free, like every
 * module under src/lib/receivables/copy/. Held to the bright-line rules by
 * tests/receivables/copy.test.ts.
 *
 * The answer is what the person entering the receivable said. Nothing here says Almstins checked
 * it, holds or controls the document, or has any part in who controls the goods.
 */

/** The question's legend, on all three forms. */
export const TRANSPORT_DOC_LEGEND = 'Transport document';

/** The hint under the legend. */
export const TRANSPORT_DOC_HINT = 'Required. The bill of lading, eBL, air waybill or CMR note for the goods on this invoice. With its number, the duplicate check can tell when another invoice cites the same shipment. The record keeps the number only as a keyed hash: you can see what you typed, and another lender can check a number they hold against it, with a yes or no.';

/** A create with a number when the number cannot be kept as a keyed hash right now. */
export const TRANSPORT_DOC_UNAVAILABLE = 'The transport document number cannot be recorded right now. Pick “Not known yet”, or try again later.';

/** The three answers. None is picked in advance. */
export const TRANSPORT_DOC_ANSWER_NUMBER = 'It has a number';
export const TRANSPORT_DOC_ANSWER_NONE = 'No transport document (services, or goods that did not ship)';
export const TRANSPORT_DOC_ANSWER_NOT_KNOWN = 'Not known yet (the shipping papers are not in hand)';

/** The type and number, shown when the answer is "It has a number". */
export const TRANSPORT_DOC_TYPE_LABEL = 'Type';
export const TRANSPORT_DOC_NUMBER_LABEL = 'Number';
export const TRANSPORT_DOC_NUMBER_PLACEHOLDER = 'The number printed on the invoice';

/** The types, by the value stored in details.transportDoc.type. */
export const TRANSPORT_DOC_TYPE_NAMES = {
	bill_of_lading: 'Bill of lading or eBL',
	air_waybill: 'Air waybill',
	cmr: 'CMR road consignment note',
	other: 'Other',
} as const;

/** The form's answer when the question is left unanswered or the number is empty. */
export const TRANSPORT_DOC_REQUIRED = 'Answer the transport document question: give its number, or say there is none or that it is not known yet.';

/** How a record shows the answer (label, then value). */
export const TRANSPORT_DOC_RECORD_LABEL = 'Transport document';
export const TRANSPORT_DOC_RECORD_NONE = 'None (no transport document)';
export const TRANSPORT_DOC_RECORD_NOT_KNOWN = 'Not known when recorded';
/** A number answer seen by anyone but the record's owner: the record holds a keyed hash only. */
export const TRANSPORT_DOC_RECORD_NUMBER_HIDDEN = 'number kept as a keyed hash (check one you hold below)';

/** Checking a number someone holds against a record: a yes or no, never the number. */
export const TRANSPORT_DOC_CHECK_LABEL = 'Check a transport document number you hold';
export const TRANSPORT_DOC_CHECK_BUTTON = 'Check';
export const TRANSPORT_DOC_CHECK_MATCH = 'It matches the number recorded with this receivable.';
export const TRANSPORT_DOC_CHECK_NO_MATCH = 'It does not match the number recorded with this receivable.';
export const TRANSPORT_DOC_CHECK_NO_NUMBER = 'This receivable has no transport document number to check against.';
export const TRANSPORT_DOC_CHECK_UNAVAILABLE = 'The check is not available right now.';
/** A record recorded before the question was asked. */
export const TRANSPORT_DOC_RECORD_NOT_ASKED = 'Recorded before this question was asked';

/** The Client Portal's line under the answers: the client's own statement. */
export const TRANSPORT_DOC_CLIENT_NOTE = 'Your answer is recorded with your invoice, in your name.';
