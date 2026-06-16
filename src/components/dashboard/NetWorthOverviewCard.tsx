import React, { useEffect, useState } from 'react';
import { normalizeNetWorthSummary, type NetWorthSummary } from '@/lib/networth/summaryContract';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getNetWorthOverviewCard } from '@/i18n/components/netWorthOverviewCard';

console.log('[island.mount]', 'NetWorthOverviewCard');

type Props = {
	endpoint?: string;
};

const formatter = Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function NetWorthOverviewCard({ endpoint = '/api/networth/summary' }: Props) {
	const [summary, setSummary] = useState<NetWorthSummary | null>(null);
	const [open, setOpen] = useState(false);
	const t = getNetWorthOverviewCard(getClientLang());

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				const response = await fetch(endpoint);
				const payload = await response.json();
				if (!mounted) return;
				const summary = normalizeNetWorthSummary(payload);
				setSummary(summary);
			} catch (error) {
				console.error('[NetWorthOverviewCard] Failed to load summary', error);
				if (mounted) setSummary(null);
			}
		};
		load();
		return () => {
			mounted = false;
		};
	}, [endpoint]);

	const totalUsd = summary?.totalUsd ?? 0;
	const chains = summary?.byChain ?? [];

	return (
		<div
			className="networth-overview-card"
			style={{
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<header className="networth-overview-header">
				<button
					type="button"
					className={`overview-screw ${open ? 'overview-screw--open' : ''}`}
					onClick={() => setOpen((prev) => !prev)}
					aria-label={t.toggleBreakdown}
				>
					<span className="screw-groove screw-groove--horizontal" />
					<span className="screw-groove screw-groove--vertical" />
				</button>
			</header>

			<div className="overview-body">
				{!open && (
					<div className="overview-total">
						<span>{t.total}</span>
						<strong>{formatter.format(totalUsd)}</strong>
					</div>
				)}

				{open && (
					<div className="overview-breakdown">
						<h4>{t.chainBreakdown}</h4>
						{chains.length === 0 ? (
							<p className="overview-empty">{t.breakdownPlaceholder}</p>
						) : (
							<ul className="overview-token-list">
								{chains.map((chain) => (
									<li key={chain.chain} className="overview-token-row">
										<div className="overview-token-symbol">
											<span>{chain.chain.toUpperCase()}</span>
										</div>
										<div className="overview-token-value">
											{formatter.format(chain.totalUsd || (chain.assetsUsd - chain.debtUsd))}
										</div>
									</li>
								))}
							</ul>
						)}
						<div className="overview-realized">
							<p>{t.realizedPlaceholder}</p>
							{/* Future realized gains component will mount here */}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default NetWorthOverviewCard;
