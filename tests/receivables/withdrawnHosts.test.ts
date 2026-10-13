import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIVABLES_HOSTS, entryModule, type ReceivablesHost } from '../helpers/receivablesHosts';

/**
 * Source pins for the S2 withdrawn rendering in the host pages. Reads files only.
 *
 *   - every data-rcv-root an entry module selects appears exactly once in its host's markup,
 *     whether written there directly or rendered by a component the host places (plan convention 3);
 *   - the desk book's State cell is the row's last cell, to which src/lib/receivables/client/
 *     withdrawnRows.ts adds the "withdrawn" tag for a withdrawn row, and the row's ID button
 *     carries data-open;
 *   - the registry's withdraw button and confirmation read the S2 copy;
 *   - the client portal shows the WithdrawnNote and the settle answer's own message;
 *   - the four request-link pages answer the 'withdrawn' error with the S2 link note, on the page
 *     and after a POST, instead of advice to ask for a new link.
 * The inline-script budgets themselves stay pinned in componentSplit.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (r: string) => fs.readFileSync(path.join(ROOT, r), 'utf8');
const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).length;
const HOSTS = Object.keys(RECEIVABLES_HOSTS) as ReceivablesHost[];

/** Roots a component renders, by the tag the host writes to place it. */
const COMPONENT_ROOTS: Record<string, RegExp> = {
	'ack-claim': /<AckPrompt\b[^>]*\bname="claim"[^>]*\/>/,
	'withdrawn-record': /<WithdrawnNote\b[^>]*\/>/,
	'dup-create': /<DuplicateFlag\b[^>]*\bname="create"[^>]*\/>/,
	'dup-record': /<DuplicateFlag\b[^>]*\bname="record"[^>]*\/>/,
};

describe('entry-module roots appear exactly once in their host', () => {
	for (const h of HOSTS) {
		it(h, () => {
			const host = read(RECEIVABLES_HOSTS[h]);
			const roots = [...read(entryModule(h)).matchAll(/\[data-rcv-root="([\w-]+)"\]/g)].map((m) => m[1]);
			for (const name of roots) {
				// Markup only: an inline script's [data-rcv-root="..."] selector is not a root.
				const direct = count(host, new RegExp(`(?<!\\[)data-rcv-root="${name}"`));
				const viaComponent = COMPONENT_ROOTS[name] ? count(host, COMPONENT_ROOTS[name]) : 0;
				expect(direct + viaComponent, `${h}: ${name}`).toBe(1);
			}
		});
	}

	it('the S2 roots are the ones selected', () => {
		expect(read(entryModule('desk'))).toContain('[data-rcv-root="withdrawn-record"]');
		expect(read(entryModule('desk'))).toContain('[data-rcv-root="book"]');
		expect(read(entryModule('registry'))).toContain('[data-rcv-root="withdrawn-record"]');
		expect(read(entryModule('registry'))).toContain('[data-rcv-root="mine"]');
		expect(read(entryModule('client'))).toContain('[data-rcv-root="withdrawn-record"]');
	});

	it('WithdrawnNote renders its root, hidden until a withdrawn record loads, with a pill slot in every variant', () => {
		const src = read('src/components/receivables/WithdrawnNote/WithdrawnNote.astro');
		expect(count(src, /data-rcv-root="withdrawn-record"/)).toBe(1);
		expect(src).toMatch(/<div class=\{`wdn wdn--\$\{variant\}`\} data-rcv-root="withdrawn-record" role="status" hidden>/);
		expect(src).toMatch(/hidden>\s*<span class="wdn__pill" data-wdn-pill><\/span>\s*<span class="wdn__text" data-wdn-text><\/span>/);
		expect(src).toContain("variant: 'desk' | 'registry' | 'client'");
		expect(read('src/components/receivables/WithdrawnNote/withdrawnNote.client.ts')).toContain("statusPillHtml({ kind: 'tag', tag: 'withdrawn' })");
	});
});

describe('desk host: where the withdrawn marks land', () => {
	const desk = () => read(RECEIVABLES_HOSTS.desk);

	it('the note sits above the decision banner in the record panel', () => {
		expect(desk()).toMatch(/<div class="panel__box">\s*<WithdrawnNote variant="desk" \/>\s*<div id="verdict"><\/div>/);
	});

	it('the book root is #book-list', () => {
		expect(desk()).toContain('<div id="book-list" class="inbox" data-rcv-root="book"></div>');
	});

	it('State is the last column, and its cell is the last in each row', () => {
		const src = desk();
		expect(src).toContain('<th>Receivable ID</th><th>State</th></tr></thead>');
		expect(src).toMatch(/<td>\$\{v\.settled \? '<span class="muted">settled<\/span>' : '<span class="ok">open<\/span>'\}<\/td>\s*<\/tr>`;/);
		expect(src).toContain('<button class="idlink" data-open="${esc(id)}"');
		expect(src).toContain('<tr class="book-row');
	});
});

describe('registry host: withdraw, not delete', () => {
	const registry = () => read(RECEIVABLES_HOSTS.registry);

	it('the note sits between the check button and its answer, with the S4 duplicate flag after it', () => {
		expect(registry()).toMatch(/id="q-btn"[^\n]*\n\s*<WithdrawnNote variant="registry" \/>\n\s*<DuplicateFlag variant="registry" name="record" \/>\n\s*<div class="out" id="q-out"><\/div>/);
	});

	it('the list root is #mine-list, and rows keep data-mid and .mine-main', () => {
		const src = registry();
		expect(src).toContain('<div id="mine-list" data-rcv-root="mine"></div>');
		expect(src).toContain('<div class="mine-row" data-mid="${esc(rc.id)}">');
		expect(src).toContain('<div class="mine-main">');
	});

	it('the button and the confirmation read the S2 copy', () => {
		const src = registry();
		expect(src).toContain("import { WITHDRAW_BUTTON_TITLE, WITHDRAW_CONFIRM } from '@/lib/receivables/copy/withdrawn';");
		expect(src).toContain('title="${esc(WITHDRAW_BUTTON_TITLE)}" aria-label="${esc(WITHDRAW_BUTTON_TITLE)}"');
		expect(src).toContain('if (!confirm(WITHDRAW_CONFIRM)) return;');
		expect(src).not.toContain('This cannot be undone');
		expect(src).not.toContain('Delete this receivable');
	});
});

describe('client host: a withdrawn record never reads as live', () => {
	const client = () => read(RECEIVABLES_HOSTS.client);

	it('the note sits in "Where it stands", under the test banner', () => {
		expect(client()).toContain("import WithdrawnNote from '@/components/receivables/WithdrawnNote/WithdrawnNote.astro';");
		expect(client()).toMatch(/<div id="t-testbanner" class="testbanner">[^\n]*<\/div>\n\s*<WithdrawnNote variant="client" \/>\n\s*<div id="t-facts" class="facts"><\/div>/);
	});

	it('the entry module mounts it and follows each loaded record', () => {
		const entry = read(entryModule('client'));
		expect(entry).toContain('mountWithdrawnNote(withdrawnRecord)');
		expect(entry).toContain('onRecordLoaded((rcv) => note.update(rcv));');
	});

	it("settle shows the server's message (the 410 withdrawn answer carries one) before the bare code", () => {
		expect(client()).toContain(": 'Could not settle: ' + esc(j.message || j.error || 'unknown error'), 'note-loss');");
	});
});

describe("request-link pages: the 'withdrawn' error", () => {
	const PAGES = ['countersign', 'attest', 'authenticate', 'offer'] as const;
	const IMPORT = "import { WITHDRAWN_LINK_NOTE } from '@/lib/receivables/copy/withdrawn';";

	for (const page of PAGES) {
		it(`${page}: the page and the POST answer both read the S2 link note`, () => {
			const src = read(`src/pages/verify/${page}.astro`);
			const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? '';
			// Frontmatter: imported, and keyed in ERRORS so the page does not fall back to not_found.
			expect(fm).toContain(IMPORT);
			expect(fm).toMatch(/const ERRORS: Record<string, string> = \{[^}]*\n  withdrawn: WITHDRAWN_LINK_NOTE,\n\};/);
			expect(src).toContain('(ERRORS[req.error] ?? ERRORS.not_found)');
			// Inline script: imported, and one branch for the POST answer.
			const script = /<script>\n([\s\S]*?)<\/script>/.exec(src)?.[1] ?? '';
			expect(script).toContain(`    ${IMPORT}`);
			expect(count(script, /j\.error === 'withdrawn' \? WITHDRAWN_LINK_NOTE/)).toBe(1);
		});
	}
});
