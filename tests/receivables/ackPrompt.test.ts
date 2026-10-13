import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { askToAcknowledge, ackInputs, closeAck, setAckBusy } from '../../src/components/receivables/AckPrompt/ackPrompt.client';
import { fillCopy } from '../../src/lib/receivables/fillCopy';
import { HEADROOM_BODY, HEADROOM_TAKE_AVAILABLE } from '../../src/lib/receivables/copy/claim';

/**
 * src/components/receivables/AckPrompt: the prompt shown before a claim is recorded when there
 * is something to read first. ackPrompt.client.ts is driven here over a small fake DOM that
 * mirrors AckPrompt.astro's markup; the last block pins that markup against what the client
 * looks for, so the two cannot drift apart.
 *
 * Each ask resolves once (a double click on "Record it anyway" or "I accept responsibility"
 * cannot post twice), and a button left over from an earlier prompt never answers a later one.
 *
 * Focus (S4 review): the prompt is not a live region. Opening it moves focus to its title, and
 * closing it while focus is inside sends focus back to the page's claim button (data-ack-return),
 * so a keyboard user is never dropped at the top of the page.
 */

// ---- A small fake DOM: attribute selectors only, template content kept out of the tree ----
/** The fake document: which element has focus, and the IDs getElementById finds. */
const doc = {
	activeElement: null as El | null,
	ids: new Map<string, El>(),
	focusCalls: [] as Array<{ el: El; opts: unknown }>,
	getElementById(id: string): El | null { return this.ids.get(id) ?? null; },
};
class El {
	children: El[] = [];
	listeners: (() => void)[] = [];
	hidden = false;
	disabled = false;
	textContent = '';
	value = '';
	content: El | null = null;
	constructor(public tag: string, public attrs: Record<string, string> = {}, children: El[] = []) {
		this.children = children;
		if ('hidden' in attrs) this.hidden = true;
	}
	get ownerDocument() { return doc; }
	focus(opts?: unknown) { doc.activeElement = this; doc.focusCalls.push({ el: this, opts }); }
	contains(other: El | null): boolean { return !!other && (other === this || [...this.descendants()].includes(other)); }
	get dataset(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(this.attrs)) {
			if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())] = v;
		}
		return out;
	}
	addEventListener(type: string, fn: () => void) { if (type === 'click') this.listeners.push(fn); }
	click() { if (!this.disabled) for (const fn of this.listeners) fn(); }
	cloneNode(): El {
		const c = new El(this.tag, { ...this.attrs }, this.children.map((x) => x.cloneNode()));
		c.hidden = this.hidden;
		c.textContent = this.textContent;
		c.value = this.value;
		c.content = this.content ? this.content.cloneNode() : null;
		return c;
	}
	replaceChildren(...nodes: El[]) { this.children = nodes.flatMap((n) => (n.tag === '#fragment' ? n.children : [n])); }
	*descendants(): Generator<El> { for (const c of this.children) { yield c; yield* c.descendants(); } }
	querySelectorAll(sel: string): El[] {
		const m = /^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
		if (!m) throw new Error(`fake DOM: unsupported selector ${sel}`);
		const [, tag, attr, value] = m;
		return [...this.descendants()].filter((e) => (!tag || e.tag === tag) && attr in e.attrs && (value === undefined || e.attrs[attr] === value));
	}
	querySelector(sel: string): El | null { return this.querySelectorAll(sel)[0] ?? null; }
}
const h = (tag: string, attrs: Record<string, string> = {}, ...children: El[]) => new El(tag, attrs, children);
function template(code: string, ...children: El[]): El {
	const t = h('template', { 'data-ack-template': code });
	t.content = h('#fragment', {}, ...children);
	return t;
}

/** The registry variant of AckPrompt.astro, element for element (text left out). */
const title = () => h('b', { class: 'ack__title', 'data-ack-title': '', tabindex: '-1' });
function promptRoot(returnFocus: string | null = 'k-btn'): El {
	return h('div', { class: 'ack ack--registry', 'data-rcv-root': 'ack-claim', ...(returnFocus ? { 'data-ack-return': returnFocus } : {}), hidden: '' },
		h('div', { class: 'ack__body', 'data-ack-body': '' }),
		template('diligence_required',
			h('div', { class: 'ack__panel ack__panel--caution' }, title()),
			h('div', { class: 'ack__field' }, h('label'), h('select', { 'data-ack-field': 'method' })),
			h('div', { class: 'ack__field' }, h('label'), h('input', { 'data-ack-field': 'note' })),
			h('p', { class: 'ack__fine' }),
			h('button', { class: 'ack__btn', 'data-ack-choice': 'diligence_required' })),
		template('exceeds_headroom',
			h('div', { class: 'ack__panel ack__panel--loss' }, title(), h('span', { 'data-ack-slot': 'headroom-body' })),
			h('div', { class: 'ack__row' },
				h('button', { class: 'ack__btn', 'data-ack-choice': 'take_available', 'data-ack-slot': 'take-available' }),
				h('button', { class: 'ack__btn', 'data-ack-choice': 'exceeds_headroom' }))),
		template('possible_duplicate',
			h('div', { class: 'ack__panel ack__panel--caution' }, title(), h('span', { 'data-ack-slot': 'duplicate-body' })),
			h('div', { class: 'ack__row' },
				h('button', { class: 'ack__btn', 'data-ack-choice': 'possible_duplicate' }),
				h('button', { class: 'ack__btn', 'data-ack-choice': 'dismiss' }))),
	);
}
const asRoot = (el: El) => el as unknown as HTMLElement;
const body = (root: El) => root.querySelector('[data-ack-body]')!;
const choice = (root: El, c: string) => body(root).querySelector(`[data-ack-choice="${c}"]`)!;
const OVER = { code: 'exceeds_headroom' as const, available: 'NGN 200.00', requested: 'NGN 500.00', claimed: 'NGN 800.00' };
const DUP = { code: 'possible_duplicate' as const, lines: ['Another record at Almstins matches this invoice.', 'If you record your claim anyway, that acknowledgment is signed into it.'] };

/** The page's claim button, which focus goes back to. */
let claimButton: El;
beforeEach(() => {
	doc.activeElement = null;
	doc.ids.clear();
	doc.focusCalls = [];
	claimButton = h('button', { id: 'k-btn' });
	doc.ids.set('k-btn', claimButton);
});

/** Settles on the next macrotask: 'pending' when the ask has not resolved yet. */
async function state(p: Promise<string[] | null>): Promise<string[] | null | 'pending'> {
	return Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 0))]);
}

describe('askToAcknowledge', () => {
	it('draws the warning\'s template into the body, fills the figures as text, and shows the root', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [OVER]);
		expect(root.hidden).toBe(false);
		const vars = { available: OVER.available, requested: OVER.requested, claimed: OVER.claimed };
		expect(body(root).querySelector('[data-ack-slot="headroom-body"]')!.textContent).toBe(fillCopy(HEADROOM_BODY, vars));
		expect(choice(root, 'take_available').textContent).toBe(fillCopy(HEADROOM_TAKE_AVAILABLE, vars));
		expect(choice(root, 'take_available').textContent).toBe('Register only the available NGN 200.00');
		// The template itself is left as written.
		const tpl = root.querySelector('template[data-ack-template="exceeds_headroom"]')!;
		expect(tpl.content!.querySelector('[data-ack-slot="headroom-body"]')!.textContent).toBe('');
		expect(await state(p)).toBe('pending');
	});

	it('"Record it anyway" answers [exceeds_headroom]; "Register only the available" answers []', async () => {
		const a = promptRoot();
		const pa = askToAcknowledge(asRoot(a), [OVER]);
		choice(a, 'exceeds_headroom').click();
		expect(await pa).toEqual(['exceeds_headroom']);

		const b = promptRoot();
		const pb = askToAcknowledge(asRoot(b), [OVER]);
		choice(b, 'take_available').click();
		expect(await pb).toEqual([]);
	});

	it('"I accept responsibility" answers [diligence_required], and the fields read back', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [{ code: 'diligence_required' }]);
		body(root).querySelector('[data-ack-field="method"]')!.value = 'relationship';
		body(root).querySelector('[data-ack-field="note"]')!.value = '  spoke with their AP team  ';
		choice(root, 'diligence_required').click();
		expect(await p).toEqual(['diligence_required']);
		expect(ackInputs(asRoot(root))).toEqual({ method: 'relationship', note: 'spoke with their AP team' });
	});

	it('only the first warning is drawn', async () => {
		const root = promptRoot();
		void askToAcknowledge(asRoot(root), [{ code: 'diligence_required' }, OVER]);
		expect(body(root).querySelector('[data-ack-choice="diligence_required"]')).not.toBeNull();
		expect(body(root).querySelector('[data-ack-choice="exceeds_headroom"]')).toBeNull();
	});

	it('the prompt stays on screen after an answer, until closeAck', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [OVER]);
		choice(root, 'exceeds_headroom').click();
		await p;
		expect(root.hidden).toBe(false);
		expect(body(root).children.length).toBeGreaterThan(0);
	});
});

describe('answers resolve once', () => {
	it('a double click, or a click on the other button after it, changes nothing', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [OVER]);
		let answers = 0;
		void p.then(() => { answers += 1; });
		choice(root, 'exceeds_headroom').click();
		choice(root, 'exceeds_headroom').click();
		choice(root, 'take_available').click();
		expect(await p).toEqual(['exceeds_headroom']);
		await state(p);
		expect(answers).toBe(1);
	});

	it('a button left over from an earlier prompt never answers a later one', async () => {
		const root = promptRoot();
		const first = askToAcknowledge(asRoot(root), [OVER]);
		const stale = choice(root, 'exceeds_headroom');
		stale.click();
		expect(await first).toEqual(['exceeds_headroom']);

		const second = askToAcknowledge(asRoot(root), [OVER]);
		stale.click();
		expect(await state(second)).toBe('pending');
		choice(root, 'take_available').click();
		expect(await second).toEqual([]);
	});

	it('a new ask answers the pending one with null', async () => {
		const root = promptRoot();
		const first = askToAcknowledge(asRoot(root), [OVER]);
		const second = askToAcknowledge(asRoot(root), [{ code: 'diligence_required' }]);
		expect(await first).toBeNull();
		expect(await state(second)).toBe('pending');
	});

	it('closeAck answers the pending ask with null, hides the root and empties the body', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [OVER]);
		const btn = choice(root, 'exceeds_headroom');
		closeAck(asRoot(root));
		expect(await p).toBeNull();
		expect(root.hidden).toBe(true);
		expect(body(root).children).toEqual([]);
		btn.click(); // detached, and already answered
		expect(await p).toBeNull();
	});

	it('nothing to show (no warning, or no template for it): null at once, root stays hidden', async () => {
		const root = promptRoot();
		expect(await askToAcknowledge(asRoot(root), [])).toBeNull();
		const bare = h('div', { hidden: '' }, h('div', { 'data-ack-body': '' }));
		expect(await askToAcknowledge(asRoot(bare), [OVER])).toBeNull();
		expect(root.hidden).toBe(true);
		expect(bare.hidden).toBe(true);
	});
});

describe('ackInputs and setAckBusy', () => {
	it('ackInputs defaults to other and an empty note when no diligence prompt is drawn', () => {
		expect(ackInputs(asRoot(promptRoot()))).toEqual({ method: 'other', note: '' });
	});

	it('setAckBusy disables and re-enables every choice button', () => {
		const root = promptRoot();
		void askToAcknowledge(asRoot(root), [OVER]);
		const buttons = body(root).querySelectorAll('[data-ack-choice]');
		expect(buttons).toHaveLength(2);
		setAckBusy(asRoot(root), true);
		expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
		setAckBusy(asRoot(root), false);
		expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
	});
});

describe('AckPrompt.astro markup matches what the client looks for', () => {
	const SRC = fs.readFileSync(fileURLToPath(new URL('../../src/components/receivables/AckPrompt/AckPrompt.astro', import.meta.url)), 'utf8');
	const count = (s: string) => SRC.split(s).length - 1;

	it('one hidden root naming the control focus returns to, with one body; not a live region', () => {
		expect(SRC).toMatch(/<div class=\{`ack ack--\$\{variant\}`\} data-rcv-root=\{`ack-\$\{name\}`\} data-ack-return=\{returnFocus\} hidden>/);
		expect(SRC).toContain("interface Props { variant: 'desk' | 'registry'; name: string; returnFocus?: string }");
		expect(count('data-ack-body')).toBe(1);
		// The prompt takes focus instead: a live region shown together with its content (and holding
		// a select, a text field and buttons) is often not announced, or read option by option.
		expect(SRC).not.toMatch(/\brole=|aria-live|aria-atomic/);
	});

	it('every prompt opens with a focusable title (tabindex -1), the one title per template', () => {
		expect(count('<b class="ack__title" data-ack-title tabindex="-1">')).toBe(6);
		// Every <b> in the prompt is a title.
		expect(SRC.match(/<b\b/g)).toHaveLength(6);
	});

	it('each variant has one template per warning code', () => {
		expect(count('<template data-ack-template="diligence_required">')).toBe(2);
		expect(count('<template data-ack-template="exceeds_headroom">')).toBe(2);
		expect(count('<template data-ack-template="possible_duplicate">')).toBe(2);
		expect(count('<template ')).toBe(6);
	});

	it('each variant has the five choices, the headroom and duplicate slots and both diligence fields', () => {
		for (const s of [
			'data-ack-choice="diligence_required"', 'data-ack-choice="exceeds_headroom"',
			'data-ack-choice="take_available" data-ack-slot="take-available"', 'data-ack-slot="headroom-body"',
			'data-ack-choice="possible_duplicate"', 'data-ack-choice="dismiss"', 'data-ack-slot="duplicate-body"',
			'data-ack-field="method"', 'data-ack-field="note"',
		]) expect(count(s), s).toBe(2);
		expect(count('data-ack-choice=')).toBe(10);
	});

	it('every choice button is type="button"', () => {
		const buttons = SRC.match(/<button\b[^>]*>/g) ?? [];
		expect(buttons).toHaveLength(10);
		for (const b of buttons) expect(b).toContain('type="button"');
	});

	it('the duplicate prompt reads the S4 copy, in the caution tone on both variants', () => {
		expect(SRC).toContain("import { CLAIM_DUPLICATE_NOT_NOW, CLAIM_DUPLICATE_RECORD_ANYWAY, DUPLICATE_FLAG_TITLE } from '@/lib/receivables/copy/duplicate';");
		expect(count('{CLAIM_DUPLICATE_RECORD_ANYWAY}')).toBe(2);
		expect(count('{CLAIM_DUPLICATE_NOT_NOW}')).toBe(2);
		expect(SRC.match(/<template data-ack-template="possible_duplicate">\s*<div class="ack__panel ack__panel--caution">/g)).toHaveLength(2);
	});
});

describe('the possible-duplicate prompt (S4)', () => {
	it('fills the lines as text into the slot and shows the root', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [{ ...DUP, lines: ['<b>not markup</b>', 'second'] }]);
		expect(root.hidden).toBe(false);
		expect(body(root).querySelector('[data-ack-slot="duplicate-body"]')!.textContent).toBe('<b>not markup</b> second');
		expect(await state(p)).toBe('pending');
	});

	it('"Record my claim anyway" answers [possible_duplicate]', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [DUP]);
		choice(root, 'possible_duplicate').click();
		expect(await p).toEqual(['possible_duplicate']);
		expect(root.hidden).toBe(false);
	});

	it('"Not now" answers null and closes the prompt', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [DUP]);
		const recordAnyway = choice(root, 'possible_duplicate');
		choice(root, 'dismiss').click();
		expect(await p).toBeNull();
		expect(root.hidden).toBe(true);
		expect(body(root).children).toEqual([]);
		recordAnyway.click(); // detached, and already answered
		expect(await p).toBeNull();
	});
});

describe('focus (S4 review)', () => {
	it('opening a prompt moves focus to its title', () => {
		const root = promptRoot();
		void askToAcknowledge(asRoot(root), [DUP]);
		const t = body(root).querySelector('[data-ack-title]')!;
		expect(doc.activeElement).toBe(t);
		void askToAcknowledge(asRoot(root), [OVER]);
		expect(doc.activeElement).toBe(body(root).querySelector('[data-ack-title]'));
		expect(doc.activeElement).not.toBe(t);
	});

	it('"Not now": closes the prompt, puts focus back on the claim button, then calls onDismiss', async () => {
		const root = promptRoot();
		const seen: Array<{ hidden: boolean; active: El | null }> = [];
		const onDismiss = vi.fn(() => { seen.push({ hidden: root.hidden, active: doc.activeElement }); });
		const p = askToAcknowledge(asRoot(root), [DUP], { onDismiss });
		const notNow = choice(root, 'dismiss');
		notNow.focus();
		notNow.click();
		expect(await p).toBeNull();
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([{ hidden: true, active: claimButton }]);
		expect(doc.focusCalls.at(-1)).toEqual({ el: claimButton, opts: { preventScroll: true } });
	});

	it('onDismiss is not called for any other answer, or for a close', async () => {
		const onDismiss = vi.fn();
		const a = promptRoot();
		const pa = askToAcknowledge(asRoot(a), [DUP], { onDismiss });
		choice(a, 'possible_duplicate').click();
		expect(await pa).toEqual(['possible_duplicate']);
		const b = promptRoot();
		const pb = askToAcknowledge(asRoot(b), [DUP], { onDismiss });
		closeAck(asRoot(b));
		expect(await pb).toBeNull();
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('"Record my claim anyway" keeps focus on its button; the close after the claim returns it', async () => {
		const root = promptRoot();
		const p = askToAcknowledge(asRoot(root), [DUP]);
		const anyway = choice(root, 'possible_duplicate');
		anyway.focus();
		anyway.click();
		await p;
		expect(doc.activeElement).toBe(anyway);
		closeAck(asRoot(root));
		expect(doc.activeElement).toBe(claimButton);
	});

	it('a close while focus is elsewhere (the desk opening another record) leaves focus alone', () => {
		const root = promptRoot();
		void askToAcknowledge(asRoot(root), [DUP]);
		const search = h('input');
		search.focus();
		closeAck(asRoot(root));
		expect(doc.activeElement).toBe(search);
		expect(doc.focusCalls.some((c) => c.el === claimButton)).toBe(false);
	});

	it('no data-ack-return, or no such element: the prompt still closes and nothing throws', () => {
		for (const ret of [null, 'missing']) {
			const root = promptRoot(ret);
			void askToAcknowledge(asRoot(root), [DUP]);
			expect(() => closeAck(asRoot(root))).not.toThrow();
			expect(root.hidden).toBe(true);
			expect(doc.focusCalls.some((c) => c.el === claimButton)).toBe(false);
		}
	});
});
