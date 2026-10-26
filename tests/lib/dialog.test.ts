import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDialogStack, createScrollLock, tabTarget } from '../../src/components/ui/useDialog';

/**
 * The shared modal shell (Area 6): useDialog's pure pieces, <Modal> and <Drawer> rendered the way
 * the server renders them, and pins on the effect code that only a browser can run (CI has no DOM).
 * The unit config compiles JSX with the classic runtime, so React is a global before the import.
 */
let Modal: typeof import('../../src/components/ui/Modal').Modal;
let Drawer: typeof import('../../src/components/ui/Drawer').Drawer;
beforeAll(async () => {
	(globalThis as { React?: typeof React }).React = React;
	Modal = (await import('../../src/components/ui/Modal')).Modal;
	Drawer = (await import('../../src/components/ui/Drawer')).Drawer;
});

const ROOT = path.resolve(__dirname, '../..');
const hook = readFileSync(path.join(ROOT, 'src/components/ui/useDialog.ts'), 'utf8');
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;

describe('tabTarget', () => {
	it('wraps from the last element to the first, and from the first back to the last with Shift', () => {
		expect(tabTarget(3, 2, true, false)).toBe('first');
		expect(tabTarget(3, 0, true, true)).toBe('last');
	});

	it('lets the browser move focus between the elements in the middle', () => {
		expect(tabTarget(3, 0, true, false)).toBeNull();
		expect(tabTarget(3, 1, true, false)).toBeNull();
		expect(tabTarget(3, 1, true, true)).toBeNull();
		expect(tabTarget(3, 2, true, true)).toBeNull();
	});

	it('brings focus back in when it has left the panel', () => {
		expect(tabTarget(3, -1, false, false)).toBe('first');
		expect(tabTarget(3, -1, false, true)).toBe('last');
	});

	it('from the panel itself, Shift+Tab goes to the last element and Tab to the next one', () => {
		expect(tabTarget(3, -1, true, true)).toBe('last');
		expect(tabTarget(3, -1, true, false)).toBeNull();
	});

	it('keeps focus on the panel when nothing in it can take focus, and with one element stays on it', () => {
		expect(tabTarget(0, -1, true, false)).toBe('panel');
		expect(tabTarget(0, -1, false, true)).toBe('panel');
		expect(tabTarget(1, 0, true, false)).toBe('first');
		expect(tabTarget(1, 0, true, true)).toBe('last');
	});
});

describe('createScrollLock', () => {
	it('hides the page scroll while open and puts the page’s own value back on close', () => {
		const lock = createScrollLock();
		const body = { style: { overflow: 'scroll' } };
		lock.lock(body);
		expect(body.style.overflow).toBe('hidden');
		lock.unlock(body);
		expect(body.style.overflow).toBe('scroll');
	});

	it('with two dialogs open, the page scrolls again only when the last one closes', () => {
		const lock = createScrollLock();
		const body = { style: { overflow: '' } };
		lock.lock(body);
		lock.lock(body);
		expect(lock.count).toBe(2);
		lock.unlock(body);
		expect(body.style.overflow).toBe('hidden');
		lock.unlock(body);
		expect(body.style.overflow).toBe('');
		expect(lock.count).toBe(0);
	});

	it('an extra unlock changes nothing', () => {
		const lock = createScrollLock();
		const body = { style: { overflow: 'auto' } };
		lock.unlock(body);
		expect(body.style.overflow).toBe('auto');
		expect(lock.count).toBe(0);
	});
});

describe('createDialogStack', () => {
	it('only the newest open dialog is on top, and the one under it is again when it closes', () => {
		const stack = createDialogStack<string>();
		stack.push('outer');
		expect(stack.isTop('outer')).toBe(true);
		stack.push('inner');
		expect(stack.isTop('outer')).toBe(false);
		expect(stack.isTop('inner')).toBe(true);
		stack.remove('inner');
		expect(stack.isTop('outer')).toBe(true);
	});

	it('a dialog under the top can close without disturbing the top one', () => {
		const stack = createDialogStack<string>();
		stack.push('a');
		stack.push('b');
		stack.remove('a');
		expect(stack.isTop('b')).toBe(true);
		expect(stack.size).toBe(1);
		stack.remove('b');
		expect(stack.isTop('b')).toBe(false);
	});
});

describe('<Modal>', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is a modal dialog named by its title, focusable as a last resort', () => {
		const html = render(React.createElement(Modal, { onClose: noop, labelledBy: 'title-1', children: React.createElement('h2', { id: 'title-1' }, 'Hello') }));
		expect(html).toMatch(/role="dialog"/);
		expect(html).toMatch(/aria-modal="true"/);
		expect(html).toMatch(/aria-labelledby="title-1"/);
		expect(html).not.toMatch(/aria-label="/);
		expect(html).toMatch(/tabindex="-1"/);
		expect(html).toContain('<h2 id="title-1">Hello</h2>');
	});

	it('takes an aria-label when there is no title element', () => {
		const html = render(React.createElement(Modal, { onClose: noop, label: 'Camera', children: 'x' }));
		expect(html).toMatch(/aria-label="Camera"/);
		expect(html).not.toMatch(/aria-labelledby/);
	});

	it('draws the default look from the design tokens, centered on a wide screen', () => {
		const html = render(React.createElement(Modal, { onClose: noop, label: 'x', children: 'x' }));
		expect(html).toContain('var(--surface-card)');
		expect(html).toContain('var(--border-bright)');
		expect(html).toContain('color-mix(in srgb, var(--surface-bg) 78%, transparent)');
		expect(html).toContain('max-width:560px');
		expect(html).toContain('align-items:center');
		expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
	});

	it('is a bottom sheet below 640px wide, unless sheet is off', () => {
		vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q === '(max-width: 639px)' }) });
		const sheet = render(React.createElement(Modal, { onClose: noop, label: 'x', children: 'x' }));
		expect(sheet).toContain('align-items:flex-end');
		expect(sheet).toContain('border-radius:16px 16px 0 0');
		expect(sheet).toContain('max-height:88vh');
		const centered = render(React.createElement(Modal, { onClose: noop, label: 'x', sheet: false, children: 'x' }));
		expect(centered).toContain('align-items:center');
		expect(centered).not.toContain('16px 16px 0 0');
	});

	it('a CSS class replaces the default look of its layer; style is laid over the top', () => {
		const html = render(
			React.createElement(Modal, { onClose: noop, label: 'x', className: 'panel', backdropClassName: 'shade', style: { maxWidth: '800px' }, children: 'x' }),
		);
		expect(html).toMatch(/class="shade"/);
		expect(html).toMatch(/class="panel"/);
		expect(html).not.toContain('var(--surface-card)');
		expect(html).not.toContain('color-mix');
		expect(html).toContain('max-width:800px');
		const bare = render(React.createElement(Modal, { onClose: noop, label: 'x', unstyled: true, children: 'x' }));
		expect(bare).not.toContain('var(--surface-card)');
		expect(bare).not.toContain('position:fixed');
	});
});

describe('<Drawer>', () => {
	it('is a modal dialog panel at the right edge, never wider than the screen', () => {
		const html = render(React.createElement(Drawer, { onClose: noop, label: 'Details', width: '480px', children: 'x' }));
		expect(html).toMatch(/role="dialog"/);
		expect(html).toMatch(/aria-modal="true"/);
		expect(html).toMatch(/aria-label="Details"/);
		expect(html).toContain('right:0');
		expect(html).toContain('width:min(480px, 100vw)');
		expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
	});

	it('lays style and backdropStyle over its look', () => {
		const html = render(React.createElement(Drawer, { onClose: noop, label: 'x', style: { background: 'var(--surface-card)' }, backdropStyle: { zIndex: 9998 }, children: 'x' }));
		expect(html).toContain('background:var(--surface-card)');
		expect(html).toContain('z-index:9998');
	});
});

describe('useDialog (browser-only effect code, pinned)', () => {
	it('Escape closes, and only the topmost dialog answers keys', () => {
		expect(hook).toMatch(/if \(!stack\.isTop\(token\)\) return;/);
		expect(hook).toMatch(/e\.key === 'Escape'[\s\S]{0,80}onCloseRef\.current\(\)/);
		expect(hook).toMatch(/document\.addEventListener\('keydown', onKeyDown\)/);
		expect(hook).toMatch(/document\.removeEventListener\('keydown', onKeyDown\)/);
	});

	it('moves focus in on open and back to the opener on close, if it is still on the page', () => {
		expect(hook).toMatch(/const opener = document\.activeElement instanceof HTMLElement/);
		expect(hook).toMatch(/initialFocusRef\.current\?\.current \?\? focusableIn\(panel\)\[0\] \?\? panel/);
		expect(hook).toMatch(/if \(opener\?\.isConnected\) opener\.focus\(\)/);
	});

	it('keeps Tab inside with tabTarget, locks the page scroll, and closes on a backdrop press-and-click', () => {
		expect(hook).toMatch(/tabTarget\(items\.length/);
		expect(hook).toMatch(/scrollLock\.lock\(document\.body\)/);
		expect(hook).toMatch(/scrollLock\.unlock\(document\.body\)/);
		expect(hook).toMatch(/downOnBackdrop\.current = e\.target === e\.currentTarget/);
		expect(hook).toMatch(/closeOnBackdrop && downOnBackdrop\.current && e\.target === e\.currentTarget/);
		expect(hook).toMatch(/max-width: 639px/);
	});
});
