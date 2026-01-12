import React, { useEffect, useMemo, useState } from 'react';

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
	const [state, setState] = useState<TotalsState>({ status: 'loading' });
	const [mode, setMode] = useState<Mode>('wallet');

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				setState({ status: 'loading' });
				const res = await fetch(endpoint);
				const payload = await res.json();
				if (!mounted) return;
				if (!payload?.ok || !payload?.summary) {
					throw new Error(payload?.message ?? 'Unable to load totals right now.');
				}
				const summary: SummaryPayload = {
					totalAssetsUsd: Number(payload.summary.totalAssetsUsd ?? 0),
					totalFreeAssetsUsd: Number(payload.summary.totalFreeAssetsUsd ?? payload.summary.totalAssetsUsd ?? 0),
					totalDebtUsd: Number(payload.summary.totalDebtUsd ?? 0),
					byWallet: (payload.summary.byWallet ?? []).map((w: any) => ({
						walletId: w.walletId,
						walletLabel: w.walletLabel ?? null,
						assetsUsd: Number(w.assetsUsd ?? 0),
						freeAssetsUsd: Number(w.freeAssetsUsd ?? w.assetsUsd ?? 0),
						debtUsd: Number(w.debtUsd ?? 0),
					})),
					byChain: (payload.summary.byChain ?? []).map((c: any) => ({
						chain: c.chain,
						assetsUsd: Number(c.assetsUsd ?? 0),
						freeAssetsUsd: Number(c.freeAssetsUsd ?? 0),
						debtUsd: Number(c.debtUsd ?? 0),
					})),
				};
				console.log('[TotalsTin] summary', summary);
				setState({ status: 'ready', summary });
			} catch (err) {
				if (!mounted) return;
				setState({ status: 'error', message: err instanceof Error ? err.message : 'Unable to load totals right now.' });
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
			return <p style={{ margin: 0, opacity: 0.8 }}>Loading totals…</p>;
		}
		if (state.status === 'error') {
			return (
				<p style={{ margin: 0, color: '#fca5a5', fontSize: '0.95rem' }}>
					{state.message || 'Unable to load totals right now.'}
				</p>
			);
		}

		const { summary } = state;
		const wallets = summary.byWallet ?? [];

		return (
			<>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
					<Row label="Total Assets" value={formatUsd(summary.totalAssetsUsd)} />
					<Row label="Total Free Assets" value={formatUsd(summary.totalFreeAssetsUsd)} muted />
					<Row label="Total Debt" value={formatUsd(summary.totalDebtUsd)} accent="red" />
				</div>

				<div
					style={{
						marginTop: '0.5rem',
						borderTop: '1px solid rgba(255,255,255,0.15)',
						paddingTop: '0.5rem',
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: '0.5rem',
					}}
				>
					<span style={{ fontSize: '0.9rem', opacity: 0.85 }}>View breakdown by</span>
					<select
						value={mode}
						onChange={(e) => setMode(e.target.value as Mode)}
						style={{
							borderRadius: '10px',
							border: '1px solid rgba(255,255,255,0.25)',
							background: 'rgba(255,255,255,0.08)',
							color: '#f7f2eb',
							padding: '0.35rem 0.65rem',
							cursor: 'pointer',
						}}
						aria-label="Totals breakdown mode"
					>
						<option value="wallet">Wallet</option>
						<option value="chain">Chain</option>
					</select>
				</div>

				<div
					style={{
						marginTop: '0.5rem',
						border: '1px solid rgba(255,255,255,0.15)',
						borderRadius: '10px',
						overflow: 'hidden',
						maxHeight: '240px',
						overflowY: 'auto',
					}}
				>
					{isEmpty ? (
						<p style={{ margin: '0.5rem 0.75rem', opacity: 0.75 }}>No data yet.</p>
					) : (
						<table
							style={{
								width: '100%',
								borderCollapse: 'collapse',
								fontSize: '0.9rem',
							}}
						>
							<thead>
								<tr style={{ background: 'rgba(255,255,255,0.05)' }}>
									<th style={thStyle}>Label</th>
									<th style={thStyle}>Assets</th>
									<th style={thStyle}>Free</th>
									<th style={{ ...thStyle, color: '#f97373' }}>Debt</th>
									<th style={thStyle}>Net</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row, idx) => (
									<tr key={`${row.label}-${idx}`} style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
										<td style={tdLabelStyle}>{row.label}</td>
										<td style={tdValueStyle}>{formatUsd(row.assetsUsd)}</td>
										<td style={tdValueStyle}>{formatUsd(row.freeAssetsUsd)}</td>
										<td style={{ ...tdValueStyle, color: '#f97373' }}>{formatUsd(row.debtUsd)}</td>
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
				backgroundColor: '#3b4a46',
				borderRadius: '12px',
				padding: '1rem 1.25rem',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				height: '100%',
				color: '#f7f2eb',
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
				Totals Tin
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
	const color = accent === 'red' ? '#f97373' : undefined;
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
