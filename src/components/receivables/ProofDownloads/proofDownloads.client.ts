/**
 * ProofDownloads: fills "Your signed records" for the record on screen. Follows the host page
 * through hostBridge.onRecordLoaded: a record opens, the list for its id is fetched from
 * GET /api/verify/receivables/proof-records (the caller's own records only) and drawn with
 * textContent; no record, the card hides. A reply for a record that is no longer on screen is
 * dropped, so a slow answer never lands under the wrong receivable. Any failure hides the card:
 * the page works without it.
 *
 * Emails about each claim (email statement): fetched from GET
 * /api/verify/receivables/email-statements for the same record. Each claim the viewer may see gets
 * its summary lines in place and a Download link that makes a signed statement as of now; after a
 * download the list is fetched again so the new record shows under "Your signed records".
 */
import { onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { PROOF_DOWNLOAD, PROOF_LIST_EMPTY } from '@/lib/receivables/copy/proofDownloads';
import { proofFileHref, proofRowDate, proofRowLabel, readProofRows, type ProofRow } from '@/lib/receivables/proofRecordView';
import { readStatementView, type StatementView } from '@/lib/receivables/emailStatement';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { formatMoney } from '@/lib/format';
import { ES_CLAIM_LABEL, ES_DOWNLOAD, ES_EACH_TITLE, ES_SENT_NOTE } from '@/lib/receivables/copy/emailStatement';

const LIST_URL = '/api/verify/receivables/proof-records?receivableId=';
const STATEMENTS_URL = '/api/verify/receivables/email-statements?receivableId=';
const STATEMENT_FILE_URL = '/api/verify/receivables/email-statement-file?claimId=';

/** One claim's statement as the route sends it. */
export interface StatementRow {
	claimId: string;
	financier: string;
	amount: number;
	currency: string;
	view: StatementView;
}

/** The route's answer, field by field; rows that do not read are dropped. */
export function readStatementRows(j: unknown): StatementRow[] | null {
	if (!j || typeof j !== 'object' || (j as { ok?: unknown }).ok !== true) return null;
	const list = (j as { statements?: unknown }).statements;
	if (!Array.isArray(list)) return null;
	return list.flatMap((x): StatementRow[] => {
		if (!x || typeof x !== 'object') return [];
		const o = x as Record<string, unknown>;
		const view = readStatementView(o);
		if (!view || typeof o.claimId !== 'string' || !o.claimId) return [];
		return [{
			claimId: o.claimId,
			financier: typeof o.financier === 'string' ? o.financier : '',
			amount: typeof o.amount === 'number' ? o.amount : NaN,
			currency: typeof o.currency === 'string' ? o.currency : '',
			view,
		}];
	});
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
	const n = document.createElement(tag);
	n.className = cls;
	if (text !== undefined) n.textContent = text;
	return n;
};

export function renderStatements(list: HTMLElement, rows: StatementRow[], onDownload: () => void): void {
	list.replaceChildren(...rows.map((row) => {
		const box = el('article', 'proof-dl__stmt');
		const amount = Number.isFinite(row.amount) ? formatMoney(row.amount, row.currency) : '';
		box.append(el('p', 'proof-dl__stmt-claim', fillCopy(ES_CLAIM_LABEL, { financier: row.financier, amount }).replace(/, $/, '')));
		box.append(el('p', 'proof-dl__stmt-head', row.view.head));
		const lines = el('ul', 'proof-dl__stmt-lines');
		lines.append(...row.view.lines.map((t) => el('li', '', t)));
		box.append(lines);
		if (row.view.next) box.append(el('p', 'proof-dl__stmt-next', row.view.next));
		box.append(el('p', 'proof-dl__stmt-note', ES_SENT_NOTE));
		box.append(el('p', 'proof-dl__stmt-note', row.view.history));
		if (row.view.emails.length) {
			const each = el('details', 'proof-dl__stmt-each');
			each.append(el('summary', '', ES_EACH_TITLE));
			const ul = el('ul', '');
			ul.append(...row.view.emails.map((t) => el('li', '', t)));
			each.append(ul);
			box.append(each);
		}
		const a = el('a', 'proof-dl__link', ES_DOWNLOAD);
		a.href = STATEMENT_FILE_URL + encodeURIComponent(row.claimId);
		a.setAttribute('download', '');
		a.addEventListener('click', () => onDownload());
		box.append(a);
		return box;
	}));
}

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
	const mail = root.querySelector<HTMLElement>('[data-email-statements]');
	const mailList = root.querySelector<HTMLElement>('[data-email-statement-list]');
	if (!list || !empty) return;
	let showing: string | null = null;

	const loadStatements = async (id: string): Promise<void> => {
		if (!mail || !mailList) return;
		try {
			const r = await fetch(STATEMENTS_URL + encodeURIComponent(id));
			if (showing !== id) return;
			const rows = r.ok ? readStatementRows(await r.json()) : null;
			if (showing !== id) return;
			if (!rows || !rows.length) { mail.hidden = true; return; }
			// The download makes a new signed record: list it once the file has had time to arrive.
			renderStatements(mailList, rows, () => { setTimeout(() => { if (showing === id) void load(id); }, 2500); });
			mail.hidden = false;
		} catch {
			if (showing === id) mail.hidden = true;
		}
	};

	const load = async (id: string): Promise<void> => {
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
			return;
		}
		await loadStatements(id);
	};

	onRecordLoaded(async (rcv) => {
		const id = rcv?.id ?? null;
		showing = id;
		if (!id) { root.hidden = true; return; }
		await load(id);
	});
}
