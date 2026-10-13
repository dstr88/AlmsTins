/**
 * WithdrawnNote behavior: show the notice while a withdrawn record is on screen, hide it for any
 * other record (or none). The page entry modules mount it once on its data-rcv-root element and
 * feed it every record the host announces through hostBridge (onRecordLoaded).
 *
 * The sentence comes from src/lib/receivables/withdrawn.ts and is set with textContent. The pill is
 * the StatusPill "withdrawn" tag, shown beside the record's own status pill rather than in place of
 * it, so a disputed or fully financed record still reads that way at a glance.
 */
import { statusPillHtml } from '../StatusPill/statusPill';
import { withdrawnNote, type WithdrawnView } from '@/lib/receivables/withdrawn';

export interface WithdrawnNoteHandle {
	update(rcv: WithdrawnView | null | undefined): void;
}

export function mountWithdrawnNote(root: HTMLElement): WithdrawnNoteHandle {
	const pill = root.querySelector<HTMLElement>('[data-wdn-pill]');
	const text = root.querySelector<HTMLElement>('[data-wdn-text]');
	return {
		update(rcv) {
			const sentence = withdrawnNote(rcv);
			if (!sentence) {
				root.hidden = true;
				if (text) text.textContent = '';
				return;
			}
			if (pill) pill.innerHTML = statusPillHtml({ kind: 'tag', tag: 'withdrawn' });
			if (text) text.textContent = sentence;
			root.hidden = false;
		},
	};
}
