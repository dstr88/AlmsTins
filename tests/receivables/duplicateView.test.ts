import { describe, it, expect } from 'vitest';
import {
	bookDuplicateIds, claimDuplicateLines, duplicateFlagView, recordIsPossibleDuplicate,
	type DuplicatePhase, type DuplicateVariant,
} from '../../src/lib/receivables/duplicateView';
import * as copy from '../../src/lib/receivables/copy/duplicate';

/**
 * src/lib/receivables/duplicateView.ts (S4): what the pages show for a duplicate-check answer, per
 * phase and per disclosure tier (owner decision 9). The tier pins are the point: the view may only
 * repeat what the answer carries, so the financed detail and the reference-only clause appear only
 * for a verified account's full answer, and never on the record view (the public lookup).
 */

const RID = 'a'.repeat(64);
const RID2 = 'B'.repeat(64);
const PHASES: DuplicatePhase[] = ['precheck', 'created', 'record', 'claim'];
const VARIANTS: DuplicateVariant[] = ['desk', 'registry', 'client'];

const full = (over: Record<string, unknown> = {}) => ({
	duplicateCheck: { state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: true, ...over },
});
const stateOnly = (state: string) => ({ duplicateCheck: { state } });
const publicTier = (state: string, hasDebtorReference: boolean) => ({ duplicateCheck: { state, hasDebtorReference } });

describe('a possible duplicate', () => {
	it('verified, recorded as financed: the Addendum A line while typing, the financed line after', () => {
		expect(duplicateFlagView(full(), 'precheck')).toEqual({
			tone: 'caution', lines: [copy.PRECHECK_FINANCED, copy.PRECHECK_PROCEED], ownMatches: [],
		});
		expect(copy.PRECHECK_FINANCED).toBe('This invoice may already be financed. Check with the debtor before you advance.');
		expect(duplicateFlagView(full(), 'created')?.lines).toEqual([copy.DUPLICATE_DETAIL_FINANCED]);
		expect(duplicateFlagView(full(), 'claim')?.lines).toEqual([copy.DUPLICATE_DETAIL_FINANCED, copy.CLAIM_DUPLICATE_SIGNED]);
	});

	it('verified, not recorded as financed: says so', () => {
		expect(duplicateFlagView(full({ encumbered: false }), 'precheck')?.lines).toEqual([copy.DUPLICATE_DETAIL_MATCH, copy.PRECHECK_PROCEED]);
		expect(duplicateFlagView(full({ encumbered: false }), 'created')?.lines).toEqual([copy.DUPLICATE_DETAIL_MATCH]);
	});

	it('verified, matched on the debtor reference only: adds the installment clause', () => {
		expect(duplicateFlagView(full({ basis: 'debtor_reference_only' }), 'precheck')?.lines[0]).toBe(`${copy.PRECHECK_FINANCED} ${copy.DUPLICATE_DETAIL_REFERENCE_ONLY}`);
		expect(duplicateFlagView(full({ basis: 'debtor_reference_only', encumbered: false }), 'created')?.lines[0]).toBe(`${copy.DUPLICATE_DETAIL_MATCH} ${copy.DUPLICATE_DETAIL_REFERENCE_ONLY}`);
	});

	it('the state alone (an account that is not verified): the plain match line in every phase', () => {
		for (const phase of PHASES) {
			const v = duplicateFlagView(stateOnly('possible_duplicate'), phase)!;
			expect(v.tone).toBe('caution');
			expect(v.lines[0]).toBe(copy.DUPLICATE_DETAIL_ANY_MATCH);
		}
	});

	it('the record view never says more than the plain line, even when an answer carries more', () => {
		expect(duplicateFlagView(full(), 'record')?.lines).toEqual([copy.DUPLICATE_DETAIL_ANY_MATCH]);
		expect(duplicateFlagView(publicTier('possible_duplicate', false), 'record')?.lines).toEqual([copy.DUPLICATE_DETAIL_ANY_MATCH]);
	});

	it('the client portal reads its own lines, never the lender\'s advice or the financed detail', () => {
		for (const phase of ['precheck', 'created', 'record'] as const) {
			const v = duplicateFlagView(full(), phase, 'client')!;
			expect(v.lines[0]).toBe(phase === 'precheck' ? copy.CLIENT_MATCH : copy.CLIENT_RECORD_MATCH);
			expect(v.lines.join(' ')).not.toMatch(/financed|before you advance/i);
		}
		expect(duplicateFlagView(full(), 'precheck', 'client')?.lines).toEqual([copy.CLIENT_MATCH, copy.PRECHECK_PROCEED]);
		expect(duplicateFlagView(stateOnly('possible_duplicate'), 'record', 'client')?.lines).toEqual([copy.CLIENT_RECORD_MATCH]);
	});

	it('half a detail is no detail: a basis without the financed boolean (or the reverse) reads as the state alone', () => {
		for (const dc of [
			{ state: 'possible_duplicate', basis: 'invoice_number' },
			{ state: 'possible_duplicate', encumbered: true },
			{ state: 'possible_duplicate', basis: 'made_up', encumbered: true },
			{ state: 'possible_duplicate', basis: 'invoice_number', encumbered: 'true' },
		]) {
			expect(duplicateFlagView({ duplicateCheck: dc }, 'precheck')?.lines[0], JSON.stringify(dc)).toBe(copy.DUPLICATE_DETAIL_ANY_MATCH);
		}
	});
});

describe('own matches', () => {
	const ownMatches = [
		{ id: RID, invoiceNo: 'INV-42', withdrawn: false },
		{ id: RID2, invoiceNo: 'INV 42', withdrawn: true },
		{ id: 'not-an-id', invoiceNo: 'x', withdrawn: false },
		{ id: 'c'.repeat(64), invoiceNo: 7, withdrawn: false },
		'junk',
	];

	it('listed while typing and after saving, well-formed ones only, IDs lowercased', () => {
		for (const phase of ['precheck', 'created'] as const) {
			expect(duplicateFlagView({ ...full(), ownMatches }, phase)?.ownMatches).toEqual([
				{ id: RID, invoiceNo: 'INV-42', withdrawn: false },
				{ id: 'b'.repeat(64), invoiceNo: 'INV 42', withdrawn: true },
			]);
		}
	});

	it('never on the record view or the claim prompt', () => {
		for (const phase of ['record', 'claim'] as const) expect(duplicateFlagView({ ...full(), ownMatches }, phase)?.ownMatches).toEqual([]);
	});

	it('at most ten', () => {
		const many = Array.from({ length: 14 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), invoiceNo: `INV-${i}`, withdrawn: false }));
		expect(duplicateFlagView({ ...full(), ownMatches: many }, 'precheck')?.ownMatches).toHaveLength(10);
	});
});

describe('anything that is not a possible duplicate', () => {
	it('while typing, on the record and at claim time: nothing, whatever the state', () => {
		for (const phase of ['precheck', 'record', 'claim'] as const) {
			for (const a of [stateOnly('no_match'), stateOnly('unavailable'), publicTier('no_match', false), publicTier('unavailable', true), full({ state: 'no_match' })]) {
				expect(duplicateFlagView(a, phase), `${phase} ${JSON.stringify(a)}`).toBeNull();
			}
		}
	});

	it('just after saving: a muted note when the check could not run, or when no debtor reference was recorded', () => {
		expect(duplicateFlagView(publicTier('unavailable', true), 'created')).toEqual({ tone: 'muted', lines: [copy.DUPLICATE_DETAIL_UNAVAILABLE], ownMatches: [] });
		expect(duplicateFlagView(stateOnly('unavailable'), 'created')?.lines).toEqual([copy.DUPLICATE_DETAIL_UNAVAILABLE]);
		expect(duplicateFlagView(full({ state: 'no_match', basis: null, encumbered: false, hasDebtorReference: false }), 'created')).toEqual({
			tone: 'muted', lines: [copy.DUPLICATE_DETAIL_NO_REFERENCE], ownMatches: [],
		});
	});

	it('just after saving: no match with a reference, or a state-only no match, shows nothing (never "clear")', () => {
		expect(duplicateFlagView(full({ state: 'no_match', basis: null, encumbered: false, hasDebtorReference: true }), 'created')).toBeNull();
		expect(duplicateFlagView(stateOnly('no_match'), 'created')).toBeNull();
	});

	it('malformed answers read as no answer', () => {
		for (const a of [null, undefined, {}, { duplicateCheck: null }, { duplicateCheck: 'possible_duplicate' }, { duplicateCheck: [] },
			{ duplicateCheck: { state: 'POSSIBLE_DUPLICATE' } }, { duplicateCheck: { state: '__proto__' } }, { duplicateCheck: Object.create({ state: 'possible_duplicate' }) }]) {
			for (const phase of PHASES) expect(duplicateFlagView(a as never, phase), JSON.stringify(a)).toBeNull();
		}
	});
});

describe('claimDuplicateLines', () => {
	it('the answer\'s lines, or the plain line when the answer carries nothing usable', () => {
		expect(claimDuplicateLines(full().duplicateCheck)).toEqual([copy.DUPLICATE_DETAIL_FINANCED, copy.CLAIM_DUPLICATE_SIGNED]);
		for (const dc of [undefined, null, 'x', { state: 'no_match' }, { state: 'possible_duplicate' }]) {
			expect(claimDuplicateLines(dc), JSON.stringify(dc)).toEqual([copy.DUPLICATE_DETAIL_ANY_MATCH, copy.CLAIM_DUPLICATE_SIGNED]);
		}
	});
});

describe('book and record helpers', () => {
	it('bookDuplicateIds: only an explicit true with a string ID', () => {
		const ids = bookDuplicateIds([
			{ id: 'a', possibleDuplicate: true }, { id: 'b', possibleDuplicate: false }, { id: 'c', possibleDuplicate: null },
			{ id: 'd' }, { id: 7, possibleDuplicate: true } as never, { possibleDuplicate: true }, { id: 'e', possibleDuplicate: 'true' } as never,
		]);
		expect([...ids]).toEqual(['a']);
		expect(bookDuplicateIds(null).size).toBe(0);
	});

	it('recordIsPossibleDuplicate reads the lookup state', () => {
		expect(recordIsPossibleDuplicate(publicTier('possible_duplicate', true))).toBe(true);
		expect(recordIsPossibleDuplicate(publicTier('no_match', true))).toBe(false);
		expect(recordIsPossibleDuplicate(null)).toBe(false);
	});
});

describe('wording', () => {
	it('every line any view can show is free of em dashes and accusations, and never says "blocked"', () => {
		const answers = [
			full(), full({ encumbered: false }), full({ basis: 'debtor_reference_only' }), stateOnly('possible_duplicate'),
			publicTier('unavailable', false), full({ state: 'no_match', basis: null, encumbered: false, hasDebtorReference: false }),
		];
		for (const a of answers) for (const phase of PHASES) for (const variant of VARIANTS) {
			const v = duplicateFlagView(a, phase, variant);
			for (const line of v?.lines ?? []) {
				expect(line).not.toContain('—');
				expect(line).not.toMatch(/fraud|block|accus|refus|reject/i);
			}
		}
	});
});
