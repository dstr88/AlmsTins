import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The search results, the Dataset Health cards, the address lookup panel and the
 * annotate/dispose/forward forms on /dashboard/research build innerHTML from row fields
 * (asset_symbol and description come from on-chain data; sources, account names, exchange names
 * and notes are typed or imported text) and from values read back out of data-* attributes,
 * which getAttribute decodes to raw text. Every such value goes through escapeHtml, and every
 * '...' string argument in an inline onclick goes through jsArg.
 *
 * Astro client scripts cannot run hermetically here, so this pins the source.
 * researchNeedsAttentionEscape.test.ts covers the Needs Attention path and jsArg itself.
 */

const ROOT = path.resolve(__dirname, '../..');
const src = readFileSync(path.join(ROOT, 'src/pages/dashboard/research.astro'), 'utf8');

function fn(name: string): string {
	const start = src.indexOf(`function ${name}(`);
	expect(start, name).toBeGreaterThan(-1);
	const end = src.indexOf('\n}\n', start);
	expect(end).toBeGreaterThan(start);
	return src.slice(start, end);
}

const ROW = String.raw`(t|r|m|d|ex|data)\.[\w.]+`;

describe.each(['renderResults', 'renderHealthCheck', 'checkAddress', 'renderAddressPanel'])('%s', (name) => {
	const body = fn(name);

	it('interpolates no raw row field', () => {
		expect(body).not.toMatch(new RegExp(String.raw`\$\{\s*${ROW}\s*(\?\?[^}]*)?\}`));
		expect(body).not.toMatch(new RegExp(String.raw`\+\s*${ROW}\s*\+`));
		expect(body).not.toMatch(new RegExp(String.raw`\+\s*t\.account_name\b`));
		expect(body).not.toMatch(/\.map\(\s*\w+\s*=>\s*\w+\.name\s*\)/);
	});

	it('escapes every placeholder replacement that carries a value', () => {
		const values = [...body.matchAll(/\.replace\('__([A-Z]+)__',\s*/g)].map((m) => {
			const rest = body.slice(m.index! + m[0].length);
			return { key: m[1], rest };
		});
		for (const { key, rest } of values) {
			if (key === 'S') continue; // literal plural suffix chosen in code
			if (key === 'R') { expect(rest.startsWith('String(ratio)')).toBe(true); continue; } // a number
			if (key === 'L' && rest.startsWith('lbl)')) { expect(body).toMatch(/const lbl = escapeHtml\(/); continue; }
			expect(rest.startsWith('escapeHtml('), `__${key}__ in ${name}: ${rest.slice(0, 40)}`).toBe(true);
		}
	});
});

describe('renderResults', () => {
	const body = fn('renderResults');

	it('escapes symbols, description, account name, notes and category', () => {
		for (const v of ['t.asset_symbol', 't.description', 't.account_name', 't.notes', 't.category', 't.id']) {
			expect(body).toContain(`escapeHtml(${v}`);
		}
	});

	it('passes the attach id through jsArg', () => {
		expect(body).toContain(`onclick="attachReceipt(event,'\${jsArg(t.id)}')"`);
	});
});

describe('renderHealthCheck', () => {
	const body = fn('renderHealthCheck');

	it('escapes symbols, sources and exchange names in every card', () => {
		expect(body).toContain('escapeHtml(r.symbol)');
		expect(body).toContain('escapeHtml(ex.name)');
		expect(body.match(/escapeHtml\(r\.asset_symbol\)/g)?.length).toBeGreaterThanOrEqual(3);
		expect(body.match(/escapeHtml\(r\.source\)/g)?.length).toBe(2);
		expect(body).toContain('escapeHtml(t.asset_symbol)');
	});
});

describe.each(['openAnnotateForm', 'openDisposeForm', 'openForwardForm', 'openResultAnnotateForm'])('%s', (name) => {
	const body = fn(name);

	it('escapes the id, note and source read back from data-* attributes', () => {
		expect(body).not.toMatch(/\$\{\s*(txId|curNote|srcName|srcTin)\s*\}/);
		if (body.includes('curNote')) expect(body).toContain('value="${escapeHtml(curNote)}"');
	});

	it('passes every inline onclick string argument through jsArg', () => {
		const handlers = [...body.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
		expect(handlers.length).toBeGreaterThan(0);
		for (const h of handlers) {
			for (const arg of h.matchAll(/\$\{([^}]*)\}/g)) {
				expect(arg[1], h).toMatch(/^jsArg\(/);
			}
		}
	});
});
