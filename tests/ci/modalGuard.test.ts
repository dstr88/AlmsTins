import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * React dialogs use the one modal shell (Area 6). Each modal and drawer used to handle Escape,
 * focus and scrolling itself, most of them partly or not at all. This fails the day a React file
 * (.tsx) outside src/components/ui/Modal.tsx and Drawer.tsx declares a dialog of its own with
 * role="dialog" / "alertdialog" or aria-modal: use <Modal> or <Drawer> (useDialog) instead.
 *
 * Astro files are not covered yet: they move to the browser's native <dialog> one page at a time.
 *
 * ALLOWED lists files that cannot move yet, each with the reason. It is empty and only shrinks: an
 * entry whose file no longer declares a dialog fails too, so remove it then.
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
