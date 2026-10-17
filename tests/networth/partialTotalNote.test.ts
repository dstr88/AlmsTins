import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as copy from '../../src/i18n/components/partialTotalNote';
import PartialTotalNote from '../../src/components/dashboard/PartialTotalNote';

/**
 * The note that tells you a total leaves something out: an Aave position no price source could value is
 * counted as nothing, so the total reads lower than it should.
 *
 *   - The wording exists in EN/ES/FR with the same keys, and no em dash.
 *   - It names the count when there is one, and says the Aave data was incomplete when there is not.
 *   - It shows nothing for a complete total.
 *   - Every screen that shows a Vault, Portfolio or reconciliation total carries it.
 *
 * Hermetic: no network, no database. Every number here is invented.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;

describe('the wording', () => {
	it.each(LANGS)('%s: names the count, singular and plural', (lang) => {
		const one = copy.partialTotalMessage(lang, true, 1)!;
		const many = copy.partialTotalMessage(lang, true, 3)!;
		expect(one).toContain('1');
		expect(many).toContain('3');
		expect(one).not.toBe(many.replace('3', '1'));
	});

	it('English reads as a short, plain sentence', () => {
		expect(copy.partialTotalMessage('en', true, 1)).toBe('Partial total: 1 Aave position unpriced, not counted');
		expect(copy.partialTotalMessage('en', true, 2)).toBe('Partial total: 2 Aave positions unpriced, not counted');
		expect(copy.partialTotalMessage('en', true, 0)).toBe('Partial total: Aave data is incomplete');
	});

	it.each(LANGS)('%s: shows nothing for a complete total', (lang) => {
		expect(copy.partialTotalMessage(lang, false, 4)).toBeNull();
		expect(copy.partialTotalMessage(lang, undefined, 4)).toBeNull();
	});

	it.each(LANGS)('%s: a partial total with no count says the Aave data was incomplete', (lang) => {
		const message = copy.partialTotalMessage(lang, true, 0)!;
		expect(message).toBe(copy[lang].incomplete);
		expect(copy.partialTotalMessage(lang, true, undefined)).toBe(message);
		expect(copy.partialTotalMessage(lang, true, Number.NaN)).toBe(message);
		expect(copy.partialTotalMessage(lang, true, -2)).toBe(message);
	});

	it.each(LANGS)('%s: same keys as English, non-empty, no em dash', (lang) => {
		const { lang: _l, ...rest } = copy[lang];
		const { lang: _e, ...enRest } = copy.en;
		expect(Object.keys(rest).sort()).toEqual(Object.keys(enRest).sort());
		expect(copy[lang].incomplete.trim()).not.toBe('');
		for (const text of [copy[lang].incomplete, copy[lang].unpriced(1), copy[lang].unpriced(5)]) {
			expect(text).not.toMatch(/—/);
			expect(text.trim()).not.toBe('');
		}
	});

	it('falls back to English for an unknown language', () => {
		expect(copy.getPartialTotalNote('de' as any)).toBe(copy.en);
	});
});

describe('the component', () => {
	const render = (props: { partial?: boolean; unpricedCount?: number }) =>
		renderToStaticMarkup(React.createElement(PartialTotalNote, props));

	it('renders the note, as a note, for a partial total', () => {
		const html = render({ partial: true, unpricedCount: 2 });
		expect(html).toContain('role="note"');
		expect(html).toContain('Partial total: 2 Aave positions unpriced, not counted');
	});

	it('says the Aave data is incomplete when a partial total has no count', () => {
		expect(render({ partial: true, unpricedCount: 0 })).toContain('Partial total: Aave data is incomplete');
		expect(render({ partial: true })).toContain('Partial total: Aave data is incomplete');
	});

	it('renders nothing at all for a complete total', () => {
		expect(render({ partial: false, unpricedCount: 0 })).toBe('');
		expect(render({})).toBe('');
		// A count without the flag is not a partial total: the flag decides.
		expect(render({ partial: false, unpricedCount: 5 })).toBe('');
	});

	it('uses design tokens only, never a hard-coded color', () => {
		const source = read('src/components/dashboard/PartialTotalNote.tsx');
		expect(source).toMatch(/var\(--warning\)/);
		expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(source).not.toMatch(/rgba?\(/);
	});
});

describe('every screen that shows a total carries the note', () => {
	it.each([
		['src/components/dashboard/PortfolioTile.tsx', 'the Vault'],
		['src/components/dashboard/TotalsTin.tsx', 'the net worth page totals'],
		['src/components/dashboard/NetWorthTable.tsx', 'the net worth page aggregate'],
		['src/components/dashboard/ReconciliationSnapshot.tsx', 'the reconciliation snapshot column'],
	])('%s (%s)', (file) => {
		const source = read(file);
		expect(source).toMatch(/import PartialTotalNote from '\.\/PartialTotalNote'/);
		expect(source).toMatch(/<PartialTotalNote partial=\{[^}]+\} unpricedCount=\{[^}]+\} \/>/);
	});

	it('the Portfolio page shows it, from the response, as text (never as markup)', () => {
		const page = read('src/pages/dashboard/portfolio.astro');
		expect(page).toContain('id="pf-partial-note"');
		expect(page).toContain('showPartialNote(data.summary, data.unpricedAave)');
		// Shown before the empty-state return, so an account with only unpriced positions still sees it.
		expect(page.indexOf('showPartialNote(data.summary')).toBeLessThan(page.indexOf('elEmpty.hidden = false'));
		const fn = page.slice(page.indexOf('function showPartialNote'), page.indexOf('// ── Main load'));
		expect(fn).toContain('textContent');
		expect(fn).not.toMatch(/innerHTML/);
	});

	it('the Vault and Portfolio endpoints cache under keys that never serve a payload from before this existed', () => {
		expect(read('src/pages/api/networth/summary.ts')).toContain(':networth:summary:v5`');
		expect(read('src/pages/api/portfolio/performance.ts')).toContain(':portfolio:performance:v8`');
		expect(read('src/pages/api/portfolio/reconciliation.ts')).toContain(':portfolio:reconciliation:v4`');
	});
});
