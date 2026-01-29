import React, { useEffect, useState } from 'react';
import './WalletSummary.css';

type WalletSummaryState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'empty'; message: string; hint?: string }
	| {
			status: 'ready';
			wallet: {
				walletId: string;
				label: string | null;
				address: string;
				totalUsd: number;
				tokens: Array<{
					tokenSymbol: string;
					chain: string;
					amount: number;
					usdValue: number;
					priceUsd?: number | null;
					capturedAt?: string | null;
				}>;
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
				const res = await fetch(`/api/wallets/${walletId}/tokens?refreshMissing=1`);
				const payload = await res.json();
				if (!payload?.ok) {
					throw new Error(payload?.message ?? payload?.error ?? 'Unable to load wallet tokens.');
				}
				const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
				const totalUsd = tokens.reduce((sum, token) => sum + Number(token.usdValue ?? 0), 0);
				const isDust = Math.abs(totalUsd) < DUST_THRESHOLD_USD;
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
						wallet: {
							walletId: String(payload.walletId ?? walletId),
							label: payload.label ?? null,
							address: String(payload.address ?? ''),
							totalUsd,
							tokens: tokens
								.filter((token) => Number(token.usdValue ?? 0) > 0)
								.sort((a, b) => Number(b.usdValue ?? 0) - Number(a.usdValue ?? 0)),
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
							{currencyFormatter.format(state.wallet.totalUsd)}
						</span>
					</div>
					<section className="wallet-summary__chain">
						<h4 className="wallet-summary__chain-title">
							{state.wallet.label || 'Wallet'}
						</h4>
						<div className="wallet-summary__chain-rows">
							<div className="wallet-summary__row wallet-summary__row--header">
								<span className="wallet-summary__cell wallet-summary__cell--token">Token</span>
								<span className="wallet-summary__cell wallet-summary__cell--days">Chain</span>
								<span className="wallet-summary__cell wallet-summary__cell--qty">Days</span>
								<span className="wallet-summary__cell wallet-summary__cell--pl">Qty</span>
								<span className="wallet-summary__cell wallet-summary__cell--pl">Price</span>
								<span className="wallet-summary__cell wallet-summary__cell--value">Value</span>
							</div>
							{state.wallet.tokens.map((token) => {
								const priceUsd =
									Number.isFinite(token.priceUsd) && Number(token.priceUsd) > 0
										? Number(token.priceUsd)
										: Number(token.usdValue ?? 0) / (Number(token.amount ?? 0) || 1);
								const capturedAt = token.capturedAt ? Date.parse(token.capturedAt) : NaN;
								const daysHeld = Number.isFinite(capturedAt)
									? Math.max(0, Math.floor((Date.now() - capturedAt) / (1000 * 60 * 60 * 24)))
									: null;
								return (
									<div key={`${token.chain}-${token.tokenSymbol}`} className="wallet-summary__row">
										<span className="wallet-summary__cell wallet-summary__cell--token">
											{token.tokenSymbol}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--days">
											{token.chain}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--qty">
											{daysHeld === null ? '—' : String(daysHeld)}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--pl">
											{Number(token.amount ?? 0).toLocaleString(undefined, {
												maximumFractionDigits: 6,
											})}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--pl">
											{currencyFormatter.format(priceUsd)}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--value">
											{currencyFormatter.format(Number(token.usdValue ?? 0))}
										</span>
									</div>
								);
							})}
						</div>
					</section>
				</>
			) : null}
		</div>
	);
}
