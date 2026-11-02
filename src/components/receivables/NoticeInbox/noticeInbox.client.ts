/**
 * NoticeInbox (aging A4 / D5): fills the desk's "needs an update" card with the tenant's own
 * claims that are due-in-grace or past due, from GET /api/verify/receivables/needs-update —
 * computed on load, stored nowhere, so settling / extending / flagging a claim clears its
 * item by itself on the next load.
 *
 * Each row is a plain link that reopens the desk with that record on screen (?id= — the same
 * prefill the "Check a receivable" box uses), landing on the claim's status row with its
 * one-click Settled / Extend / Unpaid. A practice record's row keeps the TEST tag the book
 * rows use; practice records never email anyone, but his own desk still shows them.
 *
 * DOM is built with createElement/textContent; the only innerHTML writes are the allowlisted
 * pill fragment helpers. Any failure leaves the card hidden — the desk works without its
 * inbox, and the pills on each record still tell the story.
 */
import { agingPillHtml } from '../AgingPill/agingPill';
import { statusPillHtml } from '../StatusPill/statusPill';
import { formatMoney } from '@/lib/receivables/client/money';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { CHAIN_PROMISED } from '@/lib/receivables/copy/aging';
import { INBOX_OPEN_TITLE } from '@/lib/receivables/copy/notices';

const NEEDS_UPDATE_URL = '/api/verify/receivables/needs-update';

function span(cls: string, text: string): HTMLElement {
	const el = document.createElement('span');
	el.className = cls;
	el.textContent = text;
	return el;
}

function buildRow(item: Record<string, unknown>): HTMLElement {
	const row = document.createElement('a');
	row.className = 'nup__row';
	row.href = `/verify/desk?id=${encodeURIComponent(String(item.receivableId))}`;
	row.title = INBOX_OPEN_TITLE;

	const deal = document.createElement('span');
	deal.className = 'nup__deal';
	const invoice = span('nup__invoice', String(item.invoiceNo ?? ''));
	if (item.isTest === true) {
		const tag = document.createElement('span');
		tag.innerHTML = statusPillHtml({ kind: 'tag', tag: 'test' });
		invoice.append(' ', tag);
	}
	deal.append(invoice, span('nup__who', String(item.supplier ?? '')));

	const right = document.createElement('span');
	right.className = 'nup__right';
	right.append(span('nup__amount', formatMoney(Number(item.face ?? 0), String(item.currency ?? '') || 'NGN')));
	if (typeof item.promisedDate === 'string' && item.promisedDate) {
		right.append(span('nup__promised', fillCopy(CHAIN_PROMISED, { day: item.promisedDate })));
	}
	const pill = document.createElement('span');
	pill.innerHTML = agingPillHtml(item.aging);
	right.append(pill);

	row.append(deal, right);
	return row;
}

export function mountNoticeInbox(root: HTMLElement): void {
	const list = root.querySelector<HTMLElement>('[data-nup-list]');
	if (!list) return;
	void (async () => {
		try {
			const r = await fetch(NEEDS_UPDATE_URL);
			if (!r.ok) return;
			const j = await r.json();
			if (!j || j.ok !== true || !Array.isArray(j.items) || !j.items.length) return;
			const rows = j.items
				.filter((it: unknown): it is Record<string, unknown> =>
					!!it && typeof it === 'object' && typeof (it as Record<string, unknown>).receivableId === 'string')
				.map(buildRow);
			if (!rows.length) return;
			list.replaceChildren(...rows);
			root.hidden = false;
		} catch { /* stays hidden */ }
	})();
}
