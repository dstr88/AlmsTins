/**
 * What kind of record a receivable attestation is, decided one way for every reader.
 *
 * Pure and import-free, so it is client-safe (like paths.ts): the registry, the public lookup
 * projection and the page scripts all classify a row identically.
 *
 * Why it exists. A statement's opening word used to be the only mark of a dispute
 * ("DISPUTED —") or a diligence acceptance ("DILIGENCE —"), and the free-text attest endpoint
 * let anyone holding a receivable ID type that word. Two changes close that:
 *   - every writer records its provenance in receivable_attestations.source, and the class
 *     comes from the source whenever one is present;
 *   - the free-text endpoint answers 400 reserved_prefix for a statement that opens like a
 *     system answer (hasReservedPrefix), so no new free-text row can wear one.
 *
 * Rows written before the source column existed (source NULL) are classified by their prefix,
 * spelled exactly as the system writers spell it. A NULL row is never consent: an old free-text
 * row and a real confirmation cannot be told apart, so neither is read as one.
 */

/** Who wrote an attestation row. Stored in receivable_attestations.source. */
export const ATTESTATION_SOURCES = [
	/** POST /api/verify/receivables/attest: free text from a signed-in party. */
	'party_statement',
	/** acceptDiligence: a financier accepts responsibility for having verified the debtor. */
	'diligence',
	/** confirmByToken, confirmed: the debtor confirms the debt through a single-use link. */
	'debtor_confirmation',
	/** confirmByToken, not ours or amount wrong. */
	'debtor_dispute',
	/** affirmClaimByToken, received: the client confirms an advance arrived. */
	'receipt_confirmation',
	/** affirmClaimByToken, not received or a different amount. */
	'receipt_dispute',
	/** confirmRecordByToken, accurate: the client confirms the record is theirs. */
	'record_confirmation',
	/** confirmRecordByToken, wrong. */
	'record_dispute',
	/** respondToOffer, accept: the client accepts an offer's terms. */
	'offer_acceptance',
	/** respondToOffer, decline. */
	'offer_decline',
	/** recordLapse: a request expired without a reply. */
	'unanswered',
] as const;
export type AttestationSource = (typeof ATTESTATION_SOURCES)[number];

/**
 * What a row means to someone weighing the receivable.
 *   - consent: a party's affirmative answer through a single-use request link (the debtor
 *     confirms the debt, the client confirms the record or an advance, the client accepts an
 *     offer). Only a row with a recorded source can be consent.
 *   - party_dispute: a party's disagreement through a request link (not our invoice, wrong
 *     amount, the record is wrong, the money did not arrive).
 *   - diligence: a financier's own acceptance of responsibility for verifying the debtor.
 *     His word about his process, never evidence that the debtor confirmed anything.
 *   - system_note: a note about the paperwork rather than a claim about the debt: a request
 *     that expired unanswered, or an offer the client declined.
 *   - party_statement: free text a signed-in party typed, and anything not classified above.
 */
export const ATTESTATION_CLASSES = ['consent', 'party_dispute', 'diligence', 'system_note', 'party_statement'] as const;
export type AttestationClass = (typeof ATTESTATION_CLASSES)[number];

const SOURCE_CLASS: Record<AttestationSource, AttestationClass> = {
	party_statement: 'party_statement',
	diligence: 'diligence',
	debtor_confirmation: 'consent',
	debtor_dispute: 'party_dispute',
	receipt_confirmation: 'consent',
	receipt_dispute: 'party_dispute',
	record_confirmation: 'consent',
	record_dispute: 'party_dispute',
	offer_acceptance: 'consent',
	offer_decline: 'system_note',
	unanswered: 'system_note',
};

/** The role each consent flow writes. A consent-sourced row under any other role is read as a
 *  party statement: defense in depth, so a mislabeled row can never pass as consent. */
const CONSENT_ROLE: Partial<Record<AttestationSource, string>> = {
	debtor_confirmation: 'buyer',
	receipt_confirmation: 'supplier',
	record_confirmation: 'supplier',
	offer_acceptance: 'supplier',
};

/** The exact openings the system writers use (U+2014 em dash). Legacy NULL-source rows are
 *  classified by these. */
export const RESERVED_STATEMENT_PREFIXES = ['DISPUTED —', 'DILIGENCE —', 'UNANSWERED —', 'DECLINED —'] as const;

const RESERVED_WORDS = RESERVED_STATEMENT_PREFIXES.map((p) => p.split(' ')[0]);

/** A reserved word in any case, then optional spaces, then any dash (hyphen-minus, the
 *  U+2010-U+2015 hyphens and dashes, the minus sign, the two- and three-em dashes). */
const RESERVED_WORD_THEN_DASH = new RegExp(
	`^(?:${RESERVED_WORDS.join('|')})\\s*[-\\u2010-\\u2015\\u2212\\u2E3A\\u2E3B]`,
	'iu',
);

export function isAttestationSource(v: unknown): v is AttestationSource {
	return typeof v === 'string' && (ATTESTATION_SOURCES as readonly string[]).includes(v);
}

export function isAttestationClass(v: unknown): v is AttestationClass {
	return typeof v === 'string' && (ATTESTATION_CLASSES as readonly string[]).includes(v);
}

/**
 * True when free text opens like a system answer, checked after compatibility normalization
 * (so full-width letters count) and after any leading whitespace or invisible formatting
 * characters. Two shapes are reserved:
 *   - a reserved word in capitals, with or without a dash after it ("DISPUTED", "DILIGENCE
 *     notes"): the financier desk still tests the bare upper-case word, so no typed statement
 *     may open with one;
 *   - a reserved word in any case followed by a dash ("Disputed — ..."), which reads like the
 *     system's own "DISPUTED —" opening.
 * Sentence-case prose ("Declined 20 cartons as damaged", "Diligence visit at the port") is an
 * ordinary statement. Matching text cannot catch every look-alike letter, which is why readers
 * trust the class from the recorded source, never the opening words.
 */
export function hasReservedPrefix(statement: unknown): boolean {
	const s = String(statement ?? '')
		.normalize('NFKC')
		.replace(/^[\s\p{Cf}]+/u, '');
	return RESERVED_WORDS.some((w) => s.startsWith(w)) || RESERVED_WORD_THEN_DASH.test(s);
}

/**
 * Classify one attestation row. The source wins when present; an unknown source is a party
 * statement (never consent, never a dispute). A NULL source falls back to the exact system
 * prefix, and is never consent.
 */
export function classifyAttestation(role: unknown, statement: unknown, source: unknown): AttestationClass {
	if (source != null && source !== '') {
		if (!isAttestationSource(source)) return 'party_statement';
		const cls = SOURCE_CLASS[source];
		const needRole = CONSENT_ROLE[source];
		if (cls === 'consent' && needRole && String(role ?? '') !== needRole) return 'party_statement';
		return cls;
	}
	const s = String(statement ?? '');
	if (s.startsWith('DISPUTED —')) return 'party_dispute';
	if (s.startsWith('DILIGENCE —')) return 'diligence';
	if (s.startsWith('UNANSWERED —') || s.startsWith('DECLINED —')) return 'system_note';
	return 'party_statement';
}

/** The class of an attestation object: its `class` field when it carries a valid one (the
 *  public lookup sends it), otherwise classified from role, statement and source. */
export function attestationClassOf(a: { class?: unknown; role?: unknown; statement?: unknown; source?: unknown } | null | undefined): AttestationClass {
	if (!a) return 'party_statement';
	if (isAttestationClass(a.class)) return a.class;
	return classifyAttestation(a.role, a.statement, a.source);
}

/** A party's disagreement on the record (the debtor's, or the client's). */
export function isPartyDispute(a: { class?: unknown; role?: unknown; statement?: unknown; source?: unknown } | null | undefined): boolean {
	return attestationClassOf(a) === 'party_dispute';
}
