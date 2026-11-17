import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));

import { isDustDisposal, splitQuarantinedDust } from '../../src/lib/quarantineBooks';
import type { PoisonFlag } from '../../src/lib/poisoningFlags';
import { getQuarantine } from '../../src/i18n/components/quarantine';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Needs Attention and quarantine: an item that moved nothing or dust to a quarantined address is
 * set aside behind "Show"; a real payment to one is never hidden. Display only.
 */

const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const MINE = `0x${'5'.repeat(40)}`;
const FRIEND = `0x${'6'.repeat(40)}`;

const item = (sourceId: string, amount: number, proceedsUsd: number | null) => ({ sourceId, amount, proceedsUsd });
const flags = new Map<string, PoisonFlag>([
	[POISON, { signal: 'both', imitates: 'Coinbase deposit' }],
	[MINE, { signal: 'quarantined', imitates: null }],
]);

describe('isDustDisposal', () => {
	it('is dust when nothing moved, there is no value, or it is under $1', () => {
		expect(isDustDisposal(item('a', 0, 500))).toBe(true);
		expect(isDustDisposal(item('a', 10, null))).toBe(true);
		expect(isDustDisposal(item('a', 10, 0.99))).toBe(true);
		expect(isDustDisposal(item('a', 10, 1))).toBe(false);
	});
});

describe('splitQuarantinedDust', () => {
	const to = new Map([
		['spoof', POISON],
		['real-loss', POISON],
		['mine', MINE],
		['friend', FRIEND],
	]);

	it('sets aside dust to a quarantined address, with its flag', () => {
		const { visible, hidden } = splitQuarantinedDust([item('spoof', 0, 0), item('mine', 5, 0.2)], to, flags);
		expect(visible).toEqual([]);
		expect(hidden.map((h) => [h.item.sourceId, h.flag.signal])).toEqual([['spoof', 'both'], ['mine', 'quarantined']]);
	});

	it('never hides a real payment to a quarantined address', () => {
		const { visible, hidden } = splitQuarantinedDust([item('real-loss', 1200, 1200)], to, flags);
		expect(visible.map((v) => v.sourceId)).toEqual(['real-loss']);
		expect(hidden).toEqual([]);
	});

	it('leaves dust to an ordinary address, and items with no known address, where they are', () => {
		const { visible } = splitQuarantinedDust([item('friend', 0, 0), item('unknown', 0, 0)], to, flags);
		expect(visible.map((v) => v.sourceId)).toEqual(['friend', 'unknown']);
	});
});

describe('the page', () => {
	it('keeps the filter to display: tax math and CSVs read their own data', () => {
		const page = readFileSync(path.resolve(__dirname, '../../src/pages/dashboard/bookkeeping.astro'), 'utf8');
		expect(page).toMatch(/splitQuarantinedDust\(needsAttentionAll/);
		expect(page).toMatch(/<details class="tin-quarantine">/);
		const csv = readFileSync(path.resolve(__dirname, '../../src/pages/api/yearEnd/breakdown-csv.ts'), 'utf8');
		expect(csv).not.toMatch(/quarantine/i);
	});

	it('has the hidden line in every language', () => {
		for (const lang of ['en', 'es', 'fr'] as const) {
			const t = getQuarantine(lang);
			expect(t.needsAttentionHidden(1)).not.toBe(t.needsAttentionHidden(3));
			expect(t.hiddenReason('quarantined')).toContain('☠');
			expect(t.show.length).toBeGreaterThan(0);
		}
	});
});
