/**
 * nativeDialog: what Astro pages add to the browser's own <dialog> (Area 6). showModal() already
 * gives Escape, an inert page behind and Tab kept inside; src/styles/dialog.css gives the look
 * reset and the scroll lock. This adds the two things the browser leaves out, the same way
 * useDialog does for React:
 *
 *   - A click on the backdrop closes, unless the dialog has data-dialog-backdrop="stay". The press
 *     must also start on the backdrop, so selecting text inside and letting go outside does not
 *     close it.
 *   - Focus goes back to whatever had it before the dialog opened, if the browser did not already
 *     put it back and nothing else took it.
 *
 * Wire every dialog-shell dialog on the page once with wireDialogs(). Open with openDialog(), or
 * with dialog.showModal() in an inline script (which cannot import this): the opener is then
 * remembered through the dialog's beforetoggle event where the browser has it, and the browser's
 * own focus return covers the rest. Put a page's close cleanup on the dialog's 'close' event, so it
 * runs however the dialog closed (button, Escape or backdrop).
 *
 * Pure DOM (no framework), so an inline page script's bundled neighbor can import it cheaply.
 */

type Focusable = { focus(options?: FocusOptions): void; isConnected: boolean };

const openers = new WeakMap<HTMLDialogElement, Focusable>();
const wired = new WeakSet<HTMLDialogElement>();

function remember(dialog: HTMLDialogElement, el: Element | null) {
	if (el && el !== document.body && typeof (el as unknown as Focusable).focus === 'function') {
		openers.set(dialog, el as unknown as Focusable);
	}
}

/** Whether a click closes the dialog: both the press and the click landed on the dialog element itself. */
export function isBackdropClick(dialog: unknown, downTarget: unknown, clickTarget: unknown): boolean {
	return downTarget === dialog && clickTarget === dialog;
}

/** Opens a dialog modally and remembers the opener (default: whatever has focus now). */
export function openDialog(dialog: HTMLDialogElement, opener: Element | null = document.activeElement) {
	if (dialog.open) return;
	remember(dialog, opener);
	dialog.showModal();
}

/** Adds backdrop closing and focus return to one dialog. Safe to call twice. */
export function wireDialog(dialog: HTMLDialogElement) {
	if (wired.has(dialog)) return;
	wired.add(dialog);

	dialog.addEventListener('beforetoggle', (e) => {
		if ((e as ToggleEvent).newState === 'open' && !openers.has(dialog)) remember(dialog, document.activeElement);
	});

	dialog.addEventListener('close', () => {
		const opener = openers.get(dialog);
		openers.delete(dialog);
		const active = document.activeElement;
		if (opener?.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true });
	});

	let downTarget: EventTarget | null = null;
	dialog.addEventListener('pointerdown', (e) => {
		downTarget = e.target;
	});
	dialog.addEventListener('click', (e) => {
		const closes = dialog.dataset.dialogBackdrop !== 'stay' && isBackdropClick(dialog, downTarget, e.target);
		downTarget = null;
		if (closes) dialog.close();
	});
}

/** Wires every dialog-shell dialog under root (default the whole page). */
export function wireDialogs(root: ParentNode = document) {
	root.querySelectorAll<HTMLDialogElement>('dialog.dialog-shell').forEach(wireDialog);
}
