/**
 * Entry module for the financing desk host page, loaded by its single
 * <script>import '@/lib/receivables/client/pages/desk';</script> line (plan convention 2).
 *
 * New desk behavior lives here, never in the host's inline script. Each widget is mounted once
 * on its data-rcv-root element (never a global ID) and follows the inline script through
 * hostBridge (onRecordLoaded, onBookLoaded).
 *
 * The claim prompt (AckPrompt) belongs to the record that raised it. When the desk opens a
 * different record, or a lookup finds nothing, the open prompt closes, so a "Record it anyway"
 * drawn with one record's figures never sits under another record's claim card.
 *
 * Withdrawn records (S2): the WithdrawnNote shows above the decision banner while one is open,
 * and "Your book" adds a "withdrawn" tag to a withdrawn row's State cell, beside its open or
 * settled. The inline renderBook redraws the table on every search and filter without announcing
 * it, so the marks are put back after each redraw.
 */
import { onBookLoaded, onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { closeAck } from '@/components/receivables/AckPrompt/ackPrompt.client';
import { mountWithdrawnNote } from '@/components/receivables/WithdrawnNote/withdrawnNote.client';
import { markDeskBook } from '@/lib/receivables/client/withdrawnRows';
import { bookWithdrawnIds } from '@/lib/receivables/withdrawn';

const claimPrompt = document.querySelector<HTMLElement>('[data-rcv-root="ack-claim"]');
let shownId: string | null | undefined;

if (claimPrompt) {
	onRecordLoaded((rcv) => {
		const id = rcv?.id ?? null;
		if (shownId !== undefined && id !== shownId) closeAck(claimPrompt);
		shownId = id;
	});
}

const withdrawnRecord = document.querySelector<HTMLElement>('[data-rcv-root="withdrawn-record"]');
if (withdrawnRecord) {
	const note = mountWithdrawnNote(withdrawnRecord);
	onRecordLoaded((rcv) => note.update(rcv));
}

const book = document.querySelector<HTMLElement>('[data-rcv-root="book"]');
if (book) {
	let withdrawn: ReadonlySet<string> = new Set();
	const mark = () => markDeskBook(book, withdrawn);
	onBookLoaded((rows) => { withdrawn = bookWithdrawnIds(rows); mark(); });
	new MutationObserver(mark).observe(book, { childList: true });
}
