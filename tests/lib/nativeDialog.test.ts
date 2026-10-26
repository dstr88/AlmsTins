import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isBackdropClick, openDialog, wireDialog, wireDialogs } from '../../src/lib/nativeDialog';

/**
 * The Astro half of the modal shell (Area 6): src/lib/nativeDialog.ts on a stand-in <dialog> built
 * on Node's EventTarget (CI has no DOM), and pins on src/styles/dialog.css.
 */

const ROOT = path.resolve(__dirname, '../..');

class FakeElement extends EventTarget {
	isConnected = true;
	focused = 0;
	focus() {
		this.focused += 1;
		doc.activeElement = this;
	}
}

class FakeDialog extends FakeElement {
	open = false;
	dataset: Record<string, string> = {};
	modal = false;
	showModal() {
		this.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState: 'open' }));
		this.open = true;
		this.modal = true;
		doc.activeElement = this;
	}
	show() {
		this.dispatchEvent(Object.assign(new Event('beforetoggle'), { newState: 'open' }));
		this.open = true;
		this.modal = false;
	}
	close() {
		if (!this.open) return;
		this.open = false;
		doc.activeElement = doc.body;
		this.dispatchEvent(new Event('close'));
	}
}

const doc = {
	body: new FakeElement() as FakeElement,
	activeElement: null as FakeElement | null,
	list: [] as FakeDialog[],
	querySelectorAll(selector: string) {
		return selector === 'dialog.dialog-shell' ? this.list : [];
	},
};

function press(dialog: FakeDialog, down: EventTarget, up: EventTarget) {
	// Event.target is set by dispatch, so pin the target the helper should see.
	for (const [type, target] of [['pointerdown', down], ['click', up]] as const) {
		const e = new Event(type);
		Object.defineProperty(e, 'target', { value: target });
		dialog.dispatchEvent(e);
	}
}

beforeEach(() => {
	(globalThis as { document?: unknown }).document = doc;
	doc.activeElement = doc.body;
	doc.list = [];
});

afterEach(() => {
	delete (globalThis as { document?: unknown }).document;
});

describe('isBackdropClick', () => {
	it('is a backdrop click only when the press and the click both land on the dialog itself', () => {
		const d = {};
		const panel = {};
		expect(isBackdropClick(d, d, d)).toBe(true);
		expect(isBackdropClick(d, panel, d)).toBe(false);
		expect(isBackdropClick(d, d, panel)).toBe(false);
		expect(isBackdropClick(d, null, d)).toBe(false);
	});
});

describe('wireDialog', () => {
	it('closes on a click on the backdrop, not on one inside or one that only ends outside', () => {
		const d = new FakeDialog();
		const panel = new FakeElement();
		wireDialog(d as unknown as HTMLDialogElement);
		d.showModal();
		press(d, panel, panel);
		expect(d.open).toBe(true);
		press(d, panel, d);
		expect(d.open).toBe(true);
		press(d, d, d);
		expect(d.open).toBe(false);
	});

	it('stays open on a backdrop click when the dialog says data-dialog-backdrop="stay"', () => {
		const d = new FakeDialog();
		d.dataset.dialogBackdrop = 'stay';
		wireDialog(d as unknown as HTMLDialogElement);
		d.showModal();
		press(d, d, d);
		expect(d.open).toBe(true);
	});

	it('gives focus back to the opener when the dialog closes, opened through showModal() alone', () => {
		const opener = new FakeElement();
		const d = new FakeDialog();
		wireDialog(d as unknown as HTMLDialogElement);
		doc.activeElement = opener;
		d.showModal();
		d.close();
		expect(opener.focused).toBe(1);
		expect(doc.activeElement).toBe(opener);
	});

	it('leaves focus alone when something else already has it, or the opener is gone', () => {
		const opener = new FakeElement();
		const other = new FakeElement();
		const d = new FakeDialog();
		wireDialog(d as unknown as HTMLDialogElement);
		doc.activeElement = opener;
		d.showModal();
		d.open = false;
		doc.activeElement = other;
		d.dispatchEvent(new Event('close'));
		expect(opener.focused).toBe(0);

		doc.activeElement = opener;
		d.showModal();
		opener.isConnected = false;
		d.close();
		expect(opener.focused).toBe(0);
	});

	it('wires a dialog once, however often it is called', () => {
		const opener = new FakeElement();
		const d = new FakeDialog();
		wireDialog(d as unknown as HTMLDialogElement);
		wireDialog(d as unknown as HTMLDialogElement);
		doc.activeElement = opener;
		d.showModal();
		d.close();
		expect(opener.focused).toBe(1);
	});
});

describe('openDialog and wireDialogs', () => {
	it('openDialog remembers the opener it is given, and does nothing on an open dialog', () => {
		const button = new FakeElement();
		const d = new FakeDialog();
		doc.list = [d];
		wireDialogs();
		openDialog(d as unknown as HTMLDialogElement, button as unknown as Element);
		expect(d.open).toBe(true);
		openDialog(d as unknown as HTMLDialogElement, new FakeElement() as unknown as Element);
		d.close();
		expect(button.focused).toBe(1);
	});

	it('openDialog opens a panel without a backdrop with { modal: false }, and still gives focus back', () => {
		const button = new FakeElement();
		const d = new FakeDialog();
		wireDialog(d as unknown as HTMLDialogElement);
		openDialog(d as unknown as HTMLDialogElement, button as unknown as Element, { modal: false });
		expect(d.open).toBe(true);
		expect(d.modal).toBe(false);
		d.close();
		expect(button.focused).toBe(1);
	});
});

describe('dialog.css', () => {
	const css = readFileSync(path.join(ROOT, 'src/styles/dialog.css'), 'utf8');

	it('resets the browser look with no specificity, so page classes win', () => {
		expect(css).toMatch(/:where\(dialog\.dialog-shell\) \{[^}]*border: 0;[^}]*background: none;/);
		expect(css).toMatch(/:where\(dialog\.dialog-shell--layer\) \{[^}]*position: fixed;[^}]*inset: 0;/);
		expect(css).toMatch(/:where\(dialog\.dialog-shell--layer\)::backdrop \{\s*background: transparent;/);
	});

	it('keeps a closed dialog hidden whatever display a page class sets, and locks the page scroll', () => {
		expect(css).toMatch(/dialog\.dialog-shell:not\(\[open\]\) \{\s*display: none;/);
		expect(css).toMatch(/body:has\(dialog\.dialog-shell:modal\) \{\s*overflow: hidden;/);
	});
});
