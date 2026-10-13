/**
 * Entry module for the client portal host page, loaded by its single
 * <script>import '@/lib/receivables/client/pages/client';</script> line (plan convention 2).
 *
 * New client portal behavior lives here, never in the host's inline script. Each widget is mounted once
 * on its data-rcv-root element (never a global ID) and follows the inline script through
 * hostBridge (onRecordLoaded, onBookLoaded, onCreateResult).
 *
 * Withdrawn records (S2): a client who withdrew a record can still track it by ID while another
 * party's claim or statement keeps it on the public check. The WithdrawnNote then shows in "Where
 * it stands", so it never reads as a live record; marking it settled answers 410 withdrawn, and the
 * inline settle handler shows that answer's message.
 *
 * Possible duplicates (S4): "Record a receivable" checks its fields while they are typed and shows
 * the answer above its button, then the create's own answer. The client records his own invoice,
 * so the wording (duplicateView, client variant) allows that the match may be his financier's own
 * record of it. "Where it stands" shows the flag when another record matches.
 */
import { onCreateResult, onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { mountWithdrawnNote } from '@/components/receivables/WithdrawnNote/withdrawnNote.client';
import { mountDuplicateFlag } from '@/components/receivables/DuplicateFlag/duplicateFlag.client';
import { readPrecheckFields, wirePrecheck } from '@/components/receivables/duplicatePrecheck.client';

const withdrawnRecord = document.querySelector<HTMLElement>('[data-rcv-root="withdrawn-record"]');
if (withdrawnRecord) {
	const note = mountWithdrawnNote(withdrawnRecord);
	onRecordLoaded((rcv) => note.update(rcv));
}

const form = document.querySelector<HTMLElement>('[data-rcv-root="create-form"]');
const createFlagRoot = document.querySelector<HTMLElement>('[data-rcv-root="dup-create"]');
if (form && createFlagRoot) {
	const flag = mountDuplicateFlag(createFlagRoot, { variant: 'client' });
	const precheck = wirePrecheck({ root: form, read: () => readPrecheckFields(form), onResult: (a) => flag.update(a, 'precheck') });
	onCreateResult((answer) => {
		if (!answer || !('duplicateCheck' in answer)) return;
		precheck.suspend();
		flag.update(answer, 'created');
	});
}

const recordFlagRoot = document.querySelector<HTMLElement>('[data-rcv-root="dup-record"]');
if (recordFlagRoot) {
	const flag = mountDuplicateFlag(recordFlagRoot, { variant: 'client' });
	onRecordLoaded((rcv) => flag.update(rcv, 'record'));
}
