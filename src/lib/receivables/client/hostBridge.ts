/**
 * The one seam between a receivables host page's inline <script> and its page entry module
 * (plan convention 2). The inline script announces what it has just put on screen; the entry
 * module listens. Nothing flows the other way.
 *
 *   emitRecordLoaded(status)  a record was just rendered (status is the lookup payload), or null
 *                             when the host cleared its record view without hiding the container.
 *   emitBookLoaded(rows)      the signed-in account's list was just rendered (non-empty).
 *
 * A listener added late is handed the last value at once, so the order of a page's <script>
 * tags never matters (Astro 5 here renders a page's scripts in reverse source order). Listener
 * errors stay with the listener: EventTarget reports them and never throws into the inline script.
 *
 * Client-safe. The registry import is type-only and erased at build time. Importing this module
 * creates one EventTarget and nothing else.
 */
import type { ReceivableStatus, ReceivableSummary } from '@/lib/receivablesRegistry';

export type LoadedRecord = ReceivableStatus | null;
export type LoadedBook = ReadonlyArray<ReceivableSummary>;

const RECORD_LOADED = 'rcv:record-loaded';
const BOOK_LOADED = 'rcv:book-loaded';

const target = new EventTarget();
let lastRecord: { value: LoadedRecord } | null = null;
let lastBook: { value: LoadedBook } | null = null;

function listen<T>(type: string, last: { value: T } | null, cb: (value: T) => void): () => void {
	const handler = (e: Event) => cb((e as CustomEvent<T>).detail);
	target.addEventListener(type, handler);
	if (last) cb(last.value);
	return () => target.removeEventListener(type, handler);
}

export function emitRecordLoaded(status: LoadedRecord): void {
	lastRecord = { value: status };
	target.dispatchEvent(new CustomEvent(RECORD_LOADED, { detail: status }));
}

export function onRecordLoaded(cb: (status: LoadedRecord) => void): () => void {
	return listen(RECORD_LOADED, lastRecord, cb);
}

export function emitBookLoaded(rows: LoadedBook): void {
	lastBook = { value: rows };
	target.dispatchEvent(new CustomEvent(BOOK_LOADED, { detail: rows }));
}

export function onBookLoaded(cb: (rows: LoadedBook) => void): () => void {
	return listen(BOOK_LOADED, lastBook, cb);
}
