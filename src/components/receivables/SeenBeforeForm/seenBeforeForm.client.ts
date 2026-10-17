/**
 * SeenBeforeForm behavior (S6): post the invoice fields to POST /api/verify/receivables/check and
 * render the tiered answer (seenBeforeView) in the form's live region. The entry module mounts it
 * once on its data-rcv-root element.
 *
 * The form never decides: it shows exactly what the check returned — a 401 sign-in prompt (with the
 * link the route supplies), a 403 for the shared demo account, a 400 field problem, a 429, and a
 * 503 that is never read as "not found". A verified account sees the full answer; any other
 * signed-in account sees only whether anything was found. Text goes in with textContent only. The
 * answer warns; the person decides.
 */
import { seenBeforeView, type SeenBeforeOutcome, type SeenBeforeView } from '@/lib/receivables/seenBeforeView';
import type { SeenBeforeAnswer } from '@/lib/receivables/seenBefore';
import { SEEN_BEFORE_SIGN_IN_CTA, SEEN_BEFORE_UNAVAILABLE } from '@/lib/receivables/copy/seenBefore';

const CHECK_URL = '/api/verify/receivables/check';

const TONE_CLASS: Readonly<Record<SeenBeforeView['tone'], string>> = {
	caution: 'sbf__panel--caution',
	muted: 'sbf__panel--muted',
	info: 'sbf__panel--info',
	error: 'sbf__panel--error',
	signin: 'sbf__panel--signin',
};

function readField(form: HTMLFormElement, name: string): string {
	const el = form.elements.namedItem(name);
	return el instanceof HTMLInputElement ? el.value.trim() : '';
}

/** Build the check body and normalize the response into a SeenBeforeOutcome. */
async function runCheck(form: HTMLFormElement): Promise<SeenBeforeOutcome> {
	const faceRaw = readField(form, 'face');
	const face = Number(faceRaw);
	// face stays a JSON number; an empty or non-numeric box sends the raw text, and the API 400s.
	const invoice: Record<string, unknown> = {
		supplier: readField(form, 'supplier'),
		buyer: readField(form, 'buyer'),
		invoiceNo: readField(form, 'invoiceNo'),
		currency: readField(form, 'currency'),
		face: faceRaw !== '' && Number.isFinite(face) ? face : faceRaw,
	};
	const buyerRef = readField(form, 'buyerRef');
	if (buyerRef) invoice.buyerRef = buyerRef;

	let res: Response;
	try {
		res = await fetch(CHECK_URL, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ invoice }),
		});
	} catch {
		return { kind: 'unavailable', message: SEEN_BEFORE_UNAVAILABLE };
	}

	let body: Record<string, unknown> = {};
	try {
		const j: unknown = await res.json();
		if (j && typeof j === 'object') body = j as Record<string, unknown>;
	} catch { /* a non-JSON body leaves body = {} and falls to the status checks */ }
	const message = typeof body.message === 'string' ? body.message : '';

	if (res.status === 401) {
		return { kind: 'signin', message: message || SEEN_BEFORE_SIGN_IN_CTA, signInHref: typeof body.signIn === 'string' ? body.signIn : '/receivables/login' };
	}
	if (res.status === 403) return { kind: 'blocked', message };
	if (res.status === 429) return { kind: 'rate_limited' };
	if (res.status === 400) return { kind: 'invalid', message };
	if (res.status === 503 || !res.ok) return { kind: 'unavailable', message: message || SEEN_BEFORE_UNAVAILABLE };
	// 200: the full answer carries 'matches'; the found-only tier never does.
	if ('matches' in body) return { kind: 'full', answer: body as unknown as SeenBeforeAnswer };
	return { kind: 'found_only', found: body.found === true };
}

export function mountSeenBeforeForm(form: HTMLFormElement): void {
	const panel = form.querySelector<HTMLElement>('[data-sbf-panel]');
	const body = form.querySelector<HTMLElement>('[data-sbf-body]');
	const signin = form.querySelector<HTMLAnchorElement>('[data-sbf-signin]');
	const submit = form.querySelector<HTMLButtonElement>('[data-sbf-submit]');
	if (!panel || !body || !signin) return;

	function render(view: SeenBeforeView): void {
		if (!panel || !body || !signin) return;
		panel.classList.remove(...Object.values(TONE_CLASS));
		panel.classList.add(TONE_CLASS[view.tone]);
		body.replaceChildren(...view.lines.map((line) => {
			const p = document.createElement('p');
			p.className = 'sbf__line';
			p.textContent = line;
			return p;
		}));
		if (view.signInHref) {
			signin.href = view.signInHref;
			signin.textContent = SEEN_BEFORE_SIGN_IN_CTA;
			signin.hidden = false;
		} else {
			signin.hidden = true;
			signin.removeAttribute('href');
		}
		panel.hidden = false;
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		if (submit) submit.disabled = true;
		runCheck(form)
			.then((outcome) => render(seenBeforeView(outcome)))
			.catch(() => render(seenBeforeView({ kind: 'unavailable', message: SEEN_BEFORE_UNAVAILABLE })))
			.finally(() => { if (submit) submit.disabled = false; });
	});
}
