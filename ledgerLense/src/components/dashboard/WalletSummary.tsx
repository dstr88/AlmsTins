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

const formatDate = (value: string) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const chainDisplayName = (chain: string) => {
	const normalized = chain.toLowerCase();
	if (normalized === 'ethereum') return 'Ethereum';
	if (normalized === 'polygon') return 'Polygon';
	if (normalized === 'avalanche') return 'Avalanche';
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export default function WalletSummary({ walletId }: { walletId: string }) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;

		async function loadTokens() {
			try {
				setState({ status: 'loading' });
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
				}
			} catch (err) {
				if (!cancelled) {
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
							<div className="wallet-summary__chain-rows">
								<div className="wallet-summary__row wallet-summary__row--header">
									<span className="wallet-summary__cell wallet-summary__cell--token">Token</span>
									<span className="wallet-summary__cell wallet-summary__cell--date">Date</span>
									<span className="wallet-summary__cell wallet-summary__cell--price">Price</span>
									<span className="wallet-summary__cell wallet-summary__cell--pl">P/L</span>
								</div>
								{tokens.map((token) => {
									const symbol = token.symbol.toUpperCase();
									const dateText = token.basisDate ? formatDate(token.basisDate) : '—';
									const priceText = token.priceUsd ? currencyFormatter.format(token.priceUsd) : '—';
									const qtyText = Number.isFinite(token.balance) ? formatAmount(token.balance) : '—';
									const valueText =
										typeof token.valueUsd === 'number' && token.valueUsd > 0
											? currencyFormatter.format(token.valueUsd)
											: '—';
									const plValue = typeof token.profitUsd === 'number' ? token.profitUsd : null;
									const plPrefix = token.basisType === 'firstTransferIn' ? '*' : '';
									const plText = plValue === null ? '—' : `${plPrefix}${currencyFormatter.format(plValue)}`;
									const plClass =
										plValue === null ? '' : plValue >= 0 ? 'wallet-summary__cell--pl-positive' : 'wallet-summary__cell--pl-negative';

									return (
										<div className="wallet-summary__row" key={`${chain}-${symbol}`}>
											<span className="wallet-summary__cell wallet-summary__cell--token">
												{symbol}
												{token.name && token.name.toUpperCase() !== symbol ? (
													<span className="wallet-summary__token-name">{token.name}</span>
												) : null}
												<span className="wallet-summary__token-qty">Qty: {qtyText}</span>
												<span className="wallet-summary__token-value">Value: {valueText}</span>
											</span>
											<span className="wallet-summary__cell wallet-summary__cell--date">{dateText}</span>
											<span className="wallet-summary__cell wallet-summary__cell--price">{priceText}</span>
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
