/**
 * TransportDocField's reader: the answer a create form holds, in the shape the create route takes
 * as details.transportDoc, or null when the question is unanswered (or "It has a number" with no
 * number). The pages refuse to save on null, and the live duplicate check sends the number only.
 * Logic only, no CSS.
 */
import { normalizeTransportDoc, type TransportDocAnswer } from '@/lib/receivables/transportDoc';

export function readTransportDoc(root: ParentNode): TransportDocAnswer | null {
	const picked = root.querySelector<HTMLInputElement>('[data-rcv-field="transportDocAnswer"]:checked');
	if (!picked) return null;
	const type = root.querySelector<HTMLSelectElement>('[data-rcv-field="transportDocType"]')?.value ?? '';
	const number = root.querySelector<HTMLInputElement>('[data-rcv-field="transportDocNumber"]')?.value ?? '';
	return normalizeTransportDoc({ answer: picked.value, type, number });
}

/** Clears the answer, the type and the number (after a save, or when the form is reset). */
export function clearTransportDoc(root: ParentNode): void {
	root.querySelectorAll<HTMLInputElement>('[data-rcv-field="transportDocAnswer"]').forEach((r) => { r.checked = false; });
	const number = root.querySelector<HTMLInputElement>('[data-rcv-field="transportDocNumber"]');
	if (number) number.value = '';
	const type = root.querySelector<HTMLSelectElement>('[data-rcv-field="transportDocType"]');
	if (type) type.selectedIndex = 0;
}
