/**
 * MonthlyReconciliation — checkbook-style monthly portfolio reconciliation tile.
 *
 * Shows per-month:
 *   Opening balance + inflows - outflows = expected closing
 *   vs. actual closing from wallet snapshots
 *   delta = unexplained difference (price change + missing data)
 *
 * Flags unmatched transfer halves (transactions that disappeared from the data).
 */

import { useState, useEffect, useCallback } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getMonthlyReconciliation } from '@/i18n/components/monthlyReconciliation';

// ── Types (mirrors src/lib/monthlyReconciliation.ts) ─────────────────────────

type MonthlyAssetRow = {
	assetSymbol: string;
	inflowsQty: number;
	inflowsUsd: number;
	outflowsQty: number;
	outflowsUsd: number;
	unmatchedOutQty: number;
	unmatchedOutUsd: number;
	unmatchedInQty: number;
	unmatchedInUsd: number;
	txCount: number;
};

type MonthlyReconciliation = {
	yearMonth: string;
	openingAssetsUsd: number | null;
	closingAssetsUsd: number | null;
	inflowsUsd: number;
	outflowsUsd: number;
	transferInUsd: number;
	transferOutUsd: number;
	unmatchedOutUsd: number;
	unmatchedInUsd: number;
	expectedClosingUsd: number | null;
	deltaUsd: number | null;
	txCount: number;
	unmatchedTxCount: number;
	assets: MonthlyAssetRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined) =>
	n == null
		? '—'
		: n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const sign = (n: number) => (n >= 0 ? '+' : '');

function deltaColor(delta: number | null): string {
	if (delta == null) return 'var(--text-muted)';
	if (Math.abs(delta) < 50) return 'var(--gain)';   // green — balanced
	if (delta > 0) return 'var(--gain)';               // gain
	return 'var(--loss)';                              // loss / data gap
}

function monthLabel(ym: string, dateLocale: string): string {
	const [y, m] = ym.split('-');
	const date = new Date(Number(y), Number(m) - 1, 1);
	return date.toLocaleString(dateLocale, { month: 'long', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MonthlyReconciliationTile() {
	const t = getMonthlyReconciliation(getClientLang());
	const [months, setMonths]       = useState<string[]>([]);
	const [selected, setSelected]   = useState<string>('');
	const [data, setData]           = useState<MonthlyReconciliation | null>(null);
	const [loading, setLoading]     = useState(false);
	const [expanded, setExpanded]   = useState(false); // per-asset breakdown

	// Load available months on mount
	useEffect(() => {
		fetch('/api/reconciliation/monthly?months=all')
			.then((r) => r.json())
			.then((j: { months: string[] }) => {
				const ms = j.months ?? [];
				setMonths(ms);
				if (ms.length) setSelected(ms[0]);
			})
			.catch(() => {});
	}, []);

	const load = useCallback((month: string) => {
		if (!month) return;
		setLoading(true);
		setData(null);
		fetch(`/api/reconciliation/monthly?month=${month}`)
			.then((r) => r.json())
			.then((j: { data: MonthlyReconciliation }) => setData(j.data ?? null))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const recompute = useCallback((month: string) => {
		if (!month) return;
		setLoading(true);
		fetch('/api/reconciliation/monthly', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ month }),
		})
			.then((r) => r.json())
			.then((j: { data: MonthlyReconciliation }) => setData(j.data ?? null))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (selected) load(selected);
	}, [selected, load]);

	const hasUnmatched = data && (data.unmatchedOutUsd > 0 || data.unmatchedInUsd > 0);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

			{/* Month selector */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
				<select
					value={selected}
					onChange={(e) => setSelected(e.target.value)}
					style={{
						background: 'var(--surface-card-2)', border: '1px solid var(--accent-dim)',
						color: 'var(--text-secondary)', borderRadius: 8, padding: '0.35rem 0.6rem',
						fontSize: '0.85rem', cursor: 'pointer',
					}}
				>
					{months.map((m) => (
						<option key={m} value={m}>{monthLabel(m, t.dateLocale)}</option>
					))}
				</select>
				<button
					onClick={() => recompute(selected)}
					disabled={loading || !selected}
					style={{
						background: 'none', border: '1px solid var(--accent-dim)',
						color: 'var(--accent)', borderRadius: 8, padding: '0.3rem 0.7rem',
						fontSize: '0.75rem', cursor: 'pointer', textTransform: 'uppercase',
						letterSpacing: '0.1em', opacity: loading ? 0.5 : 1,
					}}
				>
					{loading ? t.computing : t.recompute}
				</button>
			</div>

			{loading && (
				<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>{t.computing}</p>
			)}

			{data && !loading && (
				<>
					{/* Checkbook summary */}
					<div style={{
						background: 'var(--surface-card-2)', borderRadius: 10, padding: '0.85rem 1rem',
						display: 'flex', flexDirection: 'column', gap: '0.45rem',
						border: '1px solid var(--border-bright)',
					}}>
						<Row label={t.openingBalance} value={usd(data.openingAssetsUsd)} />
						<Row label={t.inflows} value={usd(data.inflowsUsd)} color="var(--gain)" />
						<Row label={t.outflows} value={`−${usd(data.outflowsUsd)}`} color="var(--loss)" />
						{(data.transferInUsd > 0 || data.transferOutUsd > 0) && (
							<Row
								label={t.matchedTransfers}
								value={usd(data.transferInUsd - data.transferOutUsd)}
								color="var(--text-muted)"
								muted
							/>
						)}
						<div style={{ borderTop: '1px dashed var(--accent-dim)', margin: '0.2rem 0' }} />
						<Row label={t.expectedClosing} value={usd(data.expectedClosingUsd)} />
						<Row label={t.actualClosing} value={usd(data.closingAssetsUsd)} bold />
						<div style={{ borderTop: '1px solid var(--accent-dim)', margin: '0.2rem 0' }} />
						<Row
							label={t.delta}
							value={data.deltaUsd != null ? `${sign(data.deltaUsd)}${usd(data.deltaUsd)}` : '—'}
							color={deltaColor(data.deltaUsd)}
							bold
						/>
					</div>

					{/* Unmatched transfer warning */}
					{hasUnmatched && (
						<div style={{
							background: 'var(--loss-bg)', border: '1px solid var(--loss-border)',
							borderRadius: 8, padding: '0.65rem 0.85rem',
							fontSize: '0.8rem', color: 'var(--loss)',
							display: 'flex', flexDirection: 'column', gap: '0.3rem',
						}}>
							<span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
								{t.unmatchedWarning(data.unmatchedTxCount)}
							</span>
							{data.unmatchedOutUsd > 0 && (
								<span>{t.unmatchedOut(usd(data.unmatchedOutUsd))}</span>
							)}
							{data.unmatchedInUsd > 0 && (
								<span>{t.unmatchedIn(usd(data.unmatchedInUsd))}</span>
							)}
						</div>
					)}

					{/* Per-asset breakdown toggle */}
					{data.assets.length > 0 && (
						<button
							onClick={() => setExpanded((x) => !x)}
							style={{
								background: 'none', border: '1px dashed var(--accent-dim)',
								color: 'var(--accent)', borderRadius: 8, padding: '0.3rem 0.75rem',
								fontSize: '0.72rem', cursor: 'pointer', textTransform: 'uppercase',
								letterSpacing: '0.12em', alignSelf: 'flex-start',
							}}
						>
							{expanded ? t.hideBreakdown : t.showBreakdown}{t.assetBreakdownSuffix(data.assets.length)}
						</button>
					)}

					{expanded && (
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
							{/* Header */}
							<div style={{
								display: 'grid', gridTemplateColumns: '4rem 1fr 1fr 1fr',
								gap: '0.5rem', padding: '0.25rem 0.5rem',
								fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em',
								color: 'var(--text-muted)',
							}}>
								<span>{t.colAsset}</span>
								<span style={{ textAlign: 'right' }}>{t.colIn}</span>
								<span style={{ textAlign: 'right' }}>{t.colOut}</span>
								<span style={{ textAlign: 'right' }}>{t.colGap}</span>
							</div>
							{data.assets.map((a) => {
								const hasGap = a.unmatchedOutUsd > 0 || a.unmatchedInUsd > 0;
								return (
									<div key={a.assetSymbol} style={{
										display: 'grid', gridTemplateColumns: '4rem 1fr 1fr 1fr',
										gap: '0.5rem', padding: '0.3rem 0.5rem',
										background: hasGap ? 'var(--loss-bg)' : 'var(--border-subtle)',
										borderRadius: 6, fontSize: '0.8rem', alignItems: 'center',
									}}>
										<span style={{ fontWeight: 700, color: 'var(--accent)' }}>{a.assetSymbol}</span>
										<span style={{ textAlign: 'right', color: 'var(--gain)' }}>
											{usd(a.inflowsUsd)}
										</span>
										<span style={{ textAlign: 'right', color: 'var(--loss)' }}>
											{a.outflowsUsd > 0 ? `−${usd(a.outflowsUsd)}` : '—'}
										</span>
										<span style={{ textAlign: 'right', color: hasGap ? 'var(--loss)' : 'var(--text-muted)' }}>
											{hasGap ? usd(a.unmatchedOutUsd + a.unmatchedInUsd) : '—'}
										</span>
									</div>
								);
							})}
						</div>
					)}

					<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
						{t.txFooter(data.txCount)}
					</p>
				</>
			)}

			{!loading && !data && selected && (
				<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>{t.noData}</p>
			)}
		</div>
	);
}

// ── Row sub-component ─────────────────────────────────────────────────────────

function Row({
	label, value, color, bold, muted,
}: {
	label: string;
	value: string;
	color?: string;
	bold?: boolean;
	muted?: boolean;
}) {
	return (
		<div style={{
			display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
			fontSize: muted ? '0.78rem' : '0.85rem',
			opacity: muted ? 0.65 : 1,
		}}>
			<span style={{ color: 'var(--text-muted)' }}>{label}</span>
			<span style={{ color: color ?? 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{value}</span>
		</div>
	);
}
