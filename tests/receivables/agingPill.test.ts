import { describe, it, expect } from 'vitest';
import { agingPillHtml } from '../../src/components/receivables/AgingPill/agingPill';
import { AGING_STATE_LABELS, AGING_STATE_TITLES } from '../../src/lib/receivables/copy/aging';

/**
 * The AgingPill fragment helper (aging A2): an HTML string per claim-aging state, dropped into
 * the hosts' innerHTML builders — same contract as statusPillHtml (fragments.test.ts). The
 * goldens are written out here; the state must map to its own class and label, an unknown state
 * must render nothing, and raw input must never reach a class name.
 */

const golden = (state: string) =>
	`<span class="rcv-pill rcv-pill--aging rcv-pill--ag-${state}" title="${AGING_STATE_TITLES[state as keyof typeof AGING_STATE_TITLES]}">${AGING_STATE_LABELS[state as keyof typeof AGING_STATE_LABELS]}</span>`;

describe('agingPillHtml', () => {
	it('renders all six states agingStateOf returns, each with its label and hover line', () => {
		expect(agingPillHtml('active')).toBe(
			'<span class="rcv-pill rcv-pill--aging rcv-pill--ag-active" title="On time against its promised payment date.">Active</span>',
		);
		expect(agingPillHtml('due_in_grace')).toBe(golden('due_in_grace'));
		expect(agingPillHtml('past_due_not_updated')).toBe(golden('past_due_not_updated'));
		expect(agingPillHtml('no_promised_date')).toBe(golden('no_promised_date'));
		expect(agingPillHtml('lapsed')).toBe(golden('lapsed'));
		expect(agingPillHtml('settled')).toBe(golden('settled'));
	});

	it('the grace and past-due labels read as the plan wrote them', () => {
		expect(agingPillHtml('due_in_grace')).toContain('>Due, in grace<');
		expect(agingPillHtml('past_due_not_updated')).toContain('>Past due, not updated<');
	});

	it('an unknown or missing state renders nothing, so hostile input never reaches a class name', () => {
		expect(agingPillHtml(undefined)).toBe('');
		expect(agingPillHtml(null)).toBe('');
		expect(agingPillHtml('')).toBe('');
		expect(agingPillHtml('withdrawn')).toBe('');
		expect(agingPillHtml('ag-lapsed" onmouseover="x')).toBe('');
		expect(agingPillHtml('<img src=x onerror=1>')).toBe('');
		expect(agingPillHtml(42)).toBe('');
		// Inherited object keys are not states.
		expect(agingPillHtml('toString')).toBe('');
		expect(agingPillHtml('__proto__')).toBe('');
	});
});
