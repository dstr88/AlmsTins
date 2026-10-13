/**
 * ReconciliationSnapshot
 *
 * Column 2 of the portfolio reconciliation panel.
 * Shows the net token quantity from wallet snapshots — what the wallets
 * actually reported holding at last sync.
 *
 * When a discrepancy exists vs. the transaction column, shows the delta
 * and a Memory Lane link so the user can investigate.
 */

import React, { useEffect, useState } from 'react';
import './reconciliation.css';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getReconciliationSnapshot } from '@/i18n/components/reconciliationSnapshot';

interface ReconciliationItem {
	symbol:       string;
	txQty:        number;
	snapQty:      number;
	snapValueUsd: number;
	match:        boolean;
	delta:        number;
}

const USD = new Intl.NumberFormat('en-US', {
	style: 'currency', currency: 'USD',
	maximumFractionDigits: 2,
});

const fmtQty = (n: number): string => {
	if (n === 0) return '0';
	if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
	if (Math.abs(n) >= 1)    return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
	return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

const fmtDelta = (delta: number): string => {
	const sign = delta > 0 ? '+' : '';
	return `${sign}${fmtQty(delta)}`;
};

const currentYear = new Date().getFullYear();

export default function ReconciliationSnapshot({ threshold = 50 }: { threshold?: number }) {
	const t = getReconciliationSnapshot(getClientLang());
	const [items, setItems]         = useState<ReconciliationItem[] | null>(null);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [error, setError]         = useState(false);

	useEffect(() => {
		fetch(`/api/portfolio/reconciliation?threshold=${threshold}`)
			.then(r => r.json())
			.then(data => {
				if (!data.ok) { setError(true); return; }
				setItems(data.items ?? []);
				setUpdatedAt(data.updatedAt ?? null);
			})
			.catch(() => setError(true));
	}, [threshold]);

	return (
		<div className="recon-card">
			<div className="recon-card__header">
				<span className="recon-card__num">2</span>
				<span className="recon-card__title">{t.heading}</span>
			</div>

			{error && (
				<div className="recon-state">{t.errorState}</div>
			)}

			{!error && items === null && (
				<div className="recon-state">
					<div className="recon-spinner" />
					{t.loadingState}
				</div>
			)}

			{!error && items !== null && items.length === 0 && (
				<div className="recon-state">{t.emptyState(threshold)}</div>
			)}

			{!error && items !== null && items.length > 0 && (
				<>
					<ul className="recon-list">
						{items.map(item => (
							<li key={item.symbol} className="recon-row">
								<div className="recon-symbol">
									<div className="recon-symbol__badge">
										{item.symbol.slice(0, 4)}
									</div>
									<div>
										<div className="recon-symbol__name">{item.symbol}</div>
										{item.snapValueUsd > 0 && (
											<div className="recon-qty__usd">{USD.format(item.snapValueUsd)}</div>
										)}
									</div>
								</div>

								<div className="recon-qty">
									<div className="recon-qty__amount">
										{item.snapQty > 0 ? fmtQty(item.snapQty) : '—'}
									</div>
								</div>

								{item.match ? (
									<div className="recon-status">
										<span className="recon-status__dot recon-status__dot--match" />
										<span className="recon-status__label recon-status__label--match">{t.matchLabel}</span>
									</div>
								) : (
									<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
										<div className="recon-status">
											<span className="recon-status__dot recon-status__dot--gap" />
											<span className="recon-delta">{fmtDelta(item.delta)}</span>
										</div>
										<a
											href={`/dashboard/yearEnd/memory-lane?year=${currentYear}&symbol=${item.symbol}`}
											className="recon-ml-link"
											title={t.investigateTitle(item.symbol)}
										>
											{t.historyLink}
										</a>
									</div>
								)}
							</li>
						))}
					</ul>

					{updatedAt && (
						<div className="recon-footer">
							{t.footerAs(new Date(updatedAt).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit' }))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
