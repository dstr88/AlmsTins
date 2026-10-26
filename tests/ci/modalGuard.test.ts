import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dialogs use the one modal shell (Area 6). Each modal and drawer used to handle Escape, focus and
 * scrolling itself, most of them partly or not at all.
 *
 * React: this fails the day a React file (.tsx) outside src/components/ui/Modal.tsx and Drawer.tsx
 * declares a dialog of its own with role="dialog" / "alertdialog" or aria-modal: use <Modal> or
 * <Drawer> (useDialog) instead.
 *
 * Astro: a modal is the browser's own <dialog> opened with showModal() (src/styles/dialog.css,
 * src/lib/nativeDialog.ts). This fails the day an .astro file puts a dialog role or aria-modal on
 * anything but a <dialog>, or a stylesheet (.astro or .css) draws a full-screen fixed overlay
 * outside dialog.css; and it pins each page that moved.
 *
 * The ALLOWED lists name what stays, each with the reason. They only shrink: an entry whose file no
 * longer has what it allows fails too, so remove it then.
 */

const ROOT = path.resolve(__dirname, '../..');
const HOMES = new Set(['src/components/ui/Modal.tsx', 'src/components/ui/Drawer.tsx']);
const PATTERN = /role\s*[=:]\s*\{?\s*["'`](?:alert)?dialog["'`]|aria-modal|ariaModal/g;
const FIX = 'use <Modal> or <Drawer> from src/components/ui (keyboard, focus and scroll come from useDialog)';

const ALLOWED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (name.endsWith('.tsx')) out.push(p);
	}
	return out;
}

const hits = new Map<string, string[]>();
for (const file of walk(path.join(ROOT, 'src'))) {
	const rel = path.relative(ROOT, file).split(path.sep).join('/');
	if (HOMES.has(rel)) continue;
	const text = readFileSync(file, 'utf8');
	const found = [...text.matchAll(PATTERN)].map((m) => `line ${text.slice(0, m.index).split('\n').length}: ${m[0]}`);
	if (found.length) hits.set(rel, found);
}

describe('React dialogs use the one modal shell', () => {
	it('no React file outside Modal.tsx and Drawer.tsx declares its own dialog', () => {
		const strays = Object.fromEntries([...hits].filter(([f]) => !(f in ALLOWED)));
		expect(strays, FIX).toEqual({});
	});

	it('every allowlisted file still declares one, and has a reason', () => {
		for (const [file, reason] of Object.entries(ALLOWED)) {
			expect(hits.has(file), `${file} no longer declares a dialog: remove it from ALLOWED`).toBe(true);
			expect(reason.length).toBeGreaterThan(20);
		}
	});

	it('the shells are where the rule points, and get their behavior from useDialog', () => {
		for (const home of HOMES) {
			const text = readFileSync(path.join(ROOT, home), 'utf8');
			expect(text).toMatch(/role="dialog"/);
			expect(text).toMatch(/aria-modal="true"/);
			expect(text).toMatch(/useDialog\(\{ onClose, initialFocus, closeOnBackdrop \}\)/);
		}
	});

	it('the screens that had their own dialog now use the shell', () => {
		const uses: Record<string, RegExp> = {
			'src/components/dashboard/AddressDetailsModal.tsx': /<Modal\b/,
			'src/components/bookkeeping/TransactionDrawer.tsx': /<Drawer\b/,
			'src/components/bookkeeping/ReconciliationTin.tsx': /<Modal\b/,
			'src/components/WalletYearChangesModal.tsx': /<Modal\b/,
			'src/components/WalletChecker.tsx': /<Modal\b/,
		};
		for (const [file, pattern] of Object.entries(uses)) {
			expect(readFileSync(path.join(ROOT, file), 'utf8'), file).toMatch(pattern);
		}
	});

	it('the pattern still finds the dialogs it is for', () => {
		const sample = [
			'<div role="dialog" aria-label="x">',
			"<div role={'alertdialog'}>",
			'aria-modal="true"',
			"React.createElement('div', { role: 'dialog' })",
			'<Modal onClose={close} label="x">',
			'<div role="status">',
			'// a dialog box',
		];
		expect(sample.map((line) => new RegExp(PATTERN.source).test(line))).toEqual([true, true, true, true, false, false, false]);
	});
});

// ── Astro ─────────────────────────────────────────────────────────────────────

function walkExt(dir: string, exts: string[], out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) walkExt(p, exts, out);
		else if (exts.some((e) => name.endsWith(e))) out.push(p);
	}
	return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;
const ASTRO = walkExt(path.join(ROOT, 'src'), ['.astro']).map(rel);
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** The tag a match sits in starts at the last "<" before it. */
const ASTRO_ROLE = /role\s*=\s*\{?\s*["'`](?:alert)?dialog["'`]|aria-modal/g;
function strayAstroRoles(text: string): string[] {
	return [...text.matchAll(ASTRO_ROLE)]
		.filter((m) => !/^<dialog\b/.test(text.slice(text.lastIndexOf('<', m.index), m.index)))
		.map((m) => `line ${lineOf(text, m.index!)}: ${m[0]}`);
}

/** Selectors of CSS rules that pin a box over the whole viewport: position fixed and all four edges at 0. */
function fullScreenRules(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
		const body = m[2];
		if (!/position\s*:\s*fixed/.test(body)) continue;
		const zero = (prop: string) => new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*0(?:px)?\\s*(?:;|$)`).test(body);
		const full = (prop: string) => new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*100(?:%|vw|vh|dvh)\\s*(?:;|$)`).test(body);
		const edges =
			zero('inset') ||
			(zero('top') && zero('left') && ((zero('right') && zero('bottom')) || (full('width') && full('height'))));
		if (edges) out.push(m[1].trim().split('\n').pop()!.trim());
	}
	return out;
}

const ASTRO_ROLE_ALLOWED: Record<string, string> = {
	'src/components/TourEngine.astro':
		'the guided tour tooltip: the highlighted page element must sit above the dim layer (z-index), and a modal <dialog> in the top layer would cover it',
};

const OVERLAY_HOME = 'src/styles/dialog.css';
const OVERLAY_ALLOWED: Record<string, Record<string, string>> = {
	'src/styles/tour-engine.css': {
		'.te-overlay': 'the guided tour dim layer, clicks pass through; the highlighted element sits above it (see TourEngine above)',
	},
	'src/pages/verify/desk.astro': {
		'.primer': 'the first-run primer is a full page shown instead of the desk, not a modal over it',
		'#panel.show':
			'the desk result view: opened from several code paths and the embedded host bridge; not on the plan list, moves when the desk is next worked on',
	},
	'src/components/dashboard/BookkeepingTin2.css': {
		".bookkeeping-tin2[data-open='true']": 'an expanded tin card that fills a phone screen; part of the page, not a dialog',
	},
	'src/components/wallet-year-changes.css': {
		'.wallet-modal-backdrop': "the React <Modal>'s backdrop class for WalletYearChangesModal.tsx (the React guard above covers it)",
	},
	'src/styles/wallet-checker.css': {
		'.threat-modal': 'not imported anywhere (WalletCheckerPage.astro carries its own styles); delete the file in a cleanup',
	},
	'src/components/LoginPageComponent.astro': {
		'.hesitation-overlay': 'dead: the demo invite markup is gone and its script returns early; delete in a cleanup',
	},
};

/** Every page that moved to the shell, with the ids (or data- hooks) of its dialogs. */
const MOVED: Record<string, string[]> = {
	'src/components/dashboard/AddTransactionModal.astro': ['id="add-tx-modal"'],
	'src/components/LoginPageComponent.astro': ['id="session-overlay"'],
	'src/components/WalletCheckerPage.astro': ['id="modal-phishing"', 'id="modal-scam"', 'id="modal-approval"'],
	'src/layouts/Layout.astro': ['id="help-drawer"'],
	'src/components/Footer.astro': ['id="privacy-modal"', 'id="terms-modal"'],
	'src/components/faq.astro': ['id={it.id}'],
	'src/components/LoanPayoffCalculator.astro': ['data-payment-modal', 'data-penalty-modal', 'data-expiry-modal', 'data-loanvalue-modal', 'data-contract-modal'],
	'src/pages/year-summary.astro': ['id="disclaimer-modal"'],
	'src/pages/dashboard/annual-records.astro': ['id="disclaimer-modal"'],
	'src/pages/dashboard/petro-tins.astro': ['id="dt-modal"', 'id="dt-splits-modal"', 'id="dt-entry-modal"'],
	'src/pages/dashboard/research.astro': ['id="intake-wizard-overlay"', 'id="match-modal"'],
	'src/pages/dashboard/transactions.astro': ['id="screenshot-modal"'],
	'src/pages/receivables.astro': ['id={`rmodal-${i}`}'],
};

/** <dialog> elements with their own look, from before the shell (they already had the browser's behavior). */
const OWN_LOOK: Record<string, string> = {
	'src/pages/myplans.astro': 'the pattern the shell followed: dialog is the panel, ::backdrop the dim, its own click-outside script',
	'src/components/admin/MailboxWindows.astro': 'the compose window, sized and styled by mailboxWindows.client.ts',
};

/** The <dialog> tags in a file's markup (not the word in a // or <!-- --> comment). */
function dialogTags(text: string): string[] {
	return [...text.matchAll(/<dialog\b[^>]*>/g)]
		.filter((m) => {
			const lineStart = text.lastIndexOf('\n', m.index) + 1;
			const before = text.slice(lineStart, m.index);
			return !/^\s*(?:\/\/|\*|\/\*)|<!--/.test(before);
		})
		.map((m) => m[0]);
}

describe('Astro modals are native <dialog>s', () => {
	it('no .astro file puts a dialog role or aria-modal on anything but a <dialog>', () => {
		const strays = Object.fromEntries(
			ASTRO.map((f) => [f, strayAstroRoles(read(f))] as const).filter(([f, found]) => found.length && !(f in ASTRO_ROLE_ALLOWED)),
		);
		expect(strays, 'make the modal a <dialog class="dialog-shell …"> opened with showModal() (src/styles/dialog.css)').toEqual({});
	});

	it('no stylesheet draws a full-screen fixed overlay outside dialog.css', () => {
		const files = walkExt(path.join(ROOT, 'src'), ['.astro', '.css']).map(rel).filter((f) => f !== OVERLAY_HOME);
		const strays: Record<string, string[]> = {};
		for (const f of files) {
			const found = fullScreenRules(read(f)).filter((sel) => !(OVERLAY_ALLOWED[f] && sel in OVERLAY_ALLOWED[f]));
			if (found.length) strays[f] = found;
		}
		expect(strays, 'an overlay is a <dialog class="dialog-shell dialog-shell--layer …">: dialog.css places it, the page class paints it').toEqual({});
	});

	it('every allowlisted file still has what it allows, and a reason', () => {
		for (const [file, reason] of Object.entries(ASTRO_ROLE_ALLOWED)) {
			expect(strayAstroRoles(read(file)).length, `${file}: remove it from ASTRO_ROLE_ALLOWED`).toBeGreaterThan(0);
			expect(reason.length).toBeGreaterThan(20);
		}
		for (const [file, selectors] of Object.entries(OVERLAY_ALLOWED)) {
			const found = fullScreenRules(read(file));
			for (const [sel, reason] of Object.entries(selectors)) {
				expect(found, `${file} no longer draws ${sel}: remove it from OVERLAY_ALLOWED`).toContain(sel);
				expect(reason.length).toBeGreaterThan(20);
			}
		}
	});

	it('every <dialog> uses the shell, is named, and its file loads dialog.css', () => {
		for (const file of ASTRO) {
			const text = read(file);
			const tags = dialogTags(text);
			if (!tags.length || file in OWN_LOOK) continue;
			expect(text, `${file} imports the shell's stylesheet`).toMatch(/^import ['"]@\/styles\/dialog\.css['"];$/m);
			for (const tag of tags) {
				expect(tag, file).toMatch(/class="dialog-shell[ "]/);
				expect(tag, file).toMatch(/aria-labelledby=|aria-label=/);
			}
		}
		for (const [file, reason] of Object.entries(OWN_LOOK)) {
			expect(dialogTags(read(file)).length, file).toBeGreaterThan(0);
			expect(reason.length).toBeGreaterThan(20);
		}
	});

	it('the pages that had their own overlay now open a <dialog> through the shell', () => {
		for (const [file, hooks] of Object.entries(MOVED)) {
			const text = read(file);
			const tags = dialogTags(text);
			for (const hook of hooks) {
				expect(tags.filter((t) => t.includes(hook)), `${file}: ${hook}`).toHaveLength(1);
			}
			// Opened as a dialog, not by a class, hidden or display toggle.
			expect(text, file).toMatch(/openDialog\(|\.showModal\(\)/);
		}
	});

	it('pages with a bundled script wire the dialogs; inline-only pages get a bundled neighbor that does', () => {
		for (const file of ['src/pages/dashboard/petro-tins.astro', 'src/pages/dashboard/transactions.astro']) {
			expect(read(file), file).toMatch(/<script>(?:(?!<\/script>)[\s\S])*import \{ wireDialogs \} from '@\/lib\/nativeDialog';\s*wireDialogs\(\);/);
		}
	});

	it('the patterns still find what they are for', () => {
		expect(strayAstroRoles('<div class="x" role="dialog" aria-modal="true">')).toHaveLength(2);
		expect(strayAstroRoles('<dialog class="dialog-shell" role="alertdialog" aria-labelledby="t">')).toEqual([]);
		expect(strayAstroRoles('<div role="tablist">')).toEqual([]);
		expect(fullScreenRules('.a { position: fixed; inset: 0; }')).toEqual(['.a']);
		expect(fullScreenRules('.b {\n  position: fixed;\n  top: 0;\n  left: 0;\n  width: 100%;\n  height: 100%;\n}')).toEqual(['.b']);
		expect(fullScreenRules('@media (max-width: 1px) { .c { position: fixed; top: 0; right: 0; bottom: 0; left: 0 } }')).toEqual(['.c']);
		expect(fullScreenRules('.pill { position: fixed; bottom: 1.5rem; right: 1.5rem; }')).toEqual([]);
		expect(fullScreenRules('.hero { position: absolute; inset: 0; }')).toEqual([]);
		expect(dialogTags('<dialog class="x">\n// a native <dialog> here\n<!-- one <dialog> -->')).toEqual(['<dialog class="x">']);
	});
});
