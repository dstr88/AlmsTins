/**
 * "Seen before?" (S5): whether an invoice is already on record at Almstins, asked before anyone
 * advances against it, by someone who holds no receivable ID. The body is read here
 * (parseSeenBeforeBody) and the answer is built here (summarizeMatches); the store
 * (server/seenBeforeStore.ts) finds the matching records in between.
 *
 * Pure and client-safe: no database, no server module, no key. The keyed hash is taken in the
 * store, never here.
 *
 * The match is on the invoice key only (the debtor, the supplier, the invoice number, the amount
 * and the currency, test with test and real with real), across every account. A match on the
 * debtor's reference alone is not a match here: it may be another installment under one order, and
 * this check answers about one invoice. When a reference is sent and the invoice key matched, the
 * answer also says whether the reference matched too (refMatch).
 *
 * How much of the answer a caller sees is tiered: a verified account gets the full answer
 * (FULL_ANSWER_KEYS), any other signed-in account whether anything was found (foundOnly). Never in
 * any answer: another record's ID, its account, its invoice number, its amount, its fingerprint or
 * an exact count (NEVER_RETURNED). "matches" stops at five. The answer warns; the person decides.
 */
import { clampCurrency, fingerprintTuples, type InvoiceFingerprintInput } from './fingerprintNormalize';
import { financingStatusOf, type FinancingStatus } from './status';
import {
	SEEN_BEFORE_INVALID_BODY,
	SEEN_BEFORE_INVALID_BUYER_REF,
	SEEN_BEFORE_INVALID_CURRENCY,
	SEEN_BEFORE_INVALID_FACE,
	SEEN_BEFORE_INVALID_NAMES,
	SEEN_BEFORE_INVALID_PARTIES,
} from './copy/seenBefore';

/** The largest request body the check reads, in bytes. */
export const SEEN_BEFORE_MAX_BYTES = 4096;

/** Calls a minute: per signed-in account, and per client address. */
export const SEEN_BEFORE_LIMITS = { perTenantPerMinute: 60, perIpPerMinute: 120 } as const;

/** The most "matches" ever says: 5 means "5 or more". */
export const SEEN_BEFORE_MATCHES_CAP = 5;

/** The invoice being checked, trimmed. The create clamps are applied by fingerprintTuples. */
export interface SeenBeforeInput {
	supplier: string;
	/** The debtor. */
	buyer: string;
	invoiceNo: string;
	/** The debtor's own reference (PO or contract number), or null. */
	buyerRef: string | null;
	face: number;
	currency: string;
	isTest: boolean;
}

/** The fingerprint fields of a check: the invoice type, as every receivables row is. The currency
 *  is clamped once here, as createReceivable stores it, because fingerprintTuples clamps again and
 *  a clamp is not idempotent when uppercasing lengthens the text ('ß' becomes 'SS'). */
export function toFingerprintInput(input: SeenBeforeInput): InvoiceFingerprintInput {
	return {
		recordType: 'invoice', supplier: input.supplier, buyer: input.buyer, invoiceNo: input.invoiceNo,
		buyerRef: input.buyerRef, face: input.face, currency: clampCurrency(input.currency), isTest: input.isTest,
	};
}

export type ParsedSeenBefore = { ok: true; input: SeenBeforeInput } | { ok: false; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * The request body: { invoice: { supplier, buyer, invoiceNo, face, currency, buyerRef? }, test? }.
 * Strict about types, so nothing is guessed: face must be a JSON number, the names and the
 * currency text, and "test" counts only when it is exactly true. The currency is checked as sent,
 * before any default could fill it in. A buyerRef of null or an empty one reads as none.
 */
export function parseSeenBeforeBody(body: unknown): ParsedSeenBefore {
	if (!isRecord(body) || !isRecord(body.invoice)) return { ok: false, message: SEEN_BEFORE_INVALID_BODY };
	const inv = body.invoice;
	const supplier = text(inv.supplier);
	const buyer = text(inv.buyer);
	const invoiceNo = text(inv.invoiceNo);
	if (supplier === null || buyer === null || invoiceNo === null) return { ok: false, message: SEEN_BEFORE_INVALID_PARTIES };
	const currency = text(inv.currency);
	if (currency === null) return { ok: false, message: SEEN_BEFORE_INVALID_CURRENCY };
	const face = inv.face;
	if (typeof face !== 'number' || !Number.isFinite(face) || face <= 0) return { ok: false, message: SEEN_BEFORE_INVALID_FACE };
	if (inv.buyerRef !== undefined && inv.buyerRef !== null && typeof inv.buyerRef !== 'string') {
		return { ok: false, message: SEEN_BEFORE_INVALID_BUYER_REF };
	}
	const input: SeenBeforeInput = {
		supplier, buyer, invoiceNo,
		buyerRef: text(inv.buyerRef),
		face, currency,
		isTest: body.test === true,
	};
	// A name or number of punctuation alone normalizes to nothing, and there is no invoice key.
	if (fingerprintTuples(toFingerprintInput(input)).inv === null) return { ok: false, message: SEEN_BEFORE_INVALID_NAMES };
	return { ok: true, input };
}

/** One matching record, as the store reads it: no ID, no account, no hash, no invoice text. */
export interface SeenBeforeRow {
	face: number;
	/** The sum of its active claims. */
	claimed: number;
	/** An active claim stands against it. */
	encumbered: boolean;
	/** Some active claim on it is affirmed by the client (the advance arrived). */
	anyAffirmed: boolean;
	/** Some active claim on it is not affirmed. */
	anyUnaffirmed: boolean;
	/** The debtor confirmed the debt through a request link. */
	debtorConfirmed: boolean;
	/** The debtor disputed it (not theirs, or the amount is wrong) through a request link. */
	debtorDisputed: boolean;
	settled: boolean;
	/** Withdrawn by its owner (S2). */
	withdrawn: boolean;
	/** The debtor's reference matched as well. */
	refMatch: boolean;
	/** The day it was recorded, YYYY-MM-DD. */
	createdDay: string;
}

export type SeenBeforeStatus = 'financed' | 'settled' | 'recorded' | 'not_found';
export type SeenBeforeFinancing = 'none' | 'partial' | 'full' | 'over';

/** The full answer, version 1. Additive only: a new field never changes an old one's meaning. */
export interface SeenBeforeAnswer {
	v: 1;
	found: boolean;
	/** 0 when not found, else 1 to 5 (5 means "5 or more"). */
	matches: number;
	/** Financed outranks settled, settled outranks recorded. */
	status: SeenBeforeStatus;
	anyFinanced: boolean;
	/** The most financed matching record, on its own. Never a sum across records. */
	financing: SeenBeforeFinancing;
	claimsAffirmed: 'all' | 'some' | 'none';
	anySettled: boolean;
	/** A dispute outranks a confirmation. */
	debtor: 'confirmed' | 'disputed' | 'none';
	withdrawn: boolean;
	/** A debtor reference was sent, so it could be compared. */
	refChecked: boolean;
	refMatch: boolean;
	/** The day the earliest matching record was recorded, or null. */
	firstSeen: string | null;
	test: boolean;
	checkedAt: string;
}

/** The full answer's keys, in the order the route writes them. */
export const FULL_ANSWER_KEYS = [
	'v', 'found', 'matches', 'status', 'anyFinanced', 'financing', 'claimsAffirmed', 'anySettled',
	'debtor', 'withdrawn', 'refChecked', 'refMatch', 'firstSeen', 'test', 'checkedAt',
] as const;

/** What an account that is not verified sees. */
export const FOUND_ONLY_KEYS = ['v', 'found', 'test', 'checkedAt'] as const;

/** Keys no answer ever carries, at any tier. */
export const NEVER_RETURNED = [
	'id', 'receivableId', 'tenant_id', 'tenantId', 'invoiceNo', 'supplier', 'buyer', 'face', 'amount',
	'currency', 'fingerprint', 'fingerprint_inv', 'fingerprint_ref', 'label', 'financier', 'count',
] as const;

const FINANCING_OF: Record<FinancingStatus, SeenBeforeFinancing> = {
	unfinanced: 'none',
	partially_financed: 'partial',
	fully_financed: 'full',
	over_financed: 'over',
};
const FINANCING_RANK: Record<SeenBeforeFinancing, number> = { none: 0, partial: 1, full: 2, over: 3 };

/** The answer for the matching records. */
export function summarizeMatches(
	rows: readonly SeenBeforeRow[],
	o: { refChecked: boolean; test: boolean; checkedAt: string },
): SeenBeforeAnswer {
	const found = rows.length > 0;
	const anyFinanced = rows.some((r) => r.encumbered);
	const anySettled = rows.some((r) => r.settled);
	let financing: SeenBeforeFinancing = 'none';
	for (const r of rows) {
		const f = FINANCING_OF[financingStatusOf(r.claimed, r.face)];
		if (FINANCING_RANK[f] > FINANCING_RANK[financing]) financing = f;
	}
	const affirmed = rows.some((r) => r.anyAffirmed);
	const unaffirmed = rows.some((r) => r.anyUnaffirmed);
	let firstSeen: string | null = null;
	for (const r of rows) if (firstSeen === null || r.createdDay < firstSeen) firstSeen = r.createdDay;
	return {
		v: 1,
		found,
		matches: Math.min(rows.length, SEEN_BEFORE_MATCHES_CAP),
		status: anyFinanced ? 'financed' : anySettled ? 'settled' : found ? 'recorded' : 'not_found',
		anyFinanced,
		financing,
		claimsAffirmed: affirmed && !unaffirmed ? 'all' : affirmed && unaffirmed ? 'some' : 'none',
		anySettled,
		debtor: rows.some((r) => r.debtorDisputed) ? 'disputed' : rows.some((r) => r.debtorConfirmed) ? 'confirmed' : 'none',
		withdrawn: rows.some((r) => r.withdrawn),
		refChecked: o.refChecked,
		refMatch: o.refChecked && rows.some((r) => r.refMatch),
		firstSeen,
		test: o.test,
		checkedAt: o.checkedAt,
	};
}

/** Whether anything was found, and nothing more: what an account that is not verified sees. */
export function foundOnly(a: SeenBeforeAnswer): { v: 1; found: boolean; test: boolean; checkedAt: string } {
	return { v: 1, found: a.found, test: a.test, checkedAt: a.checkedAt };
}
