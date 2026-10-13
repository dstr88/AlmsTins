/**
 * DuplicateFlag behavior (S4): show what a duplicate-check answer warrants in a phase (the live
 * check while the invoice is entered, the create's own answer, an opened record), or nothing.
 * The page entry modules mount it once on its data-rcv-root element and feed it answers.
 *
 * What is shown, and what each viewer may see, comes from src/lib/receivables/duplicateView.ts.
 * A possible duplicate opens with the "possible duplicate" tag (the WithdrawnNote pattern); a
 * muted note has none. Text goes in with textContent only; the tag comes from the StatusPill
 * fragment helper; each of the viewer's own matching records is a link built with createElement,
 * to the same page with ?id=, which opens that record. Showing the same view again changes nothing on the page, so the
 * live region does not repeat itself while the person keeps typing.
 */
import { statusPillHtml } from '../StatusPill/statusPill';
import {
	duplicateFlagView, type DuplicateAnswer, type DuplicateFlagView, type DuplicatePhase, type DuplicateVariant,
} from '@/lib/receivables/duplicateView';
import { OWN_MATCHES_LEAD, OWN_MATCH_WITHDRAWN } from '@/lib/receivables/copy/duplicate';

export interface DuplicateFlagHandle {
	update(answer: DuplicateAnswer | null | undefined, phase: DuplicatePhase): void;
	clear(): void;
}

export interface DuplicateFlagOptions {
	variant: DuplicateVariant;
	/** Where an own-match link goes. Default: this page with ?id=<receivable ID>. */
	hrefFor?: (id: string) => string;
}

/** "INV-42 · 1a2b3c4d…": the invoice number and the start of the receivable ID. */
const shortId = (id: string) => `${id.slice(0, 8)}…`;

export function mountDuplicateFlag(root: HTMLElement, opts: DuplicateFlagOptions): DuplicateFlagHandle {
	const panel = root.querySelector<HTMLElement>('[data-dupf-panel]');
	const pill = root.querySelector<HTMLElement>('[data-dupf-pill]');
	const body = root.querySelector<HTMLElement>('[data-dupf-body]');
	const own = root.querySelector<HTMLElement>('[data-dupf-own]');
	const ownLead = root.querySelector<HTMLElement>('[data-dupf-own-lead]');
	const ownList = root.querySelector<HTMLElement>('[data-dupf-own-list]');
	const hrefFor = opts.hrefFor ?? ((id: string) => `?id=${encodeURIComponent(id)}`);
	let shown = '';

	function clear(): void {
		shown = '';
		if (panel) panel.hidden = true;
		body?.replaceChildren();
		ownList?.replaceChildren();
	}

	function draw(view: DuplicateFlagView): void {
		if (!panel) return;
		panel.classList.toggle('dupf__panel--caution', view.tone === 'caution');
		panel.classList.toggle('dupf__panel--muted', view.tone === 'muted');
		if (pill) pill.innerHTML = statusPillHtml(view.tone === 'caution' ? { kind: 'tag', tag: 'possible_duplicate' } : null);
		if (pill) pill.hidden = view.tone !== 'caution';
		body?.replaceChildren(...view.lines.map((line) => {
			const p = document.createElement('p');
			p.className = 'dupf__line';
			p.textContent = line;
			return p;
		}));
		if (ownLead) ownLead.textContent = view.ownMatches.length ? OWN_MATCHES_LEAD : '';
		ownList?.replaceChildren(...view.ownMatches.map((m) => {
			const li = document.createElement('li');
			const a = document.createElement('a');
			a.className = 'dupf__own-link';
			a.href = hrefFor(m.id);
			a.textContent = `${m.invoiceNo} · `;
			const id = document.createElement('span');
			id.className = 'dupf__own-id';
			id.textContent = shortId(m.id);
			a.append(id);
			li.append(a);
			if (m.withdrawn) li.append(` ${OWN_MATCH_WITHDRAWN}`);
			return li;
		}));
		if (own) own.hidden = view.ownMatches.length === 0;
		panel.hidden = false;
	}

	return {
		update(answer, phase) {
			const view = duplicateFlagView(answer, phase, opts.variant);
			if (!view) { clear(); return; }
			const key = JSON.stringify(view);
			if (key === shown) return;
			shown = key;
			draw(view);
		},
		clear,
	};
}
