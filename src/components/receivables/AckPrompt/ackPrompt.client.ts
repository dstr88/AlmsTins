/**
 * AckPrompt behavior. askToAcknowledge shows the first warning's template inside root and
 * resolves with what the person chose:
 *   [code]  go ahead, acknowledging it ("I accept responsibility", "Record it anyway");
 *   []      go ahead without acknowledging ("Register only the available ...");
 *   null    the prompt was replaced or closed first.
 * Each ask resolves once and posts nothing; the caller does the posting. The prompt stays on
 * screen until closeAck(). Text is set with textContent only.
 */
import { fillCopy } from '@/lib/receivables/fillCopy';
import { HEADROOM_BODY, HEADROOM_TAKE_AVAILABLE } from '@/lib/receivables/copy/claim';

export type AckWarning =
	| { code: 'diligence_required' }
	| { code: 'exceeds_headroom'; available: string; requested: string; claimed: string };

const waiting = new WeakMap<HTMLElement, (answer: string[] | null) => void>();

function settle(root: HTMLElement, answer: string[] | null): void {
	const done = waiting.get(root);
	waiting.delete(root);
	done?.(answer);
}

export function askToAcknowledge(root: HTMLElement, warnings: readonly AckWarning[]): Promise<string[] | null> {
	settle(root, null);
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
	root.hidden = false;
	return new Promise((resolve) => {
		waiting.set(root, resolve);
		body.querySelectorAll<HTMLButtonElement>('[data-ack-choice]').forEach((btn) => btn.addEventListener('click', () => {
			if (waiting.get(root) !== resolve) return;
			const c = btn.dataset.ackChoice!;
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
	root.querySelectorAll<HTMLButtonElement>('[data-ack-choice]').forEach((b) => { b.disabled = busy; });
}

export function closeAck(root: HTMLElement): void {
	settle(root, null);
	root.hidden = true;
	root.querySelector('[data-ack-body]')?.replaceChildren();
}
