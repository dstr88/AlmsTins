/**
 * useDialog: the keyboard, focus and scroll behavior every React modal and drawer shares (Area 6).
 * It came out of AddressDetailsModal.tsx, the first modal that had all of it:
 *
 *   - Escape closes (only the topmost dialog when two are open).
 *   - Focus moves in on open (the `initialFocus` element, else the first focusable one, else the
 *     panel itself) and goes back to whatever had it before, on close.
 *   - Tab and Shift+Tab stay inside the panel.
 *   - The page behind does not scroll while any dialog is open; it scrolls again only when the
 *     last one closes.
 *   - A click on the backdrop closes, unless `closeOnBackdrop` is false. The press must also start
 *     on the backdrop, so selecting text inside the panel and letting go outside does not close it.
 *
 * Use it through <Modal> or <Drawer> (src/components/ui/Modal.tsx, Drawer.tsx); a guard test
 * (tests/ci/modalGuard.test.ts) keeps role="dialog" out of other React files.
 */

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

export const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// ── Pure pieces (tested in tests/lib/dialog.test.ts) ─────────────────────────

/**
 * Where Tab should send focus, or null to let the browser move it. `inside` is whether focus is
 * in the panel now; `index` is the focused element's place in `count` focusable elements (-1 if
 * it is not one of them). With nothing focusable, focus stays on the panel.
 */
export function tabTarget(count: number, index: number, inside: boolean, shiftKey: boolean): 'first' | 'last' | 'panel' | null {
	if (count === 0) return 'panel';
	if (!inside) return shiftKey ? 'last' : 'first';
	if (shiftKey && index <= 0) return 'last';
	if (!shiftKey && index === count - 1) return 'first';
	return null;
}

type Styled = { style: { overflow: string } };

/**
 * One page scroll lock shared by every open dialog: the first to open saves the page's own
 * overflow and sets it to hidden; only the last to close puts the saved value back.
 */
export function createScrollLock() {
	let count = 0;
	let saved = '';
	return {
		lock(body: Styled) {
			if (count === 0) {
				saved = body.style.overflow;
				body.style.overflow = 'hidden';
			}
			count += 1;
		},
		unlock(body: Styled) {
			if (count === 0) return;
			count -= 1;
			if (count === 0) body.style.overflow = saved;
		},
		get count() {
			return count;
		},
	};
}

/** The open dialogs, oldest first; only the last one answers Escape and Tab. */
export function createDialogStack<T>() {
	const open: T[] = [];
	return {
		push(item: T) {
			open.push(item);
		},
		remove(item: T) {
			const i = open.lastIndexOf(item);
			if (i !== -1) open.splice(i, 1);
		},
		isTop(item: T) {
			return open.length > 0 && open[open.length - 1] === item;
		},
		get size() {
			return open.length;
		},
	};
}

const scrollLock = createScrollLock();
const stack = createDialogStack<object>();

// ── The hook ──────────────────────────────────────────────────────────────────

export type UseDialogOptions = {
	onClose: () => void;
	/** The element to focus on open; default the first focusable element in the panel. */
	initialFocus?: RefObject<HTMLElement | null>;
	/** Default true. False for a dialog that must be closed with its own button. */
	closeOnBackdrop?: boolean;
};

export type DialogBackdropProps = {
	onMouseDown: (e: MouseEvent<HTMLElement>) => void;
	onClick: (e: MouseEvent<HTMLElement>) => void;
};

function focusableIn(panel: HTMLElement): HTMLElement[] {
	// Leave out anything not drawn (inside a closed <details>, display: none).
	return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/** Call it in a component that is mounted only while the dialog is open. */
export function useDialog<T extends HTMLElement = HTMLDivElement>({ onClose, initialFocus, closeOnBackdrop = true }: UseDialogOptions) {
	const dialogRef = useRef<T>(null);
	const downOnBackdrop = useRef(false);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const initialFocusRef = useRef(initialFocus);

	useEffect(() => {
		const token = {};
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		stack.push(token);
		scrollLock.lock(document.body);

		const panel = dialogRef.current;
		if (panel) {
			const target = initialFocusRef.current?.current ?? focusableIn(panel)[0] ?? panel;
			target.focus();
		}

		function onKeyDown(e: KeyboardEvent) {
			if (!stack.isTop(token)) return;
			if (e.key === 'Escape') {
				e.preventDefault();
				onCloseRef.current();
				return;
			}
			const panelNow = dialogRef.current;
			if (e.key !== 'Tab' || !panelNow) return;
			const items = focusableIn(panelNow);
			const active = document.activeElement;
			const move = tabTarget(items.length, items.indexOf(active as HTMLElement), panelNow.contains(active), e.shiftKey);
			if (move === null) return;
			e.preventDefault();
			if (move === 'panel') panelNow.focus();
			else (move === 'first' ? items[0] : items[items.length - 1]).focus();
		}
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			stack.remove(token);
			scrollLock.unlock(document.body);
			if (opener?.isConnected) opener.focus();
		};
	}, []);

	const backdropProps: DialogBackdropProps = {
		onMouseDown: (e) => {
			downOnBackdrop.current = e.target === e.currentTarget;
		},
		onClick: (e) => {
			if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onCloseRef.current();
			downOnBackdrop.current = false;
		},
	};

	return { dialogRef, backdropProps };
}

/** True below 640px wide: a <Modal> becomes a bottom sheet there. */
export function useNarrow(): boolean {
	const query = '(max-width: 639px)';
	const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
	useEffect(() => {
		const mq = window.matchMedia(query);
		const update = () => setNarrow(mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	}, []);
	return narrow;
}
