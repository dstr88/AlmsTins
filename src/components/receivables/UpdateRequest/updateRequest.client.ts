/**
 * UpdateRequest: fills "Ask the lender to update" for the record on screen (Part A). Follows the
 * host page through hostBridge.onRecordLoaded: a record opens, GET /api/verify/receivables/
 * update-request answers what this caller may see and do, and one row per claim is drawn with
 * textContent. A reply for a record that is no longer on screen is dropped. Any failure hides the
 * card: the page works without it.
 *
 * After a request the row shows the same line to every clicker, first or eleventh: "The lender
 * has been asked to update this record. Last asked: today, 2:14 PM." Never "email sent".
 */
import { onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { formatMoney } from '@/lib/receivables/client/money';
import { formatDateTime, formatTime } from '@/lib/format';
import { requestedLine, UPDATE_REQUEST_NOTE_MAX, type RequestDays } from '@/lib/receivables/updateRequests';
import {
	UR_ASKED,
	UR_BUTTON,
	UR_CLAIM_LABEL,
	UR_CLIENT_LINE,
	UR_CLIENT_NOTE,
	UR_ERR_DEMO,
	UR_ERR_FAILED,
	UR_ERR_NOT_OPEN,
	UR_ERR_NOTE,
	UR_ERR_RATE,
	UR_ERR_WITHDRAWN,
	UR_LEDE_CLIENT,
	UR_LEDE_LENDER,
	UR_LEDE_PUBLIC,
	UR_NOTE_HINT,
	UR_NOTE_LABEL,
	UR_NOTE_PLACEHOLDER,
	UR_SENDING,
	UR_TODAY,
	UR_YOUR_LINE,
} from '@/lib/receivables/copy/updateRequests';

const URL_BASE = '/api/verify/receivables/update-request';

export interface ClaimView {
	claimId: string;
	canAsk: boolean;
	requested: RequestDays;
	own?: boolean;
	clientRequests?: Array<{ at: string; note: string | null }>;
}
export interface RequestView {
	viewer: 'public' | 'client' | 'lender';
	claims: ClaimView[];
}

/** A stored UTC timestamp ('YYYY-MM-DD HH:MM:SS') as a Date, or null. */
export function parseStamp(ts: string): Date | null {
	const d = new Date(`${ts.replace(' ', 'T').replace(/Z?$/, 'Z')}`);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** "today, 2:14 PM" for a moment today (viewer's clock), else "Nov 26, 2026, 2:14 PM". */
export function whenText(ts: string, now: Date = new Date()): string {
	const d = parseStamp(ts);
	if (!d) return ts;
	if (d.toDateString() === now.toDateString()) return fillCopy(UR_TODAY, { time: formatTime(d, 'en') });
	return formatDateTime(d, 'en');
}

/** The honest line a clicker sees after asking. */
export function askedLine(askedAt: string, now: Date = new Date()): string {
	return fillCopy(UR_ASKED, { when: whenText(askedAt, now) });
}

export function errorLine(error: unknown): string {
	return error === 'rate_limited' ? UR_ERR_RATE
		: error === 'withdrawn' ? UR_ERR_WITHDRAWN
		: error === 'not_open' || error === 'own_claim' ? UR_ERR_NOT_OPEN
		: error === 'demo_readonly' ? UR_ERR_DEMO
		: error === 'note_too_long' ? UR_ERR_NOTE
		: UR_ERR_FAILED;
}

/** Whether a claim gets a row for this viewer: something to say or something to do. */
export function rowShows(view: RequestView, c: ClaimView): boolean {
	if (view.viewer === 'lender') return !!c.own && (c.requested.days > 0 || !!c.clientRequests?.length);
	return c.canAsk || c.requested.days > 0 || !!c.clientRequests?.length;
}

export function readView(body: unknown): RequestView | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	if (b.ok !== true || !Array.isArray(b.claims)) return null;
	const viewer = b.viewer === 'client' || b.viewer === 'lender' ? b.viewer : 'public';
	return { viewer, claims: b.claims as ClaimView[] };
}

function p(cls: string, text: string): HTMLParagraphElement {
	const el = document.createElement('p');
	el.className = cls;
	el.textContent = text;
	return el;
}

export function mountUpdateRequest(root: HTMLElement): void {
	const list = root.querySelector<HTMLElement>('[data-upd-list]');
	const lede = root.querySelector<HTMLElement>('[data-upd-lede]');
	if (!list || !lede) return;
	let showing: string | null = null;

	const draw = (rcv: any, view: RequestView) => {
		const year = new Date().getFullYear();
		const rows = view.claims.filter((c) => rowShows(view, c)).map((c) => {
			const claim = (rcv.claims || []).find((x: any) => x.id === c.claimId) ?? {};
			const li = document.createElement('li');
			li.className = 'upd-req__row';
			const label = document.createElement('span');
			label.className = 'upd-req__label';
			label.textContent = fillCopy(UR_CLAIM_LABEL, {
				financier: String(claim.financier ?? ''),
				amount: formatMoney(Number(claim.amount ?? 0), String(claim.currency || rcv.currency || '')),
				date: String(claim.date ?? '').slice(0, 10),
			});
			li.append(label);
			const line = requestedLine(c.requested, year);
			if (line) li.append(p('upd-req__line', line));
			for (const r of c.clientRequests ?? []) {
				const when = whenText(r.at);
				li.append(p('upd-req__line upd-req__line--muted', fillCopy(view.viewer === 'client' ? UR_YOUR_LINE : UR_CLIENT_LINE, { when })));
				if (r.note) li.append(p('upd-req__line', fillCopy(UR_CLIENT_NOTE, { note: r.note })));
			}
			if (c.canAsk) {
				let note: HTMLTextAreaElement | null = null;
				if (view.viewer === 'client') {
					const nl = document.createElement('label');
					nl.className = 'upd-req__note-label';
					nl.textContent = UR_NOTE_LABEL;
					note = document.createElement('textarea');
					note.className = 'upd-req__note';
					note.maxLength = UPDATE_REQUEST_NOTE_MAX;
					note.placeholder = UR_NOTE_PLACEHOLDER;
					nl.append(note);
					li.append(nl, p('upd-req__line upd-req__line--muted', UR_NOTE_HINT));
				}
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'upd-req__btn';
				btn.textContent = UR_BUTTON;
				const out = document.createElement('p');
				out.hidden = true;
				btn.addEventListener('click', async () => {
					btn.disabled = true;
					btn.textContent = UR_SENDING;
					try {
						const r = await fetch(URL_BASE, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ receivableId: rcv.id, claimId: c.claimId, note: note?.value ?? undefined }),
						});
						const j = await r.json().catch(() => ({}));
						if (j && j.ok && typeof j.askedAt === 'string') {
							out.className = 'upd-req__asked';
							out.textContent = askedLine(j.askedAt);
							if (note) note.value = '';
						} else {
							out.className = 'upd-req__error';
							out.textContent = errorLine(j?.error ?? (r.status === 429 ? 'rate_limited' : null));
						}
					} catch {
						out.className = 'upd-req__error';
						out.textContent = UR_ERR_FAILED;
					}
					out.hidden = false;
					btn.disabled = false;
					btn.textContent = UR_BUTTON;
				});
				li.append(btn, out);
			}
			return li;
		});
		if (!rows.length) { root.hidden = true; return; }
		lede.textContent = view.viewer === 'client' ? UR_LEDE_CLIENT : view.viewer === 'lender' ? UR_LEDE_LENDER : UR_LEDE_PUBLIC;
		list.replaceChildren(...rows);
		root.hidden = false;
	};

	onRecordLoaded(async (rcv) => {
		const id = rcv?.id ?? null;
		showing = id;
		if (!rcv || !id) { root.hidden = true; return; }
		try {
			const r = await fetch(`${URL_BASE}?receivableId=${encodeURIComponent(id)}`);
			if (showing !== id) return;
			const view = r.ok ? readView(await r.json()) : null;
			if (showing !== id) return;
			if (!view) { root.hidden = true; return; }
			draw(rcv, view);
		} catch {
			if (showing === id) root.hidden = true;
		}
	});
}
