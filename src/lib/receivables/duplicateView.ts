/**
 * What the pages show for a duplicate-check answer (S4), as pure view logic: the DuplicateFlag's
 * tone, lines and the viewer's own matches, the claim prompt's lines, the book's tagged rows
 * and the registry's record tag. Client-safe: copy and types only.
 *
 * Disclosure tiers hold here by construction (owner decision 9). An answer is read field by field,
 * so the view can only say what the answer carries:
 *   - "recorded as financed" or "not recorded as financed", and the reference-only clause, only
 *     when the answer carries a known basis and the financed boolean (a verified account's answer);
 *   - an answer that is the state alone gets the plain "another record matches" line;
 *   - the record phase reads the public lookup, so it never says more than that line;
 *   - the viewer's own matches only while entering or just after saving, and only when the answer
 *     lists them.
 * A malformed answer reads as no answer. The warning never says who holds the other record, how
 * much is on it, or that anyone did anything wrong; the person decides.
 */
import type { DuplicateBasis, OwnMatch } from './duplicateCheck';
import {
	CLIENT_MATCH, CLIENT_RECORD_MATCH, CLAIM_DUPLICATE_SIGNED, DUPLICATE_DETAIL_ANY_MATCH, DUPLICATE_DETAIL_FINANCED,
	DUPLICATE_DETAIL_MATCH, DUPLICATE_DETAIL_NO_REFERENCE, DUPLICATE_DETAIL_REFERENCE_ONLY,
	DUPLICATE_DETAIL_UNAVAILABLE, PRECHECK_FINANCED, PRECHECK_PROCEED,
} from './copy/duplicate';

/** Where the answer is shown:
 *   precheck  while the invoice is being entered, before it is saved (Addendum A);
 *   created   the create's own answer, just after saving;
 *   record    a record opened on the page (the public lookup's answer);
 *   claim     the claim's 409 possible_duplicate, in the claim prompt. */
export type DuplicatePhase = 'precheck' | 'created' | 'record' | 'claim';
export type DuplicateVariant = 'desk' | 'registry' | 'client';

/** An answer as a route sends it: the duplicateCheck, plus ownMatches on a verified account's
 *  precheck or create. Typed loosely on purpose: every field is checked before it is used. */
export interface DuplicateAnswer {
	duplicateCheck?: unknown;
	ownMatches?: unknown;
}

export interface DuplicateFlagView {
	/** caution: a possible duplicate, headed by the "possible duplicate" tag; muted: the check
	 *  could not compare it fully (no tag). */
	tone: 'caution' | 'muted';
	lines: string[];
	ownMatches: OwnMatch[];
}

const BASES: readonly DuplicateBasis[] = ['invoice_and_reference', 'invoice_number', 'debtor_reference_only'];
const STATES = ['unavailable', 'no_match', 'possible_duplicate'] as const;
type State = (typeof STATES)[number];

/** The fields of an answer, each one only when it is really there. */
interface ReadCheck {
	state: State;
	/** Both present only on a verified account's answer. */
	detail: { basis: DuplicateBasis; encumbered: boolean } | null;
	/** Present on every tier but the state-only one. */
	hasDebtorReference: boolean | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function readCheck(raw: unknown): ReadCheck | null {
	if (!isObject(raw) || !own(raw, 'state') || !(STATES as readonly unknown[]).includes(raw.state)) return null;
	const basis = own(raw, 'basis') && (BASES as readonly unknown[]).includes(raw.basis) ? (raw.basis as DuplicateBasis) : null;
	const encumbered = own(raw, 'encumbered') && typeof raw.encumbered === 'boolean' ? raw.encumbered : null;
	return {
		state: raw.state as State,
		detail: basis && encumbered !== null ? { basis, encumbered } : null,
		hasDebtorReference: own(raw, 'hasDebtorReference') && typeof raw.hasDebtorReference === 'boolean' ? raw.hasDebtorReference : null,
	};
}

const HEX64 = /^[0-9a-f]{64}$/i;
const OWN_MATCHES_SHOWN = 10;

/** The viewer's own matches, well-formed ones only (a 64-hex ID, a string invoice number). */
function readOwnMatches(raw: unknown): OwnMatch[] {
	if (!Array.isArray(raw)) return [];
	const out: OwnMatch[] = [];
	for (const m of raw) {
		if (!isObject(m) || typeof m.id !== 'string' || !HEX64.test(m.id) || typeof m.invoiceNo !== 'string') continue;
		out.push({ id: m.id.toLowerCase(), invoiceNo: m.invoiceNo, withdrawn: m.withdrawn === true });
		if (out.length === OWN_MATCHES_SHOWN) break;
	}
	return out;
}

/** The match line for a lender (desk, registry): financed or not only when the answer says so. */
function matchLine(c: ReadCheck, phase: DuplicatePhase): string {
	if (phase === 'record' || !c.detail) return DUPLICATE_DETAIL_ANY_MATCH;
	const lead = c.detail.encumbered ? (phase === 'precheck' ? PRECHECK_FINANCED : DUPLICATE_DETAIL_FINANCED) : DUPLICATE_DETAIL_MATCH;
	return c.detail.basis === 'debtor_reference_only' ? `${lead} ${DUPLICATE_DETAIL_REFERENCE_ONLY}` : lead;
}

/**
 * The flag for an answer in a phase, or null to show nothing. Shown:
 *   - a possible duplicate, in every phase (caution);
 *   - just after saving only: a check that could not run, or a record saved with no debtor
 *     reference, so only its invoice number could be compared (muted). The precheck shows nothing
 *     for these (the form stays quiet until there is something to warn about), and the record view
 *     leaves them to Verify now.
 * A match never says the invoice is clear of anything: no match shows nothing.
 */
export function duplicateFlagView(answer: DuplicateAnswer | null | undefined, phase: DuplicatePhase, variant: DuplicateVariant = 'desk'): DuplicateFlagView | null {
	const c = readCheck(answer?.duplicateCheck);
	if (!c) return null;
	if (c.state === 'possible_duplicate') {
		const lines = [variant !== 'client' ? matchLine(c, phase) : phase === 'precheck' ? CLIENT_MATCH : CLIENT_RECORD_MATCH];
		if (phase === 'precheck') lines.push(PRECHECK_PROCEED);
		if (phase === 'claim') lines.push(CLAIM_DUPLICATE_SIGNED);
		const ownMatches = phase === 'precheck' || phase === 'created' ? readOwnMatches(answer?.ownMatches) : [];
		return { tone: 'caution', lines, ownMatches };
	}
	if (phase !== 'created') return null;
	if (c.state === 'unavailable') return { tone: 'muted', lines: [DUPLICATE_DETAIL_UNAVAILABLE], ownMatches: [] };
	if (c.hasDebtorReference === false) return { tone: 'muted', lines: [DUPLICATE_DETAIL_NO_REFERENCE], ownMatches: [] };
	return null;
}

/** The claim prompt's lines for a 409 possible_duplicate answer. Never empty. */
export function claimDuplicateLines(duplicateCheck: unknown): string[] {
	return duplicateFlagView({ duplicateCheck: isObject(duplicateCheck) ? duplicateCheck : { state: 'possible_duplicate' } }, 'claim')?.lines
		?? [DUPLICATE_DETAIL_ANY_MATCH, CLAIM_DUPLICATE_SIGNED];
}

/** What these helpers read from a book row or a lookup answer. */
export interface DuplicateRowView {
	id?: unknown;
	possibleDuplicate?: unknown;
	duplicateCheck?: unknown;
}

/** The IDs of the book rows another record matches. Only an explicit true counts: null means the
 *  check could not answer, and that row gets no tag. */
export function bookDuplicateIds(rows: ReadonlyArray<DuplicateRowView> | null | undefined): Set<string> {
	const ids = new Set<string>();
	for (const r of rows ?? []) if (r?.possibleDuplicate === true && typeof r.id === 'string') ids.add(r.id);
	return ids;
}

/** Whether an opened record (the lookup's answer) matches another record at Almstins. */
export function recordIsPossibleDuplicate(rcv: DuplicateRowView | null | undefined): boolean {
	return readCheck(rcv?.duplicateCheck)?.state === 'possible_duplicate';
}
