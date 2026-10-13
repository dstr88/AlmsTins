import React, { useEffect, useState } from 'react';
import './WalletSummary.css';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getWalletSummary } from '@/i18n/components/walletSummary';

console.log('[island.mount]', 'WalletSummary');

// ── Inline basis-entry form ───────────────────────────────────────────────────
// Shown beneath a token row when the user clicks "+ basis".
// Both fields are optional: fill one or both, click Save.
type BasisFormProps = {
	walletId: string;
	symbol: string;
	chain: string;
	onClose: () => void;
};
function BasisForm({ walletId, symbol, chain, onClose }: BasisFormProps) {
	const t = getWalletSummary(getClientLang());
	const [date, setDate]   = useState('');
	const [price, setPrice] = useState('');
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const save = async () => {
		const d = date.trim();
		const p = parseFloat(price.trim());
		if (!d && isNaN(p)) { setMsg(t.basisFormValidation); return; }
		setSaving(true);
		setMsg(null);
		try {
			const body: Record<string, unknown> = { symbol };
			if (d)                        body.purchaseDate = d;
			if (!isNaN(p) && p > 0)       body.pricePerCoin = p;
			const res = await fetch(`/api/wallets/${walletId}/token-basis`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				setMsg((err as any).message ?? t.basisFormSaveFailed);
				setSaving(false);
				return;
			}
			window.location.reload();
		} catch {
			setMsg(t.basisFormNetworkError);
			setSaving(false);
		}
	};

	return (
		<div className="wallet-summary__basis-form">
			<label className="wallet-summary__basis-label">
				{t.basisFormBought}
				<input type="date" value={date} onChange={(e) => setDate(e.target.value)}
					max={new Date().toISOString().slice(0, 10)} className="wallet-summary__basis-input" />
			</label>
			<label className="wallet-summary__basis-label">
				{t.basisFormPerCoin}
				<input type="number" min="0" step="any" placeholder="0.00"
					value={price} onChange={(e) => setPrice(e.target.value)}
					className="wallet-summary__basis-input wallet-summary__basis-input--num" />
			</label>
			<button onClick={save} disabled={saving} className="wallet-summary__basis-save">
				{saving ? t.basisFormSaving : t.basisFormSave}
			</button>
			<button onClick={onClose} className="wallet-summary__basis-cancel">
				{t.basisFormCancel}
			</button>
			{msg && <span className="wallet-summary__basis-error">{msg}</span>}
		</div>
	);
}

type WalletSummaryState =
	| { status: 'loading' }
	| { status: 'error'; message: string; refCode: string }
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

function makeRefCode(walletId: string): string {
	const suffix = walletId.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(4, 'X');
	const stamp = Date.now().toString(36).slice(-5).toUpperCase();
	return `${suffix}-${stamp}`;
}

function reportWalletError(walletId: string, refCode: string, message: string) {
	try {
		fetch('/api/vault/report-error', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ walletId, refCode, message }),
			keepalive: true,
		}).catch(() => {});
	} catch { /* ignore */ }
}

/**
 * Fetch that rides out a deploy / restart window: retries network-level failures
 * ("Load failed" / "Failed to fetch") and transient gateway statuses (502/503/504)
 * a couple of times before giving up — so a redeploy blip never trips a false alert.
 */
async function fetchWithRetry(
	url: string,
	opts: RequestInit,
	retries = 2,
	delayMs = 3000,
): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(url, opts);
			if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
				await new Promise((r) => setTimeout(r, delayMs));
				continue;
			}
			return res;
		} catch (e) {
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, delayMs));
				continue;
			}
			throw e;
		}
	}
}

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
	daysHeld: number | null;
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
	walletCreatedAt?: string | null;
	initialData?: {
		snapshot?: FullWalletSnapshot | null;
		sync?: FullWalletSync | null;
	} | null;
};

const formatLastSync = (value?: string | null, neverLabel = 'never') => {
	if (!value) return neverLabel;
	const stamp = Date.parse(value);
	if (!Number.isFinite(stamp)) return value;
	const lang = getClientLang();
	const locale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
	return new Date(stamp).toLocaleString(locale);
};

export default function WalletSummary({ walletId, walletCreatedAt, initialData }: WalletSummaryProps) {
	const t = getWalletSummary(getClientLang());
	const [state, setState] = useState<WalletSummaryState>({ status: 'loading' });
	const [hideSpam, setHideSpam] = useState(true);
	const [copied, setCopied] = useState(false);
	const [retryKey, setRetryKey] = useState(0);
	// Manual cost-basis entry — tracks which token row has the form open
	const [basisEdit, setBasisEdit] = useState<{ symbol: string; chain: string } | null>(null);
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
				const res = await fetchWithRetry(url, { credentials: 'include' });
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
					// 404 means the wallet was deleted (e.g. demo cleanup ran on reload).
					// Silently render nothing so the tin disappears without an error flash.
					if (status === 404) {
						if (!cancelled) setStateLogged({ status: 'empty', message: '' }, 'refresh.404-gone');
						return;
					}
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
								message: t.emptyMessage,
								hint: t.emptyHint,
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
				const message = err instanceof Error ? err.message : 'Unable to load wallet summary.';
				const refCode = makeRefCode(walletId);
				console.log('[WalletSummary.refresh] exception', {
					message,
					refCode,
					stack: err instanceof Error ? err.stack : undefined,
				});
				if (!cancelled) {
					if (state.status === 'ready' || state.status === 'stale') {
						// Prior balances still on screen — show them as stale, don't alert.
						setStateLogged({ ...(state as any), status: 'stale', message }, 'refresh.exception');
					} else {
						// No prior data and still failing after retries — a real problem: alert + show error.
						reportWalletError(walletId, refCode, message);
						setStateLogged({ status: 'error', message, refCode }, 'refresh.exception');
					}
				}
			}
		};
		loadSummary();
		return () => {
			cancelled = true;
		};
	}, [walletId, retryKey]);

	const snapshotChains = initialData?.snapshot?.byChain ?? [];
	const showSnapshotFallback =
		snapshotChains.length > 0 && state.status !== 'ready' && state.status !== 'stale';
	const walletData = (state.status === 'ready' || state.status === 'stale') ? state.wallet : null;
	// Days since this wallet was added to tracking — used as last-resort fallback when no
	// acquisition date exists in the token data (e.g. freshly-added watch-only wallets).
	const walletTrackedDays =
		walletCreatedAt && Number.isFinite(Date.parse(walletCreatedAt))
			? Math.max(0, Math.floor((Date.now() - Date.parse(walletCreatedAt)) / (1000 * 60 * 60 * 24)))
			: null;
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
			{walletData ? (
				<label className="flex items-center justify-center mb-4 text-sm">
					<input
						type="checkbox"
						checked={hideSpam}
						onChange={(event) => setHideSpam(event.target.checked)}
						className="mr-2"
					/>
					{t.hideSpam}
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
								<div className="wallet-summary__asset-row wallet-summary__asset-row--header">
									<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
										<span className="wallet-summary__cell wallet-summary__cell--days">{t.colDays}</span>
										<span className="wallet-summary__cell wallet-summary__cell--token">{t.colToken}</span>
										<span className="wallet-summary__cell wallet-summary__cell--value">{t.colValue}</span>
									</div>
								</div>
								{chain.tokens.map((token) => (
									<div key={`${chain.chain}-${token.symbol}`} className="wallet-summary__asset-row">
										<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
											<span className="wallet-summary__cell wallet-summary__cell--days">
												{(token.daysHeld ?? walletTrackedDays) != null
													? `${token.daysHeld ?? walletTrackedDays}d`
													: '—'}
											</span>
											<span className="wallet-summary__cell wallet-summary__cell--token">{token.symbol}</span>
											<span className="wallet-summary__cell wallet-summary__cell--value">
												{token.usdValue == null ? t.unpriced : currencyFormatter.format(Number(token.usdValue))}
											</span>
										</div>
										<div className="wallet-summary__asset-line wallet-summary__asset-line--bottom">
											<span className="wallet-summary__cell wallet-summary__cell--qty">{token.amountFormatted}</span>
											<span className="wallet-summary__cell wallet-summary__cell--price">—</span>
											<span className="wallet-summary__cell wallet-summary__cell--pl">
												{token.profitLoss === 'N/A' || token.profitLoss?.percent === undefined
													? '—'
													: `${token.profitLoss.percent.toFixed(1)}%`}
											</span>
										</div>
									</div>
								))}
							</div>
						</section>
					))}
				</div>
			) : null}
			{state.status === 'loading' ? (
				<div className="wallet-summary__skeleton-chain">
					<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-title" />
					{[0, 1, 2].map((i) => (
						<div key={i} className="wallet-summary__skeleton-row">
							<div className="wallet-summary__skeleton-line">
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell" style={{ width: '2rem' }} />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell" style={{ width: '65%' }} />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell" style={{ width: '45%' }} />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell" style={{ width: '3.5rem' }} />
							</div>
							<div className="wallet-summary__skeleton-line">
								<div />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell wallet-summary__skeleton-cell--sm" style={{ width: '55%' }} />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell wallet-summary__skeleton-cell--sm" style={{ width: '35%' }} />
								<div className="wallet-summary__skeleton-bar wallet-summary__skeleton-cell wallet-summary__skeleton-cell--sm" style={{ width: '2.5rem' }} />
							</div>
						</div>
					))}
				</div>
			) : null}
			{state.status === 'error' ? (
				<div className="wallet-summary__error-panel">
					<div className="wallet-summary__error-message">{t.errorMessage}</div>
					<div className="wallet-summary__error-detail">{state.message}</div>
					<div className="wallet-summary__error-ref">
						<span className="wallet-summary__error-ref-label">{t.errorRefLabel}</span>
						<code className="wallet-summary__error-ref-code">{state.refCode}</code>
					</div>
					<button
						className="wallet-summary__retry-btn"
						onClick={() => setRetryKey((k) => k + 1)}
					>
						{t.retryBtn}
					</button>
				</div>
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
						{t.staleBanner}
					</div>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const unpricedCount = tokens.filter((tok) => tok.unpricedReason || tok.usdValue == null).length;
						const showBanner = tokens.length > 0 && unpricedCount >= Math.ceil(tokens.length * 0.5);
						return showBanner ? (
							<div className="wallet-summary__status">
								{t.unpricedBanner}
							</div>
						) : null;
					})()}
					<div className="wallet-summary__total">
						<span className="wallet-summary__total-label">{t.totalLabel}</span>
						<span className="wallet-summary__total-value">
							{(() => {
								const tokens = state.wallet.tokens ?? [];
								const unpricedCount = tokens.filter((tok) => tok.unpricedReason || tok.usdValue == null).length;
								return state.wallet.totalUsd === 0 && unpricedCount > 0
									? t.unpriced
									: currencyFormatter.format(state.wallet.totalUsd);
							})()}
						</span>
					</div>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const displayedTokens = hideSpam
							? tokens.filter(
									(tok) =>
										(tok.usdValue != null && tok.usdValue > 0.01) ||
										tok.amount >= 1e-4 ||
										!tok.unpricedReason,
							  )
							: tokens;
						const groups = buildChainGroups(displayedTokens);
						return groups.map((group) => (
							<section key={group.chain} className="wallet-summary__chain">
								<h4 className="wallet-summary__chain-title">{group.chain}</h4>
								<div className="wallet-summary__chain-rows">
									<div className="wallet-summary__asset-row wallet-summary__asset-row--header">
										<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
											<span className="wallet-summary__cell wallet-summary__cell--days">{t.colDays}</span>
											<span className="wallet-summary__cell wallet-summary__cell--token">{t.colToken}</span>
											<span className="wallet-summary__cell wallet-summary__cell--value">{t.colValue}</span>
										</div>
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
										const valueNode = isUnverified ? (
											<abbr title={t.unpricedContractTitle} className="wallet-summary__cell--value-unverified">?</abbr>
										) : resolvedUsd !== null ? (
											<span className={resolvedUsd > 0 ? 'wallet-summary__cell--value-positive' : undefined}>{currencyFormatter.format(resolvedUsd)}</span>
										) : (
											<abbr title={t.unpricedDataTitle} className="wallet-summary__cell--value-unpriced">—</abbr>
										);
										// Days held priority:
										// 1. purchaseAt — from imported tx history (most accurate)
										// 2. walletCreatedAt — when wallet was added to tracking (last resort)
										// capturedAt (snapshot time) intentionally excluded — it updates on every
										// sync so it always equals "today", producing a bogus 0d result.
										// The 1-year (365d) threshold determines short-term vs long-term gains.
										const acquiredAt = token.purchaseAt ? Date.parse(token.purchaseAt) : NaN;
										const walletMs = walletCreatedAt ? Date.parse(walletCreatedAt) : NaN;
										const effectiveMs = Number.isFinite(acquiredAt)
											? acquiredAt
											: Number.isFinite(walletMs)
												? walletMs
												: NaN;
										const daysHeld = Number.isFinite(effectiveMs)
											? Math.max(0, Math.floor((Date.now() - effectiveMs) / (1000 * 60 * 60 * 24)))
											: null;
										const isLongTerm = daysHeld !== null && daysHeld >= 365;
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
										const plClass = plPct !== null
											? (plPct >= 0 ? 'wallet-summary__cell--pl-positive' : 'wallet-summary__cell--pl-negative')
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? 'wallet-summary__cell--pl-unknown'
												: 'wallet-summary__cell--pl-none';
										// Show dollar gain/loss; percentage moves to tooltip on hover
										const plLabel = plAbsolute !== null
											? `${plAbsolute >= 0 ? '+' : ''}${currencyFormatter.format(plAbsolute)}`
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? '?'
												: '—';
										const plTooltip = plPct !== null
											? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
											: undefined;
										return (
											<div key={`${token.chain}-${token.tokenSymbol}`} className="wallet-summary__asset-row">
												<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
													<span className="wallet-summary__cell wallet-summary__cell--days">
														{daysHeld === null ? '—' : `${daysHeld}d`}
														{daysHeld !== null && (
															<span className={isLongTerm ? 'wallet-summary__lt-badge' : 'wallet-summary__st-badge'}>
																{isLongTerm ? 'LT' : 'ST'}
															</span>
														)}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--token">
														{token.tokenSymbol}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--qty wallet-summary__cell--qty-top">
														{Number(token.amount ?? 0).toLocaleString(undefined, {
															maximumFractionDigits: 4,
														})} {t.qtyEach}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--value">
														{valueNode}
													</span>
												</div>
												<div className="wallet-summary__asset-line wallet-summary__asset-line--bottom">
													<span />
													<span className="wallet-summary__cell wallet-summary__cell--price">
														{currentPrice != null ? currencyFormatter.format(currentPrice) : '—'}
													</span>
													<span
														className={`wallet-summary__cell wallet-summary__cell--pl ${plClass}`}
														title={plTooltip}
													>
														{plLabel}
														{basisPrice === null && (
															<button
																onClick={() => setBasisEdit(
																	basisEdit?.symbol === token.tokenSymbol && basisEdit?.chain === token.chain
																		? null
																		: { symbol: token.tokenSymbol, chain: token.chain }
																)}
																className="wallet-summary__add-basis-btn"
																title={t.addBasisTitle}
															>{t.addBasis}</button>
														)}
													</span>
												</div>
												{basisEdit?.symbol === token.tokenSymbol && basisEdit?.chain === token.chain && (
													<BasisForm walletId={walletId} symbol={token.tokenSymbol} chain={token.chain}
														onClose={() => setBasisEdit(null)} />
												)}
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
						const unpricedCount = tokens.filter((tok) => tok.unpricedReason || tok.usdValue == null).length;
						const showBanner = tokens.length > 0 && unpricedCount >= Math.ceil(tokens.length * 0.5);
						return showBanner ? (
							<div className="wallet-summary__status">
								{t.unpricedBanner}
							</div>
						) : null;
					})()}
					<div className="wallet-summary__total">
						<span className="wallet-summary__total-label">{t.totalLabel}</span>
						<span className="wallet-summary__total-value">
							{(() => {
								const tokens = state.wallet.tokens ?? [];
								const unpricedCount = tokens.filter((tok) => tok.unpricedReason || tok.usdValue == null).length;
								return state.wallet.totalUsd === 0 && unpricedCount > 0
									? t.unpriced
									: currencyFormatter.format(state.wallet.totalUsd);
							})()}
						</span>
					</div>
					{(() => {
						const tokens = state.wallet.tokens ?? [];
						const displayedTokens = hideSpam
							? tokens.filter(
									(tok) =>
										(tok.usdValue != null && tok.usdValue > 0.01) ||
										tok.amount >= 1e-4 ||
										!tok.unpricedReason,
							  )
							: tokens;
						const groups = buildChainGroups(displayedTokens);
						return groups.map((group) => (
							<section key={group.chain} className="wallet-summary__chain">
								<h4 className="wallet-summary__chain-title">{group.chain}</h4>
								<div className="wallet-summary__chain-rows">
									<div className="wallet-summary__asset-row wallet-summary__asset-row--header">
										<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
											<span className="wallet-summary__cell wallet-summary__cell--days">{t.colDays}</span>
											<span className="wallet-summary__cell wallet-summary__cell--token">{t.colToken}</span>
											<span className="wallet-summary__cell wallet-summary__cell--value">{t.colValue}</span>
										</div>
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
										const valueNode = isUnverified ? (
											<abbr title={t.unpricedContractTitle} className="wallet-summary__cell--value-unverified">?</abbr>
										) : resolvedUsd !== null ? (
											<span className={resolvedUsd > 0 ? 'wallet-summary__cell--value-positive' : undefined}>{currencyFormatter.format(resolvedUsd)}</span>
										) : (
											<abbr title={t.unpricedDataTitle} className="wallet-summary__cell--value-unpriced">—</abbr>
										);
										// Days held priority:
										// 1. purchaseAt — from imported tx history (most accurate)
										// 2. walletCreatedAt — when wallet was added to tracking (last resort)
										// capturedAt (snapshot time) intentionally excluded — it updates on every
										// sync so it always equals "today", producing a bogus 0d result.
										// The 1-year (365d) threshold determines short-term vs long-term gains.
										const acquiredAt = token.purchaseAt ? Date.parse(token.purchaseAt) : NaN;
										const walletMs = walletCreatedAt ? Date.parse(walletCreatedAt) : NaN;
										const effectiveMs = Number.isFinite(acquiredAt)
											? acquiredAt
											: Number.isFinite(walletMs)
												? walletMs
												: NaN;
										const daysHeld = Number.isFinite(effectiveMs)
											? Math.max(0, Math.floor((Date.now() - effectiveMs) / (1000 * 60 * 60 * 24)))
											: null;
										const isLongTerm = daysHeld !== null && daysHeld >= 365;
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
										const plClass = plPct !== null
											? (plPct >= 0 ? 'wallet-summary__cell--pl-positive' : 'wallet-summary__cell--pl-negative')
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? 'wallet-summary__cell--pl-unknown'
												: 'wallet-summary__cell--pl-none';
										// Show dollar gain/loss; percentage moves to tooltip on hover
										const plLabel = plAbsolute !== null
											? `${plAbsolute >= 0 ? '+' : ''}${currencyFormatter.format(plAbsolute)}`
											: (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0)
												? '?'
												: '—';
										const plTooltip = plPct !== null
											? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
											: undefined;
										return (
											<div key={`${token.chain}-${token.tokenSymbol}`} className="wallet-summary__asset-row">
												<div className="wallet-summary__asset-line wallet-summary__asset-line--top">
													<span className="wallet-summary__cell wallet-summary__cell--days">
														{daysHeld === null ? '—' : `${daysHeld}d`}
														{daysHeld !== null && (
															<span className={isLongTerm ? 'wallet-summary__lt-badge' : 'wallet-summary__st-badge'}>
																{isLongTerm ? 'LT' : 'ST'}
															</span>
														)}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--token">
														{token.tokenSymbol}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--qty wallet-summary__cell--qty-top">
														{Number(token.amount ?? 0).toLocaleString(undefined, {
															maximumFractionDigits: 4,
														})} {t.qtyEach}
													</span>
													<span className="wallet-summary__cell wallet-summary__cell--value">
														{valueNode}
													</span>
												</div>
												<div className="wallet-summary__asset-line wallet-summary__asset-line--bottom">
													<span />
													<span className="wallet-summary__cell wallet-summary__cell--price">
														{currentPrice != null ? currencyFormatter.format(currentPrice) : '—'}
													</span>
													<span
														className={`wallet-summary__cell wallet-summary__cell--pl ${plClass}`}
														title={plTooltip}
													>
														{plLabel}
														{basisPrice === null && (
															<button
																onClick={() => setBasisEdit(
																	basisEdit?.symbol === token.tokenSymbol && basisEdit?.chain === token.chain
																		? null
																		: { symbol: token.tokenSymbol, chain: token.chain }
																)}
																className="wallet-summary__add-basis-btn"
																title={t.addBasisTitle}
															>{t.addBasis}</button>
														)}
													</span>
												</div>
												{basisEdit?.symbol === token.tokenSymbol && basisEdit?.chain === token.chain && (
													<BasisForm walletId={walletId} symbol={token.tokenSymbol} chain={token.chain}
														onClose={() => setBasisEdit(null)} />
												)}
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
