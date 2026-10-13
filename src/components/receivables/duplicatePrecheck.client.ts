/**
 * The live duplicate check while a receivable is being entered (Addendum A, S4): once the create
 * form holds enough to compare, ask POST /api/verify/receivables/precheck whether another record at
 * Almstins matches it, and hand the answer to the page's DuplicateFlag. Logic only, no CSS.
 *
 * It warns and never holds anything up: it never touches the submit button, and saving works
 * whatever it is doing. It asks:
 *   - only after typing stops (600 ms by default), never on each keystroke;
 *   - only once the fields can be compared (precheckReady);
 *   - only for fields it has not already answered;
 * and every change cancels the request in flight, so an answer for older fields never shows.
 *
 * When the check cannot answer, the form stays quiet: a 429 waits out its Retry-After, a 503, a
 * 400 or a network error clears the flag, and the create's own answer reports the check after
 * saving. A 401 or 403 (signed out on the public registry page, or the read-only demo account)
 * stops it for the rest of the visit.
 *
 * The fields come from the form's [data-rcv-field] elements (readPrecheckFields), so the host page
 * needs markup only. They travel in a POST body, never in a URL.
 */

export const PRECHECK_URL = '/api/verify/receivables/precheck';
export const PRECHECK_DELAY_MS = 600;
const RETRY_AFTER_DEFAULT_S = 60;

/** The create form's fields, as typed (trimmed). face is the raw text of the amount field. */
export interface PrecheckFields {
	supplier: string;
	buyer: string;
	invoiceNo: string;
	face: string;
	currency: string;
	buyerRef: string;
	isTest: boolean;
}

export interface PrecheckBody {
	supplier: string;
	buyer: string;
	invoiceNo: string;
	face: number;
	currency: string;
	isTest: boolean;
	details?: { buyerRef: string };
}

/** The route's answer (200), as sent: the full answer for a verified account, the state alone otherwise. */
export interface PrecheckAnswer {
	duplicateCheck?: unknown;
	ownMatches?: unknown;
}

const positive = (face: string) => { const n = Number(face); return face !== '' && Number.isFinite(n) && n > 0; };

/**
 * Whether the fields can be compared: a debtor, a positive amount, a currency, and either the
 * client with the invoice number (the invoice key) or the debtor's reference (the reference key).
 * The invoice key needs the client too, so an invoice number alone is not asked about.
 */
export function precheckReady(f: PrecheckFields): boolean {
	return !!f.buyer && positive(f.face) && !!f.currency && ((!!f.supplier && !!f.invoiceNo) || !!f.buyerRef);
}

/** The request body. details is sent only with a reference, the way the create sends it. */
export function precheckBody(f: PrecheckFields): PrecheckBody {
	const body: PrecheckBody = {
		supplier: f.supplier, buyer: f.buyer, invoiceNo: f.invoiceNo, face: Number(f.face), currency: f.currency, isTest: f.isTest,
	};
	if (f.buyerRef) body.details = { buyerRef: f.buyerRef };
	return body;
}

type FieldEl = HTMLInputElement | HTMLSelectElement;

/**
 * The fields of a create form: the [data-rcv-field] elements inside root. "currency-other" is the
 * free-text currency the registry form shows when its select reads "__other"; "test-mode" is a
 * checkbox or the Test radio, read by .checked. Any other marked control (the desk's "Real world"
 * radio, "real-mode") is read by nothing here: it only starts a check when it changes, because a
 * radio that is unchecked by its neighbor fires no event of its own.
 */
export function readPrecheckFields(root: ParentNode): PrecheckFields {
	const el = (name: string) => root.querySelector<FieldEl>(`[data-rcv-field="${name}"]`);
	const v = (name: string) => (el(name)?.value ?? '').trim();
	const currency = v('currency') === '__other' ? v('currency-other') : v('currency');
	const test = el('test-mode') as HTMLInputElement | null;
	return {
		supplier: v('supplier'), buyer: v('buyer'), invoiceNo: v('invoiceNo'), face: v('face'),
		currency, buyerRef: v('buyerRef'), isTest: test?.checked === true,
	};
}

export interface PrecheckOptions {
	/** The form: input and change events from its [data-rcv-field] elements start a check. */
	root: HTMLElement;
	read(): PrecheckFields;
	/** The answer to show, or null to show nothing. */
	onResult(answer: PrecheckAnswer | null): void;
	/** True while the form is not taking a new invoice (the desk's recorded, locked intake): field
	 *  changes then start nothing, and the answer on screen stays. Default: never. */
	paused?: () => boolean;
	fetchImpl?: typeof fetch;
	delayMs?: number;
	now?: () => number;
}

export interface PrecheckHandle {
	/** Hold off until the next field change (the page just showed the create's own answer). */
	suspend(): void;
	/** Forget everything and wait for the next field change (the form was cleared). */
	reset(): void;
	/** Check now, without waiting for the delay (tests, and a page that wants it). */
	flush(): Promise<void>;
}

export function wirePrecheck(o: PrecheckOptions): PrecheckHandle {
	const delay = o.delayMs ?? PRECHECK_DELAY_MS;
	const now = o.now ?? (() => Date.now());
	const send = o.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inflight: AbortController | null = null;
	let seq = 0;
	/** The fields whose answer is on screen. */
	let shownKey: string | null = null;
	let stopped = false;
	let suspended = false;
	let pausedUntil = 0;

	const cancel = () => {
		if (timer !== null) { clearTimeout(timer); timer = null; }
		if (inflight) { inflight.abort(); inflight = null; }
		seq++;
	};

	async function check(): Promise<void> {
		timer = null;
		if (stopped || suspended || o.paused?.()) return;
		const fields = o.read();
		if (!precheckReady(fields)) { shownKey = null; o.onResult(null); return; }
		if (now() < pausedUntil) return;
		const body = JSON.stringify(precheckBody(fields));
		if (body === shownKey) return;
		const mine = ++seq;
		const ctl = new AbortController();
		inflight = ctl;
		let res: Response;
		let json: any = null;
		try {
			res = await send(PRECHECK_URL, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
				credentials: 'same-origin', signal: ctl.signal,
			});
			if (res.ok) json = await res.json();
		} catch {
			if (mine !== seq) return;
			inflight = null;
			shownKey = null;
			o.onResult(null);
			return;
		}
		if (mine !== seq) return;
		inflight = null;
		if (res.status === 401 || res.status === 403) { stopped = true; shownKey = null; o.onResult(null); return; }
		if (res.status === 429) {
			const after = Number(res.headers?.get?.('Retry-After'));
			pausedUntil = now() + (Number.isFinite(after) && after > 0 ? after : RETRY_AFTER_DEFAULT_S) * 1000;
		}
		if (!res.ok || !json || json.ok !== true) { shownKey = null; o.onResult(null); return; }
		shownKey = body;
		o.onResult({ duplicateCheck: json.duplicateCheck, ownMatches: json.ownMatches });
	}

	const onChange = (e: Event) => {
		const t = e.target as Element | null;
		if (!t || typeof t.closest !== 'function' || !t.closest('[data-rcv-field]')) return;
		if (o.paused?.()) return;
		suspended = false;
		cancel();
		if (stopped) return;
		timer = setTimeout(() => { void check(); }, delay);
	};
	o.root.addEventListener('input', onChange);
	o.root.addEventListener('change', onChange);

	return {
		// The page now shows another answer, so the next field change asks again even for the
		// fields that were last answered here.
		suspend() { cancel(); suspended = true; shownKey = null; },
		reset() { cancel(); suspended = false; shownKey = null; },
		flush() { if (timer !== null) clearTimeout(timer); return check(); },
	};
}
