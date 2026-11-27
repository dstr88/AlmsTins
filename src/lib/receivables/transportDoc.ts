/**
 * The transport document question on the create forms: every new receivable answers it, and the
 * answer is signed into the record's details as `details.transportDoc`.
 *
 * Three answers, none picked in advance:
 *   - "number": the number of the transport document, with its type (a bill of lading or eBL, an
 *     air waybill, a CMR road consignment note, or another). Only this answer builds the
 *     duplicate check's shipment key (fingerprintNormalize.ts);
 *   - "none": no transport document (services, or goods that did not ship);
 *   - "not_known": the shipping papers were not in hand when the receivable was recorded.
 * A record recorded before the question existed carries no answer at all.
 *
 * The number never stays readable in a record. A form sends it (TransportDocInput); the create
 * replaces it with a keyed commitment before signing (StoredTransportDoc, see
 * server/transportDocCommit.ts) and keeps an encrypted copy that only the record's owner can read.
 *
 * Pure and client-safe: the forms, the create path and the view logic share it.
 */

export const TRANSPORT_DOC_TYPES = ['bill_of_lading', 'air_waybill', 'cmr', 'other'] as const;
export type TransportDocType = (typeof TRANSPORT_DOC_TYPES)[number];

export const TRANSPORT_DOC_ANSWERS = ['number', 'none', 'not_known'] as const;
export type TransportDocAnswerKind = (typeof TRANSPORT_DOC_ANSWERS)[number];

/** An answer as a form sends it. */
export type TransportDocAnswer =
	| { answer: 'number'; type: TransportDocType; number: string }
	| { answer: 'none' }
	| { answer: 'not_known' };

/** An answer as a record stores and signs it: a number answer holds a keyed commitment only. */
export type StoredTransportDoc =
	| { answer: 'number'; type: TransportDocType; commitment: { kid: string; mac: string } }
	| { answer: 'none' }
	| { answer: 'not_known' };

/** The longest number kept, after trimming. */
export const TRANSPORT_DOC_NUMBER_MAX = 60;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A submitted answer, clamped, or null when it is not a valid answer: an unknown answer, a number
 * answer with no number left after trimming, or an unknown type. Only the fields of the chosen
 * answer are kept, so "none" with a stray number is just "none".
 */
export function normalizeTransportDoc(raw: unknown): TransportDocAnswer | null {
	if (!isObject(raw)) return null;
	if (raw.answer === 'none') return { answer: 'none' };
	if (raw.answer === 'not_known') return { answer: 'not_known' };
	if (raw.answer !== 'number') return null;
	const type = raw.type;
	if (!(TRANSPORT_DOC_TYPES as readonly unknown[]).includes(type)) return null;
	const number = String(raw.number ?? '').trim().slice(0, TRANSPORT_DOC_NUMBER_MAX);
	if (!number || !/[\p{L}\p{N}]/u.test(number)) return null;
	return { answer: 'number', type: type as TransportDocType, number };
}

/** A stored answer read back from a record, or null when there is none (or it is malformed). */
export function readStoredTransportDoc(raw: unknown): StoredTransportDoc | null {
	if (!isObject(raw)) return null;
	if (raw.answer === 'none') return { answer: 'none' };
	if (raw.answer === 'not_known') return { answer: 'not_known' };
	if (raw.answer !== 'number' || !(TRANSPORT_DOC_TYPES as readonly unknown[]).includes(raw.type)) return null;
	const c = raw.commitment;
	if (!isObject(c) || typeof c.kid !== 'string' || typeof c.mac !== 'string') return null;
	return { answer: 'number', type: raw.type as TransportDocType, commitment: { kid: c.kid, mac: c.mac } };
}

/** The readable number of a submitted answer (a form or a precheck), or null. A stored record
 *  never has one: its number lives only in the owner's encrypted copy. */
export function transportDocNumberOf(details: { transportDoc?: unknown } | null | undefined): string | null {
	const a = normalizeTransportDoc(details?.transportDoc);
	return a && a.answer === 'number' ? a.number : null;
}

/** The answer kind a record or a form carries, or null when it was recorded before the question existed. */
export function transportDocAnswerOf(details: { transportDoc?: unknown } | null | undefined): TransportDocAnswerKind | null {
	return (readStoredTransportDoc(details?.transportDoc) ?? normalizeTransportDoc(details?.transportDoc))?.answer ?? null;
}
