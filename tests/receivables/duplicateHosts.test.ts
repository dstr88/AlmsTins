import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIVABLES_HOSTS, entryModule } from '../helpers/receivablesHosts';

/**
 * Source pins for the S4 duplicate UI in the three host pages. Reads files only (there is no DOM
 * test environment; the widgets themselves are tested in duplicateFlag, duplicatePrecheck and
 * duplicateView). These pin where each piece sits, that the create forms send the debtor
 * reference, and where each host announces its create answer. The once-per-root counts and the
 * inline-script budgets stay in withdrawnHosts.test.ts and componentSplit.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (r: string) => fs.readFileSync(path.join(ROOT, r), 'utf8');
const desk = () => read(RECEIVABLES_HOSTS.desk);
const registry = () => read(RECEIVABLES_HOSTS.registry);
const client = () => read(RECEIVABLES_HOSTS.client);

describe('desk', () => {
	it('the New client card is the form root; the test radio is its test-mode field, and switching back to real re-checks', () => {
		expect(desk()).toContain('<div class="card tin" data-rcv-root="create-form">');
		expect(desk()).toContain('<input type="radio" name="dealmode" value="test" data-rcv-field="test-mode" />');
		// A radio unchecked by its neighbor fires no change of its own, so the real one is marked too.
		expect(desk()).toContain('<input type="radio" name="dealmode" value="real" checked data-rcv-field="real-mode" />');
	});

	it('the intake carries the lock marker the entry module watches', () => {
		expect(desk()).toContain('<div id="n-intake" data-rcv-lock>');
		expect(read(entryModule('desk'))).toContain("form.querySelector<HTMLElement>('[data-rcv-lock]')");
		expect(read(entryModule('desk'))).toContain("attributeFilter: ['data-locked']");
		// While the recorded intake is locked, the live check starts nothing.
		expect(read(entryModule('desk'))).toContain('paused: () => !!lock?.dataset.locked,');
		// The create path sets it and the reset clears it, as before S4.
		expect(desk()).toContain("if (intakeEl) { intakeEl.dataset.locked = '1'; intakeEl.classList.add('step--done'); }");
		expect(desk()).toContain('if (intakeEl) { delete intakeEl.dataset.locked; intakeEl.classList.remove(\'step--done\'); }');
	});

	it('the debtor reference left the folded extras for the main grid, keeping its n-ref id', () => {
		const src = desk();
		const fold = /<details class="more">[\s\S]*?<\/details>/.exec(src)?.[0] ?? '';
		expect(fold).not.toContain('n-ref');
		expect(src).toMatch(/<\/select>\n\s*<\/label>\n\s*<BuyerRefField variant="desk" id="n-ref" \/>\n\s*<\/div>\n\s*\n\s*<details class="more">/);
		expect(src).toContain("buyerRef: val('n-ref') || null,");
		expect(src).toContain("['n-sup','n-buy','n-inv','n-face','n-ref',");
	});

	it('the create flag sits outside the intake and the record step, so dimming them never hides or disables it', () => {
		expect(desk()).toMatch(/<\/details>\n\s*<\/div>\n\s*<DuplicateFlag variant="desk" name="create" \/>\n\s*\n\s*<div class="sep"><\/div>/);
	});

	it('the record flag sits under the decision banner', () => {
		expect(desk()).toMatch(/<div id="verdict"><\/div>\n\s*<DuplicateFlag variant="desk" name="record" \/>/);
	});

	it('the create answer is announced as soon as it is parsed, before the ok check', () => {
		expect(desk()).toMatch(/const j = await r\.json\(\);\n\s*hostBridge\.emitCreateResult\(j\);\n\s*if \(!j\.ok\) \{ show\(out, esc\(j\.message \|\| 'Could not record that\.'\)/);
	});

	it('"Before you advance" reads the duplicate copy, not the pre-S3 claim that nothing matches', () => {
		expect(desk()).toContain("import { NOT_PROVEN_DUPLICATE_TITLE, NOT_PROVEN_DUPLICATE_DETAIL } from '@/lib/receivables/copy/duplicate';");
		expect(desk()).toContain('[NOT_PROVEN_DUPLICATE_TITLE, NOT_PROVEN_DUPLICATE_DETAIL],');
		expect(desk()).not.toContain('Nothing yet matches two records');
	});

	it('the claimed-only tag reads relation', () => {
		expect(desk()).toContain("${v.relation === 'claimant' ? ' ' + statusPillHtml({ kind: 'tag', tag: 'claimed_only' }) : ''}");
	});
});

describe('registry', () => {
	it('"Create a receivable" is the form root; the "Other" currency is read when chosen', () => {
		expect(registry()).toContain('<section class="card" data-rcv-root="create-form">');
		expect(registry()).toContain('data-rcv-field="currency-other"');
	});

	it('the debtor reference follows the invoice row, and the create sends it', () => {
		expect(registry()).toMatch(/data-rcv-field="currency-other"[^\n]*\n\s*<\/div>\n\s*<\/div>\n\s*<BuyerRefField variant="registry" id="c-buyerref" \/>/);
		expect(registry()).toContain("details: { buyerRef: val('c-buyerref') || null },");
	});

	it('the create flag sits right above the create button', () => {
		expect(registry()).toMatch(/<DuplicateFlag variant="registry" name="create" \/>\n\s*<button class="btn btn-primary btn-full" id="c-btn"/);
	});

	it('the create answer is announced once it is known not to be a sign-in prompt', () => {
		expect(registry()).toMatch(/if \(!j\) return;\n\s*hostBridge\.emitCreateResult\(j\);\n\s*if \(!j\.ok\) \{ show\(out, `<div class="note note-loss">\$\{esc\(j\.message \|\| 'Could not create the receivable\.'\)/);
	});

	it('the status line adds the possible-duplicate tag beside the record pill', () => {
		expect(registry()).toContain('${statusPillHtml(recordPill(rcv))}${statusPillHtml(duplicatePill(rcv))}');
	});

	it('"Your receivables": the claimed-only tag and the withdraw button read relation', () => {
		expect(registry()).toContain("${rc.relation === 'claimant' ? ' ' + statusPillHtml({ kind: 'tag', tag: 'claimed_only' }) : ''}");
		// Only the record's owner gets the withdraw button: a claimant, or any relation added later
		// (a tokenizer, S7), never does.
		expect(registry()).toContain("${rc.relation === 'owner' ? `<button class=\"mine-del\"");
	});
});

describe('client portal', () => {
	it('"Record a receivable" is the form root, with the practice checkbox as its test-mode field', () => {
		expect(client()).toContain('<div class="card" id="rec-card" data-rcv-root="create-form">');
		expect(client()).toContain('<input id="f-test" type="checkbox" data-rcv-field="test-mode" />');
	});

	it('the debtor reference follows the invoice number, and the create sends it', () => {
		expect(client()).toMatch(/id="f-inv"[^\n]*\n\s*<BuyerRefField variant="client" id="f-ref" \/>/);
		expect(client()).toContain("dueDate: val('f-due') || null, details: { buyerRef: val('f-ref') || null },");
	});

	it('the create flag sits above the record button; the record flag under the facts', () => {
		expect(client()).toMatch(/<DuplicateFlag variant="client" name="create" \/>\n\s*<div class="row" style="margin-top:\.85rem">\n\s*<button id="f-go">/);
		expect(client()).toMatch(/<div id="t-facts" class="facts"><\/div>\n\s*<DuplicateFlag variant="client" name="record" \/>/);
	});

	it('the create answer is announced after the 401 line; "Your receivables" is a root', () => {
		expect(client()).toMatch(/Sign in again<\/a> to record it\.', 'note-loss'\); return; \}\n\s*hostBridge\.emitCreateResult\(j\);/);
		expect(client()).toContain('<div id="mine" class="mine" data-rcv-root="mine">');
	});
});

describe('entry modules', () => {
	for (const h of ['desk', 'registry', 'client'] as const) {
		it(`${h}: mounts both flags, wires the live check on the form, and shows the create answer`, () => {
			const src = read(entryModule(h));
			for (const root of ['create-form', 'dup-create', 'dup-record']) expect(src).toContain(`[data-rcv-root="${root}"]`);
			expect(src).toContain(`mountDuplicateFlag(createFlagRoot, { variant: '${h}' })`);
			expect(src).toContain(`mountDuplicateFlag(recordFlagRoot, { variant: '${h}' })`);
			expect(src).toMatch(/wirePrecheck\(\{\s*root: form, read: \(\) => readPrecheckFields\(form\), onResult: \(a\) => flag\.update\(a, 'precheck'\)/);
			expect(src).toContain('precheck.suspend();');
			expect(src).toContain("flag.update(answer, 'created');");
			expect(src).toContain("onRecordLoaded((rcv) => flag.update(rcv, 'record'));");
			expect(src).toContain('bookDuplicateIds(rows)');
		});
	}
});

describe('the claim prompt gives focus back to the claim button (S4 review)', () => {
	const HOSTS = { desk: ['desk', 'c-go'], registry: ['registry', 'k-btn'] } as const;
	for (const [h, [variant, id]] of Object.entries(HOSTS)) {
		it(`${h}: returnFocus names its claim button, which sits right above the prompt`, () => {
			const src = h === 'desk' ? desk() : registry();
			expect(src).toContain(`<AckPrompt variant="${variant}" name="claim" returnFocus="${id}" />`);
			expect(src.split(`id="${id}"`).length - 1).toBe(1);
			expect(src.indexOf(`id="${id}"`)).toBeLessThan(src.indexOf('<AckPrompt '));
		});
	}
});
