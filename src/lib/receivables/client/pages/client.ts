/**
 * Entry module for the client portal host page, loaded by its single
 * <script>import '@/lib/receivables/client/pages/client';</script> line (plan convention 2).
 *
 * New client portal behavior lives here, never in the host's inline script. Each widget is mounted once
 * on its data-rcv-root element (never a global ID) and follows the inline script through
 * hostBridge (onRecordLoaded, onBookLoaded).
 *
 * Withdrawn records (S2): a client who withdrew a record can still track it by ID while another
 * party's claim or statement keeps it on the public check. The WithdrawnNote then shows in "Where
 * it stands", so it never reads as a live record; marking it settled answers 410 withdrawn, and the
 * inline settle handler shows that answer's message.
 */
import { onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { mountWithdrawnNote } from '@/components/receivables/WithdrawnNote/withdrawnNote.client';

const withdrawnRecord = document.querySelector<HTMLElement>('[data-rcv-root="withdrawn-record"]');
if (withdrawnRecord) {
	const note = mountWithdrawnNote(withdrawnRecord);
	onRecordLoaded((rcv) => note.update(rcv));
}
