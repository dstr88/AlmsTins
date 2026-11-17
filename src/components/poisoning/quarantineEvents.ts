/**
 * The Addresses page has two islands, the wallet cards (WalletOverview) and the address book
 * (AddressLabels), and quarantine actions happen in both. They keep each other in step with two
 * window events instead of a page reload.
 */

import type { QuarantineEntry } from '@/lib/quarantineEntry';

const QUARANTINE = 'almstins:quarantine';
const RELEASED = 'almstins:address-released';

/** The quarantine as it now stands. */
export function emitQuarantine(list: QuarantineEntry[]): void {
	window.dispatchEvent(new CustomEvent(QUARANTINE, { detail: list }));
}

export function onQuarantine(fn: (list: QuarantineEntry[]) => void): () => void {
	const h = (e: Event) => fn((e as CustomEvent<QuarantineEntry[]>).detail);
	window.addEventListener(QUARANTINE, h);
	return () => window.removeEventListener(QUARANTINE, h);
}

/** An address released into the address book: the saved row as the API returned it. */
export function emitReleased(row: Record<string, unknown>): void {
	window.dispatchEvent(new CustomEvent(RELEASED, { detail: row }));
}

export function onReleased(fn: (row: Record<string, unknown>) => void): () => void {
	const h = (e: Event) => fn((e as CustomEvent<Record<string, unknown>>).detail);
	window.addEventListener(RELEASED, h);
	return () => window.removeEventListener(RELEASED, h);
}
