import React, { useEffect, useMemo, useState } from 'react';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';

console.log('[island.mount]', 'PriceWatchlist');

const BASE_SYMBOLS = ['BTC', 'ETH', 'POL', 'AVAX'] as const;
const STORAGE_KEY = 'watchlist';
const inflightPriceFetches = new Map<string, Promise<Record<string, number>>>();

function stableHash(symbols: string[]) {
	return symbols.join('|');
}

type PriceEntry = {
	symbol: string;
	priceUsd: number;
};

type WatchlistToken = {
	symbol: string;
};

type FetchState =
	| { status: 'idle' | 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; prices: PriceEntry[] };

type StoredWatchlist = {
	tokens: Array<string | WatchlistToken>;
	expanded: boolean;
};

type Toast = { id: number; message: string };

/**
 * PriceWatchlist
 *
 * Fetches key asset prices (BTC, ETH, POL, AVAX) from CoinGecko
 * via an internal API and renders a compact watchlist card
 * suitable for the top-left column of the Net Worth dashboard.
 */
export function PriceWatchlist() {
	const [state, setState] = useState<FetchState>({ status: 'idle' });
	const [tokens, setTokens] = useState<WatchlistToken[]>(
		BASE_SYMBOLS.map((sym) => ({ symbol: sym })),
	);
	const [input, setInput] = useState('');
	const [isExpanded, setIsExpanded] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	const [removing, setRemoving] = useState<Set<string>>(new Set());
	const [toasts, setToasts] = useState<Toast[]>([]);
	const [toastCounter, setToastCounter] = useState(0);
	const combinedSymbols = useMemo(() => allowlistSymbols(tokens.map((t) => t.symbol)), [tokens]);
	const combinedSymbolsKey = useMemo(() => stableHash(combinedSymbols), [combinedSymbols]);

	const totalTokens = combinedSymbols.length;
	const showToggle = totalTokens > 3;
	const visibleTokens = !isExpanded && showToggle ? tokens.slice(0, 3) : tokens;

	// Hydrate from localStorage (with migration)
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as StoredWatchlist;
				const defaultTokens: WatchlistToken[] = BASE_SYMBOLS.map((sym) => ({ symbol: sym }));

				let migrated: WatchlistToken[] = defaultTokens;
				if (Array.isArray(parsed.tokens) && parsed.tokens.length) {
					const first = parsed.tokens[0];
					if (typeof first === 'string') {
						migrated = parsed.tokens.map((sym) => ({
							symbol: String(sym).toUpperCase(),
						}));
					} else {
						migrated = (parsed.tokens as WatchlistToken[]).map((t) => ({
							symbol: String((t as any).symbol ?? '').toUpperCase(),
						}));
					}
				}

				setTokens(migrated);
				if (typeof parsed.expanded === 'boolean') {
					setIsExpanded(parsed.expanded);
				}
			}
		} catch (err) {
			console.warn('[PriceWatchlist] Failed to parse watchlist storage', err);
		} finally {
			setHydrated(true);
		}
	}, []);

	// Persist to localStorage
	useEffect(() => {
		if (!hydrated || typeof window === 'undefined') return;
		const payload: StoredWatchlist = { tokens, expanded: isExpanded };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	}, [tokens, isExpanded, hydrated]);

	// Fetch prices (Coinpaprika cached via server)
	useEffect(() => {
		if (!hydrated) {
			return;
		}

		let cancelled = false;

		let debounceTimer: ReturnType<typeof setTimeout> | undefined;

		async function loadPrices() {
			try {
				const sanitized = combinedSymbols;
				if (!sanitized.length) {
					setState({ status: 'ready', prices: [] });
					return;
				}
				const hash = stableHash(sanitized);
				console.log('[client] price fetch', { count: sanitized.length, hash });
				setState({ status: 'loading' });
				let promise = inflightPriceFetches.get(hash);
				if (!promise) {
					const url = `/api/market/coinpaprika-prices?symbols=${encodeURIComponent(
						sanitized.join(','),
					)}`;
					promise = (async () => {
						const response = await fetch(url);
						if (!response.ok) {
							throw new Error(`HTTP ${response.status}`);
						}
						const payload = (await response.json()) as { prices?: Record<string, number> };
						return payload.prices ?? {};
					})();
					inflightPriceFetches.set(hash, promise);
				}
				let priceMap: Record<string, number>;
				try {
					priceMap = await promise;
				} finally {
					if (inflightPriceFetches.get(hash) === promise) {
						inflightPriceFetches.delete(hash);
					}
				}

				const entries: PriceEntry[] = tokens.map((t) => ({
					symbol: t.symbol.toUpperCase(),
					priceUsd: Number(priceMap[t.symbol.toUpperCase()] ?? 0),
				}));

				if (!cancelled) {
					setState({ status: 'ready', prices: entries });
				}
			} catch (err) {
				console.error('[PriceWatchlist] Failed to load prices', err);
				if (!cancelled) {
					setState({
						status: 'error',
						message: 'Unable to load prices right now.',
					});
				}
			}
		}

		loadPrices();

		const schedule = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(loadPrices, 400);
		};
		schedule();

		// Optional: refresh every 60s
		const interval = setInterval(loadPrices, 60_000);

		return () => {
			cancelled = true;
			if (debounceTimer) clearTimeout(debounceTimer);
			clearInterval(interval);
		};
	}, [hydrated, combinedSymbolsKey, tokens]);

	// adjusted watchlist and built hide buttonfor NFTs
	function handleAddSymbol(
		event?: React.FormEvent | React.KeyboardEvent<HTMLInputElement> | React.MouseEvent<HTMLButtonElement>,
	) {
		event?.preventDefault();
		const trimmed = input.trim().toUpperCase();
		if (!trimmed || trimmed.length > 10) return;
		if (combinedSymbols.includes(trimmed)) return;
		setTokens((prev) => [...prev, { symbol: trimmed }]);
		setInput('');
		setIsExpanded(true);
		pushToast(`Added ${trimmed} to watchlist.`);
	}

	function handleDelete(symbol: string) {
		setRemoving((prev) => new Set(prev).add(symbol));
		setTimeout(() => {
			setTokens((prev) => prev.filter((t) => t.symbol !== symbol));
			setRemoving((prev) => {
				const next = new Set(prev);
				next.delete(symbol);
				return next;
			});
			pushToast(`Removed ${symbol} from watchlist.`);
		}, 180);
	}

	function handleMove(symbol: string, direction: 'up' | 'down') {
		setTokens((prev) => {
			const idx = prev.findIndex((t) => t.symbol === symbol);
			if (idx === -1) return prev;
			const swapWith = direction === 'up' ? idx - 1 : idx + 1;
			if (swapWith < 0 || swapWith >= prev.length) return prev;
			const next = [...prev];
			[next[idx], next[swapWith]] = [next[swapWith], next[idx]];
			return next;
		});
	}

	function pushToast(message: string) {
		setToastCounter((id) => {
			const nextId = id + 1;
			const toast: Toast = { id: nextId, message };
			setToasts((prev) => [...prev, toast]);
			setTimeout(() => {
				setToasts((prev) => prev.filter((entry) => entry.id !== nextId));
			}, 2000);
			return nextId;
		});
	}

	return (
		<div style={{ position: 'relative' }}>
			<div
				className="price-watchlist-card"
				style={{
					backgroundColor: '#3b4a46',
					borderRadius: '12px',
					padding: '1rem 1.25rem',
					display: 'flex',
					flexDirection: 'column',
					gap: '0.5rem',
					minHeight: '240px',
					height: '100%',
					color: '#f7f2eb',
				}}
			>
				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						marginBottom: '0.25rem',
						gap: '0.5rem',
					}}
				>
					<h2
						style={{
							fontSize: '1rem',
							fontWeight: 600,
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						}}
					>
						Price watchlist
					</h2>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<span
							style={{
								fontSize: '0.75rem',
								opacity: 0.75,
							}}
						>
							From Aave / fallback
						</span>
						{showToggle ? (
							<button
								type="button"
								onClick={() => setIsExpanded((prev) => !prev)}
								aria-label={isExpanded ? 'Collapse watchlist' : 'Expand watchlist'}
								style={{
									width: '32px',
									height: '32px',
									borderRadius: '50%',
									border: '1px solid rgba(255,255,255,0.25)',
									background: 'rgba(255,255,255,0.08)',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									cursor: 'pointer',
									transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
									transition: 'transform 0.15s ease-out, opacity 0.15s ease-out',
									opacity: 0.85,
								}}
								onMouseEnter={(e) => {
									(e.currentTarget as HTMLButtonElement).style.opacity = '1';
								}}
								onMouseLeave={(e) => {
									(e.currentTarget as HTMLButtonElement).style.opacity = '0.85';
								}}
							>
								{isExpanded ? (
									<ChevronUp size={16} color="#f7f2eb" strokeWidth={2.4} />
								) : (
									<ChevronDown size={16} color="#f7f2eb" strokeWidth={2.4} />
								)}
							</button>
						) : null}
					</div>
				</div>

				<form
					onSubmit={handleAddSymbol}
					style={{
						display: 'flex',
						gap: '0.5rem',
						alignItems: 'stretch',
						flexWrap: 'wrap',
					}}
				>
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								handleAddSymbol(event);
							}
						}}
						placeholder="Add token (e.g. LINK, SOL)"
						style={{
							flex: '1 1 180px',
							minWidth: '0',
							borderRadius: '10px',
							border: '1px solid rgba(255,255,255,0.25)',
							background: 'rgba(0,0,0,0.2)',
							color: '#f7f2eb',
							padding: '0.45rem 0.75rem',
							fontSize: '0.9rem',
						}}
					/>
					<button
						type="button"
						onClick={handleAddSymbol}
						style={{
							flex: '0 0 auto',
							borderRadius: '10px',
							border: '1px solid rgba(255,255,255,0.25)',
							background: 'rgba(255,255,255,0.08)',
							color: '#f7f2eb',
							padding: '0.45rem 0.9rem',
							fontSize: '0.9rem',
							cursor: 'pointer',
						}}
					>
						Add
					</button>
				</form>

				{state.status === 'loading' ? (
					<p
						style={{
							fontSize: '0.875rem',
							opacity: 0.8,
						}}
					>
						Loading prices…
					</p>
				) : null}

				{state.status === 'error' ? (
					<p
						style={{
							fontSize: '0.875rem',
							color: '#fca5a5',
						}}
					>
						{state.message}
					</p>
				) : null}

				{state.status === 'ready' ? (
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: '1fr',
							rowGap: '0.35rem',
							overflowY: 'auto',
							paddingRight: '0.15rem',
							scrollbarWidth: 'thin',
							flex: '1 1 auto',
							minHeight: '140px',
						}}
					>
						{visibleTokens.map((token) => {
							const symbol = token.symbol.toUpperCase();
							const priceEntry =
								state.status === 'ready'
									? state.prices.find((p) => p.symbol === symbol)
									: undefined;
							const entry = priceEntry ?? { symbol, priceUsd: 0 };
							const showNoData = !priceEntry || !(entry.priceUsd > 0);
							const formattedPrice = showNoData
								? '—'
								: `$${entry.priceUsd.toLocaleString(undefined, {
										minimumFractionDigits: 4,
										maximumFractionDigits: 4,
								  })}`;

							const changeLabel = '—';
							const changeColor = 'rgba(255,255,255,0.7)';

							const isRemoving = removing.has(symbol);

							const isFirst = tokens[0]?.symbol === token.symbol;
							const isLast = tokens[tokens.length - 1]?.symbol === token.symbol;

							return (
								<div
									key={token.symbol}
									className={`token-row${isRemoving ? ' removing' : ''}`}
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
										fontSize: '0.9rem',
										gap: '0.5rem',
										padding: '0.25rem 0',
										opacity: isRemoving ? 0 : 1,
										transform: isRemoving ? 'translateX(-10px)' : 'translateX(0)',
										transition: 'opacity 0.2s ease, transform 0.2s ease',
									}}
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
										<GripVertical size={16} color="#c9d5d0" aria-hidden="true" />
										<div style={{ display: 'flex', flexDirection: 'column' }}>
											<span style={{ fontWeight: 600 }}>{symbol}</span>
											<span
												style={{
													fontSize: '0.75rem',
													opacity: 0.7,
												}}
											>
												Aave reference
											</span>
											{showNoData ? (
												<span
													style={{
														fontSize: '0.75rem',
														opacity: 0.6,
														marginTop: '0.15rem',
													}}
												>
													No data yet
												</span>
											) : null}
										</div>
									</div>
									<div
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '0.45rem',
										}}
									>
										<div
											style={{
												textAlign: 'right',
												display: 'flex',
												flexDirection: 'column',
												gap: '0.1rem',
												minWidth: '90px',
											}}
										>
											<span style={{ fontWeight: 500, textAlign: 'right' }}>{formattedPrice}</span>
											<span
												style={{
													fontSize: '0.75rem',
													color: changeColor,
													textAlign: 'right',
												}}
											>
												{changeLabel}
											</span>
										</div>
										<div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
											<button
												type="button"
												onClick={() => handleMove(symbol, 'up')}
												aria-label={`Move ${symbol} up`}
												disabled={isFirst}
												style={{
													width: '26px',
													height: '24px',
													borderRadius: '8px',
													border: '1px solid rgba(255,255,255,0.2)',
													background: 'rgba(255,255,255,0.06)',
													color: '#f7f2eb',
													display: 'inline-flex',
													alignItems: 'center',
													justifyContent: 'center',
													cursor: isFirst ? 'not-allowed' : 'pointer',
													opacity: isFirst ? 0.5 : 0.9,
												}}
											>
												<ChevronUp size={14} />
											</button>
											<button
												type="button"
												onClick={() => handleMove(symbol, 'down')}
												aria-label={`Move ${symbol} down`}
												disabled={isLast}
												style={{
													width: '26px',
													height: '24px',
													borderRadius: '8px',
													border: '1px solid rgba(255,255,255,0.2)',
													background: 'rgba(255,255,255,0.06)',
													color: '#f7f2eb',
													display: 'inline-flex',
													alignItems: 'center',
													justifyContent: 'center',
													cursor: isLast ? 'not-allowed' : 'pointer',
													opacity: isLast ? 0.5 : 0.9,
												}}
											>
												<ChevronDown size={14} />
											</button>
										</div>
										<button
											type="button"
											onClick={() => handleDelete(symbol)}
											aria-label={`Remove ${symbol}`}
											style={{
												width: '32px',
												height: '32px',
												borderRadius: '10px',
												border: '1px solid rgba(255,255,255,0.25)',
												background: 'rgba(255,255,255,0.08)',
												color: '#f7f2eb',
												display: 'inline-flex',
												alignItems: 'center',
												justifyContent: 'center',
												cursor: 'pointer',
												opacity: 0.85,
												transition: 'opacity 0.15s ease',
											}}
											onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
											onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
										>
											<Trash2 size={16} />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				) : null}
			</div>

			{/* Toasts */}
			<div
				style={{
					position: 'absolute',
					bottom: '0.5rem',
					right: '0.5rem',
					display: 'flex',
					flexDirection: 'column',
					gap: '0.35rem',
					pointerEvents: 'none',
				}}
			>
				{toasts.map((toast) => (
					<div
						key={toast.id}
						style={{
							background: 'rgba(59, 74, 70, 0.9)',
							border: '1px solid rgba(250, 235, 215, 0.35)',
							borderRadius: '10px',
							padding: '0.55rem 0.8rem',
							color: '#f7f2eb',
							fontSize: '0.9rem',
							boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
							pointerEvents: 'auto',
						}}
					>
						{toast.message}
					</div>
				))}
			</div>
		</div>
	);
}

export default PriceWatchlist;
