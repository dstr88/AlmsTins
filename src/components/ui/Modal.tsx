/**
 * <Modal>: the one centered dialog shell for React screens (Area 6). It draws the backdrop and the
 * panel and gets its keyboard, focus and scroll behavior from useDialog (./useDialog.ts): Escape,
 * focus in and back out, Tab kept inside, page scroll locked, backdrop click to close.
 *
 * Render it only while the dialog is open. Name it with `labelledBy` (the id of its visible
 * title) or, when there is no title element, `label`.
 *
 * The default look is the address details modal's: a blurred backdrop and a card panel, all from
 * the design tokens, and a bottom sheet below 640px wide (`sheet={false}` keeps it centered).
 * A screen with its own look passes `className` / `backdropClassName` (a CSS class replaces the
 * default look of that layer) or `unstyled` (no default look on either layer); `style` and
 * `backdropStyle` are laid over whichever look applies.
 */

import React, { type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useDialog, useNarrow } from './useDialog';

type Name = { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

export type ModalProps = Name & {
	onClose: () => void;
	children: ReactNode;
	initialFocus?: RefObject<HTMLElement | null>;
	/** Default true. */
	closeOnBackdrop?: boolean;
	/** Bottom sheet below 640px wide. Default true; only the default look uses it. */
	sheet?: boolean;
	/** Panel width on a wide screen, default look only. */
	maxWidth?: string;
	unstyled?: boolean;
	className?: string;
	backdropClassName?: string;
	style?: CSSProperties;
	backdropStyle?: CSSProperties;
};

function backdropLook(sheet: boolean): CSSProperties {
	return {
		position: 'fixed',
		inset: 0,
		zIndex: 1000,
		background: 'color-mix(in srgb, var(--surface-bg) 78%, transparent)',
		backdropFilter: 'blur(3px)',
		display: 'flex',
		alignItems: sheet ? 'flex-end' : 'center',
		justifyContent: 'center',
		padding: sheet ? 0 : '1.5rem',
	};
}

function panelLook(sheet: boolean, maxWidth: string): CSSProperties {
	return {
		width: '100%',
		maxWidth: sheet ? '100%' : maxWidth,
		maxHeight: sheet ? '88vh' : '90vh',
		overflowY: 'auto',
		background: 'var(--surface-card)',
		border: '1px solid var(--border-bright)',
		borderRadius: sheet ? '16px 16px 0 0' : '16px',
		padding: sheet ? '1rem 1rem 1.5rem' : '1.35rem 1.5rem 1.5rem',
		boxSizing: 'border-box',
		display: 'flex',
		flexDirection: 'column',
		gap: '1rem',
		color: 'var(--text-secondary)',
	};
}

export function Modal({
	onClose,
	children,
	labelledBy,
	label,
	initialFocus,
	closeOnBackdrop = true,
	sheet = true,
	maxWidth = '560px',
	unstyled = false,
	className,
	backdropClassName,
	style,
	backdropStyle,
}: ModalProps) {
	const { dialogRef, backdropProps } = useDialog({ onClose, initialFocus, closeOnBackdrop });
	const narrow = useNarrow();
	const asSheet = sheet && narrow;

	return (
		<div
			{...backdropProps}
			className={backdropClassName}
			style={{ ...(unstyled || backdropClassName ? {} : backdropLook(asSheet)), ...backdropStyle }}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				aria-label={label}
				tabIndex={-1}
				className={className}
				style={{ ...(unstyled || className ? {} : panelLook(asSheet, maxWidth)), outline: 'none', ...style }}
			>
				{children}
			</div>
		</div>
	);
}

export default Modal;
