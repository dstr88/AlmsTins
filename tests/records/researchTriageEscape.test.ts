import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The AI Triage panel on /dashboard/research builds `panel.innerHTML` from values an attacker
 * can shape: tx.asset_symbol comes from on-chain token names, r.reason is model output, and the
 * error text comes from the server. Every `${...}` and every `.replace('__X__', ...)` value in
 * the handler must go through escapeHtml. The Fill Missing Prices handler writes textContent
 * only.
 *
 * Astro client scripts cannot run hermetically here, so this pins the source.
 */

const ROOT = path.resolve(__dirname, '../..');
const src = readFileSync(path.join(ROOT, 'src/pages/dashboard/research.astro'), 'utf8');

function handler(id: string): string {
	const start = src.indexOf(`$('${id}').addEventListener('click'`);
	expect(start).toBeGreaterThan(-1);
	const end = src.indexOf('\n});', start);
	expect(end).toBeGreaterThan(start);
	return src.slice(start, end);
}

describe('AI Triage panel', () => {
	const body = handler('btn-ai-triage');

	it('imports the shared escapeHtml helper', () => {
		expect(src).toMatch(/import \{ escapeHtml \} from '\.\.\/\.\.\/lib\/escapeHtml'/);
	});

	it('escapes every template interpolation', () => {
		const interps = [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
		expect(interps.length).toBeGreaterThan(5);
		const unescaped = interps.filter((e) => !/^escapeHtml\(.*\)$/.test(e) && e !== 'autoMsg');
		expect(unescaped).toEqual([]);
	});

	it('escapes every placeholder replacement', () => {
		const values = [...body.matchAll(/\.replace\('__[A-Z]+__',\s*([^)]*\)?)\)/g)].map((m) => m[1].trim());
		expect(values.length).toBeGreaterThanOrEqual(4);
		// __S__ is a literal plural suffix chosen in code, not data.
		const unescaped = values.filter((v) => !v.startsWith('escapeHtml(') && !/^data\.autoResolved !== 1/.test(v));
		expect(unescaped).toEqual([]);
	});

	it('escapes the symbol, amount, date, reason and group label', () => {
		for (const v of ['sym', 'amt', 'date', 'r.reason', 'meta.label']) {
			expect(body).toContain(`\${escapeHtml(${v})}`);
		}
	});
});

describe('Fill Missing Prices button', () => {
	it('never writes innerHTML', () => {
		expect(handler('btn-backfill')).not.toMatch(/innerHTML/);
	});
});
