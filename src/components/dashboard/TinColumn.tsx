import React from 'react';

import { TinAssetsCard } from '@/components/dashboard/TinAssetsCard';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getTinColumn } from '@/i18n/components/tinColumn';

export type TinColumnProps = {
	tinId: string;
	tinName: string;
	type: 'onchain' | 'aave' | 'tradfi' | 'cex' | 'cash' | string;
	assetsUsd: number;
	debtUsd: number;
	notes?: string;
	walletLabel?: string | null;
};

const formatUsd = (value: number) =>
	`$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TinColumn({ tinId, tinName, type, assetsUsd, debtUsd, notes, walletLabel }: TinColumnProps) {
	const t = getTinColumn(getClientLang());
	const typeLabel = type ? type.toString() : 'N/A';
	const noteLine = notes || typeLabel;

	const debtTitle = t.debtTitle(tinName);

	return (
		<div
			className="tin-column"
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '0.75rem',
				height: '100%',
				border: '2px solid var(--text-secondary)',
				borderRadius: '14px',
				padding: '0.5rem',
			}}
		>
			<TinAssetsCard walletId={tinId} label={walletLabel ?? null} />

			<div
				className="networth-card tin-debt-card"
				style={{
					backgroundColor: 'var(--surface-card-2)',
					borderRadius: '12px',
					padding: '1rem 1.25rem',
					color: 'var(--text-primary)',
					position: 'relative',
					overflow: 'hidden',
				}}
			>
				<p
					style={{
						margin: 0,
						textTransform: 'uppercase',
						letterSpacing: '0.08em',
						fontSize: '0.85rem',
						opacity: 0.85,
					}}
				>
					{debtTitle}
				</p>
				<p
					style={{
						margin: '0.35rem 0',
						fontSize: '1.6rem',
						fontWeight: 700,
						color: 'var(--loss)',
					}}
				>
					{formatUsd(debtUsd)}
				</p>
				<p
					style={{
						margin: 0,
						fontSize: '0.95rem',
						opacity: 0.8,
					}}
				>
					{noteLine}
				</p>
			</div>
		</div>
	);
}

export default TinColumn;
