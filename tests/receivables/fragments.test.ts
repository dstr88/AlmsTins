import { describe, it, expect, vi } from 'vitest';
import { recordPill, statusPillHtml, type StatusPillView } from '../../src/components/receivables/StatusPill/statusPill';
import { anchorPillHtml, bindAnchorPills, type AnchorPillClick } from '../../src/components/receivables/AnchorPill/anchorPill';
import type { PageAnchorKind } from '../../src/lib/receivables/anchorView';
import { escapeHtml } from '../../src/lib/escapeHtml';

/**
 * The receivables fragment helpers: StatusPill/statusPill.ts and AnchorPill/anchorPill.ts. They
 * return HTML strings the pages drop into innerHTML, so these tests pin the exact markup (the
 * goldens are written out here, not built from the copy modules) and feed them hostile input:
 * an unknown state renders nothing, and a hostile value only ever lands escaped.
 */

const hostile = (v: unknown) => v as never;

describe('statusPillHtml: record pill goldens', () => {
	const golden = (state: string, label: string) =>
		`<span class="rcv-pill rcv-pill--record rcv-pill--${state}"><span class="rcv-pill__dot"></span>${label}</span>`;

	it('renders all six states with the labels the registry showed', () => {
		expect(statusPillHtml({ kind: 'record', state: 'test' })).toBe(
			'<span class="rcv-pill rcv-pill--record rcv-pill--test"><span class="rcv-pill__dot"></span>TEST RECORD — not a real receivable</span>',
		);
		expect(statusPillHtml({ kind: 'record', state: 'disputed' })).toBe(golden('disputed', '⚠ Disputed'));
		expect(statusPillHtml({ kind: 'record', state: 'settled' })).toBe(golden('settled', 'Settled / paid'));
		expect(statusPillHtml({ kind: 'record', state: 'partial' })).toBe(golden('partial', 'Partially encumbered'));
		expect(statusPillHtml({ kind: 'record', state: 'full' })).toBe(golden('full', 'Fully encumbered'));
		expect(statusPillHtml({ kind: 'record', state: 'open' })).toBe(golden('open', 'Available to finance'));
	});

	it('the warning sign is U+26A0 with no variation selector', () => {
		const html = statusPillHtml({ kind: 'record', state: 'disputed' });
		expect(html).toContain('⚠ Disputed');
		expect(html).not.toContain('️');
	});

	it('recordPill reads ragState', () => {
		expect(recordPill({ isTest: true, settled: true, status: 'fully_financed' })).toEqual({ kind: 'record', state: 'test' });
		expect(recordPill({ settled: true, status: 'partially_financed' })).toEqual({ kind: 'record', state: 'settled' });
		expect(recordPill({ status: 'partially_financed' })).toEqual({ kind: 'record', state: 'partial' });
		expect(recordPill({ status: 'over_financed' })).toEqual({ kind: 'record', state: 'full' });
		expect(recordPill({ status: 'unfinanced' })).toEqual({ kind: 'record', state: 'open' });
		expect(recordPill({ attestations: [{ class: 'party_dispute' }] })).toEqual({ kind: 'record', state: 'disputed' });
		// S2: withdrawn is a tag beside the record pill, never a record state of its own.
		const withdrawn = { withdrawn: true, withdrawnAt: '2026-10-12 09:30:00' };
		expect(recordPill({ ...withdrawn, settled: true, attestations: [{ class: 'party_dispute' }] })).toEqual({ kind: 'record', state: 'disputed' });
		expect(recordPill({ ...withdrawn, status: 'fully_financed' })).toEqual({ kind: 'record', state: 'full' });
		expect(recordPill({ ...withdrawn, isTest: true })).toEqual({ kind: 'record', state: 'test' });
	});
});

describe('statusPillHtml: tag pill goldens', () => {
	it('test tag', () => {
		expect(statusPillHtml({ kind: 'tag', tag: 'test' })).toBe('<span class="rcv-pill rcv-pill--tag">test</span>');
	});

	it('withdrawn tag (S2), with its title', () => {
		expect(statusPillHtml({ kind: 'tag', tag: 'withdrawn' })).toBe(
			'<span class="rcv-pill rcv-pill--tag" title="Whoever recorded this receivable withdrew it. Your claim and the rest of its record stay on file.">withdrawn</span>',
		);
	});

	it('claimed-only tag, with its title (ASCII double hyphen)', () => {
		expect(statusPillHtml({ kind: 'tag', tag: 'claimed_only' })).toBe(
			'<span class="rcv-pill rcv-pill--tag" title="You hold a claim against this receivable, but did not create it -- settle, invite and document actions belong to whoever did">claimed only</span>',
		);
	});
});

describe('statusPillHtml: hostile view input renders nothing', () => {
	it('unknown or hostile record states', () => {
		for (const state of ['"><img src=x onerror=1>', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'OPEN', 'withdrawn', 'WITHDRAWN', 'withdrawn"']) {
			expect(statusPillHtml(hostile({ kind: 'record', state })), state).toBe('');
		}
	});

	it('unknown or hostile tags', () => {
		for (const tag of ['x"', '__proto__', 'constructor', 'claimed only', '', 'Withdrawn', 'withdrawn ']) {
			expect(statusPillHtml(hostile({ kind: 'tag', tag })), tag).toBe('');
		}
	});

	it('a missing kind, an unknown kind, and a null or undefined view', () => {
		expect(statusPillHtml(hostile({ state: 'open' }))).toBe('');
		expect(statusPillHtml(hostile({ kind: undefined, state: 'open' }))).toBe('');
		expect(statusPillHtml(hostile({ kind: 'anchor', state: 'open' }))).toBe('');
		expect(statusPillHtml(hostile(null))).toBe('');
		expect(statusPillHtml(hostile(undefined))).toBe('');
	});

	it('never emits a style attribute', () => {
		const views: StatusPillView[] = [
			...(['test', 'disputed', 'settled', 'partial', 'full', 'open'] as const).map((state) => ({ kind: 'record' as const, state })),
			{ kind: 'tag', tag: 'test' }, { kind: 'tag', tag: 'claimed_only' }, { kind: 'tag', tag: 'withdrawn' },
		];
		for (const v of views) expect(statusPillHtml(v)).not.toMatch(/style\s*=/);
	});
});

describe('anchorPillHtml goldens', () => {
	const CONFIRMED = { id: 'ab12', anchored: true, anchoredAt: '2026-10-09T14:00:00Z' };
	const PENDING = { id: 'ab12', anchored: true, anchoredAt: null };
	const NONE = { id: 'ab12', anchored: false, anchoredAt: null };

	it('confirmed: a block-date badge', () => {
		expect(anchorPillHtml('claim', CONFIRMED, { actionable: true })).toBe('<span class="rcv-anchor rcv-anchor--confirmed">⛓ Bitcoin 2026-10-09</span>');
		expect(anchorPillHtml('claim', CONFIRMED, { actionable: false })).toBe('<span class="rcv-anchor rcv-anchor--confirmed">⛓ Bitcoin 2026-10-09</span>');
	});

	it('pending, actionable: a re-check button that asks for an upgrade', () => {
		expect(anchorPillHtml('claim', PENDING, { actionable: true })).toBe(
			'<button class="rcv-anchor rcv-anchor--action" data-anchor="claim:ab12" data-up="1" type="button">⏳ pending · re-check</button>',
		);
	});

	it('none, actionable: an anchor button', () => {
		expect(anchorPillHtml('claim', NONE, { actionable: true })).toBe(
			'<button class="rcv-anchor rcv-anchor--action" data-anchor="claim:ab12" type="button">Anchor to Bitcoin</button>',
		);
	});

	it('the kind is carried into data-anchor', () => {
		expect(anchorPillHtml('receivable', NONE, { actionable: true })).toContain('data-anchor="receivable:ab12"');
		expect(anchorPillHtml('attestation', PENDING, { actionable: true })).toContain('data-anchor="attestation:ab12"');
	});

	it('actionable:false never emits a button or data-anchor', () => {
		expect(anchorPillHtml('claim', PENDING, { actionable: false })).toBe('<span class="rcv-anchor rcv-anchor--pending">⏳ Bitcoin pending</span>');
		expect(anchorPillHtml('claim', NONE, { actionable: false })).toBe('<span class="rcv-anchor rcv-anchor--none">Not yet anchored</span>');
		for (const rec of [CONFIRMED, PENDING, NONE]) {
			const html = anchorPillHtml('claim', rec, { actionable: false });
			expect(html).not.toContain('<button');
			expect(html).not.toContain('data-anchor');
			expect(html).not.toContain('data-up');
		}
	});
});

describe('anchorPillHtml: hostile input only ever lands escaped', () => {
	// The whole fragment, with every attribute value free of raw quotes and angle brackets.
	const BUTTON = /^<button class="rcv-anchor rcv-anchor--action" data-anchor="[^"'<>]*"(?: data-up="1")? type="button">[^<>]*<\/button>$/;
	const SPAN = /^<span class="rcv-anchor rcv-anchor--(?:confirmed|pending|none)">[^<>]*<\/span>$/;

	for (const id of ['"><img src=x onerror=1>', "' onmouseover='x", "a\"b'c<d>e&f"]) {
		it(`hostile id ${JSON.stringify(id)}`, () => {
			for (const anchored of [true, false]) {
				const html = anchorPillHtml('claim', { id, anchored, anchoredAt: null }, { actionable: true });
				expect(html).toMatch(BUTTON);
				expect(html).not.toContain(id);
				expect(html).toContain(`data-anchor="claim:${escapeHtml(id)}"`);
			}
			// Read-only and confirmed pills never carry the id at all.
			expect(anchorPillHtml('claim', { id, anchored: true, anchoredAt: null }, { actionable: false })).toMatch(SPAN);
			expect(anchorPillHtml('claim', { id, anchored: true, anchoredAt: '2026-10-09T14:00:00Z' }, { actionable: true })).not.toContain(escapeHtml(id));
		});
	}

	it('hostile anchoredAt', () => {
		const anchoredAt = '<svg onload=1>xx';
		for (const actionable of [true, false]) {
			const html = anchorPillHtml('claim', { id: 'ab12', anchored: true, anchoredAt }, { actionable });
			expect(html).toMatch(SPAN);
			expect(html).not.toContain(anchoredAt);
			expect(html).not.toContain('<svg');
			// The pill shows the first ten characters as the day, escaped.
			expect(html).toBe(`<span class="rcv-anchor rcv-anchor--confirmed">⛓ Bitcoin ${escapeHtml(anchoredAt.slice(0, 10))}</span>`);
		}
	});

	it('hostile kind (a cast past the type)', () => {
		const kind = 'claim" onclick="alert(1)' as PageAnchorKind;
		const html = anchorPillHtml(kind, { id: 'ab12', anchored: false, anchoredAt: null }, { actionable: true });
		expect(html).toMatch(BUTTON);
		expect(html).not.toContain(kind);
		expect(html).toContain(`data-anchor="${escapeHtml(kind)}:ab12"`);
	});
});

describe('bindAnchorPills', () => {
	type Listener = () => void;
	function fakePill(anchor: string, up?: string) {
		const listeners: Record<string, Listener[]> = {};
		const dataset: Record<string, string | undefined> = { anchor, up };
		return {
			dataset,
			addEventListener: vi.fn((type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); }),
			click: () => (listeners.click ?? []).forEach((fn) => fn()),
			listenerCount: () => (listeners.click ?? []).length,
		};
	}

	it('binds each pill once and reports kind, id and upgrade (read at click time)', () => {
		const a = fakePill('claim:ab12', '1');
		const b = fakePill('receivable:cd34');
		const root = { querySelectorAll: vi.fn(() => [a, b]) };
		const clicks: AnchorPillClick[] = [];
		bindAnchorPills(root as unknown as ParentNode, (c) => clicks.push(c));

		expect(root.querySelectorAll).toHaveBeenCalledWith('.rcv-anchor[data-anchor]');
		expect(a.listenerCount()).toBe(1);
		expect(b.listenerCount()).toBe(1);
		expect(clicks).toEqual([]);

		a.click();
		b.click();
		expect(clicks).toEqual([
			{ kind: 'claim', id: 'ab12', upgrade: true },
			{ kind: 'receivable', id: 'cd34', upgrade: false },
		]);

		// data-up is read when the click happens, not when the pill was bound.
		b.dataset.up = '1';
		a.dataset.up = undefined;
		a.click();
		b.click();
		expect(clicks.slice(2)).toEqual([
			{ kind: 'claim', id: 'ab12', upgrade: false },
			{ kind: 'receivable', id: 'cd34', upgrade: true },
		]);
	});

	it('an empty root binds nothing and never calls onAnchor', () => {
		const onAnchor = vi.fn();
		bindAnchorPills({ querySelectorAll: () => [] } as unknown as ParentNode, onAnchor);
		expect(onAnchor).not.toHaveBeenCalled();
	});
});
