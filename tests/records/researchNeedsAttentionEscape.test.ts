import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { escapeHtml } from '../../src/lib/escapeHtml';

/**
 * The Needs Attention list on /dashboard/research, the suggested-match modal, the action panel
 * and the help panel build innerHTML from values an attacker can shape: asset_symbol and
 * description come from on-chain data, account names and notes are typed text. Every such value
 * must go through escapeHtml, and a value inside a '...' JS string in an inline onclick must go
 * through jsArg (quotes stripped, then escaped), because the browser decodes entities before the
 * handler runs.
 *
 * Astro client scripts cannot run hermetically here, so this pins the source; jsArg itself is
 * evaluated from its source line.
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

const FUNCS = ['renderNeedsAttention', 'openMatchModal', 'renderNaActionPanel', 'openHelpPanel', 'napShowDispose'];

describe('Needs Attention render path', () => {
	it.each(FUNCS)('%s: no raw row field is interpolated', (name) => {
		// `src` is built as raw text on purpose (it round-trips through data-src) and is
		// escaped at each sink; see the next test.
		const body = fn(name).replace(/^\s*const src\s*=.*$/m, '');
		// `${t.asset_symbol}`, `${m.match_id}`, `${match.confidence_score}` …
		expect(body).not.toMatch(/\$\{\s*(t|m|r|match)\.\w+\s*(\?\?[^}]*)?\}/);
		// `' · ' + m.out_account_name`
		expect(body).not.toMatch(/\+\s*(t|m|r|match)\.\w*account_name\b/);
		// values read back from data-* attributes or passed in as arguments
		expect(body).not.toMatch(/\$\{\s*(sym|src|amt|desc|kind|label|panel\._note)\s*(\?\?[^}]*)?\}/);
	});

	it('escapes symbols, account names, notes and categories in the list', () => {
		const body = fn('renderNeedsAttention');
		for (const v of ['m.asset_symbol', 't.asset_symbol', 'r.asset_symbol', 't.notes', 't.category', 'src']) {
			expect(body).toContain(`escapeHtml(${v})`);
		}
		for (const v of ['m.out_account_name', 'm.in_account_name', 'r.out_account_name', 'r.in_account_name']) {
			expect(body).toContain(`escapeHtml(${v})`);
		}
		expect(body).toContain('data-src="${escapeHtml(src)}"');
		expect(body).toContain('<span class="tx-src-badge">${escapeHtml(src)}</span>');
	});

	it('stores the match JSON in an escaped double-quoted attribute and parses it back as is', () => {
		const body = fn('renderNeedsAttention');
		expect(body).toContain('data-match="${escapeHtml(JSON.stringify(m))}"');
		expect(body).toContain('openMatchModal(JSON.parse(raw))');
	});

	it('escapes every field in the match modal', () => {
		const body = fn('openMatchModal');
		for (const v of ['match.asset_symbol', 'match.out_account_name', 'match.in_account_name', 'match.confidence_score']) {
			expect(body).toContain(`escapeHtml(${v})`);
		}
	});

	it('passes every inline onclick string argument through jsArg', () => {
		for (const name of ['renderNeedsAttention', 'renderNaActionPanel']) {
			const handlers = [...fn(name).matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
			expect(handlers.length).toBeGreaterThan(0);
			for (const h of handlers) {
				for (const arg of h.matchAll(/'\$\{([^}]*(?:\}[^']*)?)\}'/g)) {
					expect(arg[1], h).toMatch(/^jsArg\(/);
				}
			}
		}
		expect(fn('renderNeedsAttention')).toContain("'${jsArg(t.asset_symbol)}'");
	});

	it('escapes the description and kind in the help panel', () => {
		const body = fn('openHelpPanel');
		expect(body).toContain('escapeHtml(desc)');
		expect(body).toContain('escapeHtml(kind)');
	});
});

describe('jsArg', () => {
	const line = src.match(/const jsArg = \(v: unknown\) => (.*);/);
	const jsArg = new Function('escapeHtml', `return v => ${line?.[1]}`)(escapeHtml) as (v: unknown) => string;

	it('is defined once on the page', () => {
		expect(line).not.toBeNull();
		expect(src.match(/const jsArg =/g)).toHaveLength(1);
	});

	it('cannot break out of a quoted JS string once the attribute is decoded', () => {
		const out = jsArg(`X');alert(1);//"\\<img>`);
		const decoded = out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
		expect(decoded).not.toMatch(/['"\\]/);
		expect(out).not.toMatch(/[<>]/);
	});

	it('maps null and undefined to an empty string', () => {
		expect(jsArg(null)).toBe('');
		expect(jsArg(undefined)).toBe('');
	});
});
