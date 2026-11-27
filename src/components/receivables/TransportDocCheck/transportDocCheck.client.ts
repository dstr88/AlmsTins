/**
 * TransportDocCheck behavior: shown only for an opened record whose transport document answer is a
 * number; sends the typed number in a POST body (never a URL) to the check route and shows a yes
 * or no. Text goes in with textContent only. Logic only, no CSS.
 */
import {
	TRANSPORT_DOC_CHECK_MATCH, TRANSPORT_DOC_CHECK_NO_MATCH, TRANSPORT_DOC_CHECK_NO_NUMBER, TRANSPORT_DOC_CHECK_UNAVAILABLE,
} from '@/lib/receivables/copy/transportDoc';
import { hasCheckableTransportDoc } from '@/lib/receivables/transportDocView';

export const TRANSPORT_DOC_CHECK_URL = '/api/verify/receivables/transport-doc-check';

/** The line for a check route answer. */
export function transportDocCheckLine(status: number, body: any): string {
	if (status === 200 && body?.ok === true) return body.match === true ? TRANSPORT_DOC_CHECK_MATCH : TRANSPORT_DOC_CHECK_NO_MATCH;
	if (body?.error === 'no_number') return TRANSPORT_DOC_CHECK_NO_NUMBER;
	return TRANSPORT_DOC_CHECK_UNAVAILABLE;
}

export interface TransportDocCheckHandle { update(rcv: { id?: unknown; details?: unknown } | null | undefined): void }

export function mountTransportDocCheck(root: HTMLElement, fetchImpl: typeof fetch = fetch): TransportDocCheckHandle {
	const input = root.querySelector<HTMLInputElement>('[data-tdc-number]');
	const go = root.querySelector<HTMLButtonElement>('[data-tdc-go]');
	const out = root.querySelector<HTMLElement>('[data-tdc-out]');
	let id = '';
	go?.addEventListener('click', async () => {
		const number = (input?.value ?? '').trim();
		if (!id || !number || !out) return;
		if (go) go.disabled = true;
		try {
			const res = await fetchImpl(TRANSPORT_DOC_CHECK_URL, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receivableId: id, number }),
			});
			out.textContent = transportDocCheckLine(res.status, await res.json().catch(() => null));
		} catch {
			out.textContent = TRANSPORT_DOC_CHECK_UNAVAILABLE;
		} finally {
			if (go) go.disabled = false;
		}
	});
	return {
		update(rcv) {
			id = typeof rcv?.id === 'string' ? rcv.id : '';
			root.hidden = !id || !hasCheckableTransportDoc(rcv?.details);
			if (input) input.value = '';
			if (out) out.textContent = '';
		},
	};
}
