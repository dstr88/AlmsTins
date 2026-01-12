import React, { useEffect, useState } from 'react';

type NetWorthToken = {
	symbol: string;
	valueUsd: number;
	isDebt?: boolean;
	isMature?: boolean;
	unrealizedPnlUsd?: number;
	unrealizedPnlPct?: number;
};

type NetWorthSummary = {
	totalUsd: number;
	tokens?: NetWorthToken[];
};

type Props = {
	endpoint?: string;
};

const formatter = Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function NetWorthOverviewCard({ endpoint = '/api/networth/summary' }: Props) {
	const [summary, setSummary] = useState<NetWorthSummary | null>(null);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				const response = await fetch(endpoint);
				const data = await response.json();
				if (!mounted) return;
				if (data?.summary) {
					setSummary({ totalUsd: data.summary.totalUsd ?? 0, tokens: data.summary.tokens ?? [] });
				} else {
					setSummary({ totalUsd: 0, tokens: [] });
				}
			} catch (error) {
				console.error('[NetWorthOverviewCard] Failed to load summary', error);
				if (mounted) setSummary({ totalUsd: 0, tokens: [] });
			}
		};
		load();
		return () => {
			mounted = false;
		};
	}, [endpoint]);

	const totalUsd = summary?.totalUsd ?? 0;
	const tokens = summary?.tokens ?? [];

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
					aria-label="Toggle token breakdown"
				>
					<span className="screw-groove screw-groove--horizontal" />
					<span className="screw-groove screw-groove--vertical" />
				</button>
			</header>

			<div className="overview-body">
				{!open && null}

				{open && (
					<div className="overview-breakdown">
						<h4>Token breakdown</h4>
						{tokens.length === 0 ? (
							<p className="overview-empty">Token breakdown will appear here.</p>
						) : (
							<ul className="overview-token-list">
								{tokens.map((token) => (
									<li key={token.symbol} className="overview-token-row">
										<div className="overview-token-symbol">
											<span>{token.symbol}</span>
											{token.isMature && <span className="token-mature-badge">1y+</span>}
											{/* Future: apply a special border/badge when token.isMature === true */}
										</div>
										<div className="overview-token-value">
											{formatter.format(token.valueUsd)}
											{token.isDebt && <span className="token-debt">Debt</span>}
											{/* Future: color-code by unrealizedPnlUsd / unrealizedPnlPct */}
										</div>
									</li>
								))}
							</ul>
						)}
						<div className="overview-realized">
							<p>Realized gains history (placeholder)</p>
							{/* Future realized gains component will mount here */}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default NetWorthOverviewCard;
