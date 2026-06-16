import React, { useEffect, useMemo, useState } from 'react';
import { normalizeNetWorthSummary } from '@/lib/networth/summaryContract';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getTotalsTin } from '@/i18n/components/totalsTin';

type WalletRow = {
	walletId: string;
	walletLabel: string | null;
	assetsUsd: number;
	freeAssetsUsd: number;
	debtUsd: number;
};

type SummaryPayload = {
	totalAssetsUsd: number;
	totalFreeAssetsUsd: number;
	totalDebtUsd: number;
	byWallet: WalletRow[];
	byChain?: Array<{
		chain: string;
		assetsUsd: number;
		freeAssetsUsd: number;
		debtUsd: number;
	}>;
};

type TotalsState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| {
			status: 'ready';
			summary: SummaryPayload;
	  };

const formatUsd = (value: number) =>
	`$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Mode = 'wallet' | 'chain';

export default function TotalsTin({ endpoint = '/api/networth/summary' }: { endpoint?: string }) {
	const t = getTotalsTin(getClientLang());
	const [state, setState] = useState<TotalsState>({ status: 'loading' });
	const [mode, setMode] = useState<Mode>('wallet');
	const [hasWalletBreakdown, setHasWalletBreakdown] = useState(false);

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				setState({ status: 'loading' });
				const res = await fetch(endpoint);
				const payload = await res.json();
				if (!mounted) return;
				if (!payload?.ok) {
					throw new Error(payload?.message ?? t.errorFallback);
				}
				const normalized = normalizeNetWorthSummary(payload);
				const summary: SummaryPayload = {
					totalAssetsUsd: normalized.totalAssetsUsd,
					totalFreeAssetsUsd: normalized.totalFreeAssetsUsd,
					totalDebtUsd: normalized.totalDebtUsd,
					byWallet: normalized.tins.map((t) => ({
						walletId: t.tinId,
						walletLabel: t.tinName ?? null,
						assetsUsd: Number(t.assetsUsd ?? 0),
						freeAssetsUsd: Number(t.freeAssetsUsd ?? t.assetsUsd ?? 0),
						debtUsd: Number(t.debtUsd ?? 0),
					})),
					byChain: normalized.byChain.map((c) => ({
						chain: c.chain,
						assetsUsd: c.assetsUsd,
						freeAssetsUsd: c.freeAssetsUsd,
						debtUsd: c.debtUsd,
					})),
				};
				const walletHasBreakdown = normalized.tins.length > 0;
				setHasWalletBreakdown(walletHasBreakdown);
				if (!walletHasBreakdown) {
					setMode('chain');
				}
				console.log('[TotalsTin] summary', summary);
				setState({ status: 'ready', summary });
			} catch (err) {
				if (!mounted) return;
				setState({ status: 'error', message: err instanceof Error ? err.message : t.errorFallback });
			}
		};
		load();
		return () => {
			mounted = false;
		};
	}, [endpoint]);

	const { rows, isEmpty } = useMemo(() => {
		if (state.status !== 'ready') return { rows: [], isEmpty: true };
		if (mode === 'chain') {
			const chains = state.summary.byChain ?? [];
			const mapped = chains.map((c) => {
				const assets = Number(c.assetsUsd ?? 0);
				const debt = Number(c.debtUsd ?? 0);
				return {
					label: c.chain,
					assetsUsd: assets,
					freeAssetsUsd: Number(c.freeAssetsUsd ?? assets),
					debtUsd: debt,
					netUsd: assets - debt,
				};
			});
			return { rows: mapped, isEmpty: mapped.length === 0 };
		}
		const wallets = state.summary.byWallet ?? [];
		const mapped = wallets.map((w) => {
			const assets = Number(w.assetsUsd ?? 0);
			const debt = Number(w.debtUsd ?? 0);
			return {
				label: w.walletLabel ?? w.walletId.slice(0, 8),
				assetsUsd: assets,
				freeAssetsUsd: Number(w.freeAssetsUsd ?? assets),
				debtUsd: debt,
				netUsd: assets - debt,
			};
		});
		return { rows: mapped, isEmpty: mapped.length === 0 };
	}, [state, mode]);

	const content = useMemo(() => {
		if (state.status === 'loading') {
			return <p style={{ margin: 0, opacity: 0.8 }}>{t.loading}</p>;
		}
		if (state.status === 'error') {
			return (
				<p style={{ margin: 0, color: 'var(--loss)', fontSize: '0.95rem' }}>
					{state.message || t.errorFallback}
				</p>
			);
		}

		const { summary } = state;

		return (
			<>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
					<Row label={t.totalAssets} value={formatUsd(summary.totalAssetsUsd)} />
					<Row label={t.totalFreeAssets} value={formatUsd(summary.totalFreeAssetsUsd)} muted />
					<Row label={t.totalDebt} value={formatUsd(summary.totalDebtUsd)} accent="red" />
				</div>

				<div
					style={{
						marginTop: '0.5rem',
						borderTop: '1px solid var(--border-bright)',
						paddingTop: '0.5rem',
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: '0.5rem',
					}}
				>
					<span style={{ fontSize: '0.9rem', opacity: 0.85 }}>{t.viewBreakdownBy}</span>
					<select
						value={mode}
						onChange={(e) => setMode(e.target.value as Mode)}
						style={{
							borderRadius: '10px',
							border: '1px solid var(--text-muted)',
							background: 'var(--border-bright)',
							color: 'var(--text-primary)',
							padding: '0.35rem 0.65rem',
							cursor: 'pointer',
						}}
						aria-label={t.breakdownModeAriaLabel}
					>
						<option value="wallet" disabled={!hasWalletBreakdown}>
							{t.optionWallet}
						</option>
						<option value="chain">{t.optionChain}</option>
					</select>
				</div>

				<div
					style={{
						marginTop: '0.5rem',
						border: '1px solid var(--border-bright)',
						borderRadius: '10px',
						overflow: 'hidden',
						maxHeight: '240px',
						overflowY: 'auto',
					}}
				>
					{isEmpty ? (
						<p style={{ margin: '0.5rem 0.75rem', opacity: 0.75 }}>{t.noData}</p>
					) : (
						<table
							style={{
								width: '100%',
								borderCollapse: 'collapse',
								fontSize: '0.9rem',
							}}
						>
							<thead>
								<tr style={{ background: 'var(--border-subtle)' }}>
									<th style={thStyle}>{t.colLabel}</th>
									<th style={thStyle}>{t.colAssets}</th>
									<th style={thStyle}>{t.colFree}</th>
									<th style={{ ...thStyle, color: 'var(--loss)' }}>{t.colDebt}</th>
									<th style={thStyle}>{t.colNet}</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row, idx) => (
									<tr key={`${row.label}-${idx}`} style={{ borderTop: '1px solid var(--border-bright)' }}>
										<td style={tdLabelStyle}>{row.label}</td>
										<td style={tdValueStyle}>{formatUsd(row.assetsUsd)}</td>
										<td style={tdValueStyle}>{formatUsd(row.freeAssetsUsd)}</td>
										<td style={{ ...tdValueStyle, color: 'var(--loss)' }}>{formatUsd(row.debtUsd)}</td>
										<td style={tdValueStyle}>{formatUsd(row.netUsd)}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</>
		);
	}, [state, mode, rows, isEmpty]);

	return (
		<div
			className="networth-card totals-tin-card"
			style={{
				backgroundColor: 'var(--surface-card-2)',
				borderRadius: '12px',
				padding: '1rem 1.25rem',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				height: '100%',
				color: 'var(--text-primary)',
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<h2
				style={{
					fontSize: '1rem',
					fontWeight: 600,
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					margin: 0,
				}}
			>
				{t.heading}
			</h2>
			{content}
		</div>
	);
}

function Row({
	label,
	value,
	muted,
	accent,
}: {
	label: string;
	value: string;
	muted?: boolean;
	accent?: 'red';
}) {
	const color = accent === 'red' ? 'var(--loss)' : undefined;
	return (
		<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
			<span style={{ fontSize: '0.95rem', opacity: muted ? 0.75 : 0.9 }}>{label}</span>
			<strong style={{ fontSize: '1rem', color }}>{value}</strong>
		</div>
	);
}

const thStyle: React.CSSProperties = {
	textAlign: 'left',
	padding: '0.5rem 0.75rem',
	fontSize: '0.75rem',
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
	opacity: 0.75,
};

const tdLabelStyle: React.CSSProperties = {
	padding: '0.45rem 0.75rem',
};

const tdValueStyle: React.CSSProperties = {
	padding: '0.45rem 0.75rem',
	textAlign: 'right',
};
