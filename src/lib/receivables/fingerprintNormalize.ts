/**
 * The canonical form of a receivable for the duplicate check (S3): the text a keyed hash is
 * taken of, so two records of the same debt match even when they were typed differently.
 *
 * Two keys, each built only when its fields are there:
 *   - strong ("ref"): debtor + the debtor's own reference (PO or contract number) + currency +
 *     face. The reference is the one identifier the supplier does not control;
 *   - fallback ("inv"): debtor + supplier + invoice number + currency + face.
 * Exact match only, after the normalization below. Cosmetic differences match ("ACME Ltd" and
 * "Acme Limited", "INV-0042" and "inv 42"); different amounts or currencies never do.
 *
 * Every tuple starts with the scheme, the record type, the key kind and t/r (a test record or a
 * real one), so a test record never matches a real one and record types never collide. Only the
 * invoice type is built today. Every receivables row is an invoice here, whatever its rtype: a
 * purchase order and an invoice for the same debt must still match. A warehouse receipt will be
 * its own type, with its own fields, in this same domain.
 *
 * Pure and client-safe. The plaintext tuples never leave the server: server/fingerprint.ts hashes
 * them under RECEIVABLES_FINGERPRINT_KEY, and only the hashes are stored. Any change to the
 * output of this file must bump the scheme (the kid prefix in server/fingerprint.ts), which marks
 * every stored fingerprint stale so the backfill recomputes them. Golden vectors in
 * tests/receivables/fingerprintNormalize.test.ts pin it.
 */
import { normalizeName } from '@/lib/verifyNameMatch';

export const FINGERPRINT_SCHEME = 'v1';
export const FINGERPRINT_RECORD_TYPES = ['invoice'] as const;
export type FingerprintRecordType = (typeof FINGERPRINT_RECORD_TYPES)[number];

/** The fields of an invoice-type record the fingerprint reads, as typed (the create clamps apply). */
export interface InvoiceFingerprintInput {
	recordType: 'invoice';
	supplier: string;
	/** The debtor. */
	buyer: string;
	invoiceNo: string;
	/** The debtor's own reference (details.buyerRef), when recorded. */
	buyerRef?: string | null;
	face: number;
	currency: string;
	isTest: boolean;
}

/** One branch per record type. A warehouse receipt adds its own branch here later. */
export type FingerprintInput = InvoiceFingerprintInput;

export interface FingerprintTuples {
	ref: string | null;
	inv: string | null;
}

// The create path's clamps (createReceivable in src/lib/receivablesRegistry.ts), repeated so the
// tuple of a submitted form and the tuple of the stored row are the same text.
const clamp = (s: unknown, n: number): string => String(s ?? '').trim().slice(0, n);

/** createReceivable's currency: clamped to 8, uppercased, NGN when empty. */
export function clampCurrency(currency: unknown): string {
	return clamp(currency || 'NGN', 8).toUpperCase() || 'NGN';
}

// Letters, numbers and combining marks are kept; anything else separates words.
const NOT_WORD = /[^\p{L}\p{N}\p{M}]+/gu;
const DIGIT = /\p{Nd}/u;

/** Legal-form words dropped from the end of a party name. */
const LEGAL_FORMS = new Set([
	'ltd', 'limited', 'plc', 'llc', 'llp', 'lp', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
	'gmbh', 'kg', 'ag', 'sa', 'sarl', 'sas', 'srl', 'spa', 'bv', 'nv', 'pty', 'pvt', 'pte', 'private', 'ltda', 'sdn', 'bhd',
]);

/**
 * A debtor or supplier name: NFKC, lowercase, "&" read as "and", periods dropped (so P.L.C. is
 * plc), other punctuation as spaces, a leading "the" and trailing legal-form words removed (with an
 * "and" left over from "and Co"), then the spaces removed. Never strips a name to nothing: the last
 * word stays.
 */
export function normParty(raw: unknown): string {
	// NFKC on both sides of the lowercase: a compatibility letter can fold to a capital.
	const s = normalizeName(String(raw ?? '').normalize('NFKC'))
		.normalize('NFKC')
		.replace(/&/g, ' and ')
		.replace(/\./g, '')
		.replace(NOT_WORD, ' ')
		.trim();
	const words = s ? s.split(' ') : [];
	if (words.length > 1 && words[0] === 'the') words.shift();
	let strippedForm = false;
	while (words.length > 1) {
		const last = words[words.length - 1];
		if (LEGAL_FORMS.has(last)) { words.pop(); strippedForm = true; continue; }
		if (strippedForm && last === 'and') { words.pop(); continue; }
		break;
	}
	return words.join('');
}

/** Labels a reference or invoice number may start with, longest first. */
const LABELS = ['PURCHASEORDER', 'CONTRACTNO', 'INVOICENO', 'INVOICE', 'INVNO', 'INV', 'PONO', 'PO', 'REF', 'NO'] as const;

/**
 * A reference or invoice number: NFKC, uppercase, letters and numbers only. One label is taken off
 * the front (longest first) when the typed text has a separator or a digit right after it and a
 * digit is left once it is gone, so "INVOICE 42", "INV-42" and "inv 42" are all 42, while
 * "NOV2024-7" keeps its letters. Leading zeros of a leading run of digits go ("PO-00123" is 123),
 * keeping at least one digit. Empty when nothing is left.
 */
export function normRef(raw: unknown): string {
	const text = String(raw ?? '').normalize('NFKC').toUpperCase();
	// The kept characters, and where each one sits in the typed text.
	const kept: string[] = [];
	const at: number[] = [];
	for (let i = 0; i < text.length;) {
		const ch = String.fromCodePoint(text.codePointAt(i)!);
		if (!/^[\p{L}\p{N}\p{M}]$/u.test(ch)) { i += ch.length; continue; }
		kept.push(ch);
		at.push(i);
		i += ch.length;
	}
	let out = kept.join('');
	for (const label of LABELS) {
		if (!out.startsWith(label)) continue;
		// Labels are ASCII, so their length in kept characters is their length in code units.
		const lastIdx = at[label.length - 1];
		const lastCh = String.fromCodePoint(text.codePointAt(lastIdx)!);
		const next = text.slice(lastIdx + lastCh.length, lastIdx + lastCh.length + 2);
		const nextCh = next ? String.fromCodePoint(next.codePointAt(0)!) : '';
		const boundary = nextCh !== '' && (!/^[\p{L}\p{N}\p{M}]$/u.test(nextCh) || DIGIT.test(nextCh));
		const rest = out.slice(label.length);
		if (boundary && DIGIT.test(rest)) { out = rest; break; }
	}
	return out.replace(/^0+(?=\d)/, '');
}

/** An invoice number, the same way as a reference. */
export const normInvoiceNo = normRef;

/** Face value in minor units as text: 1000 is "100000", 12.5 is "1250". */
export function faceMinor(face: unknown): string {
	return Number(face).toFixed(2).replace(/[^0-9A-Za-z]/g, '');
}

/** The plaintext tuples (never stored, logged or returned). A key is null when its fields are not all there. */
export function fingerprintTuples(input: FingerprintInput): FingerprintTuples {
	const t = input.isTest ? 't' : 'r';
	const debtor = normParty(clamp(input.buyer, 160));
	const supplier = normParty(clamp(input.supplier, 160));
	const invoiceNo = normInvoiceNo(clamp(input.invoiceNo, 80));
	const ref = normRef(clamp(input.buyerRef ?? '', 80));
	const currency = clampCurrency(input.currency).replace(NOT_WORD, '');
	const face = faceMinor(input.face);
	const head = [FINGERPRINT_SCHEME, input.recordType];
	return {
		ref: debtor && ref ? [...head, 'ref', t, debtor, ref, currency, face].join('|') : null,
		inv: debtor && supplier && invoiceNo ? [...head, 'inv', t, debtor, supplier, invoiceNo, currency, face].join('|') : null,
	};
}

/** Whether the record carries a debtor reference the strong key can compare on. */
export function hasDebtorReference(input: FingerprintInput): boolean {
	return fingerprintTuples(input).ref !== null;
}
