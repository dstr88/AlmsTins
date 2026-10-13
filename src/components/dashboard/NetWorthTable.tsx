import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getNetWorthTable } from '@/i18n/components/netWorthTable';

type ChainBreakdown = { chain: string; totalUsd: number };

type WalletChainBreakdown = {
	chain: string;
	totalUsd: number;
	capturedAt: string;
};

type WalletBreakdown = {
	walletId: string;
	walletLabel: string | null;
	totalUsd: number;
	byChain: WalletChainBreakdown[];
};

type TinBreakdown = {
	tinId: string;
	tinName: string;
	assetsUsd: number;
	freeAssetsUsd: number;
	debtUsd: number;
	netUsd: number;
};

type NetWorthSummary = {
	totalUsd: number;
	byWallet: WalletBreakdown[];
	byChain: ChainBreakdown[];
	tins?: TinBreakdown[];
	tinCount?: number;
};

type NetWorthResponse = { ok: boolean; summary?: NetWorthSummary };

// Distinct per-chain series colors — chart-readability exception (same rationale
// as AaveRateChart): chains must be visually distinguishable, so these intentionally
// use brand/identity hues outside the token palette. Documented in CLAUDE.md.
const CHAIN_COLORS: Record<string, string> = {
	ethereum: '#a855f7',
	polygon: '#6366f1',
	avalanche: '#f97316',
	bitcoin: '#f7931a',
};

const FALLBACK_COLORS = ['#10b981', '#ec4899', '#facc15', '#0ea5e9', '#f472b6'];

export default function NetWorthTable() {
	const t = getNetWorthTable(getClientLang());
	const [summary, setSummary] = useState<NetWorthSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const response = await fetch('/api/networth/summary');
				const payload = (await response.json()) as NetWorthResponse;
				if (!payload.ok || !payload.summary) {
					throw new Error('Failed to load net worth.');
				}
				if (mounted) {
					setSummary(payload.summary);
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err.message : 'Failed to load net worth.');
				}
			} finally {
				if (mounted) setLoading(false);
			}
		};

		load();
		return () => {
			mounted = false;
		};
	}, []);

	const totalUsd = summary?.totalUsd ?? 0;
	const chainBreakdown = summary?.byChain ?? [];
	const walletRows = summary?.byWallet ?? [];
	const tins = summary?.tins ?? [];
	const tinCount = summary?.tinCount ?? tins.length ?? walletRows.length;

	const donutSegments = useMemo(() => buildSegments(chainBreakdown, totalUsd), [chainBreakdown, totalUsd]);

	if (loading) {
		return <p className="text-sm text-muted-foreground">{t.loading}</p>;
	}

	if (error) {
		return (
			<p className="rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-500">
				{error}
			</p>
		);
	}

	if (!summary) {
		return (
			<p className="text-sm text-muted-foreground">
				{t.noSnapshots}
			</p>
		);
	}

	return (
		<div className="space-y-6">
			<div className="rounded-lg border bg-card p-6">
				<div className="flex flex-col gap-8 md:flex-row">
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-wide text-muted-foreground">{t.aggregateLabel}</p>
						<p className="text-3xl font-semibold">${formatUsd(totalUsd)}</p>
						<p className="text-sm text-muted-foreground">
							{t.tinCountDescription(tinCount)}
						</p>
						<ul className="mt-4 space-y-2 text-sm">
							{chainBreakdown.map((entry, idx) => {
								const color =
									CHAIN_COLORS[entry.chain.toLowerCase()] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
								const pct = totalUsd ? ((entry.totalUsd / totalUsd) * 100).toFixed(1) : '0.0';
								return (
									<li key={entry.chain} className="flex items-center justify-between">
										<span className="flex items-center gap-2">
											<span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
											<span className="capitalize">{entry.chain}</span>
										</span>
										<span className="text-right font-medium">
											${formatUsd(entry.totalUsd)} <span className="text-xs text-muted-foreground">({pct}%)</span>
										</span>
									</li>
								);
							})}
						</ul>
					</div>
					<div className="mx-auto md:ml-auto">
						<ChainDonut segments={donutSegments} totalUsd={totalUsd} />
					</div>
				</div>
			</div>

			<div className="rounded-lg border bg-card">
				<div className="border-b px-4 py-3">
					<h2 className="text-lg font-semibold">{t.byTinHeading}</h2>
					<p className="text-sm text-muted-foreground">{t.byTinSubtitle}</p>
				</div>
				<div className="overflow-x-auto">
					<table className="min-w-full text-sm">
						<thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
							<tr>
								<th className="px-4 py-2 text-left">{t.colTin}</th>
								<th className="px-4 py-2 text-left">{t.colTotalUsd}</th>
								<th className="px-4 py-2 text-left">{t.colPerChain}</th>
							</tr>
						</thead>
						<tbody>
							{walletRows.map((wallet) => (
								<tr key={wallet.walletId} className="border-t border-border/50">
									<td className="px-4 py-3">
										<div className="font-medium">{wallet.walletLabel ?? wallet.walletId.slice(0, 10)}</div>
										<div className="text-xs text-muted-foreground">{wallet.walletId}</div>
									</td>
									<td className="px-4 py-3 font-semibold">${formatUsd(wallet.totalUsd)}</td>
									<td className="px-4 py-3">
										<div className="space-y-2">
											{wallet.byChain.map((chain, index) => (
												<div key={`${wallet.walletId}-${chain.chain}-${index}`} className="flex items-center justify-between">
													<span className="capitalize text-xs text-muted-foreground">{chain.chain}</span>
													<span className="text-sm font-medium">${formatUsd(chain.totalUsd)}</span>
												</div>
											))}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

type DonutSegment = {
	chain: string;
	value: number;
	pct: number;
	color: string;
};

type DonutCenterSegment = {
	label: string;
	amountUsd: number;
	pct: number;
	color: string;
};

function ChainDonut({ segments, totalUsd }: { segments: DonutSegment[]; totalUsd: number }) {
	const t = getNetWorthTable(getClientLang());
	const size = 180;
	const strokeWidth = 26;
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const [selected, setSelected] = useState<DonutCenterSegment | null>(null);
	const [tooltip, setTooltip] = useState<{ label: string; pct: string; amount: string; x: number; y: number } | null>(
		null,
	);
	const containerRef = useRef<HTMLDivElement | null>(null);

	if (!segments.length) {
		return (
			<div className="flex h-[180px] w-[180px] items-center justify-center text-sm text-muted-foreground">
				{t.donutNoData}
			</div>
		);
	}

	let offset = 0;

	return (
		<div
			className="chain-donut-container"
			ref={containerRef}
			style={{
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: size,
				height: size,
				margin: '0 auto',
				overflow: 'hidden',
			}}
		>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="transparent"
					stroke="var(--border-bright)"
					strokeWidth={strokeWidth}
				/>
				{segments.map((segment) => {
					const dash = segment.pct * circumference;
					const pctText = `${(segment.pct * 100).toFixed(1)}%`;
					const amountText = formatUsd(segment.value);
					const circle = (
						<circle
							key={segment.chain}
							className={`donut-slice ${
								selected?.label === segment.chain ? 'donut-slice--selected' : selected ? 'donut-slice--dimmed' : ''
							}`}
							cx={size / 2}
							cy={size / 2}
							r={selected?.label === segment.chain ? radius + 2 : radius}
							fill="transparent"
							stroke={segment.color}
							strokeWidth={strokeWidth}
							strokeDasharray={`${dash} ${circumference - dash}`}
							strokeDashoffset={-offset}
							strokeLinecap="round"
							onClick={() => {
								setSelected((prev) =>
									prev?.label === segment.chain
										? null
										: {
												label: segment.chain,
												amountUsd: segment.value,
												pct: segment.pct,
												color: segment.color,
										  },
								);
								setTooltip(null);
							}}
							onMouseEnter={(event) => {
								const rect = containerRef.current?.getBoundingClientRect();
								if (!rect) return;
								setTooltip({
									label: segment.chain,
									pct: pctText,
									amount: amountText,
									x: event.clientX - rect.left,
									y: event.clientY - rect.top,
								});
							}}
							onMouseLeave={() => setTooltip(null)}
							onMouseMove={(event) => {
								if (!tooltip) return;
								const rect = containerRef.current?.getBoundingClientRect();
								if (!rect) return;
								setTooltip((prev) =>
									prev
										? {
												...prev,
												x: event.clientX - rect.left,
												y: event.clientY - rect.top,
										  }
										: prev,
								);
							}}
						/>
					);
					offset += dash;
					return circle;
				})}
			</svg>
			{tooltip && !selected && (
				<div className="donut-tooltip" style={{ left: tooltip.x, top: tooltip.y, opacity: 1 }}>
					<p className="donut-tooltip-title">{tooltip.label}</p>
					<p className="donut-tooltip-values">
						{tooltip.pct} • {tooltip.amount}
					</p>
				</div>
			)}
			<DonutCenterPanel
				totalUsd={totalUsd}
				selectedSegment={
					selected
						? {
								label: selected.label,
								amountUsd: selected.amountUsd,
								pct: selected.pct,
								color: selected.color,
						  }
						: undefined
				}
			/>
		</div>
	);
}

type DonutCenterPanelProps = {
	totalUsd: number;
	selectedSegment?: { label: string; amountUsd: number; pct: number; color?: string };
};

function DonutCenterPanel({ totalUsd, selectedSegment }: DonutCenterPanelProps) {
	const t = getNetWorthTable(getClientLang());
	const amountFormatter = (value: number) =>
		value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

	if (!selectedSegment) {
		return (
			<div
				className="donut-center-panel"
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: '0.35rem',
					textAlign: 'center',
					minWidth: '120px',
					pointerEvents: 'none',
				}}
			>
				<p className="donut-center-line1">{t.donutCenterLine1}</p>
				<p className="donut-center-line2">{amountFormatter(totalUsd)}</p>
				<p className="donut-center-line3">{t.donutCenterLine3}</p>
			</div>
		);
	}

	return (
		<div
			className="donut-center-panel donut-center-panel--active"
			style={{
				position: 'absolute',
				top: '50%',
				left: '50%',
				transform: 'translate(-50%, -50%)',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: '0.35rem',
				textAlign: 'center',
				minWidth: '120px',
				pointerEvents: 'none',
			}}
		>
			<p className="donut-center-line1">{selectedSegment.label}</p>
			<p className="donut-center-line2">{amountFormatter(selectedSegment.amountUsd)}</p>
			<p className="donut-center-line3">{t.donutSelectedPct((selectedSegment.pct * 100).toFixed(1))}</p>
		</div>
	);
}

function buildSegments(chains: ChainBreakdown[], total: number): DonutSegment[] {
	if (!total) return [];
	return chains.map((entry, idx) => {
		const color =
			CHAIN_COLORS[entry.chain.toLowerCase()] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
		return {
			chain: entry.chain,
			value: entry.totalUsd,
			pct: entry.totalUsd / total,
			color,
		};
	});
}

function formatUsd(value: number) {
	return value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}
