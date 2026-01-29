import React, { useEffect, useState } from 'react';
import { normalizeNetWorthSummary } from '@/lib/networth/summaryContract';
import './WalletSummary.css';

type WalletSummaryState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'empty'; message: string; hint?: string }
	| {
			status: 'ready';
			tin: {
				tinId: string;
				tinName: string;
				assetsUsd: number;
				freeAssetsUsd: number;
				debtUsd: number;
				netUsd: number;
			};
	  };

const currencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 2,
});
const DUST_THRESHOLD_USD = 1;

export default function WalletSummary({ walletId }: { walletId: string }) {
	const [state, setState] = useState<WalletSummaryState>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;
		const loadSummary = async () => {
			try {
				setState({ status: 'loading' });
				const res = await fetch('/api/networth/summary');
				const payload = await res.json();
				if (!payload?.ok) {
					throw new Error(payload?.message ?? 'Unable to load wallet summary.');
				}
				const summary = normalizeNetWorthSummary(payload);
				const tin = summary.tins.find((t) => t.tinId === walletId);
				if (!tin) {
					if (!cancelled) {
						setState({
							status: 'empty',
							message: 'No data for this wallet yet.',
							hint: 'Try refreshing or reconnecting.',
						});
					}
					return;
				}
				const isDust =
					Math.abs(tin.netUsd) < DUST_THRESHOLD_USD &&
					Math.abs(tin.assetsUsd) < DUST_THRESHOLD_USD &&
					Math.abs(tin.debtUsd) < DUST_THRESHOLD_USD &&
					Math.abs(tin.freeAssetsUsd) < DUST_THRESHOLD_USD;
				if (isDust) {
					if (!cancelled) {
						setState({
							status: 'empty',
							message: 'No balance data yet.',
							hint: 'Add a wallet and run a sync to populate totals.',
						});
					}
					return;
				}
				if (!cancelled) {
					setState({
						status: 'ready',
						tin: {
							tinId: tin.tinId,
							tinName: tin.tinName,
							assetsUsd: tin.assetsUsd,
							freeAssetsUsd: tin.freeAssetsUsd,
							debtUsd: tin.debtUsd,
							netUsd: tin.netUsd,
						},
					});
				}
			} catch (err) {
				if (!cancelled) {
					setState({
						status: 'error',
						message: err instanceof Error ? err.message : 'Unable to load wallet summary.',
					});
				}
			}
		};
		loadSummary();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	return (
		<div className="wallet-summary">
			{state.status === 'loading' ? (
				<div className="wallet-summary__status">Loading summary…</div>
			) : null}
			{state.status === 'error' ? (
				<div className="wallet-summary__status wallet-summary__status--error">{state.message}</div>
			) : null}
			{state.status === 'empty' ? (
				<div className="wallet-summary__status">
					{state.message}
					{state.hint ? <div className="wallet-summary__status-hint">{state.hint}</div> : null}
				</div>
			) : null}

			{state.status === 'ready' ? (
				<>
					<div className="wallet-summary__total">
						<span className="wallet-summary__total-label">Total</span>
						<span className="wallet-summary__total-value">
							{currencyFormatter.format(state.tin.netUsd)}
						</span>
					</div>
					<section className="wallet-summary__chain">
						<h4 className="wallet-summary__chain-title">{state.tin.tinName || 'Wallet'}</h4>
						<div className="wallet-summary__chain-rows">
							<div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7 }}>
								<span>Assets</span>
								<span>{currencyFormatter.format(state.tin.assetsUsd)}</span>
							</div>
							<div style={{ display: 'flex', justifyContent: 'space-between' }}>
								<span>Free</span>
								<span>{currencyFormatter.format(state.tin.freeAssetsUsd)}</span>
							</div>
							<div style={{ display: 'flex', justifyContent: 'space-between', color: '#f97373' }}>
								<span>Debt</span>
								<span>{currencyFormatter.format(state.tin.debtUsd)}</span>
							</div>
							<div style={{ display: 'flex', justifyContent: 'space-between' }}>
								<span>Net</span>
								<span>{currencyFormatter.format(state.tin.netUsd)}</span>
							</div>
						</div>
					</section>
				</>
			) : null}
		</div>
	);
}
