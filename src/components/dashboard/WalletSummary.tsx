import React, { useEffect, useMemo, useState } from 'react';
import './WalletSummary.css';

type HoldingsToken = {
	symbol: string;
	name: string;
	contractAddress: string;
	decimals: number;
	balance: number;
	priceUsd: number;
	valueUsd: number;
	purchaseBasisUsd?: number;
	basisType: 'purchase' | 'firstTransferIn' | 'unknown';
	profitUsd?: number;
	profitPct?: number;
	basisDate?: string | null;
	firstSeenAt?: string | null;
};

type HoldingsResponse = {
	chain: string;
	wallet: string;
	address: string;
	asOf: string;
	totalUsd: number;
	tokens: HoldingsToken[];
};

type FetchState =
	| { status: 'loading' }
	| { status: 'error' }
	| { status: 'ready'; payload: HoldingsResponse[] };

const formatAmount = (value: number) =>
	Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const currencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 2,
});

const formatDaysInWallet = (value?: string | null) => {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const diffMs = Date.now() - date.getTime();
	if (diffMs < 0) return '—';
	const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
	return `${days}d`;
};

const chainDisplayName = (chain: string) => {
	const normalized = chain.toLowerCase();
	if (normalized === 'ethereum') return 'Ethereum';
	if (normalized === 'polygon') return 'Polygon';
	if (normalized === 'avalanche') return 'Avalanche';
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const isAaveToken = (token: HoldingsToken) => {
	const symbol = token.symbol?.toUpperCase() ?? '';
	const name = token.name?.toLowerCase() ?? '';
	return symbol === 'AAVE' || name.includes('aave');
};

export default function WalletSummary({ walletId }: { walletId: string }) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;
		const cacheKey = `wallet-summary:${walletId}`;
		let hasCached = false;

		if (typeof window !== 'undefined') {
			try {
				const raw = localStorage.getItem(cacheKey);
				if (raw) {
					const parsed = JSON.parse(raw) as { payload?: HoldingsResponse[] };
					if (Array.isArray(parsed?.payload)) {
						setState({ status: 'ready', payload: parsed.payload });
						hasCached = true;
					}
				}
			} catch {
				// Ignore cache parse failures.
			}
		}

		async function loadTokens() {
			try {
				if (!hasCached) {
					setState({ status: 'loading' });
				}
				const chains = [1, 137, 43114];
				const payloads: HoldingsResponse[] = [];
				for (const chainId of chains) {
					const res = await fetch(`/api/wallets/${walletId}/holdings?chainid=${chainId}`);
					if (!res.ok) {
						throw new Error('Request failed');
					}
					const data = (await res.json()) as HoldingsResponse;
					const tokens = Array.isArray(data.tokens) ? data.tokens : [];
					payloads.push({ ...data, tokens });
				}
				if (!cancelled) {
					setState({ status: 'ready', payload: payloads });
					if (typeof window !== 'undefined') {
						try {
							localStorage.setItem(cacheKey, JSON.stringify({ payload: payloads, savedAt: Date.now() }));
						} catch {
							// Ignore cache write failures.
						}
					}
				}
			} catch (err) {
				if (!cancelled && !hasCached) {
					setState({ status: 'error' });
				}
			}
		}

		loadTokens();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	const totalUsd = useMemo(() => {
		if (state.status !== 'ready') return 0;
		return state.payload.reduce((sum, entry) => sum + (Number(entry.totalUsd ?? 0) || 0), 0);
	}, [state]);

	const tokensByChain = useMemo(() => {
		if (state.status !== 'ready') return [];
		const ordered = state.payload
			.map((payload) => {
				const filtered = payload.tokens.filter(
					(token) => token.contractAddress === 'native' || (token.valueUsd ?? 0) > 0,
				);
				return [payload.chain, filtered] as [string, HoldingsToken[]];
			})
			.filter(([, tokens]) => tokens.length > 0);
		const order = ['ethereum', 'polygon', 'avalanche'];
		return ordered.sort(([a], [b]) => {
			const aIndex = order.indexOf(a.toLowerCase());
			const bIndex = order.indexOf(b.toLowerCase());
			if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});
	}, [state]);

	return (
		<div className="wallet-summary">
			<div className="wallet-summary__total">
				<span className="wallet-summary__total-label">Total</span>
				<span className="wallet-summary__total-value">
					{state.status === 'ready' ? currencyFormatter.format(totalUsd) : '…'}
				</span>
			</div>

			{state.status === 'loading' ? (
				<div className="wallet-summary__status">Loading balances…</div>
			) : null}
			{state.status === 'error' ? (
				<div className="wallet-summary__status wallet-summary__status--error">Unable to load balances.</div>
			) : null}
			{state.status === 'ready' &&
			state.payload.every((payload) => payload.tokens.filter((token) => (token.valueUsd ?? 0) > 0).length === 0) ? (
				<div className="wallet-summary__status">No tokens found.</div>
			) : null}

			{state.status === 'ready'
				? tokensByChain.map(([chain, tokens]) => (
						<section className="wallet-summary__chain" key={chain}>
							<h4 className="wallet-summary__chain-title">{chainDisplayName(chain)}</h4>
							<div className="wallet-summary__chain-spacer" aria-hidden="true" />
							<div className="wallet-summary__chain-rows">
								{tokens.map((token) => {
									const symbol = token.symbol.toUpperCase();
									const daysText = formatDaysInWallet(token.basisDate ?? token.firstSeenAt);
									const qtyText = Number.isFinite(token.balance) ? formatAmount(token.balance) : '—';
									// adjusted the balance for wallet, and the css for the defi tin
									const derivedValue =
										typeof token.valueUsd === 'number' && token.valueUsd > 0
											? token.valueUsd
											: token.priceUsd > 0 && token.balance > 0
												? token.priceUsd * token.balance
												: null;
									const valueText =
										!isAaveToken(token) && typeof derivedValue === 'number'
											? currencyFormatter.format(derivedValue)
											: '—';
									const plValue = typeof token.profitUsd === 'number' ? token.profitUsd : null;
									const plPrefix = token.basisType === 'firstTransferIn' ? '*' : '';
									const plText = plValue === null ? '—' : `${plPrefix}${currencyFormatter.format(plValue)}`;
									const plClass =
										plValue === null ? '' : plValue >= 0 ? 'wallet-summary__cell--pl-positive' : 'wallet-summary__cell--pl-negative';

									return (
										<div className="wallet-summary__row" key={`${chain}-${symbol}`}>
											<span className="wallet-summary__cell wallet-summary__cell--days">{daysText}</span>
											<span className="wallet-summary__cell wallet-summary__cell--token">
												{symbol}
											</span>
											<span className="wallet-summary__cell wallet-summary__cell--qty">{qtyText}</span>
											<span className="wallet-summary__cell wallet-summary__cell--value">{valueText}</span>
											<span className={`wallet-summary__cell wallet-summary__cell--pl ${plClass}`}>{plText}</span>
										</div>
									);
								})}
							</div>
						</section>
				  ))
				: null}

			<div className="wallet-summary__basis-note">
				* Basis uses first transfer-in price (purchase price unavailable).
			</div>
		</div>
	);
}
