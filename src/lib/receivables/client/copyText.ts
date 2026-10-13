/**
 * A copy-to-clipboard button: write the text, then show "Copied" (or the button's own
 * data-copied-label) and add .is-copied. Options reproduce each page's existing behavior:
 *   restoreMs   put the button's label back after this many ms (omit: keep "Copied")
 *   optimistic  swap the label as the write starts, whatever its outcome
 *   failedLabel shown, permanently, when the write is rejected (omit: leave the button alone)
 * With no clipboard API nothing changes unless optimistic. Never throws.
 */
import { COPIED_LABEL } from '@/lib/receivables/copy/clipboard';

export interface CopyTextOptions {
	restoreMs?: number;
	failedLabel?: string;
	optimistic?: boolean;
}

function showCopied(btn: HTMLElement, restoreMs: number | undefined): void {
	const was = btn.textContent;
	btn.textContent = btn.dataset.copiedLabel ?? COPIED_LABEL;
	btn.classList.add('is-copied');
	if (restoreMs === undefined) return;
	setTimeout(() => { btn.textContent = was; btn.classList.remove('is-copied'); }, restoreMs);
}

export async function copyText(btn: HTMLElement, text: string, opts: CopyTextOptions = {}): Promise<boolean> {
	const write = navigator.clipboard?.writeText(text); // write first, then swap: same order as before
	if (opts.optimistic) showCopied(btn, opts.restoreMs);
	if (!write) return false;
	try {
		await write;
	} catch {
		if (!opts.optimistic && opts.failedLabel !== undefined) btn.textContent = opts.failedLabel;
		return false;
	}
	if (!opts.optimistic) showCopied(btn, opts.restoreMs);
	return true;
}

/** One listener on root for copy buttons a page renders later (notes, rosters). */
export function delegateCopyButtons(root: Document | HTMLElement, selector: string, textOf: (btn: HTMLElement) => string, opts?: CopyTextOptions): void {
	root.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement)?.closest?.(selector) as HTMLElement | null;
		if (btn) void copyText(btn, textOf(btn), opts);
	});
}

/** Binds each match inside root now. Call after the innerHTML render that created them. */
export function bindCopyButtons(root: ParentNode, selector: string, textOf: (btn: HTMLElement) => string, opts?: CopyTextOptions): void {
	root.querySelectorAll<HTMLElement>(selector).forEach((btn) => btn.addEventListener('click', () => { void copyText(btn, textOf(btn), opts); }));
}
