import React, { useEffect, useState } from 'react';
import './WalletSummary.css';

console.log('[island.mount]', 'WalletSummary');

type WalletSummaryState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'empty'; message: string; hint?: string }
	| {
			status: 'stale';
			message: string;
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
	  }
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
const WALLET_DEBUG =
	String(import.meta.env.WALLET_DEBUG ?? import.meta.env.HOLDINGS_DEBUG ?? '').trim() === '1';

type SummaryCounts = {
	byChainLength: number;
	byWalletLength: number;
	byChainDetails: Array<{ chain: string; tokenCount: number }>;
	tokenTotal: number;
};

const summarizePayload = (payload: any): SummaryCounts => {
	const byChain =
		(Array.isArray(payload?.byChain) ? payload.byChain : null) ??
		(Array.isArray(payload?.snapshot?.byChain) ? payload.snapshot.byChain : null) ??
		[];
	const byWallet = Array.isArray(payload?.byWallet) ? payload.byWallet : [];
	const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
	const byChainDetails = (Array.isArray(byChain) ? byChain : []).map((item: any) => {
		const chain = String(item?.chain ?? 'unknown');
		const tokenCount =
			typeof item?.tokenCount === 'number'
				? item.tokenCount
				: Array.isArray(item?.tokens)
					? item.tokens.length
					: Array.isArray(item?.snapshots)
						? item.snapshots.length
						: 0;
		return { chain, tokenCount };
	});
	return {
		byChainLength: Array.isArray(byChain) ? byChain.length : 0,
		byWalletLength: Array.isArray(byWallet) ? byWallet.length : 0,
		byChainDetails,
		tokenTotal: tokens.length,
	};
};

type SnapshotToken = {
	symbol: string;
	daysHeld: number;
	amountFormatted: string;
	usdValue: number;
	profitLoss?: { percent?: number; absolute?: number } | 'N/A';
};

type FullWalletSnapshot = {
	byChain?: Array<{ chain: string; tokens: SnapshotToken[] }>;
};

type FullWalletSync = {
	lastSyncedAt?: string | null;
};

type WalletSummaryProps = {
	walletId: string;
	initialData?: {
		snapshot?: FullWalletSnapshot | null;
		sync?: FullWalletSync | null;
	} | null;
};

const formatLastSync = (value?: string | null) => {
	if (!value) return 'never';
	const stamp = Date.parse(value);
	if (!Number.isFinite(stamp)) return value;
	return new Date(stamp).toLocaleString();
};

export default function WalletSummary({ walletId, initialData }: WalletSummaryProps) {
	const [state, setState] = useState<WalletSummaryState>({ status: 'loading' });
	const initialSummary = summarizePayload(initialData ?? {});
	const dataFromState = (s: WalletSummaryState) => (s as any).data ?? (s as any).wallet ?? null;

	const summarize = (s: WalletSummaryState) => {
		const data = dataFromState(s) as any;
		return {
			status: s.status,
			hasData: Boolean(data),
			byChain: data?.byChain?.length ?? null,
			byWallet: data?.byWallet?.length ?? null,
			tokens: data?.tokens?.length ?? null,
			error: (s as any).error ?? null,
		};
	};

	const setStateLogged = (next: WalletSummaryState, reason: string) => {
		if (WALLET_DEBUG) {
			console.log('[WalletSummary.state]', { walletId, reason, next: summarize(next) });
		}
		setState(next);
	};

	if (WALLET_DEBUG) {
		console.log('[WalletSummary.render]', {
			walletId,
			status: state.status,
			hasData: Boolean(dataFromState(state)),
			byChain: (dataFromState(state) as any)?.byChain?.length ?? null,
			byWallet: (dataFromState(state) as any)?.byWallet?.length ?? null,
			tokens: (dataFromState(state) as any)?.tokens?.length ?? null,
			error: (state as any).error ?? null,
		});
	}

	useEffect(() => {
		console.log('[WalletSummary.lifecycle] mount', { walletId });
		return () => {
			console.log('[WalletSummary.lifecycle] unmount', { walletId });
		};
	}, [walletId]);

	useEffect(() => {
		if (!WALLET_DEBUG) return;
		const onError = (event: ErrorEvent) => {
			console.log('[WalletSummary.error]', {
				message: event.error?.message ?? event.message,
				stack: event.error?.stack,
			});
		};
		const onRejection = (event: PromiseRejectionEvent) => {
			const reason = event.reason;
			console.log('[WalletSummary.unhandledrejection]', {
				message: reason?.message ?? String(reason),
				stack: reason?.stack,
			});
		};
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		return () => {
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
		};
	}, [walletId]);

	useEffect(() => {
		let cancelled = false;
		console.log('[WalletSummary.initial]', {
			walletId,
			byChainLength: initialSummary.byChainLength,
			byWalletLength: initialSummary.byWalletLength,
			byChainDetails: initialSummary.byChainDetails,
		});
		const loadSummary = async () => {
			try {
				setStateLogged(
					state.status === 'ready' || state.status === 'stale' ? state : { status: 'loading' },
					'refresh.start',
				);
				const url = `/api/wallets/${walletId}/tokens?refreshMissing=1`;
				console.log('[WalletSummary.refresh] start', { walletId, url });
				const res = await fetch(url, { credentials: 'include' });
				const status = res.status;
				const contentType = res.headers.get('content-type') || '';
				const text = await res.text();
				console.log('[WalletSummary.refresh] done', { walletId, status });
				if (WALLET_DEBUG) {
					console.log('[WalletSummary.refresh] preview', {
						walletId,
						status,
						contentType,
						preview: text.slice(0, 300),
					});
				}

				if (!res.ok) {
					console.log('[WalletSummary.refresh] non-2xx', {
						walletId,
						status,
						body: text.slice(0, 200),
					});
					throw new Error(`Refresh failed (${status})`);
				}

				const trimmed = text.trim();
				const shouldParseJson =
					status === 200 &&
					(contentType.includes('application/json') ||
						trimmed.startsWith('{') ||
						trimmed.startsWith('['));
				if (!shouldParseJson) {
					console.log('[WalletSummary.refresh] invalid-payload', {
						status,
						contentType,
						preview: text.slice(0, 300),
					});
					throw new Error('Refresh returned invalid payload');
				}

				let payload: any = null;
				try {
					payload = text ? JSON.parse(text) : null;
				} catch {
					throw new Error('Invalid JSON response.');
				}

				const refreshedSummary = summarizePayload(payload ?? {});
				const oldTokenTotal =
					state.status === 'ready' || state.status === 'stale'
						? state.wallet.tokens.length
						: 0;
				const isRefreshWorse = refreshedSummary.tokenTotal < oldTokenTotal;
				console.log('[WalletSummary.refresh] summary', {
					walletId,
					newSummary: refreshedSummary,
					oldSummary: {
						byChainLength: initialSummary.byChainLength,
						byWalletLength: initialSummary.byWalletLength,
						byChainDetails: initialSummary.byChainDetails,
						tokenTotal: oldTokenTotal,
					},
					isRefreshWorse,
					keys: Object.keys(payload ?? {}),
				});

				if (isRefreshWorse) {
					throw new Error('Refresh returned fewer tokens than existing data');
				}

				const hasSummary =
					Array.isArray(payload?.snapshots) ||
					Array.isArray(payload?.byChain) ||
					Array.isArray(payload?.byWallet) ||
					Array.isArray(payload?.tokens);
				if (!hasSummary) {
					console.log('[WalletSummary.refresh] invalid-payload', {
						status,
						contentType,
						preview: text.slice(0, 300),
					});
					throw new Error('Refresh returned invalid payload');
				}
				if (!payload?.ok) {
					throw new Error(payload?.message ?? payload?.error ?? 'Unable to load wallet tokens.');
				}
				const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
				const totalUsd = tokens.reduce((sum, token) => sum + Number(token.usdValue ?? 0), 0);
				const isDust = Math.abs(totalUsd) < DUST_THRESHOLD_USD;
				if (isDust) {
					if (!cancelled) {
						setStateLogged(
							{
								status: 'empty',
								message: 'No balance data yet.',
								hint: 'Add a wallet and run a sync to populate totals.',
							},
							'refresh.empty',
						);
					}
					return;
				}
				if (!cancelled) {
					setStateLogged(
						{
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
						},
						'refresh.success',
					);
				}
			} catch (err) {
				console.log('[WalletSummary.refresh] exception', {
					message: err instanceof Error ? err.message : String(err),
					stack: err instanceof Error ? err.stack : undefined,
				});
				if (!cancelled) {
					const message =
						err instanceof Error ? err.message : 'Unable to load wallet summary.';
					if (state.status === 'ready' || state.status === 'stale') {
						setStateLogged({ ...(state as any), status: 'stale', message }, 'refresh.exception');
					} else {
						setStateLogged({ status: 'error', message }, 'refresh.exception');
					}
				}
			}
		};
		loadSummary();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	const snapshotChains = initialData?.snapshot?.byChain ?? [];
	const showSnapshotFallback =
		snapshotChains.length > 0 && state.status !== 'ready' && state.status !== 'stale';

	return (
		<div className="wallet-summary">
			{WALLET_DEBUG ? (
				<small data-debug>
					status={state.status} byChain={dataFromState(state)?.byChain?.length ?? 'null'} byWallet=
					{dataFromState(state)?.byWallet?.length ?? 'null'} tokens=
					{dataFromState(state)?.tokens?.length ?? 'null'}
				</small>
			) : null}
			{showSnapshotFallback ? (
				<div className="wallet-summary__fallback">
					{snapshotChains.map((chain) => (
						<section key={chain.chain} className="wallet-summary__chain">
							<h4 className="wallet-summary__chain-title">{chain.chain}</h4>
							<div className="wallet-summary__chain-rows">
								<div className="wallet-summary__row wallet-summary__row--header">
									<span className="wallet-summary__cell wallet-summary__cell--days">Days</span>
									<span className="wallet-summary__cell wallet-summary__cell--token">Token</span>
									<span className="wallet-summary__cell wallet-summary__cell--qty">Amount</span>
									<span className="wallet-summary__cell wallet-summary__cell--value">Value</span>
									<span className="wallet-summary__cell wallet-summary__cell--pl">P/L</span>
								</div>
								{chain.tokens.map((token) => (
									<div key={`${chain.chain}-${token.symbol}`} className="wallet-summary__row">
										<span className="wallet-summary__cell wallet-summary__cell--days">
											{String(token.daysHeld ?? 0)}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--token">
											{token.symbol}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--qty">
											{token.amountFormatted}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--value">
											{currencyFormatter.format(Number(token.usdValue ?? 0))}
										</span>
										<span className="wallet-summary__cell wallet-summary__cell--pl">
											{token.profitLoss === 'N/A'
												? 'N/A'
												: token.profitLoss?.percent !== undefined
													? `${token.profitLoss.percent.toFixed(2)}%`
													: 'N/A'}
										</span>
									</div>
								))}
							</div>
						</section>
					))}
				</div>
			) : null}
			{state.status === 'loading' ? (
				<div className="wallet-summary__status">
					Loading summary…{' '}
					<span className="wallet-summary__status-hint">
						last sync: {formatLastSync(initialData?.sync?.lastSyncedAt)}
					</span>
				</div>
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

			{state.status === 'stale' ? (
				<>
					<div className="wallet-summary__status wallet-summary__status--error">
						Stale: refresh failed. Showing last known balances.
					</div>
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
