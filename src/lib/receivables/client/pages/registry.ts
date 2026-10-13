/**
 * Entry module for the registry host page, loaded by its single
 * <script>import '@/lib/receivables/client/pages/registry';</script> line (plan convention 2).
 *
 * New registry behavior lives here, never in the host's inline script. Each widget is mounted once
 * on its data-rcv-root element (never a global ID) and follows the inline script through
 * hostBridge (onRecordLoaded, onBookLoaded).
 *
 * Withdrawn records (S2): the WithdrawnNote, with its "withdrawn" tag, shows directly above the
 * check's answer while the record on screen is one its owner withdrew. The status line's pill keeps
 * the record's own state (disputed, fully financed, ...), so the withdrawal sits beside that warning
 * rather than replacing it. "Your receivables" tags a withdrawn row. The inline loadMine announces
 * every redraw, so no observer is needed here.
 */
import { onBookLoaded, onRecordLoaded } from '@/lib/receivables/client/hostBridge';
import { mountWithdrawnNote } from '@/components/receivables/WithdrawnNote/withdrawnNote.client';
import { markRegistryMine } from '@/lib/receivables/client/withdrawnRows';
import { bookWithdrawnIds } from '@/lib/receivables/withdrawn';

const withdrawnRecord = document.querySelector<HTMLElement>('[data-rcv-root="withdrawn-record"]');
if (withdrawnRecord) {
	const note = mountWithdrawnNote(withdrawnRecord);
	onRecordLoaded((rcv) => note.update(rcv));
}

const mine = document.querySelector<HTMLElement>('[data-rcv-root="mine"]');
if (mine) onBookLoaded((rows) => markRegistryMine(mine, bookWithdrawnIds(rows)));
