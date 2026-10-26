/**
 * <Drawer>: the one side panel shell for React screens (Area 6). Same behavior as <Modal>
 * (useDialog: Escape, focus in and back out, Tab kept inside, page scroll locked, backdrop click to
 * close); the panel slides in from the right edge at full height, and fills the width on a phone.
 *
 * Render it only while it is open, and name it with `labelledBy` or `label`. `style` and
 * `backdropStyle` are laid over the default look.
 */

import React, { type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useDialog } from './useDialog';

type Name = { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

export type DrawerProps = Name & {
	onClose: () => void;
	children: ReactNode;
	initialFocus?: RefObject<HTMLElement | null>;
	/** Default true. */
	closeOnBackdrop?: boolean;
	/** Panel width; it never grows past the screen. */
	width?: string;
	style?: CSSProperties;
	backdropStyle?: CSSProperties;
};

export function Drawer({
	onClose,
	children,
	labelledBy,
	label,
	initialFocus,
	closeOnBackdrop = true,
	width = '480px',
	style,
	backdropStyle,
}: DrawerProps) {
	const { dialogRef, backdropProps } = useDialog({ onClose, initialFocus, closeOnBackdrop });

	return (
		<div
			{...backdropProps}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 1000,
				background: 'color-mix(in srgb, var(--surface-bg) 78%, transparent)',
				backdropFilter: 'blur(2px)',
				...backdropStyle,
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				aria-label={label}
				tabIndex={-1}
				style={{
					position: 'fixed',
					top: 0,
					right: 0,
					bottom: 0,
					width: `min(${width}, 100vw)`,
					background: 'var(--surface-bg)',
					borderLeft: '1px solid var(--border-bright)',
					display: 'flex',
					flexDirection: 'column',
					overflowY: 'auto',
					outline: 'none',
					...style,
				}}
			>
				{children}
			</div>
		</div>
	);
}

export default Drawer;
