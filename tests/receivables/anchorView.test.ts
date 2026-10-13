import { describe, it, expect } from 'vitest';
import {
	anchorChecklist,
	anchorDay,
	anchorEvidence,
	anchorPillLabel,
	anchorStateOf,
} from '../../src/lib/receivables/anchorView';

/**
 * src/lib/receivables/anchorView.ts. The expected strings are written out here, copied from what
 * the desk's evidence row and checklist row and the registry's anchor pill rendered before S1
 * moved them, so a copy edit cannot pass by changing both sides at once.
 */

const CONFIRMED = { anchored: true, anchoredAt: '2026-10-10T13:00:00.000Z' };
const PENDING = { anchored: true, anchoredAt: null };
const NONE = { anchored: false, anchoredAt: null };

describe('anchorStateOf', () => {
	it('reads anchoredAt first, then anchored', () => {
		expect(anchorStateOf(CONFIRMED)).toBe('confirmed');
		expect(anchorStateOf({ anchoredAt: '2026-10-10T13:00:00.000Z' })).toBe('confirmed');
		expect(anchorStateOf({ anchored: false, anchoredAt: '2026-10-10T13:00:00.000Z' })).toBe('confirmed');
		expect(anchorStateOf(PENDING)).toBe('pending');
		expect(anchorStateOf({ anchored: true })).toBe('pending');
		expect(anchorStateOf(NONE)).toBe('none');
		expect(anchorStateOf({})).toBe('none');
		expect(anchorStateOf({ anchored: null, anchoredAt: '' })).toBe('none');
	});

	it('anchorDay is the YYYY-MM-DD of the block time', () => {
		expect(anchorDay(CONFIRMED)).toBe('2026-10-10');
		expect(anchorDay({ anchoredAt: '2026-01-02' })).toBe('2026-01-02');
	});
});

describe('anchorEvidence (the desk evidence row)', () => {
	it('confirmed', () => {
		expect(anchorEvidence(CONFIRMED)).toEqual({
			good: true, icon: '⛓', title: 'Timestamped to Bitcoin',
			detail: "Confirmed in a block on 2026-10-10. The record's date cannot be forged or backdated.",
		});
	});

	it('pending', () => {
		expect(anchorEvidence(PENDING)).toEqual({
			good: true, icon: '⛓', title: 'Timestamped to Bitcoin',
			detail: 'Submitted, pending a block. Once confirmed the date cannot be moved.',
		});
	});

	it('none', () => {
		expect(anchorEvidence(NONE)).toEqual({
			good: false, icon: '·', title: 'Not yet timestamped',
			detail: 'The record is signed but its date is not yet anchored publicly.',
		});
	});
});

describe('anchorChecklist (the desk checklist row)', () => {
	it('confirmed', () => {
		expect(anchorChecklist(CONFIRMED)).toEqual({
			state: 'yes', label: 'Timestamped to Bitcoin',
			detail: 'Confirmed in a block on 2026-10-10. The date cannot be moved.',
		});
	});

	it('pending', () => {
		expect(anchorChecklist(PENDING)).toEqual({
			state: 'yes', label: 'Timestamped to Bitcoin',
			detail: 'Submitted, pending a block. Once confirmed the date cannot be moved.',
		});
	});

	it('none', () => {
		expect(anchorChecklist(NONE)).toEqual({
			state: 'na', label: 'Timestamp pending',
			detail: 'Submitted on creation. It confirms into a block within an hour or two on its own.',
		});
	});
});

describe('anchorPillLabel', () => {
	it('actionable (the registry pill today)', () => {
		expect(anchorPillLabel(CONFIRMED, true)).toBe('⛓ Bitcoin 2026-10-10');
		expect(anchorPillLabel(PENDING, true)).toBe('⏳ pending · re-check');
		expect(anchorPillLabel(NONE, true)).toBe('Anchor to Bitcoin');
	});

	it('read-only', () => {
		expect(anchorPillLabel(CONFIRMED, false)).toBe('⛓ Bitcoin 2026-10-10');
		expect(anchorPillLabel(PENDING, false)).toBe('⏳ Bitcoin pending');
		expect(anchorPillLabel(NONE, false)).toBe('Not yet anchored');
	});
});
