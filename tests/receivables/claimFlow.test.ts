import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/components/receivables/AckPrompt/ackPrompt.client', () => ({
	askToAcknowledge: vi.fn(),
	ackInputs: vi.fn(),
	closeAck: vi.fn(),
	setAckBusy: vi.fn(),
}));
vi.mock('../../src/lib/receivables/client/anchorAfterWrite', () => ({ anchorAfterWrite: vi.fn() }));

import {
	submitClaim, type ClaimHost, type ClaimInput, type ClaimPost, type ClaimPostResult, type NoteTone,
} from '../../src/components/receivables/claimFlow.client';
import { askToAcknowledge, ackInputs, closeAck, setAckBusy, type AckWarning } from '../../src/components/receivables/AckPrompt/ackPrompt.client';
import { anchorAfterWrite } from '../../src/lib/receivables/client/anchorAfterWrite';
import { CLAIM_COPY_DESK, CLAIM_COPY_REGISTRY } from '../../src/lib/receivables/copy/claim';
import * as dupCopy from '../../src/lib/receivables/copy/duplicate';
import { ANCHOR_AFTER_WRITE } from '../../src/lib/receivables/copy/anchor';

/**
 * src/components/receivables/claimFlow.client.ts: the claim, duplicate-financing and diligence
 * chain the desk and the registry page share. AckPrompt and the timestamp request are mocked, so
 * this pins only the flow: what is posted, in what order, which note each answer leaves, and when
 * the page is asked to refresh. The desk is not refreshed on the two prompt answers (nothing was
 * written, and the prompt stays where the person is reading it).
 */

const RID = 'a'.repeat(64);
const OTHER_RID = 'b'.repeat(64);
const ROOT = { fake: 'ack-root' } as unknown as HTMLElement;
const CLAIM_URL = '/api/verify/receivables/claim';
const DILIGENCE_URL = '/api/verify/receivables/diligence-accept';

// A minimal document: notes are built from text nodes and a few elements, never from HTML.
interface FakeNode { nodeName: string; textContent: string; id: string; className: string; href: string }
const fakeDocument = {
	createTextNode: (s: string): FakeNode => ({ nodeName: '#text', textContent: s, id: '', className: '', href: '' }),
	createElement: (tag: string): FakeNode => ({ nodeName: tag.toUpperCase(), textContent: '', id: '', className: '', href: '' }),
};
/** One readable string per note part: 'text', 'b:text', 'br', 'span#id:text', 'a.cls[href]:text'. */
function describeNode(n: Node): string {
	const f = n as unknown as FakeNode;
	if (f.nodeName === '#text') return f.textContent;
	if (f.nodeName === 'BR') return 'br';
	if (f.nodeName === 'A') return `a.${f.className}[${f.href}]:${f.textContent}`;
	return `${f.nodeName.toLowerCase()}${f.id ? '#' + f.id : ''}:${f.textContent}`;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

let log: string[];
let asks: { warnings: readonly AckWarning[]; answer: (codes: string[] | null) => void; dismiss: () => void }[];

beforeEach(() => {
	log = [];
	asks = [];
	vi.stubGlobal('document', fakeDocument);
	vi.mocked(askToAcknowledge).mockReset().mockImplementation((root, warnings, opts) => {
		expect(root).toBe(ROOT);
		log.push(`ask:${warnings.map((w) => w.code).join(',')}`);
		return new Promise((resolve) => {
			// "Not now", as AckPrompt does it: close (answering null), then onDismiss.
			const dismiss = () => { log.push('closeAck'); resolve(null); opts?.onDismiss?.(); };
			asks.push({ warnings, answer: resolve, dismiss });
		});
	});
	vi.mocked(closeAck).mockReset().mockImplementation((root) => { expect(root).toBe(ROOT); log.push('closeAck'); });
	vi.mocked(setAckBusy).mockReset().mockImplementation((_root, busy) => { log.push(`ackBusy:${busy}`); });
	vi.mocked(ackInputs).mockReset().mockReturnValue({ method: 'phone', note: 'called their AP line' });
	vi.mocked(anchorAfterWrite).mockReset().mockImplementation(async () => { log.push('anchor'); return 'submitted'; });
});
afterEach(() => { vi.unstubAllGlobals(); });

type Answer = ClaimPostResult | null | Error;
/** A post that answers from a queue and records every request. */
function poster(...answers: Answer[]) {
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const post = vi.fn<ClaimPost>(async (url, body) => {
		calls.push({ url, body });
		log.push(`post:${url === CLAIM_URL ? 'claim' : url === DILIGENCE_URL ? 'diligence' : url}`);
		const a = answers.shift();
		if (a === undefined) throw new Error(`unexpected post to ${url}`);
		if (a instanceof Error) throw a;
		return a;
	});
	return { post, calls };
}

interface Notes { tone: NoteTone; parts: string[] }
/** A recording host. The amount lives in `state`, so setAmount shows up on the next read. */
function makeHost(over: Partial<ClaimHost> = {}, input: Partial<ClaimInput> = {}) {
	const notes: Notes[] = [];
	const state: ClaimInput = { receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11', ...input };
	const host: ClaimHost = {
		read: vi.fn(() => ({ ...state })),
		invalid: vi.fn(() => null),
		note: vi.fn((tone: NoteTone, nodes: Node[]) => { log.push(`note:${tone}`); notes.push({ tone, parts: nodes.map(describeNode) }); }),
		clear: vi.fn(() => { log.push('clear'); }),
		formatAmount: (n: number) => `A${n}`,
		formatHeadroom: (n: number) => `H${n}`,
		setAmount: vi.fn((v: string) => { log.push(`setAmount:${v}`); state.amount = Number(v); }),
		busy: vi.fn((on: boolean) => { log.push(`busy:${on}`); }),
		afterNotOk: vi.fn(async () => { log.push('afterNotOk'); }),
		afterSaved: vi.fn(async () => { log.push('afterSaved'); }),
		...over,
	};
	return { host, notes, state };
}

function options(page: 'desk' | 'registry', post: ClaimPost, host: ClaimHost) {
	return {
		root: ROOT,
		post,
		copy: page === 'desk' ? CLAIM_COPY_DESK : CLAIM_COPY_REGISTRY,
		anchor: { statusId: page === 'desk' ? 'k-anchor' : 'k-anchor-status', copy: ANCHOR_AFTER_WRITE[page] },
		host,
	};
}

const OK = (extra: Record<string, unknown> = {}): ClaimPostResult => ({ status: 200, body: { ok: true, claimId: 'claim-1', claimed: 700, available: 300, signed: true, ...extra } });
const OVER: ClaimPostResult = { status: 409, body: { ok: false, error: 'exceeds_headroom', message: 'over', available: 200, claimed: 800, face: 1000 } };
const DILIGENCE: ClaimPostResult = { status: 409, body: { ok: false, error: 'diligence_required', message: 'no debtor confirmation' } };
const ACCEPTED: ClaimPostResult = { status: 200, body: { ok: true } };

describe('validation', () => {
	it('invalid input: one loss note with the host message, nothing posted', async () => {
		const { post } = poster();
		const { host, notes } = makeHost({ invalid: vi.fn(() => 'Enter your firm name.') });
		await submitClaim(options('desk', post, host));
		expect(post).not.toHaveBeenCalled();
		expect(notes).toEqual([{ tone: 'loss', parts: ['Enter your firm name.'] }]);
		expect(log).toEqual(['closeAck', 'note:loss']);
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('validates what read() returned on this pass', async () => {
		const { post } = poster(OK());
		const { host } = makeHost({}, { amount: 42 });
		await submitClaim(options('registry', post, host));
		expect(host.invalid).toHaveBeenCalledWith({ receivableId: RID, financier: 'Sahel Capital', amount: 42, date: '2026-10-11' });
	});
});

describe('the claim post', () => {
	it('desk: the sending note first, then the post with the old body key order plus acceptsWarnings (S4)', async () => {
		const { post, calls } = poster(OK());
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes[0]).toEqual({ tone: 'info', parts: ['Signing and registering…'] });
		expect(log.slice(0, 5)).toEqual(['closeAck', 'note:info', 'busy:true', 'post:claim', 'busy:false']);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(CLAIM_URL);
		// No acknowledge key until the person acknowledged something.
		expect(Object.keys(calls[0].body)).toEqual(['receivableId', 'financier', 'amount', 'date', 'force', 'acceptsWarnings']);
		expect(calls[0].body).toEqual({ receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11', force: false, acceptsWarnings: true });
	});

	it('registry: no sending note', async () => {
		const { post } = poster(OK());
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		expect(notes.map((n) => n.tone)).toEqual(['gain']);
		expect(log.slice(0, 3)).toEqual(['busy:true', 'post:claim', 'busy:false']);
	});

	it('passes force through, and keeps an empty date as undefined (JSON drops it, as before)', async () => {
		const { post, calls } = poster(OK());
		const { host } = makeHost({}, { date: undefined });
		await submitClaim(options('registry', post, host), { force: true });
		expect(calls[0].body.force).toBe(true);
		expect('date' in calls[0].body).toBe(true);
		expect(calls[0].body.date).toBeUndefined();
	});

	it('a null answer (the host already said why): closes the prompt, no note, no refresh', async () => {
		const { post } = poster(null);
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		expect(notes).toEqual([]);
		expect(log).toEqual(['busy:true', 'post:claim', 'busy:false', 'closeAck']);
		expect(host.afterNotOk).not.toHaveBeenCalled();
		expect(host.afterSaved).not.toHaveBeenCalled();
	});

	it('desk 401: the session-ended note with a sign-in link, and no refresh', async () => {
		const { post } = poster({ status: 401, body: { ok: false, error: 'unauthenticated' } });
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes.at(-1)).toEqual({
			tone: 'loss',
			parts: ['Your session ended. ', 'a.rcv-link[/verify/login?next=/verify/desk]:Sign in again', ' to register the claim.'],
		});
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('desk failure: names the error code, then awaits the refresh', async () => {
		const { post } = poster({ status: 403, body: { ok: false, error: 'demo_readonly' } });
		let release!: () => void;
		const { host, notes } = makeHost({ afterNotOk: vi.fn(() => { log.push('afterNotOk'); return new Promise<void>((r) => { release = r; }); }) });
		let done = false;
		const run = submitClaim(options('desk', post, host)).then(() => { done = true; });
		await flush();
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not register that claim: demo_readonly'] });
		expect(log.slice(-3)).toEqual(['closeAck', 'note:loss', 'afterNotOk']);
		expect(done).toBe(false);
		release();
		await run;
		expect(done).toBe(true);
	});

	it('desk failure without a code says unknown error', async () => {
		const { post } = poster({ status: 500, body: { ok: false } });
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not register that claim: unknown error'] });
		expect(host.afterNotOk).toHaveBeenCalledTimes(1);
	});

	it('registry failure: the message, or the fallback', async () => {
		const { post } = poster({ body: { ok: false, error: 'not_found', message: 'No receivable with that ID.' } }, { body: { ok: false, error: 'x' } });
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		await submitClaim(options('registry', post, host));
		expect(notes).toEqual([
			{ tone: 'loss', parts: ['No receivable with that ID.'] },
			{ tone: 'loss', parts: ['Could not register the claim.'] },
		]);
	});

	it('desk: a post that throws leaves "Could not reach the registry" and releases busy', async () => {
		const { post } = poster(new TypeError('network down'));
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not reach the registry. Try again.'] });
		expect(log).toContain('busy:false');
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('registry (no unreachable copy): a post that throws rejects, busy still released', async () => {
		const { post } = poster(new TypeError('network down'));
		const { host } = makeHost();
		await expect(submitClaim(options('registry', post, host))).rejects.toThrow('network down');
		expect(log).toEqual(['busy:true', 'post:claim', 'busy:false']);
	});
});

describe('duplicate-financing warning (exceeds_headroom)', () => {
	it('hides the note and asks with the host-formatted figures, without waiting for the answer', async () => {
		const { post } = poster(OVER);
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(asks).toHaveLength(1);
		expect(asks[0].warnings).toEqual([{ code: 'exceeds_headroom', available: 'H200', requested: 'H500', claimed: 'H800' }]);
		expect(log.slice(-2)).toEqual(['clear', 'ask:exceeds_headroom']);
	});

	it('does not refresh the page on the prompt (nothing was written; the prompt stays in view)', async () => {
		const { post } = poster(OVER);
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(null);
		await flush();
		expect(host.afterNotOk).not.toHaveBeenCalled();
		expect(host.afterSaved).not.toHaveBeenCalled();
		expect(log.at(-1)).toBe('ask:exceeds_headroom');
	});

	it('"Record it anyway" resubmits with force:true', async () => {
		const { post, calls } = poster(OVER, OK());
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['exceeds_headroom']);
		await flush();
		expect(calls).toHaveLength(2);
		expect(calls[1].body).toEqual({ receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11', force: true, acceptsWarnings: true });
		expect(host.setAmount).not.toHaveBeenCalled();
		expect(host.afterSaved).toHaveBeenCalledTimes(1);
	});

	it('"Register only the available" writes the amount, then resubmits without force', async () => {
		const { post, calls } = poster(OVER, OK());
		const { host } = makeHost();
		await submitClaim(options('registry', post, host), { force: false });
		asks[0].answer([]);
		await flush();
		expect(log).toContain('setAmount:200');
		expect(log.indexOf('setAmount:200')).toBeLessThan(log.lastIndexOf('post:claim'));
		expect(calls[1].body).toEqual({ receivableId: RID, financier: 'Sahel Capital', amount: 200, date: '2026-10-11', force: false, acceptsWarnings: true });
	});

	it('a closed or replaced prompt posts nothing more', async () => {
		const { post } = poster(OVER);
		const { host } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(null);
		await flush();
		expect(post).toHaveBeenCalledTimes(1);
		expect(host.setAmount).not.toHaveBeenCalled();
	});

	it('the pass the answer starts refreshes like any other pass', async () => {
		const { post } = poster(OVER, { status: 403, body: { ok: false, error: 'demo_readonly' } });
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(host.afterNotOk).not.toHaveBeenCalled();
		asks[0].answer(['exceeds_headroom']);
		await flush();
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not register that claim: demo_readonly'] });
		expect(host.afterNotOk).toHaveBeenCalledTimes(1);
	});
});

describe('diligence prompt (diligence_required)', () => {
	it('hides the note, asks, and does not refresh the page', async () => {
		const { post } = poster(DILIGENCE);
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(asks.map((a) => a.warnings)).toEqual([[{ code: 'diligence_required' }]]);
		expect(log.slice(-2)).toEqual(['clear', 'ask:diligence_required']);
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('accepting posts the acceptance (ackInputs, the host receivable), then resubmits with the same force', async () => {
		const { post, calls } = poster(DILIGENCE, ACCEPTED, OK());
		const diligenceReceivableId = vi.fn(() => OTHER_RID);
		const { host } = makeHost({ diligenceReceivableId });
		await submitClaim(options('desk', post, host), { force: true });
		asks[0].answer(['diligence_required']);
		await flush();
		expect(calls.map((c) => c.url)).toEqual([CLAIM_URL, DILIGENCE_URL, CLAIM_URL]);
		expect(diligenceReceivableId).toHaveBeenCalledWith({ receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11' });
		expect(Object.keys(calls[1].body)).toEqual(['receivableId', 'financier', 'method', 'note']);
		expect(calls[1].body).toEqual({ receivableId: OTHER_RID, financier: 'Sahel Capital', method: 'phone', note: 'called their AP line' });
		expect(calls[2].body.force).toBe(true);
		const i = log.indexOf('post:diligence');
		expect(log.slice(i - 1, i + 2)).toEqual(['ackBusy:true', 'post:diligence', 'ackBusy:false']);
		expect(host.afterSaved).toHaveBeenCalledTimes(1);
	});

	it('without diligenceReceivableId the pass receivable is used; an empty note is sent as undefined', async () => {
		vi.mocked(ackInputs).mockReturnValue({ method: 'other', note: '' });
		const { post, calls } = poster(DILIGENCE, ACCEPTED, OK());
		const { host } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(['diligence_required']);
		await flush();
		expect(Object.keys(calls[1].body)).toEqual(['receivableId', 'financier', 'method', 'note']);
		expect(calls[1].body).toEqual({ receivableId: RID, financier: 'Sahel Capital', method: 'other', note: undefined });
		expect(calls[2].body.force).toBe(false);
	});

	it('an abandoned prompt posts nothing more', async () => {
		const { post } = poster(DILIGENCE);
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(null);
		await flush();
		expect(post).toHaveBeenCalledTimes(1);
		expect(ackInputs).not.toHaveBeenCalled();
	});

	it('desk: a failed acceptance names the code, closes the prompt, and stops', async () => {
		const { post } = poster(DILIGENCE, { status: 401, body: { ok: false, error: 'unauthenticated' } });
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['diligence_required']);
		await flush();
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not record your acceptance: unauthenticated'] });
		expect(log.slice(-2)).toEqual(['closeAck', 'note:loss']);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('desk prefers the server message; the registry shows the message or its fallback', async () => {
		const desk = poster(DILIGENCE, { body: { ok: false, error: 'x', message: 'Already accepted.' } });
		const d = makeHost();
		await submitClaim(options('desk', desk.post, d.host));
		asks[0].answer(['diligence_required']);
		await flush();
		expect(d.notes.at(-1)?.parts).toEqual(['Could not record your acceptance: Already accepted.']);

		const registry = poster(DILIGENCE, { body: { ok: false, error: 'x' } });
		const r = makeHost();
		await submitClaim(options('registry', registry.post, r.host));
		asks[1].answer(['diligence_required']);
		await flush();
		expect(r.notes.at(-1)?.parts).toEqual(['Could not record your acceptance.']);
	});

	it('a null acceptance answer closes the prompt with no note and no claim', async () => {
		const { post } = poster(DILIGENCE, null);
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(['diligence_required']);
		await flush();
		expect(notes).toEqual([]);
		expect(log.slice(-2)).toEqual(['ackBusy:false', 'closeAck']);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('desk: an acceptance post that throws says it could not reach the registry', async () => {
		const { post } = poster(DILIGENCE, new TypeError('network down'));
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['diligence_required']);
		await flush();
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: ['Could not reach the registry. Try again.'] });
		expect(log.at(-1)).toBe('ackBusy:false');
	});
});

describe('recorded', () => {
	it('desk: the gain note, then the timestamp request, then the refresh', async () => {
		const { post } = poster(OK());
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes.at(-1)).toEqual({
			tone: 'gain',
			parts: ['b:Claim registered and signed.', ' Now A700 claimed, A300 unencumbered.', 'br', 'span#k-anchor:⏳ Timestamping to Bitcoin…'],
		});
		expect(anchorAfterWrite).toHaveBeenCalledWith('claim', 'claim-1', 'k-anchor', ANCHOR_AFTER_WRITE.desk);
		expect(log.slice(-4)).toEqual(['closeAck', 'note:gain', 'anchor', 'afterSaved']);
		expect(host.afterSaved).toHaveBeenCalledWith({ receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11' });
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('desk: the title always says signed, as it did', async () => {
		const { post } = poster(OK({ signed: false }));
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(notes.at(-1)?.parts[0]).toBe('b:Claim registered and signed.');
	});

	it('registry: the title names the financier and says signed only when signed', async () => {
		const { post } = poster(OK(), OK({ signed: false }));
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		await submitClaim(options('registry', post, host));
		expect(notes.map((n) => n.parts)).toEqual([
			["b:Sahel Capital's claim registered and signed.", ' Now A700 claimed · A300 unencumbered.', 'br', 'span#k-anchor-status:⏳ Timestamping to Bitcoin…'],
			["b:Sahel Capital's claim registered.", ' Now A700 claimed · A300 unencumbered.', 'br', 'span#k-anchor-status:⏳ Timestamping to Bitcoin…'],
		]);
		expect(anchorAfterWrite).toHaveBeenLastCalledWith('claim', 'claim-1', 'k-anchor-status', ANCHOR_AFTER_WRITE.registry);
	});

	it('a negative available reads as zero; missing figures read as zero', async () => {
		const { post } = poster(OK({ available: -50 }), OK({ claimed: undefined, available: undefined }));
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		await submitClaim(options('desk', post, host));
		expect(notes.filter((n) => n.tone === 'gain').map((n) => n.parts[1])).toEqual([
			' Now A700 claimed, A0 unencumbered.',
			' Now A0 claimed, A0 unencumbered.',
		]);
	});

	it('the refresh waits for the timestamp answer', async () => {
		let answer!: () => void;
		vi.mocked(anchorAfterWrite).mockImplementation(() => new Promise((r) => { answer = () => r('submitted'); }));
		const { post } = poster(OK());
		const { host } = makeHost();
		const run = submitClaim(options('desk', post, host));
		await flush();
		expect(anchorAfterWrite).toHaveBeenCalledTimes(1);
		expect(host.afterSaved).not.toHaveBeenCalled();
		answer();
		await run;
		expect(host.afterSaved).toHaveBeenCalledTimes(1);
	});
});

// A prompt answers only for the record that raised it (review finding, S1). The desk keeps
// its claim card while another record is opened, so without this an answer drawn with record
// A's figures would post against record B, and "Record it anyway" would force it there.
describe('a prompt answered after the record changed posts nothing', () => {
	for (const page of ['desk', 'registry'] as const) {
		it(`${page}: "Record it anyway" after switching records closes the prompt without posting`, async () => {
			const { post, calls } = poster(OVER);
			const { host, state } = makeHost();
			await submitClaim(options(page, post, host));
			expect(asks).toHaveLength(1);
			state.receivableId = OTHER_RID;
			asks[0].answer(['exceeds_headroom']);
			await flush();
			expect(calls).toHaveLength(1);
			expect(log.at(-1)).toBe('closeAck');
		});

		it(`${page}: "Register only the available" after switching records closes the prompt without posting`, async () => {
			const { post, calls } = poster(OVER);
			const { host, state } = makeHost();
			await submitClaim(options(page, post, host));
			state.receivableId = OTHER_RID;
			asks[0].answer([]);
			await flush();
			expect(calls).toHaveLength(1);
			expect(host.setAmount).not.toHaveBeenCalled();
			expect(log.at(-1)).toBe('closeAck');
		});

		it(`${page}: accepting responsibility after switching records posts no acceptance and no claim`, async () => {
			const { post, calls } = poster(DILIGENCE);
			const { host, state } = makeHost();
			await submitClaim(options(page, post, host));
			state.receivableId = OTHER_RID;
			asks[0].answer(['diligence_required']);
			await flush();
			expect(calls.map((c) => c.url)).toEqual([CLAIM_URL]);
			expect(log.at(-1)).toBe('closeAck');
		});

		it(`${page}: a record switch while the acceptance is being saved stops the claim re-run`, async () => {
			const { post, calls } = poster(DILIGENCE, ACCEPTED);
			const { host, state } = makeHost();
			post.mockImplementationOnce(async (url, body) => { calls.push({ url, body }); return DILIGENCE; });
			post.mockImplementationOnce(async (url, body) => { calls.push({ url, body }); state.receivableId = OTHER_RID; return ACCEPTED; });
			await submitClaim(options(page, post, host));
			asks[0].answer(['diligence_required']);
			await flush();
			await flush();
			expect(calls.map((c) => c.url)).toEqual([CLAIM_URL, DILIGENCE_URL]);
			expect(calls[1].body.receivableId).toBe(RID);
			expect(log.at(-1)).toBe('closeAck');
		});

		it(`${page}: the same record still re-runs the claim after "Record it anyway"`, async () => {
			const { post, calls } = poster(OVER, OK());
			const { host } = makeHost();
			await submitClaim(options(page, post, host));
			asks[0].answer(['exceeds_headroom']);
			await flush();
			await flush();
			expect(calls).toHaveLength(2);
			expect(calls[1].body).toMatchObject({ receivableId: RID, force: true });
		});
	}
});

// S2: a receivable its owner withdrew answers 410 withdrawn. The flow says so plainly, never as a
// prompt, and refreshes the page so the record shows as withdrawn.
describe('a withdrawn receivable (S2)', () => {
	const WITHDRAWN: ClaimPostResult = {
		status: 410,
		body: { ok: false, error: 'withdrawn', message: 'This receivable was withdrawn on 2026-10-12 by whoever recorded it.', withdrawnAt: '2026-10-12 09:30:00' },
	};
	const NOTE = 'This receivable was withdrawn by whoever recorded it, so your claim was not recorded. Claims and statements already on it stay on file.';

	for (const page of ['desk', 'registry'] as const) {
		it(`${page}: the claim answers withdrawn: the note, no prompt, then the refresh`, async () => {
			const { post } = poster(WITHDRAWN);
			const { host, notes } = makeHost();
			await submitClaim(options(page, post, host));
			expect(notes.at(-1)).toEqual({ tone: 'loss', parts: [NOTE] });
			expect(askToAcknowledge).not.toHaveBeenCalled();
			expect(log.slice(-3)).toEqual(['closeAck', 'note:loss', 'afterNotOk']);
			expect(host.afterNotOk).toHaveBeenCalledTimes(1);
			expect(anchorAfterWrite).not.toHaveBeenCalled();
			expect(host.afterSaved).not.toHaveBeenCalled();
		});

		it(`${page}: withdrawn while the diligence prompt was open: the note, no claim re-run, then the refresh`, async () => {
			const { post, calls } = poster(DILIGENCE, WITHDRAWN);
			const { host, notes } = makeHost();
			await submitClaim(options(page, post, host));
			asks[0].answer(['diligence_required']);
			await flush();
			await flush();
			expect(calls.map((c) => c.url)).toEqual([CLAIM_URL, DILIGENCE_URL]);
			expect(notes.at(-1)).toEqual({ tone: 'loss', parts: [NOTE] });
			expect(log.slice(-3)).toEqual(['closeAck', 'note:loss', 'afterNotOk']);
			expect(host.afterNotOk).toHaveBeenCalledTimes(1);
		});
	}

	it('the refresh is awaited', async () => {
		const { post } = poster(WITHDRAWN);
		let release!: () => void;
		const { host } = makeHost({ afterNotOk: vi.fn(() => new Promise<void>((r) => { release = r; })) });
		let done = false;
		const run = submitClaim(options('desk', post, host)).then(() => { done = true; });
		await flush();
		expect(done).toBe(false);
		release();
		await run;
		expect(done).toBe(true);
	});
});

// S4: every claim declares acceptsWarnings, so a match with another record at Almstins answers 409
// possible_duplicate. The prompt shows only what the answer carries, "Record my claim anyway"
// resubmits acknowledging it, and the acknowledgment rides along with what was answered before.
describe('possible duplicate (S4)', () => {
	const FULL = { state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: true };
	const DUP = (duplicateCheck: Record<string, unknown> = FULL): ClaimPostResult => ({
		status: 409,
		body: { ok: false, error: 'possible_duplicate', message: 'server text', warnings: ['possible_duplicate'], duplicateCheck },
	});
	const signedLine = dupCopy.CLAIM_DUPLICATE_SIGNED;

	it('hides the note and asks with the verified answer\'s lines, without refreshing the page', async () => {
		const { post } = poster(DUP());
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(asks).toHaveLength(1);
		expect(asks[0].warnings).toEqual([{ code: 'possible_duplicate', lines: [dupCopy.DUPLICATE_DETAIL_FINANCED, signedLine] }]);
		expect(log.slice(-2)).toEqual(['clear', 'ask:possible_duplicate']);
		expect(host.afterNotOk).not.toHaveBeenCalled();
		expect(host.afterSaved).not.toHaveBeenCalled();
	});

	it('an answer that is the state alone gets the plain match line, never the financed detail', async () => {
		const { post } = poster(DUP({ state: 'possible_duplicate' }));
		const { host } = makeHost();
		await submitClaim(options('registry', post, host));
		const [w] = asks[0].warnings as Array<{ lines: string[] }>;
		expect(w.lines).toEqual([dupCopy.DUPLICATE_DETAIL_ANY_MATCH, signedLine]);
		expect(w.lines.join(' ')).not.toMatch(/financ|installment|reference/i);
	});

	it('a missing or malformed duplicateCheck still asks, with the plain line', async () => {
		const { post } = poster({ status: 409, body: { ok: false, error: 'possible_duplicate' } });
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		expect(asks[0].warnings).toEqual([{ code: 'possible_duplicate', lines: [dupCopy.DUPLICATE_DETAIL_ANY_MATCH, signedLine] }]);
	});

	it('"Record my claim anyway" resubmits acknowledging it; the note says it is signed if the match still stood', async () => {
		const { post, calls } = poster(DUP(), OK());
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['possible_duplicate']);
		await flush();
		await flush();
		expect(calls).toHaveLength(2);
		expect(Object.keys(calls[1].body)).toEqual(['receivableId', 'financier', 'amount', 'date', 'force', 'acceptsWarnings', 'acknowledge']);
		expect(calls[1].body).toEqual({
			receivableId: RID, financier: 'Sahel Capital', amount: 500, date: '2026-10-11', force: false, acceptsWarnings: true, acknowledge: ['possible_duplicate'],
		});
		expect(notes.at(-1)?.tone).toBe('gain');
		expect(notes.at(-1)?.parts).toContain(' ' + dupCopy.CLAIM_NOTICE_ACKNOWLEDGED);
		expect(host.afterSaved).toHaveBeenCalledTimes(1);
	});

	// Review finding (S4): the server signs possible_duplicate only when it was raised on the
	// resubmit too, and its 200 does not say which codes it signed. The note must never claim a
	// signature the manifest may not hold.
	it('the acknowledgment line is conditional: the 200 does not say what was signed', () => {
		expect(dupCopy.CLAIM_NOTICE_ACKNOWLEDGED).toBe('You acknowledged the possible duplicate. If the match was still there when your claim was recorded, your acknowledgment is signed into the claim.');
		expect(dupCopy.CLAIM_NOTICE_ACKNOWLEDGED).not.toMatch(/is signed into this claim\.$/);
	});

	it('acknowledged, then the resubmit\'s check could not run: only the unavailable line, nothing about a signature', async () => {
		const { post, calls } = poster(DUP(), OK({ notices: ['duplicate_check_unavailable'] }));
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(['possible_duplicate']);
		await flush();
		await flush();
		expect(calls[1].body).toMatchObject({ acknowledge: ['possible_duplicate'] });
		expect(notes.at(-1)).toEqual({
			tone: 'gain',
			parts: ["b:Sahel Capital's claim registered and signed.", ' Now A700 claimed · A300 unencumbered.', ' ' + dupCopy.CLAIM_NOTICE_UNAVAILABLE, 'br', 'span#k-anchor-status:⏳ Timestamping to Bitcoin…'],
		});
		expect(notes.at(-1)?.parts.join('')).not.toMatch(/acknowledg/i);
	});

	it('"Not now": nothing more is posted, and the note says nothing was recorded', async () => {
		for (const page of ['desk', 'registry'] as const) {
			asks = [];
			const { post } = poster(DUP());
			const { host, notes } = makeHost();
			await submitClaim(options(page, post, host));
			asks[0].dismiss();
			await flush();
			expect(post).toHaveBeenCalledTimes(1);
			expect(notes.at(-1)).toEqual({ tone: 'info', parts: [dupCopy.CLAIM_DUPLICATE_NOT_RECORDED] });
			expect(dupCopy.CLAIM_DUPLICATE_NOT_RECORDED).toBe('Nothing was recorded.');
			expect(log.slice(-2)).toEqual(['closeAck', 'note:info']);
			expect(host.afterNotOk).not.toHaveBeenCalled();
			expect(host.afterSaved).not.toHaveBeenCalled();
		}
	});

	it('a prompt closed or replaced by the page posts nothing more and leaves no note', async () => {
		const { post } = poster(DUP());
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(null);
		await flush();
		expect(post).toHaveBeenCalledTimes(1);
		expect(notes).toEqual([]);
		expect(host.afterNotOk).not.toHaveBeenCalled();
	});

	it('an answer after the record changed closes the prompt and posts nothing', async () => {
		const { post, calls } = poster(DUP());
		const { host, state } = makeHost();
		await submitClaim(options('desk', post, host));
		state.receivableId = OTHER_RID;
		asks[0].answer(['possible_duplicate']);
		await flush();
		expect(calls).toHaveLength(1);
		expect(log.at(-1)).toBe('closeAck');
	});

	it('asked again after acknowledging: a plain note, no second prompt, then the refresh', async () => {
		const { post } = poster(DUP(), DUP());
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['possible_duplicate']);
		await flush();
		await flush();
		expect(asks).toHaveLength(1);
		expect(notes.at(-1)).toEqual({ tone: 'loss', parts: [dupCopy.CLAIM_DUPLICATE_STILL] });
		expect(host.afterNotOk).toHaveBeenCalledTimes(1);
	});

	it('every answer is carried forward: diligence, then headroom (force), then the duplicate, then recorded', async () => {
		const { post, calls } = poster(DILIGENCE, ACCEPTED, OVER, DUP(), OK());
		const { host, notes } = makeHost();
		await submitClaim(options('registry', post, host));
		asks[0].answer(['diligence_required']);
		await flush(); await flush();
		expect(asks.map((a) => a.warnings[0].code)).toEqual(['diligence_required', 'exceeds_headroom']);
		asks[1].answer(['exceeds_headroom']);
		await flush(); await flush();
		expect(asks.map((a) => a.warnings[0].code)).toEqual(['diligence_required', 'exceeds_headroom', 'possible_duplicate']);
		asks[2].answer(['possible_duplicate']);
		await flush(); await flush();
		expect(calls.map((c) => c.url)).toEqual([CLAIM_URL, DILIGENCE_URL, CLAIM_URL, CLAIM_URL, CLAIM_URL]);
		expect(calls[2].body).toMatchObject({ force: false, acceptsWarnings: true });
		expect(calls[3].body).toMatchObject({ force: true, acceptsWarnings: true });
		expect('acknowledge' in calls[3].body).toBe(false);
		expect(calls[4].body).toMatchObject({ force: true, acceptsWarnings: true, acknowledge: ['possible_duplicate'] });
		expect(notes.at(-1)?.tone).toBe('gain');
	});

	it('an acknowledgment survives a later headroom prompt in the same claim', async () => {
		const { post, calls } = poster(DUP(), OVER, OK());
		const { host } = makeHost();
		await submitClaim(options('desk', post, host));
		asks[0].answer(['possible_duplicate']);
		await flush(); await flush();
		asks[1].answer(['exceeds_headroom']);
		await flush(); await flush();
		expect(calls[2].body).toMatchObject({ force: true, acknowledge: ['possible_duplicate'] });
	});

	it('notices on a 200: the check could not run, or a match was noticed without a prompt', async () => {
		const { post } = poster(OK({ notices: ['duplicate_check_unavailable'] }), OK({ notices: ['possible_duplicate'] }), OK({ notices: 'junk' }));
		const { host, notes } = makeHost();
		await submitClaim(options('desk', post, host));
		await submitClaim(options('desk', post, host));
		await submitClaim(options('desk', post, host));
		const gains = notes.filter((n) => n.tone === 'gain').map((n) => n.parts);
		expect(gains[0]).toEqual(['b:Claim registered and signed.', ' Now A700 claimed, A300 unencumbered.', ' ' + dupCopy.CLAIM_NOTICE_UNAVAILABLE, 'br', 'span#k-anchor:⏳ Timestamping to Bitcoin…']);
		expect(gains[1]).toContain(' ' + dupCopy.CLAIM_NOTICE_POSSIBLE_DUPLICATE);
		expect(gains[2]).toEqual(['b:Claim registered and signed.', ' Now A700 claimed, A300 unencumbered.', 'br', 'span#k-anchor:⏳ Timestamping to Bitcoin…']);
	});
});
