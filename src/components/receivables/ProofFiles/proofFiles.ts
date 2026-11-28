/**
 * ProofFiles: the "Proof files for your records" block, as an HTML string for the pages'
 * innerHTML builders. One row per record the signed-in account owns on the receivable on screen,
 * each with a "Download proof file" link, and a one-line hint on how to check a file without
 * almstins.com. An empty string when the viewer owns nothing here (or is not signed in), so a
 * page can drop it in unconditionally. Every interpolated value goes through escapeHtml here.
 * Rows: src/lib/receivables/proofFileView.ts. Styles: ProofFiles.css, loaded through fragments.css.
 */
import { escapeHtml } from '@/lib/escapeHtml';
import { PROOF_FILE_HOW_TO_URL, proofFileRows, type ProofFileSource } from '@/lib/receivables/proofFileView';
import { PROOF_FILE_DOWNLOAD, PROOF_FILES_HINT, PROOF_FILES_HOW, PROOF_FILES_TITLE } from '@/lib/receivables/copy/proofFile';

export function proofFilesHtml(rcv: ProofFileSource | null | undefined): string {
	const rows = proofFileRows(rcv);
	if (!rows.length) return '';
	const items = rows.map((r) => `<li class="rcv-proof__row">`
		+ `<span class="rcv-proof__what">${escapeHtml(r.label)}</span>`
		+ `<a class="rcv-proof__dl" href="${escapeHtml(r.href)}" download aria-label="${escapeHtml(`${PROOF_FILE_DOWNLOAD}: ${r.label}`)}">${escapeHtml(PROOF_FILE_DOWNLOAD)}</a>`
		+ `</li>`).join('');
	return `<div class="rcv-proof" data-rcv-proof>`
		+ `<div class="rcv-proof__title">${escapeHtml(PROOF_FILES_TITLE)}</div>`
		+ `<ul class="rcv-proof__list">${items}</ul>`
		+ `<p class="rcv-proof__hint">${escapeHtml(PROOF_FILES_HINT)} `
		+ `<a href="${escapeHtml(PROOF_FILE_HOW_TO_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(PROOF_FILES_HOW)}</a></p>`
		+ `</div>`;
}
