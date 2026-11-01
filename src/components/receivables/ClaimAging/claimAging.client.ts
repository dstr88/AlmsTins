/**
 * ClaimAging (aging A2): the status row under each claim on the financing desk — the aging pill,
 * the date the claim currently promises payment by, the dated extended/unpaid chain, and the
 * three one-click updates on the lender's own entry: Settled / Extend / Unpaid.
 *
 * The desk mounts it on the claims container and calls update(rcv) after each redraw (the
 * claimFlow pattern: the logic lives here, the page provides refresh and its money format).
 * Every claim gets a row, because the public record never says whose claim is whose; the API
 * scopes each update to the claim's own financier, so a click on someone else's entry answers
 * 404 and the row says so. Settled posts the EXISTING discharge (A0: the one-click Settled is
 * dischargeClaim — no parallel path); Extend and Unpaid post the A1 status-event routes.
 *
 * Extend enforces its mandatory structured reason client-side with the same line the API 400s
 * with, and frames the field "about the deal, not the debtor" (no debtor PII). Reasons never
 * ride the public lookup (D3): the chain renders dates and kinds from the lookup, then asks
 * /status-events for the viewer's OWN events and lays the reasons in; a 404 (another
 * financier's claim) quietly leaves the chain dates-only.
 *
 * DOM is built with createElement/textContent; the one innerHTML write is the pill fragment
 * helper. A success note survives the desk's redraw because it lives in a sibling the redraw
 * never touches; opening a different record clears it.
 */
import { agingPillHtml } from '../AgingPill/agingPill';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { EXTENSION_REASON_CODES, type ExtensionReasonCode } from '@/lib/receivables/statusEvents';
import {
	ACTION_CANCEL, ACTION_EXTEND, ACTION_SETTLED, ACTION_UNPAID,
	CHAIN_EXTENDED, CHAIN_HEADING, CHAIN_PROMISED, CHAIN_UNPAID,
	EXTEND_DATE_LABEL, EXTEND_DONE, EXTEND_GO, EXTEND_NOTE_LABEL, EXTEND_NOTE_PLACEHOLDER,
	EXTEND_REASON_LABEL, EXTEND_REASON_PICK, EXTEND_TITLE,
	EXTENSION_DATE_REQUIRED, EXTENSION_REASON_FRAME, EXTENSION_REASON_LABELS, EXTENSION_REASON_REQUIRED,
	LAPSED_NOT_COUNTED, ROW_PROMISED_DATED,
	SETTLED_BODY, SETTLED_DONE, SETTLED_GO, SETTLED_NOTE_PLACEHOLDER, SETTLED_TITLE,
	STATUS_DEMO, STATUS_FAILED, STATUS_SESSION_LEAD, STATUS_SESSION_LINK, STATUS_SESSION_TAIL, STATUS_UNREACHABLE,
	UNPAID_BODY, UNPAID_DONE, UNPAID_GO, UNPAID_NOTE_PLACEHOLDER, UNPAID_TITLE,
} from '@/lib/receivables/copy/aging';

export interface ClaimAgingHost {
	/** Re-check the open record after a successful update (the page owns that). */
	refresh(): void;
	/** Where "Sign in again" goes after a 401. */
	signInHref: string;
	/** Figures in the settled note. */
	formatAmount(n: number): string;
}

export interface ClaimAgingHandle {
	/** The record just rendered into the claims container, or null when it was cleared. */
	update(rcv: unknown): void;
}

const EXTEND_URL = '/api/verify/receivables/extend';
const UNPAID_URL = '/api/verify/receivables/unpaid';
const SETTLED_URL = '/api/verify/receivables/discharge';
const EVENTS_URL = '/api/verify/receivables/status-events';

const div = (cls: string): HTMLElement => {
	const el = document.createElement('div');
	el.className = cls;
	return el;
};
const p = (cls: string, text: string): HTMLElement => {
	const el = document.createElement('p');
	el.className = cls;
	el.textContent = text;
	return el;
};
const span = (cls: string, text: string): HTMLElement => {
	const el = document.createElement('span');
	el.className = cls;
	el.textContent = text;
	return el;
};
const button = (cls: string, label: string): HTMLButtonElement => {
	const el = document.createElement('button');
	el.type = 'button';
	el.className = cls;
	el.textContent = label;
	return el;
};
const textInput = (placeholder: string): HTMLInputElement => {
	const el = document.createElement('input');
	el.className = 'clag__input';
	el.placeholder = placeholder;
	el.maxLength = 300;
	return el;
};
const labeled = (text: string, input: HTMLElement): HTMLElement => {
	const l = document.createElement('label');
	l.className = 'clag__field';
	l.append(span('clag__field-k', text), input);
	return l;
};

export function mountClaimAging(claims: HTMLElement, host: ClaimAgingHost): ClaimAgingHandle {
	// The outcome note lives beside the claims container, not inside it, so the redraw a
	// successful refresh triggers never wipes what it just reported.
	const note = div('clag__note');
	note.hidden = true;
	claims.after(note);

	let injected: HTMLElement[] = [];
	let openSlot: HTMLElement | null = null;
	let shownId: string | null = null;
	let seq = 0;

	function say(tone: 'gain' | 'loss', parts: Array<Node | string>): void {
		note.className = `clag__note clag__note--${tone}`;
		note.replaceChildren(...parts);
		note.hidden = false;
	}
	function clearNote(): void {
		note.hidden = true;
		note.replaceChildren();
	}
	function closePanels(): void {
		if (openSlot) openSlot.replaceChildren();
		openSlot = null;
	}

	async function send(
		url: string,
		body: Record<string, unknown>,
		done: (answer: Record<string, unknown>) => string,
		controls: readonly HTMLButtonElement[],
	): Promise<void> {
		for (const b of controls) b.disabled = true;
		try {
			const r = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			let j: any = null;
			try { j = await r.json(); } catch { /* an empty body reads as the plain failure below */ }
			if (r.status === 401) {
				const a = document.createElement('a');
				a.className = 'rcv-link';
				a.href = host.signInHref;
				a.textContent = STATUS_SESSION_LINK;
				say('loss', [STATUS_SESSION_LEAD, a, STATUS_SESSION_TAIL]);
				return;
			}
			if (r.status === 403 && j && j.error === 'demo_readonly') {
				say('loss', [STATUS_DEMO]);
				return;
			}
			if (!j || j.ok !== true) {
				say('loss', [String(j && j.message ? j.message : STATUS_FAILED)]);
				return;
			}
			say('gain', [done(j)]);
			host.refresh();
		} catch {
			say('loss', [STATUS_UNREACHABLE]);
		} finally {
			for (const b of controls) b.disabled = false;
		}
	}

	/** One panel open at a time; its own error line holds the client-side enforcement. */
	function openPanel(
		slot: HTMLElement,
		title: string,
		build: (panel: HTMLElement, err: (m: string) => void, controls: HTMLButtonElement[]) => void,
	): void {
		closePanels();
		openSlot = slot;
		const panel = div('clag__panel');
		panel.append(p('clag__panel-title', title));
		const errLine = p('clag__panel-err', '');
		errLine.hidden = true;
		const controls: HTMLButtonElement[] = [];
		build(panel, (m: string) => { errLine.textContent = m; errLine.hidden = false; }, controls);
		const cancel = button('clag__btn clag__btn--ghost', ACTION_CANCEL);
		cancel.addEventListener('click', () => closePanels());
		const row = div('clag__panel-row');
		for (const c of controls) row.append(c);
		row.append(cancel);
		panel.append(errLine, row);
		slot.replaceChildren(panel);
	}

	function settledPanel(claimId: string, slot: HTMLElement): void {
		openPanel(slot, SETTLED_TITLE, (panel, _err, controls) => {
			panel.append(p('clag__panel-body', SETTLED_BODY));
			const noteIn = textInput(SETTLED_NOTE_PLACEHOLDER);
			panel.append(labeled(EXTEND_NOTE_LABEL, noteIn));
			const go = button('clag__btn', SETTLED_GO);
			go.addEventListener('click', () => {
				const reason = noteIn.value.trim();
				void send(SETTLED_URL, { claimId, ...(reason ? { reason } : {}) },
					(j) => fillCopy(SETTLED_DONE, { available: host.formatAmount(Math.max(0, Number(j.available ?? 0))) }),
					[go]);
			});
			controls.push(go);
		});
	}

	function extendPanel(claimId: string, slot: HTMLElement): void {
		openPanel(slot, EXTEND_TITLE, (panel, err, controls) => {
			const date = document.createElement('input');
			date.className = 'clag__input';
			date.type = 'date';
			const reason = document.createElement('select');
			reason.className = 'clag__input';
			const pick = document.createElement('option');
			pick.value = '';
			pick.textContent = EXTEND_REASON_PICK;
			reason.append(pick);
			for (const code of EXTENSION_REASON_CODES) {
				const o = document.createElement('option');
				o.value = code;
				o.textContent = EXTENSION_REASON_LABELS[code];
				reason.append(o);
			}
			const noteIn = textInput(EXTEND_NOTE_PLACEHOLDER);
			panel.append(
				labeled(EXTEND_DATE_LABEL, date),
				labeled(EXTEND_REASON_LABEL, reason),
				p('clag__frame', EXTENSION_REASON_FRAME),
				labeled(EXTEND_NOTE_LABEL, noteIn),
			);
			const go = button('clag__btn', EXTEND_GO);
			go.addEventListener('click', () => {
				// The API 400s without a structured reason; the panel says so before posting anything.
				if (!reason.value) { err(EXTENSION_REASON_REQUIRED); return; }
				if (!date.value) { err(EXTENSION_DATE_REQUIRED); return; }
				const reasonNote = noteIn.value.trim();
				void send(EXTEND_URL, {
					claimId, newPromisedDate: date.value, reasonCode: reason.value,
					...(reasonNote ? { reasonNote } : {}),
				}, () => EXTEND_DONE, [go]);
			});
			controls.push(go);
		});
	}

	function unpaidPanel(claimId: string, slot: HTMLElement): void {
		openPanel(slot, UNPAID_TITLE, (panel, _err, controls) => {
			panel.append(p('clag__panel-body', UNPAID_BODY));
			const noteIn = textInput(UNPAID_NOTE_PLACEHOLDER);
			panel.append(labeled(EXTEND_NOTE_LABEL, noteIn));
			const go = button('clag__btn', UNPAID_GO);
			go.addEventListener('click', () => {
				const flagNote = noteIn.value.trim();
				void send(UNPAID_URL, { claimId, ...(flagNote ? { note: flagNote } : {}) }, () => UNPAID_DONE, [go]);
			});
			controls.push(go);
		});
	}

	function buildRow(c: any, rcv: any, reasonSlots: Map<string, HTMLElement>): HTMLElement {
		const box = div('clag');
		const line = div('clag__line');
		const pill = span('clag__pill', '');
		pill.innerHTML = agingPillHtml(c.aging);
		line.append(pill);
		if (typeof c.promisedDate === 'string' && c.promisedDate) {
			line.append(span('clag__promised', fillCopy(ROW_PROMISED_DATED, { day: c.promisedDate })));
		}
		const slot = div('clag__slot');
		if (c.status === 'active') {
			const actions = div('clag__actions');
			const settled = button('clag__btn clag__btn--ghost', ACTION_SETTLED);
			settled.addEventListener('click', () => settledPanel(String(c.id), slot));
			actions.append(settled);
			// A withdrawn record takes no NEW status events (410) — discharging stays the lender's
			// remaining action there — and a settled receivable has nothing left to age.
			if (!rcv.settled && !rcv.withdrawn) {
				const extend = button('clag__btn clag__btn--ghost', ACTION_EXTEND);
				extend.addEventListener('click', () => extendPanel(String(c.id), slot));
				const unpaid = button('clag__btn clag__btn--ghost', ACTION_UNPAID);
				unpaid.addEventListener('click', () => unpaidPanel(String(c.id), slot));
				actions.append(extend, unpaid);
			}
			line.append(actions);
		}
		box.append(line);
		if (c.aging === 'lapsed') box.append(p('clag__lapsed', LAPSED_NOT_COUNTED));
		const events = Array.isArray(c.statusEvents) ? c.statusEvents : [];
		if (events.length) {
			const chain = div('clag__chain');
			chain.append(p('clag__chain-h', CHAIN_HEADING));
			const list = document.createElement('ul');
			list.className = 'clag__chain-list';
			for (const e of events) {
				const li = document.createElement('li');
				li.className = 'clag__chain-item';
				const kind = String(e?.kind) === 'unpaid' ? CHAIN_UNPAID : CHAIN_EXTENDED;
				const moved = String(e?.kind) === 'extended' && typeof e?.newPromisedDate === 'string' && e.newPromisedDate
					? ' · ' + fillCopy(CHAIN_PROMISED, { day: e.newPromisedDate })
					: '';
				li.append(
					span('clag__chain-date', String(e?.date ?? '').slice(0, 10)),
					span('clag__chain-kind', ` ${kind}${moved}`),
				);
				const reasonSlot = span('clag__chain-reason', '');
				li.append(reasonSlot);
				reasonSlots.set(`${String(c.id)}:${String(e?.id ?? '')}`, reasonSlot);
				list.append(li);
			}
			chain.append(list);
			box.append(chain);
		}
		box.append(slot);
		return box;
	}

	/** The viewer's own reasons, laid into the chain (D3's signed-in tier). Another financier's
	 *  claim answers 404 and his chain stays dates-only; a failure changes nothing. */
	async function enrich(token: number, claimIds: readonly string[], slots: Map<string, HTMLElement>): Promise<void> {
		await Promise.all(claimIds.map(async (claimId) => {
			try {
				const r = await fetch(`${EVENTS_URL}?claimId=${encodeURIComponent(claimId)}`);
				if (!r.ok) return;
				const j = await r.json();
				if (token !== seq || !j || j.ok !== true || !Array.isArray(j.events)) return;
				for (const e of j.events) {
					const slot = slots.get(`${claimId}:${String(e?.id ?? '')}`);
					if (!slot) continue;
					const code = typeof e?.reasonCode === 'string'
						&& Object.prototype.hasOwnProperty.call(EXTENSION_REASON_LABELS, e.reasonCode)
						? EXTENSION_REASON_LABELS[e.reasonCode as ExtensionReasonCode]
						: '';
					const extra = typeof e?.reasonNote === 'string' ? e.reasonNote.trim() : '';
					const parts = [code, extra].filter(Boolean);
					if (parts.length) slot.textContent = ' · ' + parts.join(' · ');
				}
			} catch { /* the chain stays dates-only; reasons are an enrichment */ }
		}));
	}

	function update(rcv: any): void {
		const token = ++seq;
		for (const el of injected) el.remove();
		injected = [];
		openSlot = null;
		const id = rcv && typeof rcv.id === 'string' ? rcv.id : null;
		if (id !== shownId) clearNote();
		shownId = id;
		if (!rcv || !Array.isArray(rcv.claims) || !rcv.claims.length) return;
		const byId = new Map<string, any>();
		for (const c of rcv.claims) if (c && typeof c.id === 'string') byId.set(c.id, c);
		const reasonSlots = new Map<string, HTMLElement>();
		const withEvents: string[] = [];
		for (const row of Array.from(claims.querySelectorAll<HTMLElement>('tr[data-claim-row]'))) {
			const c = byId.get(row.dataset.claimRow ?? '');
			if (!c) continue;
			const tr = document.createElement('tr');
			tr.className = 'clag__row';
			const td = document.createElement('td');
			td.className = 'clag__cell';
			td.colSpan = Math.max(1, Number((row as any).children?.length) || 1);
			td.append(buildRow(c, rcv, reasonSlots));
			tr.append(td);
			row.after(tr);
			injected.push(tr);
			if (Array.isArray(c.statusEvents) && c.statusEvents.length) withEvents.push(String(c.id));
		}
		if (withEvents.length) void enrich(token, withEvents, reasonSlots);
	}

	return { update };
}
