/**
 * ProofDownloads: fills "Your signed records" for the record on screen. Follows the host page
 * through hostBridge.onRecordLoaded: a record opens, the list for its id is fetched from
 * GET /api/verify/receivables/proof-records (the caller's own records only) and drawn with
 * textContent; no record, the card hides. A reply for a record that is no longer on screen is
 * dropped, so a slow answer never lands under the wrong receivable. Any failure hides the card:
 * the page works without it.
 */
import { onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { PROOF_DOWNLOAD, PROOF_LIST_EMPTY } from '@/lib/receivables/copy/proofDownloads';
import { proofFileHref, proofRowDate, proofRowLabel, readProofRows, type ProofRow } from '@/lib/receivables/proofRecordView';

const LIST_URL = '/api/verify/receivables/proof-records?receivableId=';

export function renderProofRows(list: HTMLElement, rows: ProofRow[]): void {
	list.replaceChildren(...rows.map((row) => {
		const li = document.createElement('li');
		li.className = 'proof-dl__row';
		const label = document.createElement('span');
		label.className = 'proof-dl__label';
		label.textContent = proofRowLabel(row);
		const date = document.createElement('span');
		date.className = 'proof-dl__date';
		date.textContent = proofRowDate(row);
		const a = document.createElement('a');
		a.className = 'proof-dl__link';
		a.href = proofFileHref(row);
		a.setAttribute('download', '');
		a.textContent = PROOF_DOWNLOAD;
		li.append(label, date, a);
		return li;
	}));
}

export function mountProofDownloads(root: HTMLElement): void {
	const list = root.querySelector<HTMLElement>('[data-proof-list]');
	const empty = root.querySelector<HTMLElement>('[data-proof-empty]');
	if (!list || !empty) return;
	let showing: string | null = null;

	onRecordLoaded(async (rcv) => {
		const id = rcv?.id ?? null;
		showing = id;
		if (!id) { root.hidden = true; return; }
		try {
			const r = await fetch(LIST_URL + encodeURIComponent(id));
			if (showing !== id) return;
			const rows = r.ok ? readProofRows(await r.json()) : null;
			if (showing !== id) return;
			if (!rows) { root.hidden = true; return; }
			renderProofRows(list, rows);
			empty.textContent = PROOF_LIST_EMPTY;
			empty.hidden = rows.length > 0;
			root.hidden = false;
		} catch {
			if (showing === id) root.hidden = true;
		}
	});
}
