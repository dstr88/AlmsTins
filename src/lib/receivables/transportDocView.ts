/**
 * How a record shows its transport document answer: a label and a value for the record's facts.
 * Pure and client-safe. A record holds a number only as a keyed hash, so the number itself shows
 * only when the lookup sent the owner's own copy (`ownNumber`); anyone else reads that a number is
 * kept as a keyed hash, with the type.
 */
import {
	TRANSPORT_DOC_RECORD_LABEL, TRANSPORT_DOC_RECORD_NONE, TRANSPORT_DOC_RECORD_NOT_ASKED, TRANSPORT_DOC_RECORD_NOT_KNOWN,
	TRANSPORT_DOC_RECORD_NUMBER_HIDDEN, TRANSPORT_DOC_TYPE_NAMES,
} from './copy/transportDoc';
import { TRANSPORT_DOC_TYPES, type TransportDocType } from './transportDoc';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function transportDocFact(details: unknown, ownNumber?: unknown): { label: string; value: string } {
	const raw = isObject(details) ? details.transportDoc : undefined;
	const label = TRANSPORT_DOC_RECORD_LABEL;
	if (!isObject(raw)) return { label, value: TRANSPORT_DOC_RECORD_NOT_ASKED };
	if (raw.answer === 'none') return { label, value: TRANSPORT_DOC_RECORD_NONE };
	if (raw.answer === 'not_known') return { label, value: TRANSPORT_DOC_RECORD_NOT_KNOWN };
	if (raw.answer !== 'number') return { label, value: TRANSPORT_DOC_RECORD_NOT_ASKED };
	const type = (TRANSPORT_DOC_TYPES as readonly unknown[]).includes(raw.type) ? TRANSPORT_DOC_TYPE_NAMES[raw.type as TransportDocType] : TRANSPORT_DOC_TYPE_NAMES.other;
	if (typeof ownNumber === 'string' && ownNumber) return { label, value: `${type}: ${ownNumber}` };
	return { label, value: `${type}: ${TRANSPORT_DOC_RECORD_NUMBER_HIDDEN}` };
}

/** Whether a record's answer is a number, so a number someone holds can be checked against it. */
export function hasCheckableTransportDoc(details: unknown): boolean {
	const raw = isObject(details) ? details.transportDoc : undefined;
	return isObject(raw) && raw.answer === 'number';
}
