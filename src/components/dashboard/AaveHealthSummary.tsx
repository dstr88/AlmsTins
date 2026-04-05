import React, { useEffect, useMemo, useState } from 'react';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';

console.log('[island.mount]', 'AaveHealthSummary');

type WalletResponse = {
	id: string;
	address: string;
	label?: string | null;
};

type HealthResponse = {
	ok: boolean;
	cached?: boolean;
	stale?: boolean;
	asOf?: string | null;
	chains?: Record<
		string,
		{
			chainId?: number;
			market?: string | null;
			status?: string;
			message?: string;
			reason?: string;
			healthFactor?: string | number | null;
			totalCollateralBase?: string | number | null;
			totalDebtBase?: string | number | null;
			userSupplies?: Array<{
				currency?: { symbol?: string };
				balance?: { amount?: { value?: string } };
				balanceUsd?: number | null;
				priceUsd?: number | null;
			}>;
			userBorrows?: Array<{
				currency?: { symbol?: string };
				debt?: { amount?: { value?: string } };
				debtUsd?: number | null;
				priceUsd?: number | null;
			}>;
			error?: string;
		}
	>;
	error?: string;
};

type FetchState =
	| { status: 'loading' }
	| { status: 'error'; message?: string }
	| {
			status: 'ready';
			healthByChain: Array<{ chain: string; healthFactor: string | number | null }>;
			totalCollateralBase: number;
			totalDebtBase: number;
			collateralBreakdown: Array<{
				symbol: string;
				amount: number | null;
				usdValue: number | null;
				priceUsd: number | null;
				purchasePriceUsd: number | null;
				purchaseAt: string | null;
			}>;
			isStale?: boolean;
			unavailableMessage?: string | null;
	  };

function formatHealthFactor(value: string | number | null) {
	if (value === null || value === undefined) return '---';
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return '---';
	const scaled = Math.round(parsed * 100);
	return String(scaled).padStart(3, '0');
}

function formatTokenAmountBySymbol(symbol: string, value: number | null) {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—';
	const upper = symbol.toUpperCase();
	const maximumFractionDigits = upper === 'POL' ? 2 : 4;
	const minimumFractionDigits = upper === 'POL' ? 0 : 2;
	return Number(value).toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

function splitAmountForDisplay(value: string) {
	if (!/^-?[\d,]+(\.\d+)?$/.test(value)) return null;
	const [intPart, fracPart] = value.split('.');
	return { intPart, fracPart: fracPart ?? '' };
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 2,
});

function formatUsd(value: number) {
	return currencyFormatter.format(value);
}

export default function AaveHealthSummary({ walletId }: { walletId: string }) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });

	useEffect(() => {
		let cancelled = false;

		async function load() {
			try {
				setState({ status: 'loading' });
				const walletRes = await fetch(`/api/wallets/${walletId}`);
				if (!walletRes.ok) {
					throw new Error(`Wallet HTTP ${walletRes.status}`);
				}
				const wallet = (await walletRes.json()) as WalletResponse;
				const address = wallet.address;
				if (!address) {
					throw new Error('Missing wallet address');
				}

				const res = await fetch(`/api/aave/health?address=${encodeURIComponent(address)}`);
				if (!res.ok) {
					throw new Error(`Aave HTTP ${res.status}`);
				}
				const data = (await res.json()) as HealthResponse;
				if (!data.ok) {
					throw new Error(data.error ?? 'Aave lookup failed');
				}

				const chainEntries = data.chains ? Object.entries(data.chains) : [];
				const healthByChain = chainEntries.map(([chain, summary]) => ({
					chain,
					healthFactor: summary.healthFactor ?? null,
				}));
				const activeChain =
					chainEntries.find(([, summary]) => (summary.userSupplies ?? []).length > 0)?.[0] ??
					chainEntries.find(([, summary]) => (summary.userBorrows ?? []).length > 0)?.[0] ??
					healthByChain.find((entry) => entry.healthFactor !== null && entry.healthFactor !== undefined)?.chain ??
					healthByChain[0]?.chain ??
					null;
				const activeSummary = activeChain ? data.chains?.[activeChain] : null;
				const supplies = Array.isArray(activeSummary?.userSupplies) ? activeSummary.userSupplies : [];
				const borrows = Array.isArray(activeSummary?.userBorrows) ? activeSummary.userBorrows : [];
				const unavailableMessage =
					activeSummary?.status === 'UNAVAILABLE' ? activeSummary?.message ?? 'Unavailable' : null;

				const symbols = allowlistSymbols(
					[...supplies, ...borrows]
						.map((entry) => entry.currency?.symbol ?? '')
						.filter((symbol): symbol is string => Boolean(symbol)),
				);
				let cachedPrices: Record<string, number> = {};
				if (symbols.length) {
					try {
						const pricesRes = await fetch(
							`/api/market/coinpaprika-prices?symbols=${encodeURIComponent(symbols.join(','))}`,
						);
						if (pricesRes.ok) {
							const pricesData = (await pricesRes.json()) as { prices?: Record<string, number> };
							cachedPrices = pricesData.prices ?? {};
						}
					} catch {
						cachedPrices = {};
					}
				}
				const oraclePrices: Record<string, number> = {};

				const collateralBreakdown = supplies.reduce<
					Array<{ symbol: string; amount: number | null; usdValue: number | null }>
				>((acc, entry) => {
					const symbol = entry.currency?.symbol?.toUpperCase();
					if (!symbol) return acc;
					const amount = Number(entry.balance?.amount?.value ?? 0);
					const normalizedAmount = Number.isFinite(amount) ? amount : 0;
					const usdFromAave = typeof entry.balanceUsd === 'number' ? entry.balanceUsd : null;
					const priceFromAave = typeof entry.priceUsd === 'number' ? entry.priceUsd : null;
					const priceFromCached = typeof cachedPrices[symbol] === 'number' ? cachedPrices[symbol] : null;
					const priceFromOracle = typeof oraclePrices[symbol] === 'number' ? oraclePrices[symbol] : null;
					const usdValue =
						usdFromAave ??
						(priceFromAave ? normalizedAmount * priceFromAave : null) ??
						(priceFromCached ? normalizedAmount * priceFromCached : null) ??
						(priceFromOracle ? normalizedAmount * priceFromOracle : null);

					const resolvedPrice = priceFromAave ?? priceFromCached ?? priceFromOracle ?? null;
					const existing = acc.find((row) => row.symbol === symbol);
					if (existing) {
						existing.amount = (existing.amount ?? 0) + normalizedAmount;
						existing.usdValue =
							existing.usdValue !== null && usdValue !== null ? existing.usdValue + usdValue : null;
						if (!existing.priceUsd && resolvedPrice) existing.priceUsd = resolvedPrice;
					} else {
						acc.push({
							symbol,
							amount: normalizedAmount || null,
							usdValue,
							priceUsd: resolvedPrice,
							purchasePriceUsd: null,
							purchaseAt: null,
						});
					}
					return acc;
				}, []);

				const computedCollateralUsd = collateralBreakdown.reduce(
					(sum, row) => sum + (typeof row.usdValue === 'number' ? row.usdValue : 0),
					0,
				);
				const computedDebtUsd = borrows.reduce((sum, entry) => {
					const amount = Number(entry.debt?.amount?.value ?? 0);
					const normalizedAmount = Number.isFinite(amount) ? amount : 0;
					const symbol = entry.currency?.symbol?.toUpperCase() ?? '';
					const usdFromAave = typeof entry.debtUsd === 'number' ? entry.debtUsd : null;
					const priceFromAave = typeof entry.priceUsd === 'number' ? entry.priceUsd : null;
					const priceFromCached = symbol && typeof cachedPrices[symbol] === 'number' ? cachedPrices[symbol] : null;
					const priceFromOracle = symbol && typeof oraclePrices[symbol] === 'number' ? oraclePrices[symbol] : null;
					const usdValue =
						usdFromAave ??
						(priceFromAave ? normalizedAmount * priceFromAave : null) ??
						(priceFromCached ? normalizedAmount * priceFromCached : null) ??
						(priceFromOracle ? normalizedAmount * priceFromOracle : null);
					return sum + (typeof usdValue === 'number' ? usdValue : 0);
				}, 0);

				const totalCollateralFromState = Number(activeSummary?.totalCollateralBase ?? 0);
				const totalDebtFromState = Number(activeSummary?.totalDebtBase ?? 0);
				const totals = {
					totalCollateralBase:
						Number.isFinite(totalCollateralFromState) && totalCollateralFromState > 0
							? totalCollateralFromState
							: computedCollateralUsd,
					totalDebtBase:
						Number.isFinite(totalDebtFromState) && totalDebtFromState > 0 ? totalDebtFromState : computedDebtUsd,
				};

				// Enrich collateral with cost basis + purchase date from wallet tokens
				try {
					const tokensRes = await fetch(`/api/wallets/${walletId}/tokens`);
					if (tokensRes.ok) {
						const tokensData = await tokensRes.json();
						if (tokensData.ok && Array.isArray(tokensData.tokens)) {
							const bySymbol = new Map<string, any>();
							for (const t of tokensData.tokens) {
								bySymbol.set(String(t.tokenSymbol ?? '').toUpperCase(), t);
							}
							for (const item of collateralBreakdown) {
								const t = bySymbol.get(item.symbol.toUpperCase());
								if (t) {
									if (t.purchasePriceUsd != null) item.purchasePriceUsd = t.purchasePriceUsd;
									if (t.purchaseAt) item.purchaseAt = t.purchaseAt;
									if (!item.priceUsd && t.priceUsd) item.priceUsd = t.priceUsd;
								}
							}
						}
					}
				} catch {
					// non-fatal — Days/P&L will show — if tokens unavailable
				}

				if (!cancelled) {
					setState({
						status: 'ready',
						healthByChain,
						totalCollateralBase: totals.totalCollateralBase,
						totalDebtBase: totals.totalDebtBase,
						collateralBreakdown,
						isStale: data.stale === true,
						unavailableMessage,
					});
				}
			} catch (err: any) {
				if (!cancelled) {
					setState({ status: 'error', message: err?.message ?? 'Failed to load' });
				}
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	const healthText = useMemo(() => {
		if (state.status !== 'ready') return '---';
		const first = state.healthByChain.find((entry) => entry.healthFactor !== null && entry.healthFactor !== undefined);
		return formatHealthFactor(first?.healthFactor ?? null);
	}, [state]);

	const healthRows = useMemo(() => {
		if (state.status !== 'ready') return [];
		return state.healthByChain
			.map((entry) => ({
				chain: entry.chain,
				value: formatHealthFactor(entry.healthFactor),
			}))
			.filter((entry) => entry.value !== '---');
	}, [state]);

	const healthLabel = healthRows.length
		? `${healthRows[0].chain.charAt(0).toUpperCase() + healthRows[0].chain.slice(1)} Health`
		: 'Health';

	const totalCollateral = state.status === 'ready' ? state.totalCollateralBase : 0;
	const totalDebt = state.status === 'ready' ? state.totalDebtBase : 0;
	const net = totalCollateral - totalDebt;

	const collateralValue = formatUsd(totalCollateral);
	const debtValue = formatUsd(totalDebt);
	const netValue = formatUsd(net);
	const breakdownItems = state.status === 'ready' ? state.collateralBreakdown : [];
	const qtyWidthStyle = useMemo(() => {
		if (state.status !== 'ready' || !breakdownItems.length) {
			return { ['--qty-int-width' as any]: '1ch', ['--qty-frac-width' as any]: '4ch' } as React.CSSProperties;
		}
		const { maxInt, maxFrac } = breakdownItems.reduce(
			(acc, item) => {
				const qtyText = formatTokenAmountBySymbol(item.symbol, item.amount);
				const parts = splitAmountForDisplay(qtyText);
				const intLength = parts ? parts.intPart.length : qtyText.length;
				const fracLength = parts ? parts.fracPart.length : 0;
				return {
					maxInt: Math.max(acc.maxInt, intLength),
					maxFrac: Math.max(acc.maxFrac, fracLength),
				};
			},
			{ maxInt: 1, maxFrac: 4 },
		);
		return {
			['--qty-int-width' as any]: `${maxInt}ch`,
			['--qty-frac-width' as any]: `${Math.max(maxFrac, 4)}ch`,
		} as React.CSSProperties;
	}, [state.status, breakdownItems]);

	return (
		<div className="defi-stats">
			<div className="stat-row health">
				<span className="label">{healthLabel}</span>
				<span className="value">{healthText}</span>
			</div>

			<div className="spacer spacer--lg"></div>

			<div className="stat-row">
				<span className="label">Collateral</span>
				<span className="value">{collateralValue}</span>
			</div>

			<div className="stat-row debt">
				<span className="label">Debt</span>
				<span className="value">{debtValue}</span>
			</div>

			<div className="stat-row net">
				<span className="label">Net</span>
				<span className="value">{netValue}</span>
			</div>

			<div className="spacer spacer--md"></div>

			<div className="divider"></div>

			<div className="spacer spacer--sm"></div>

			<div className="breakdown-title">Collateral breakdown</div>

			<div className="breakdown" style={qtyWidthStyle}>
				<div className="breakdown-row breakdown-header">
					<span className="col-days">Days</span>
					<span className="col-token">Asset</span>
					<span className="col-qty">Qty</span>
					<span className="col-price">Price</span>
					<span className="col-usd">USD</span>
					<span className="col-pl">P/L</span>
				</div>
				{breakdownItems.length ? (
					breakdownItems.map((item) => {
						const acquiredMs = item.purchaseAt ? Date.parse(item.purchaseAt) : NaN;
						const daysHeld = Number.isFinite(acquiredMs)
							? Math.max(0, Math.floor((Date.now() - acquiredMs) / 86400000))
							: null;

						const currentPrice = item.priceUsd ?? null;
						const basisPrice   = item.purchasePriceUsd ?? null;
						const plPct =
							currentPrice !== null && basisPrice !== null && basisPrice > 0
								? ((currentPrice - basisPrice) / basisPrice) * 100
								: null;
						const plAbsolute =
							plPct !== null && item.amount != null
								? (currentPrice! - basisPrice!) * item.amount
								: null;
						const plColor = plPct === null ? undefined : plPct >= 0 ? '#86efac' : '#fca5a5';
						const plLabel = plPct !== null
							? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
							: '—';

						return (
							<div className="breakdown-row" key={item.symbol}>
								<span className="col-days">{daysHeld ?? '—'}</span>
								<span className="col-token">{item.symbol}</span>
								<span className="col-qty">
									{(() => {
										const qtyText = formatTokenAmountBySymbol(item.symbol, item.amount);
										const parts = splitAmountForDisplay(qtyText);
										if (!parts) return qtyText;
										const fracWidth = Math.max(4, parts.fracPart.length);
										const paddedFrac = parts.fracPart.padEnd(fracWidth, '0');
										return (
											<span className="qty">
												<span className="qty-whole">{parts.intPart}</span>
												<span className="qty-dot">.</span>
												<span className="qty-decimal">{paddedFrac}</span>
											</span>
										);
									})()}
								</span>
								<span className="col-price">
									{currentPrice != null ? formatUsd(currentPrice) : '—'}
								</span>
								<span className="col-usd">
									{item.usdValue != null ? formatUsd(item.usdValue) : '—'}
								</span>
								<span
									className="col-pl"
									style={{ color: plColor }}
									title={plAbsolute !== null
										? `${plAbsolute >= 0 ? '+' : ''}${formatUsd(plAbsolute)}`
										: undefined}
								>
									{plLabel}
								</span>
							</div>
						);
					})
				) : (
					<div className="breakdown-empty">No collateral positions found.</div>
				)}
			</div>
			{state.status === 'ready' && state.unavailableMessage ? (
				<div className="defi-status defi-status--warning">{state.unavailableMessage}</div>
			) : null}
			{state.status === 'ready' && state.isStale ? (
				<div className="defi-status defi-status--refreshing">Refreshing…</div>
			) : null}
			{state.status === 'loading' ? (
				<div className="defi-status defi-status--loading">Loading health factor…</div>
			) : null}
			{state.status === 'error' ? (
				<div className="defi-status defi-status--error">Unable to load health factor.</div>
			) : null}
		</div>
	);
}
