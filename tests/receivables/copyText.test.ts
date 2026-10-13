import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindCopyButtons, copyText, delegateCopyButtons } from '../../src/lib/receivables/client/copyText';
import { COPY_FAILED_LABEL } from '../../src/lib/receivables/copy/clipboard';

/**
 * src/lib/receivables/client/copyText.ts: the one copy-to-clipboard behavior that replaced the
 * receivables pages' own copies. Each option reproduces one page's existing behavior:
 *   desk copy-link   { failedLabel }                 "Copied" for good, or the failure label
 *   desk copy-id     { optimistic, restoreMs: 1200 } data-copied-label, swapped as the write starts
 *   registry copy-id { optimistic }                  "Copied" for good, whatever happens
 *   client buttons   { restoreMs: 1400 }             "Copied", then the label comes back
 */

type FakeButton = HTMLElement & { textContent: string; dataset: Record<string, string>; classList: { contains(c: string): boolean } };

function fakeButton(label: string, dataset: Record<string, string> = {}): FakeButton {
	const classes = new Set<string>();
	return {
		textContent: label,
		dataset,
		classList: {
			add: (c: string) => { classes.add(c); },
			remove: (c: string) => { classes.delete(c); },
			contains: (c: string) => classes.has(c),
		},
	} as unknown as FakeButton;
}

interface Deferred { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void }
function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

let write: Deferred;
let writeText: ReturnType<typeof vi.fn>;

function withClipboard() {
	write = deferred();
	writeText = vi.fn(() => write.promise);
	vi.stubGlobal('navigator', { clipboard: { writeText } });
}

beforeEach(() => { vi.useFakeTimers(); withClipboard(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('non-optimistic (desk copy-link, client buttons)', () => {
	it('writes the text, then swaps the label only once the write resolved', async () => {
		const btn = fakeButton('Copy the link');
		const p = copyText(btn, 'https://example.test/x');
		expect(writeText).toHaveBeenCalledWith('https://example.test/x');
		expect(btn.textContent).toBe('Copy the link');
		expect(btn.classList.contains('is-copied')).toBe(false);
		write.resolve();
		await expect(p).resolves.toBe(true);
		expect(btn.textContent).toBe('Copied');
		expect(btn.classList.contains('is-copied')).toBe(true);
	});

	it('without restoreMs, "Copied" stays', async () => {
		const btn = fakeButton('Copy the link');
		const p = copyText(btn, 't', { failedLabel: COPY_FAILED_LABEL });
		write.resolve();
		await p;
		vi.advanceTimersByTime(60_000);
		expect(btn.textContent).toBe('Copied');
		expect(btn.classList.contains('is-copied')).toBe(true);
	});

	it('restoreMs puts the label back and removes .is-copied', async () => {
		const btn = fakeButton('Copy ID');
		const p = copyText(btn, 't', { restoreMs: 1400 });
		write.resolve();
		await p;
		vi.advanceTimersByTime(1399);
		expect(btn.textContent).toBe('Copied');
		vi.advanceTimersByTime(1);
		expect(btn.textContent).toBe('Copy ID');
		expect(btn.classList.contains('is-copied')).toBe(false);
	});

	it('a rejected write with failedLabel shows it for good', async () => {
		const btn = fakeButton('Copy the link');
		const p = copyText(btn, 't', { failedLabel: COPY_FAILED_LABEL, restoreMs: 1000 });
		write.reject(new Error('denied'));
		await expect(p).resolves.toBe(false);
		expect(btn.textContent).toBe('Could not copy — select the link and copy it');
		vi.advanceTimersByTime(60_000);
		expect(btn.textContent).toBe('Could not copy — select the link and copy it');
		expect(btn.classList.contains('is-copied')).toBe(false);
	});

	it('a rejected write without failedLabel leaves the button alone', async () => {
		const btn = fakeButton('Copy ID');
		const p = copyText(btn, 't', { restoreMs: 1400 });
		write.reject(new Error('denied'));
		await expect(p).resolves.toBe(false);
		vi.advanceTimersByTime(60_000);
		expect(btn.textContent).toBe('Copy ID');
		expect(btn.classList.contains('is-copied')).toBe(false);
	});

	it('no clipboard API: unchanged, returns false, never throws', async () => {
		vi.stubGlobal('navigator', {});
		const btn = fakeButton('Copy ID');
		await expect(copyText(btn, 't', { failedLabel: COPY_FAILED_LABEL, restoreMs: 1400 })).resolves.toBe(false);
		vi.advanceTimersByTime(60_000);
		expect(btn.textContent).toBe('Copy ID');
		expect(btn.classList.contains('is-copied')).toBe(false);
	});
});

describe('optimistic (desk copy-id, registry copy-id)', () => {
	it('swaps the label as the write starts, before it settles', async () => {
		const btn = fakeButton('Copy ID');
		const labelAtWrite: string[] = [];
		writeText.mockImplementation(() => { labelAtWrite.push(btn.textContent); return write.promise; });
		const p = copyText(btn, 't', { optimistic: true });
		expect(writeText).toHaveBeenCalledWith('t');
		expect(labelAtWrite).toEqual(['Copy ID']); // the write is issued first, then the swap, as before
		expect(btn.textContent).toBe('Copied');
		expect(btn.classList.contains('is-copied')).toBe(true);
		write.resolve();
		await expect(p).resolves.toBe(true);
		expect(btn.textContent).toBe('Copied');
	});

	it('keeps "Copied" when the write is rejected, even with a failedLabel', async () => {
		const btn = fakeButton('Copy ID');
		const p = copyText(btn, 't', { optimistic: true, failedLabel: COPY_FAILED_LABEL });
		write.reject(new Error('denied'));
		await expect(p).resolves.toBe(false);
		expect(btn.textContent).toBe('Copied');
	});

	it('swaps the label with no clipboard API at all', async () => {
		vi.stubGlobal('navigator', {});
		const btn = fakeButton('Copy ID');
		await expect(copyText(btn, 't', { optimistic: true })).resolves.toBe(false);
		expect(btn.textContent).toBe('Copied');
		expect(btn.classList.contains('is-copied')).toBe(true);
	});

	it('restoreMs restores after the swap, whatever the write did', async () => {
		const btn = fakeButton('⧉', { copiedLabel: '✓' });
		const p = copyText(btn, 't', { optimistic: true, restoreMs: 1200 });
		expect(btn.textContent).toBe('✓');
		write.reject(new Error('denied'));
		await p;
		vi.advanceTimersByTime(1200);
		expect(btn.textContent).toBe('⧉');
		expect(btn.classList.contains('is-copied')).toBe(false);
	});
});

describe('labels', () => {
	it('data-copied-label is used when present', async () => {
		const btn = fakeButton('⧉', { copiedLabel: '✓' });
		const p = copyText(btn, 't');
		write.resolve();
		await p;
		expect(btn.textContent).toBe('✓');
	});

	it('a double click inside the restore window keeps the copied label, as the desk did', async () => {
		// The second click captures "✓" as the label to restore, so once both timers fire the
		// button still shows "✓". Reproduced on purpose; the desk behaved this way before S1.
		const btn = fakeButton('⧉', { copiedLabel: '✓' });
		void copyText(btn, 't', { optimistic: true, restoreMs: 1200 });
		vi.advanceTimersByTime(500);
		void copyText(btn, 't', { optimistic: true, restoreMs: 1200 });
		expect(btn.textContent).toBe('✓');
		vi.advanceTimersByTime(700);
		expect(btn.textContent).toBe('⧉');
		vi.advanceTimersByTime(500);
		expect(btn.textContent).toBe('✓');
		expect(btn.classList.contains('is-copied')).toBe(false);
		write.resolve();
		await vi.runAllTimersAsync();
		expect(btn.textContent).toBe('✓');
	});
});

describe('binding helpers', () => {
	it('delegateCopyButtons: one listener on root, copies for a matching click only', async () => {
		let handler!: (e: unknown) => void;
		const root = { addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => { expect(type).toBe('click'); handler = fn; }) };
		delegateCopyButtons(root as unknown as Document, '[data-copylink]', (b) => b.dataset.copylink ?? '', { failedLabel: COPY_FAILED_LABEL });
		expect(root.addEventListener).toHaveBeenCalledTimes(1);

		const btn = fakeButton('Copy the link', { copylink: 'https://example.test/l' });
		const closest = vi.fn((sel: string) => (sel === '[data-copylink]' ? btn : null));
		handler({ target: { closest } });
		expect(closest).toHaveBeenCalledWith('[data-copylink]');
		expect(writeText).toHaveBeenCalledWith('https://example.test/l');
		write.resolve();
		await vi.runAllTimersAsync();
		expect(btn.textContent).toBe('Copied');

		writeText.mockClear();
		handler({ target: { closest: () => null } });
		handler({ target: null });
		handler({ target: {} });
		expect(writeText).not.toHaveBeenCalled();
	});

	it('bindCopyButtons: binds each match now, with its own text', () => {
		const listeners: Array<() => void> = [];
		const mk = (id: string) => Object.assign(fakeButton('⧉', { copyid: id, copiedLabel: '✓' }), {
			addEventListener: vi.fn((_t: string, fn: () => void) => { listeners.push(fn); }),
		});
		const a = mk('aa');
		const b = mk('bb');
		const root = { querySelectorAll: vi.fn(() => [a, b]) };
		bindCopyButtons(root as unknown as ParentNode, '[data-copyid]', (el) => el.dataset.copyid ?? '', { optimistic: true, restoreMs: 1200 });
		expect(root.querySelectorAll).toHaveBeenCalledWith('[data-copyid]');
		expect(writeText).not.toHaveBeenCalled();
		listeners[1]();
		expect(writeText).toHaveBeenCalledWith('bb');
		expect(b.textContent).toBe('✓');
		expect(a.textContent).toBe('⧉');
	});
});
