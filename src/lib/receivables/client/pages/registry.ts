/**
 * Entry module for the registry host page, loaded by its single
 * <script>import '@/lib/receivables/client/pages/registry';</script> line (plan convention 2).
 *
 * New registry behavior lives here, never in the host's inline script. Each widget is mounted once
 * on its data-rcv-root element (never a global ID) and follows the inline script through
 * hostBridge (onRecordLoaded, onBookLoaded, onCreateResult).
 *
 * Withdrawn records (S2): the WithdrawnNote, with its "withdrawn" tag, shows directly above the
 * check's answer while the record on screen is one its owner withdrew. The status line's pill keeps
 * the record's own state (disputed, fully financed, ...), so the withdrawal sits beside that warning
 * rather than replacing it. "Your receivables" tags a withdrawn row. The inline loadMine announces
 * every redraw, so no observer is needed here.
 *
 * Possible duplicates (S4):
 *   - "Create a receivable" checks its fields while they are typed (duplicatePrecheck) and shows
 *     the answer in the DuplicateFlag above its button, then the create's own answer. A visitor who
 *     is not signed in gets one 401 and no further checks;
 *   - the check's answer shows the flag above it when another record matches.
 */
import { onBookLoaded, onCreateResult, onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { mountWithdrawnNote } from '@/components/receivables/WithdrawnNote/withdrawnNote.client';
import { mountDuplicateFlag } from '@/components/receivables/DuplicateFlag/duplicateFlag.client';
import { readPrecheckFields, wirePrecheck } from '@/components/receivables/duplicatePrecheck.client';
import { markRegistryMine } from '@/lib/receivables/client/withdrawnRows';
import { bookWithdrawnIds } from '@/lib/receivables/withdrawn';

const withdrawnRecord = document.querySelector<HTMLElement>('[data-rcv-root="withdrawn-record"]');
if (withdrawnRecord) {
	const note = mountWithdrawnNote(withdrawnRecord);
	onRecordLoaded((rcv) => note.update(rcv));
}

const form = document.querySelector<HTMLElement>('[data-rcv-root="create-form"]');
const createFlagRoot = document.querySelector<HTMLElement>('[data-rcv-root="dup-create"]');
if (form && createFlagRoot) {
	const flag = mountDuplicateFlag(createFlagRoot, { variant: 'registry' });
	const precheck = wirePrecheck({ root: form, read: () => readPrecheckFields(form), onResult: (a) => flag.update(a, 'precheck') });
	onCreateResult((answer) => {
		if (!answer || !('duplicateCheck' in answer)) return;
		precheck.suspend();
		flag.update(answer, 'created');
	});
}

const recordFlagRoot = document.querySelector<HTMLElement>('[data-rcv-root="dup-record"]');
if (recordFlagRoot) {
	const flag = mountDuplicateFlag(recordFlagRoot, { variant: 'registry' });
	onRecordLoaded((rcv) => flag.update(rcv, 'record'));
}

const mine = document.querySelector<HTMLElement>('[data-rcv-root="mine"]');
if (mine) onBookLoaded((rows) => markRegistryMine(mine, bookWithdrawnIds(rows)));
