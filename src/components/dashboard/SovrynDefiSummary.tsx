import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getSovrynDefiSummary } from '@/i18n/components/sovrynDefiSummary';

console.log('[island.mount]', 'SovrynDefiSummary');

type LendingPosition = { pool: string; tokenSymbol: string; netBalance: string };
type AmmPosition     = { pair: string; balance: string };

type FetchState =
	| { status: 'loading' }
	| { status: 'error'; message?: string }
	| {
			status: 'ready';
			lendingPositions: LendingPosition[];
			ammPositions: AmmPosition[];
			detectedContracts: string[];
			subgraphAvailable: boolean;
	  };

export default function SovrynDefiSummary({ walletId }: { walletId: string }) {
	const t = getSovrynDefiSummary(getClientLang());
	const [state, setState] = useState<FetchState>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res  = await fetch(`/api/wallets/${walletId}/sovryn-defi`, { credentials: 'include' });
				const data = await res.json() as {
					ok?: boolean;
					lendingPositions?: LendingPosition[];
					ammPositions?: AmmPosition[];
					detectedContracts?: string[];
					subgraphAvailable?: boolean;
					message?: string;
				};
				if (!cancelled) {
					if (!data.ok) throw new Error(data.message ?? 'Sovryn lookup failed');
					setState({
						status:             'ready',
						lendingPositions:   data.lendingPositions   ?? [],
						ammPositions:       data.ammPositions       ?? [],
						detectedContracts:  data.detectedContracts  ?? [],
						subgraphAvailable:  data.subgraphAvailable  ?? false,
					});
				}
			} catch (err: any) {
				if (!cancelled) setState({ status: 'error', message: err?.message });
			}
		})();
		return () => { cancelled = true; };
	}, [walletId]);

	if (state.status === 'loading') {
		return (
			<div className="defi-stats">
				<div className="defi-status defi-status--loading">{t.loading}</div>
			</div>
		);
	}

	if (state.status === 'error') {
		return (
			<div className="defi-stats">
				<div className="defi-status defi-status--error">{t.error}</div>
			</div>
		);
	}

	const { lendingPositions, ammPositions, detectedContracts, subgraphAvailable } = state;
	const hasAny = lendingPositions.length > 0 || ammPositions.length > 0 || detectedContracts.length > 0;

	// Compute a summary USD total for the collapsed tin label
	// (netBalance is in token units — display token symbol + amount, not USD)
	const lendingTotal = lendingPositions.length;

	return (
		<div className="defi-stats">
			{/* stat-row.health is read by vault.astro's updateDefiSummary for the collapsed tin */}
			<div className="stat-row health">
				<span className="label">Sovryn</span>
				<span className="value">
					{hasAny ? t.positionCount(lendingTotal + ammPositions.length) : '—'}
				</span>
			</div>

			<div className="spacer spacer--lg" />

			{/* Lending positions */}
			{lendingPositions.length > 0 && (
				<>
					<div className="breakdown-title">{t.lendingPositions}</div>
					<div className="breakdown">
						{lendingPositions.map((pos) => (
							<div className="stat-row" key={pos.pool} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
								<span className="label">{pos.tokenSymbol}</span>
								<span className="value" style={{ marginLeft: 'auto', fontSize: '0.78em', color: 'var(--text-secondary)' }}>
									{parseFloat(pos.netBalance).toLocaleString('en-US', { maximumFractionDigits: 6 })} {pos.tokenSymbol}
								</span>
							</div>
						))}
					</div>
				</>
			)}

			{/* AMM / LP positions */}
			{ammPositions.length > 0 && (
				<>
					{lendingPositions.length > 0 && (
						<>
							<div className="spacer spacer--md" />
							<div className="divider" />
							<div className="spacer spacer--sm" />
						</>
					)}
					<div className="breakdown-title">{t.ammLiquidity}</div>
					<div className="breakdown">
						{ammPositions.map((pos) => (
							<div className="stat-row" key={pos.pair} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
								<span className="label">{pos.pair}</span>
								<span className="value" style={{ marginLeft: 'auto', fontSize: '0.78em', color: 'var(--text-secondary)' }}>
									{parseFloat(pos.balance).toLocaleString('en-US', { maximumFractionDigits: 4 })} LP
								</span>
							</div>
						))}
					</div>
				</>
			)}

			{/* Contract detection fallback (when subgraph unavailable) */}
			{!subgraphAvailable && detectedContracts.length > 0 && (
				<>
					{(lendingPositions.length > 0 || ammPositions.length > 0) && (
						<>
							<div className="spacer spacer--md" />
							<div className="divider" />
							<div className="spacer spacer--sm" />
						</>
					)}
					<div className="breakdown-title">{t.detectedContracts}</div>
					<div className="breakdown">
						{detectedContracts.map((name) => (
							<div className="stat-row" key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
								<span className="label">{name}</span>
							</div>
						))}
					</div>
				</>
			)}

			{!hasAny && (
				<div className="breakdown-empty">{t.noPositions}</div>
			)}

			{!subgraphAvailable && !hasAny && (
				<div className="defi-status defi-status--warning" style={{ marginTop: '0.5rem' }}>
					{t.subgraphUnavailable}
				</div>
			)}
		</div>
	);
}
