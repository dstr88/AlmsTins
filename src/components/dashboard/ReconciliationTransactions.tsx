/**
 * ReconciliationTransactions
 *
 * Column 1 of the portfolio reconciliation panel.
 * Shows the net token quantity derived from the lifecycle / transaction system:
 *   acquired − disposed (excluding wallet-to-wallet transfers).
 *
 * Styled to match the vault page aesthetic.
 */

import React, { useEffect, useState } from 'react';
import './reconciliation.css';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getReconciliationTransactions } from '@/i18n/components/reconciliationTransactions';

interface ReconciliationItem {
	symbol:       string;
	txQty:        number;
	snapQty:      number;
	snapValueUsd: number;
	match:        boolean;
	delta:        number;
}

const fmtQty = (n: number): string => {
	if (n === 0) return '0';
	if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
	if (Math.abs(n) >= 1)    return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
	return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

export default function ReconciliationTransactions({ threshold = 50 }: { threshold?: number }) {
	const t = getReconciliationTransactions(getClientLang());
	const [items, setItems]       = useState<ReconciliationItem[] | null>(null);
	const [updatedAt, setUpdatedAt] = useState<string | null>(null);
	const [error, setError]       = useState(false);

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
				<span className="recon-card__num">1</span>
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
									<span className="recon-symbol__name">{item.symbol}</span>
								</div>

								<div className="recon-qty">
									<div className="recon-qty__amount">
										{item.txQty > 0 ? fmtQty(item.txQty) : '—'}
									</div>
								</div>

								<div className="recon-status">
									<span className={`recon-status__dot recon-status__dot--${item.match ? 'match' : 'gap'}`} />
									<span className={`recon-status__label recon-status__label--${item.match ? 'match' : 'gap'}`}>
										{item.match ? t.matchLabel : t.gapLabel}
									</span>
								</div>
							</li>
						))}
					</ul>

					{updatedAt && (
						<div className="recon-footer">
							{t.lifecycleAsOf(new Date(updatedAt).toLocaleTimeString(t.timeLocale, { hour: '2-digit', minute: '2-digit' }))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
