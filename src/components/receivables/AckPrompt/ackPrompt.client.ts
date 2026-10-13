/**
 * AckPrompt behavior. askToAcknowledge shows the first warning's template inside root and
 * resolves with what the person chose:
 *   [code]  go ahead, acknowledging it ("I accept responsibility", "Record it anyway",
 *           "Record my claim anyway");
 *   []      go ahead without acknowledging ("Register only the available ...");
 *   null    the prompt was replaced or closed first, or the person chose "Not now", which also
 *           closes it and then calls opts.onDismiss.
 * Each ask resolves once and posts nothing; the caller does the posting. The prompt stays on
 * screen until closeAck(). Text is set with textContent only.
 *
 * Focus (S4). The prompt holds controls that need an answer, so it takes focus instead of being a
 * live region: when it opens, focus moves to its title ([data-ack-title], tabindex -1), which a
 * screen reader reads and from which Tab reaches its fields and buttons. When it closes while focus
 * is inside it, focus goes back to the control named by the root's data-ack-return (the page's
 * claim button), so a keyboard user is never dropped at the top of the page. A close while focus is
 * elsewhere (the desk opening another record) leaves focus where it is. setAckBusy disables the
 * focused button while the diligence answer posts, and a browser then drops focus to the page body,
 * so a prompt that held focus when it went busy also counts as holding it while focus is still on
 * the body.
 */
import { fillCopy } from '@/lib/receivables/fillCopy';
import { HEADROOM_BODY, HEADROOM_TAKE_AVAILABLE } from '@/lib/receivables/copy/claim';

export type AckWarning =
	| { code: 'diligence_required' }
	| { code: 'exceeds_headroom'; available: string; requested: string; claimed: string }
	/** S4: another record at Almstins matches; `lines` from duplicateView (claimDuplicateLines). */
	| { code: 'possible_duplicate'; lines: readonly string[] };

export interface AskOptions {
	/** Called after "Not now" has closed the prompt (the ask has answered null). */
	onDismiss?: () => void;
}

const waiting = new WeakMap<HTMLElement, (answer: string[] | null) => void>();
/** Prompts that held focus when setAckBusy disabled their buttons. */
const heldFocus = new WeakSet<HTMLElement>();

function settle(root: HTMLElement, answer: string[] | null): void {
	const done = waiting.get(root);
	waiting.delete(root);
	done?.(answer);
}

/** Whether keyboard focus is on something inside the prompt. */
function focusInside(root: HTMLElement): boolean {
	const active = root.ownerDocument?.activeElement ?? null;
	return !!active && active !== root && root.contains(active);
}

/** Whether focus is on nothing in particular: the page body, as after a focused button is disabled. */
function focusLost(root: HTMLElement): boolean {
	const d = root.ownerDocument;
	const active = d?.activeElement ?? null;
	return !active || active === d?.body || active === d?.documentElement;
}

/** The control focus goes back to when the prompt closes: the root's data-ack-return ID. */
function returnTarget(root: HTMLElement): HTMLElement | null {
	const id = root.dataset.ackReturn;
	return id ? root.ownerDocument?.getElementById(id) ?? null : null;
}

export function askToAcknowledge(root: HTMLElement, warnings: readonly AckWarning[], opts: AskOptions = {}): Promise<string[] | null> {
	settle(root, null);
	heldFocus.delete(root);
	const w = warnings[0];
	const body = root.querySelector<HTMLElement>('[data-ack-body]');
	const tpl = w ? root.querySelector<HTMLTemplateElement>(`template[data-ack-template="${w.code}"]`) : null;
	if (!body || !tpl) return Promise.resolve(null);
	body.replaceChildren(tpl.content.cloneNode(true));
	if (w.code === 'exceeds_headroom') {
		const vars = { available: w.available, requested: w.requested, claimed: w.claimed };
		body.querySelectorAll<HTMLElement>('[data-ack-slot="headroom-body"]').forEach((el) => { el.textContent = fillCopy(HEADROOM_BODY, vars); });
		body.querySelectorAll<HTMLElement>('[data-ack-slot="take-available"]').forEach((el) => { el.textContent = fillCopy(HEADROOM_TAKE_AVAILABLE, vars); });
	}
	if (w.code === 'possible_duplicate') {
		body.querySelectorAll<HTMLElement>('[data-ack-slot="duplicate-body"]').forEach((el) => { el.textContent = w.lines.join(' '); });
	}
	root.hidden = false;
	body.querySelector<HTMLElement>('[data-ack-title]')?.focus();
	return new Promise((resolve) => {
		waiting.set(root, resolve);
		body.querySelectorAll<HTMLButtonElement>('[data-ack-choice]').forEach((btn) => btn.addEventListener('click', () => {
			if (waiting.get(root) !== resolve) return;
			const c = btn.dataset.ackChoice!;
			if (c === 'dismiss') { closeAck(root); opts.onDismiss?.(); return; }
			settle(root, c === 'take_available' ? [] : [c]);
		}));
	});
}

/** The diligence prompt's fields, read after the person answered. */
export function ackInputs(root: HTMLElement): { method: string; note: string } {
	return {
		method: root.querySelector<HTMLSelectElement>('[data-ack-field="method"]')?.value ?? 'other',
		note: (root.querySelector<HTMLInputElement>('[data-ack-field="note"]')?.value ?? '').trim(),
	};
}

export function setAckBusy(root: HTMLElement, busy: boolean): void {
	if (busy && focusInside(root)) heldFocus.add(root);
	root.querySelectorAll<HTMLButtonElement>('[data-ack-choice]').forEach((b) => { b.disabled = busy; });
}

export function closeAck(root: HTMLElement): void {
	const refocus = focusInside(root) || (heldFocus.has(root) && focusLost(root));
	heldFocus.delete(root);
	settle(root, null);
	root.hidden = true;
	root.querySelector('[data-ack-body]')?.replaceChildren();
	if (refocus) returnTarget(root)?.focus({ preventScroll: true });
}
