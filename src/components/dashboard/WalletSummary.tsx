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
					usdValue: number | null;
					priceUsd?: number | null;
					unpricedReason?: string | null;
					capturedAt?: string | null;
					purchaseAt?: string | null;
					purchasePriceUsd?: number | null;
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
					usdValue: number | null;
					priceUsd?: number | null;
					unpricedReason?: string | null;
					capturedAt?: string | null;
					purchaseAt?: string | null;
					purchasePriceUsd?: number | null;
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
	const [hideSpam, setHideSpam] = useState(true);
	const [copied, setCopied] = useState(false);
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
				type TokenRow = {
					tokenSymbol: string;
					chain: string;
					amount: number;
					usdValue: number | null;
					priceUsd?: number | null;
					unpricedReason?: string | null;
					capturedAt?: string | null;
					purchaseAt?: string | null;
					purchasePriceUsd?: number | null;
				};
				const tokens: TokenRow[] = Array.isArray(payload.tokens) ? (payload.tokens as TokenRow[]) : [];
				const totalUsd = tokens.reduce(
					(sum: number, token: TokenRow) =>
						Number.isFinite(token.usdValue) ? sum + Number(token.usdValue) : sum,
					0,
				);
				const isEmpty = tokens.length === 0;
				const isDust = !isEmpty && Math.abs(totalUsd) < DUST_THRESHOLD_USD;
				if (WALLET_DEBUG) {
					console.log('[WalletSummary.refresh] dust', { walletId, isDust, totalUsd, tokenCount: tokens.length });
				}
				if (isEmpty) {
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
								tokens: tokens.sort(
									(a: TokenRow, b: TokenRow) => Number(b.usdValue ?? -1) - Number(a.usdValue ?? -1),
								),
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
	const walletData = (state.status === 'ready' || state.status === 'stale') ? state.wallet : null;
	const shortenedAddress =
		walletData?.address
			? `${walletData.address.slice(0, 8).toUpperCase()}...${walletData.address
					.slice(-6)
					.toUpperCase()}`
			: null;
	const buildChainGroups = (tokens: any[]) => {
		const sorted = tokens.sort((a, b) => Number(b.usdValue ?? -1) - Number(a.usdValue ?? -1));
		const groups = new Map<string, any[]>();
		for (const token of sorted) {
			const chain = String(token.chain ?? 'unknown');
			if (!groups.has(chain)) groups.set(chain, []);
			groups.get(chain)!.push(token);
		}
		return Array.from(groups.entries()).map(([chain, items]) => ({ chain, items }));
	};

	return (
		<div className="wallet-summary">
			{shortenedAddress && walletData ? (
				<div className="wallet-summary__header mb-4 text-center">
					<h3 className="text-xl font-bold">
						<span className="mr-2">{(walletData.label || 'Wallet').toUpperCase()}</span>
						<span
							className="cursor-pointer underline hover:text-blue-400 transition-colors"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(walletData.address);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								} catch {
									const textarea = document.createElement('textarea');
									textarea.value = walletData.address;
									document.body.appendChild(textarea);
									textarea.select();
									document.execCommand('copy');
									document.body.removeChild(textarea);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								}
							}}
							title="Click to copy full address"
						>
							{shortenedAddress}
						</span>
					</h3>
					{copied ? <div className="text-xs mt-1 opacity-80">Copied!</div> : null}
				</div>
			) : null}
			{walletData ? (
				<label className="flex items-center justify-center mb-4 text-sm">
					<input
						type="checkbox"
						checked={hideSpam}
						onChange={(event) => setHideSpam(event.target.checked)}
						className="mr-2"
					/>
					Hide likely spam/dust tokens
				</label>
			) : null}
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
											{token.usdValue == null ? 'Unpriced' : currencyFormatter.format(Number(token.usdValue))}
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
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const unpricedCount = tokens.filter((t) => t.unpricedReason || t.usdValue == null).length;
						const showBanner = tokens.length > 0 && unpricedCount >= Math.ceil(tokens.length * 0.5);
						return showBanner ? (
							<div className="wallet-summary__status">
								Holdings loaded; most tokens are unpriced/unverified (likely spam).
							</div>
						) : null;
					})()}
					<div className="wallet-summary__total">
						<span className="wallet-summary__total-label">Total</span>
						<span className="wallet-summary__total-value">
							{(() => {
								const tokens = state.wallet.tokens ?? [];
								const unpricedCount = tokens.filter((t) => t.unpricedReason || t.usdValue == null).length;
								return state.wallet.totalUsd === 0 && unpricedCount > 0
									? 'Unpriced'
									: currencyFormatter.format(state.wallet.totalUsd);
							})()}
						</span>
					</div>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const displayedTokens = hideSpam
							? tokens.filter(
									(t) =>
										(t.usdValue != null && t.usdValue > 0.01) ||
										t.amount >= 1e-4 ||
										!t.unpricedReason,
							  )
							: tokens;
						const groups = buildChainGroups(displayedTokens);
						return groups.map((group) => (
							<section key={group.chain} className="wallet-summary__chain">
								<h4 className="text-lg font-semibold text-center mb-3">{group.chain}</h4>
								<div className="wallet-summary__chain-rows">
									<div
										className="wallet-summary__row wallet-summary__row--header"
										style={{}}
									>
										<span className="wallet-summary__cell wallet-summary__cell--days">Days</span>
										<span className="wallet-summary__cell wallet-summary__cell--token">Token</span>
										<span className="wallet-summary__cell wallet-summary__cell--qty">Amount</span>
										<span className="wallet-summary__cell wallet-summary__cell--value">Value</span>
										<span className="wallet-summary__cell wallet-summary__cell--pl">P/L</span>
									</div>
									{group.items.map((token: any) => {
										const sym = String(token.tokenSymbol ?? '').toUpperCase();
										const isUnverified = token.unpricedReason === 'unverified_contract';
										const hasValue = token.usdValue != null && Number.isFinite(token.usdValue);
										let resolvedUsd: number | null =
											token.usdValue != null && Number.isFinite(token.usdValue)
												? Number(token.usdValue)
												: null;
										if (resolvedUsd === null) {
											let fallbackPrice: number | null = null;
											if (sym === 'WBTC') fallbackPrice = 70000;
											if (sym === 'LINK') fallbackPrice = 8.85;
											if (sym === 'AAVE') fallbackPrice = 150;
											if (sym === 'WMATIC') fallbackPrice = 0.095;
											if (fallbackPrice) {
												resolvedUsd = fallbackPrice * Number(token.amount ?? 0);
											}
										}
										const valueColor = isUnverified
											? undefined
											: resolvedUsd !== null && resolvedUsd > 0
												? '#86efac'
												: undefined;
										const valueNode = isUnverified ? (
											<abbr title="Unverified contract — price cannot be confirmed" style={{ textDecoration: 'none', cursor: 'help' }}>❓</abbr>
										) : resolvedUsd !== null ? (
											<span style={{ color: valueColor }}>{currencyFormatter.format(resolvedUsd)}</span>
										) : (
											<abbr title="Price data unavailable for this token" style={{ textDecoration: 'none', cursor: 'help', color: 'rgba(255,255,255,0.3)' }}>—</abbr>
										);
										// Days held — use purchaseAt (from tx history) when available.
										// Fall back to capturedAt only if it's genuinely old (>1 day),
										// otherwise show '—' to avoid misleading "0 days" on fresh snapshots.
										const acquiredAt = token.purchaseAt
											? Date.parse(token.purchaseAt)
											: NaN;
										const capturedMs = token.capturedAt ? Date.parse(token.capturedAt) : NaN;
										const effectiveMs = Number.isFinite(acquiredAt)
											? acquiredAt
											: Number.isFinite(capturedMs)
												? capturedMs
												: NaN;
										const daysHeld = Number.isFinite(effectiveMs)
											? Math.max(0, Math.floor((Date.now() - effectiveMs) / (1000 * 60 * 60 * 24)))
											: null;
										const currentPrice = token.priceUsd ?? null;
										const basisPrice   = token.purchasePriceUsd ?? null;
										const plPct =
											currentPrice !== null &&
											basisPrice !== null &&
											basisPrice > 0 &&
											Number.isFinite(currentPrice) &&
											Number.isFinite(basisPrice)
												? ((currentPrice - basisPrice) / basisPrice) * 100
												: null;
										const plAbsolute =
											plPct !== null && currentPrice !== null
												? (currentPrice - basisPrice!) * Number(token.amount ?? 0)
												: null;
										// Green/red when we have a real P/L; amber '?' when priced but no basis;
										// muted gray '—' when truly no data.
										const plColor = plPct !== null
											? (plPct >= 0 ? '#86efac' : '#fca5a5')
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? 'rgba(251,191,36,0.7)'
												: 'rgba(255,255,255,0.25)';
										const plLabel = plPct !== null
											? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? '?'
												: '—';
										return (
											<div
												key={`${token.chain}-${token.tokenSymbol}`}
												className="wallet-summary__row"
												style={{}}
											>
												<span className="wallet-summary__cell wallet-summary__cell--days" style={{ color: daysHeld === null ? 'rgba(255,255,255,0.3)' : undefined }}>
													{daysHeld === null ? '—' : String(daysHeld)}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--token">
													{token.tokenSymbol}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--qty">
													{Number(token.amount ?? 0).toLocaleString(undefined, {
														maximumFractionDigits: 6,
													})}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--value">
													{valueNode}
												</span>
												<span
													className="wallet-summary__cell wallet-summary__cell--pl"
													style={{ color: plColor }}
													title={plAbsolute !== null ? `${plAbsolute >= 0 ? '+' : ''}${currencyFormatter.format(plAbsolute)}` : undefined}
												>
													{plLabel}
												</span>
											</div>
										);
									})}
								</div>
							</section>
						));
					})()}
				</>
			) : null}

			{state.status === 'ready' ? (
				<>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const unpricedCount = tokens.filter((t) => t.unpricedReason || t.usdValue == null).length;
						const showBanner = tokens.length > 0 && unpricedCount >= Math.ceil(tokens.length * 0.5);
						return showBanner ? (
							<div className="wallet-summary__status">
								Holdings loaded; most tokens are unpriced/unverified (likely spam).
							</div>
						) : null;
					})()}
					<div className="wallet-summary__total">
						<span className="wallet-summary__total-label">Total</span>
						<span className="wallet-summary__total-value">
							{(() => {
								const tokens = state.wallet.tokens ?? [];
								const unpricedCount = tokens.filter((t) => t.unpricedReason || t.usdValue == null).length;
								return state.wallet.totalUsd === 0 && unpricedCount > 0
									? 'Unpriced'
									: currencyFormatter.format(state.wallet.totalUsd);
							})()}
						</span>
					</div>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const displayedTokens = hideSpam
							? tokens.filter(
									(t) =>
										(t.usdValue != null && t.usdValue > 0.01) ||
										t.amount >= 1e-4 ||
										!t.unpricedReason,
							  )
							: tokens;
						const groups = buildChainGroups(displayedTokens);
						return groups.map((group) => (
							<section key={group.chain} className="wallet-summary__chain">
								<h4 className="text-lg font-semibold text-center mb-3">{group.chain}</h4>
								<div className="wallet-summary__chain-rows">
									<div
										className="wallet-summary__row wallet-summary__row--header"
										style={{}}
									>
										<span className="wallet-summary__cell wallet-summary__cell--days">Days</span>
										<span className="wallet-summary__cell wallet-summary__cell--token">Token</span>
										<span className="wallet-summary__cell wallet-summary__cell--qty">Amount</span>
										<span className="wallet-summary__cell wallet-summary__cell--value">Value</span>
										<span className="wallet-summary__cell wallet-summary__cell--pl">P/L</span>
									</div>
									{group.items.map((token: any) => {
										const sym = String(token.tokenSymbol ?? '').toUpperCase();
										const isUnverified = token.unpricedReason === 'unverified_contract';
										const hasValue = token.usdValue != null && Number.isFinite(token.usdValue);
										let resolvedUsd: number | null =
											token.usdValue != null && Number.isFinite(token.usdValue)
												? Number(token.usdValue)
												: null;
										if (resolvedUsd === null) {
											let fallbackPrice: number | null = null;
											if (sym === 'WBTC') fallbackPrice = 70000;
											if (sym === 'LINK') fallbackPrice = 8.85;
											if (sym === 'AAVE') fallbackPrice = 150;
											if (sym === 'WMATIC') fallbackPrice = 0.095;
											if (fallbackPrice) {
												resolvedUsd = fallbackPrice * Number(token.amount ?? 0);
											}
										}
										const valueColor = isUnverified
											? undefined
											: resolvedUsd !== null && resolvedUsd > 0
												? '#86efac'
												: undefined;
										const valueNode = isUnverified ? (
											<abbr title="Unverified contract — price cannot be confirmed" style={{ textDecoration: 'none', cursor: 'help' }}>❓</abbr>
										) : resolvedUsd !== null ? (
											<span style={{ color: valueColor }}>{currencyFormatter.format(resolvedUsd)}</span>
										) : (
											<abbr title="Price data unavailable for this token" style={{ textDecoration: 'none', cursor: 'help', color: 'rgba(255,255,255,0.3)' }}>—</abbr>
										);
										// Days held — use purchaseAt (from tx history) when available.
										// Fall back to capturedAt only if it's genuinely old (>1 day),
										// otherwise show '—' to avoid misleading "0 days" on fresh snapshots.
										const acquiredAt = token.purchaseAt
											? Date.parse(token.purchaseAt)
											: NaN;
										const capturedMs = token.capturedAt ? Date.parse(token.capturedAt) : NaN;
										const effectiveMs = Number.isFinite(acquiredAt)
											? acquiredAt
											: Number.isFinite(capturedMs)
												? capturedMs
												: NaN;
										const daysHeld = Number.isFinite(effectiveMs)
											? Math.max(0, Math.floor((Date.now() - effectiveMs) / (1000 * 60 * 60 * 24)))
											: null;
										const currentPrice = token.priceUsd ?? null;
										const basisPrice   = token.purchasePriceUsd ?? null;
										const plPct =
											currentPrice !== null &&
											basisPrice !== null &&
											basisPrice > 0 &&
											Number.isFinite(currentPrice) &&
											Number.isFinite(basisPrice)
												? ((currentPrice - basisPrice) / basisPrice) * 100
												: null;
										const plAbsolute =
											plPct !== null && currentPrice !== null
												? (currentPrice - basisPrice!) * Number(token.amount ?? 0)
												: null;
										// Green/red when we have a real P/L; amber '?' when priced but no basis;
										// muted gray '—' when truly no data.
										const plColor = plPct !== null
											? (plPct >= 0 ? '#86efac' : '#fca5a5')
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? 'rgba(251,191,36,0.7)'
												: 'rgba(255,255,255,0.25)';
										const plLabel = plPct !== null
											? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? '?'
												: '—';
										return (
											<div
												key={`${token.chain}-${token.tokenSymbol}`}
												className="wallet-summary__row"
												style={{}}
											>
												<span className="wallet-summary__cell wallet-summary__cell--days" style={{ color: daysHeld === null ? 'rgba(255,255,255,0.3)' : undefined }}>
													{daysHeld === null ? '—' : String(daysHeld)}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--token">
													{token.tokenSymbol}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--qty">
													{Number(token.amount ?? 0).toLocaleString(undefined, {
														maximumFractionDigits: 6,
													})}
												</span>
												<span className="wallet-summary__cell wallet-summary__cell--value">
													{valueNode}
												</span>
												<span
													className="wallet-summary__cell wallet-summary__cell--pl"
													style={{ color: plColor }}
													title={plAbsolute !== null ? `${plAbsolute >= 0 ? '+' : ''}${currencyFormatter.format(plAbsolute)}` : undefined}
												>
													{plLabel}
												</span>
											</div>
										);
									})}
								</div>
							</section>
						));
					})()}
				</>
			) : null}
		</div>
	);
}
