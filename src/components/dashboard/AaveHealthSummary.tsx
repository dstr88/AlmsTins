import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getAaveHealthSummary } from '@/i18n/components/aaveHealthSummary';

console.log('[island.mount]', 'AaveHealthSummary');

// ── Alert Pill ────────────────────────────────────────────────────────────────

type AlertPref = {
	threshold: number;
	direction: 'below' | 'above';
	enabled: boolean;
} | null;

function AlertPill({ walletId }: { walletId: string }) {
	const t = getAaveHealthSummary(getClientLang());
	const [pref, setPref]           = useState<AlertPref>(null);
	const [loading, setLoading]     = useState(true);
	const [open, setOpen]           = useState(false);
	const [saving, setSaving]       = useState(false);
	const [threshold, setThreshold] = useState('1.5');
	const [direction, setDirection] = useState<'below' | 'above'>('below');
	const panelRef                  = useRef<HTMLDivElement>(null);

	// Load existing preference
	useEffect(() => {
		fetch(`/api/account/alert-preferences?walletId=${encodeURIComponent(walletId)}`)
			.then((r) => r.json())
			.then((d) => {
				if (d.ok && d.preference) {
					setPref(d.preference);
					setThreshold(String(d.preference.threshold));
					setDirection(d.preference.direction);
				}
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [walletId]);

	// Close panel on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open]);

	const save = useCallback(async () => {
		const parsed = parseFloat(threshold);
		if (!Number.isFinite(parsed) || parsed <= 0) return;
		setSaving(true);
		try {
			const res  = await fetch('/api/account/alert-preferences', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ walletId, threshold: parsed, direction, enabled: true }),
			});
			const data = await res.json();
			if (data.ok) {
				setPref({ threshold: parsed, direction, enabled: true });
				setOpen(false);
			}
		} finally {
			setSaving(false);
		}
	}, [walletId, threshold, direction]);

	const disable = useCallback(async () => {
		setSaving(true);
		try {
			const res  = await fetch('/api/account/alert-preferences', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({
					walletId,
					threshold: pref?.threshold ?? 1.5,
					direction: pref?.direction ?? 'below',
					enabled: false,
				}),
			});
			const data = await res.json();
			if (data.ok) {
				setPref((p) => p ? { ...p, enabled: false } : null);
				setOpen(false);
			}
		} finally {
			setSaving(false);
		}
	}, [walletId, pref]);

	if (loading) return null;

	const isActive = pref?.enabled === true;
	const pillLabel = isActive
		? t.activePillLabel(pref!.direction === 'below' ? '<' : '>', pref!.threshold)
		: t.setAlert;

	return (
		<div className="alert-pill-wrap" ref={panelRef}>
			<button
				className={`alert-pill${isActive ? ' alert-pill--active' : ''}`}
				onClick={() => setOpen((o) => !o)}
				title={isActive ? t.editAlertTitle : t.setAlertTitle}
			>
				{pillLabel}
			</button>

			{open && (
				<div className="alert-panel">
					<p className="alert-panel__title">{t.panelTitle}</p>
					<p className="alert-panel__sub">
						{t.panelSub}
						{' '}<a href="/dashboard/vault" onClick={() => setOpen(false)}>{t.panelAccountLink}</a>
					</p>
					<div className="alert-panel__row">
						<label className="alert-panel__label">{t.alertWhenHfIs}</label>
						<select
							value={direction}
							onChange={(e) => setDirection(e.target.value as 'below' | 'above')}
							className="alert-panel__select"
						>
							<option value="below">{t.directionBelow}</option>
							<option value="above">{t.directionAbove}</option>
						</select>
					</div>
					<div className="alert-panel__row">
						<label className="alert-panel__label">{t.thresholdLabel}</label>
						<input
							type="number"
							step="0.1"
							min="0.1"
							max="10"
							value={threshold}
							onChange={(e) => setThreshold(e.target.value)}
							className="alert-panel__input"
						/>
					</div>
					<div className="alert-panel__actions">
						<button
							className="alert-panel__save"
							onClick={save}
							disabled={saving}
						>
							{saving ? t.savingBtn : t.saveAlertBtn}
						</button>
						{isActive && (
							<button
								className="alert-panel__disable"
								onClick={disable}
								disabled={saving}
							>
								{t.disableBtn}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

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

type AaveLiquidation = {
	txHash: string;
	timestamp: string;
	blockExplorerUrl: string;
	chain: string;
	collateralSymbol: string;
	collateralAmount: number;
	collateralUsd: number;
	debtSymbol: string;
	debtAmount: number;
	debtUsd: number;
	penaltyUsd: number;
};

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function LiquidationCallout({ liq }: { liq: AaveLiquidation }) {
	const t = getAaveHealthSummary(getClientLang());
	const lang = getClientLang();
	const dateLocale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
	const date = new Date(liq.timestamp).toLocaleDateString(dateLocale, {
		year: 'numeric', month: 'short', day: 'numeric',
	});

	return (
		<div className="aave-liq-callout">
			<div className="aave-liq-header">
				<span className="aave-liq-icon">⚠</span>
				<span>{t.liquidationHeader(liq.chain.charAt(0).toUpperCase() + liq.chain.slice(1), date)}</span>
			</div>
			<div className="aave-liq-body">
				<div className="aave-liq-row">
					<span className="aave-liq-label">{t.loanCleared}</span>
					<span className="aave-liq-value">{usdFmt.format(liq.debtUsd)} {liq.debtSymbol}</span>
				</div>
				<div className="aave-liq-row">
					<span className="aave-liq-label">{t.collateralSeized}</span>
					<span className="aave-liq-value aave-liq-loss">
						{liq.collateralAmount.toFixed(6)} {liq.collateralSymbol} ({usdFmt.format(liq.collateralUsd)})
					</span>
				</div>
				<div className="aave-liq-row">
					<span className="aave-liq-label">{t.penaltyToLiquidator}</span>
					<span className="aave-liq-value aave-liq-loss">{usdFmt.format(liq.penaltyUsd)}</span>
				</div>
				{liq.blockExplorerUrl && (
					<div className="aave-liq-row">
						<a
							href={liq.blockExplorerUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="aave-liq-link"
						>
							{t.viewTransaction}
						</a>
					</div>
				)}
				<div className="aave-liq-tax">
					{t.taxableDisposal}
				</div>
			</div>
		</div>
	);
}

function LiquidationAlertToggle() {
	const t = getAaveHealthSummary(getClientLang());
	const [enabled, setEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving]   = useState(false);

	useEffect(() => {
		fetch('/api/account/liquidation-alert')
			.then((r) => r.json())
			.then((d) => { if (d.ok) setEnabled(d.enabled); })
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	const toggle = useCallback(async () => {
		setSaving(true);
		try {
			const res  = await fetch('/api/account/liquidation-alert', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ enabled: !enabled }),
			});
			const data = await res.json();
			if (data.ok) setEnabled(data.enabled);
		} finally {
			setSaving(false);
		}
	}, [enabled]);

	if (loading) return null;

	return (
		<div className="stat-row liq-alert-row">
			<span className="label">{t.liquidationEmail}</span>
			<button
				className={`alert-pill${enabled ? ' alert-pill--active' : ''}`}
				onClick={toggle}
				disabled={saving}
				title={enabled ? t.liqAlertOnTitle : t.liqAlertOffTitle}
			>
				{saving ? '…' : enabled ? t.liqAlertOn : t.liqAlertOff}
			</button>
		</div>
	);
}

export default function AaveHealthSummary({ walletId, showAlertPill = true, showHealthRow = true }: { walletId: string; showAlertPill?: boolean; showHealthRow?: boolean }) {
	const t = getAaveHealthSummary(getClientLang());
	const [state, setState] = useState<FetchState>({ status: 'loading' });
	const [walletAddress, setWalletAddress] = useState<string | null>(null);
	const [liquidations, setLiquidations] = useState<AaveLiquidation[]>([]);

	useEffect(() => {
		if (!walletAddress) return;
		fetch(`/api/aave/liquidations?address=${encodeURIComponent(walletAddress)}`)
			.then((r) => r.json())
			.then((d) => { if (d.ok) setLiquidations(d.liquidations ?? []); })
			.catch(() => {});
	}, [walletAddress]);

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
				if (!cancelled) setWalletAddress(address);

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
				// Aggregate positions from ALL chains that have active supplies or borrows.
				// A wallet can have positions on Ethereum, Polygon, and Avalanche simultaneously —
				// picking only one active chain would hide the others.
				const activeChainEntries = chainEntries.filter(([, summary]) =>
					(summary.userSupplies ?? []).length > 0 || (summary.userBorrows ?? []).length > 0
				);
				const supplies = activeChainEntries.flatMap(([, summary]) => summary.userSupplies ?? []);
				const borrows = activeChainEntries.flatMap(([, summary]) => summary.userBorrows ?? []);
				const unavailableMessage = null;

				// Normalize Avalanche bridge/wrapped token symbols to their base price symbol
				const normalizePriceSymbol = (sym: string): string => {
					const upper = sym.trim().toUpperCase();
					if (upper === 'BTC.B') return 'BTC';
					if (upper === 'SAVAX') return 'AVAX';   // staked AVAX ≈ AVAX price
					if (upper === 'WAVAX') return 'AVAX';
					if (upper === 'WETH' || upper === 'WETH.E') return 'ETH';
					if (upper === 'WBTC') return 'BTC';
					if (upper === 'USDT.E' || upper === 'USDT') return 'USDT';
					if (upper === 'USDC.E' || upper === 'USDC') return 'USDC';
					if (upper === 'DAI.E' || upper === 'DAI') return 'DAI';
					if (upper === 'LINK.E' || upper === 'LINK') return 'LINK';
					if (upper === 'WMATIC' || upper === 'MATIC') return 'POL';
					return upper;
				};

				const rawSymbols = [...supplies, ...borrows]
					.map((entry) => entry.currency?.symbol ?? '')
					.filter((symbol): symbol is string => Boolean(symbol));
				// Fetch prices using normalized symbols so bridge tokens get priced
				const normalizedSymbols = allowlistSymbols(rawSymbols.map(normalizePriceSymbol));
				let cachedPrices: Record<string, number> = {};
				if (normalizedSymbols.length) {
					try {
						const pricesRes = await fetch(
							`/api/market/coinpaprika-prices?symbols=${encodeURIComponent(normalizedSymbols.join(','))}`,
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
					Array<{
						symbol: string;
						amount: number | null;
						usdValue: number | null;
						priceUsd: number | null;
						purchasePriceUsd: number | null;
						purchaseAt: string | null;
					}>
				>((acc, entry) => {
					const symbol = entry.currency?.symbol?.toUpperCase();
					if (!symbol) return acc;
					const amount = Number(entry.balance?.amount?.value ?? 0);
					const normalizedAmount = Number.isFinite(amount) ? amount : 0;
					const usdFromAave = typeof entry.balanceUsd === 'number' ? entry.balanceUsd : null;
					const priceFromAave = typeof entry.priceUsd === 'number' ? entry.priceUsd : null;
					const priceKey = normalizePriceSymbol(symbol);
					const priceFromCached = typeof cachedPrices[priceKey] === 'number' ? cachedPrices[priceKey] : null;
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
					const debtPriceKey = symbol ? normalizePriceSymbol(symbol) : '';
					const priceFromCached = debtPriceKey && typeof cachedPrices[debtPriceKey] === 'number' ? cachedPrices[debtPriceKey] : null;
					const priceFromOracle = symbol && typeof oraclePrices[symbol] === 'number' ? oraclePrices[symbol] : null;
					const usdValue =
						usdFromAave ??
						(priceFromAave ? normalizedAmount * priceFromAave : null) ??
						(priceFromCached ? normalizedAmount * priceFromCached : null) ??
						(priceFromOracle ? normalizedAmount * priceFromOracle : null);
					return sum + (typeof usdValue === 'number' ? usdValue : 0);
				}, 0);

				const totalCollateralFromState = activeChainEntries.reduce(
					(sum, [, s]) => sum + Number(s.totalCollateralBase ?? 0), 0
				);
				const totalDebtFromState = activeChainEntries.reduce(
					(sum, [, s]) => sum + Number(s.totalDebtBase ?? 0), 0
				);
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
								// Try exact match first, then normalized (BTC.B→BTC, SAVAX→AVAX, etc.)
								const t = bySymbol.get(item.symbol.toUpperCase())
									?? bySymbol.get(normalizePriceSymbol(item.symbol));
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

	const healthRows = useMemo(() => {
		if (state.status !== 'ready') return [];
		return state.healthByChain
			.map((entry) => {
				const hf = entry.healthFactor != null ? Number(entry.healthFactor) : null;
				const color =
					hf === null || !Number.isFinite(hf)
						? undefined
						: hf < 1.5
						? 'var(--loss)'
						: hf < 2.0
						? 'var(--warning)'
						: 'var(--gain)';
				return {
					chain: entry.chain,
					value: formatHealthFactor(entry.healthFactor),
					color,
				};
			})
			.filter((entry) => entry.value !== '---');
	}, [state]);


	const totalCollateral = state.status === 'ready' ? state.totalCollateralBase : 0;
	const totalDebt = state.status === 'ready' ? state.totalDebtBase : 0;
	const net = totalCollateral - totalDebt;

	const collateralValue = formatUsd(totalCollateral);
	const debtValue = formatUsd(totalDebt);
	const netValue = formatUsd(net);
	// Filter out dust positions (less than $0.01 USD value) — these are rounding
	// remnants that Aave still reports as open supply positions.
	const breakdownItems = state.status === 'ready'
		? state.collateralBreakdown.filter((item) => (item.usdValue ?? 0) >= 0.01)
		: [];
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
			{healthRows.length ? (
				healthRows.map((entry, i) => (
					<div
						key={entry.chain}
						className="stat-row health"
						style={showHealthRow ? undefined : { display: 'none' }}
						data-health-color={entry.color ?? ''}
					>
						<span className="label">
							{t.chainHealthLabel(entry.chain.charAt(0).toUpperCase() + entry.chain.slice(1))}
						</span>
						<span className="value" style={entry.color ? { color: entry.color } : undefined}>
							{entry.value}
						</span>
					</div>
				))
			) : (
				<div className="stat-row health" style={showHealthRow ? undefined : { display: 'none' }} data-health-color="">
					<span className="label">{t.healthLabel}</span>
					<span className="value">---</span>
				</div>
			)}

			<div className="spacer spacer--lg" style={showHealthRow ? undefined : { display: 'none' }}></div>

			{showAlertPill && (
				<div className="stat-row health-alert-row">
					<span className="label">{t.healthAlertLabel}</span>
					<AlertPill walletId={walletId} />
				</div>
			)}

			{showAlertPill && <LiquidationAlertToggle />}

			<div className="stat-row">
				<span className="label">{t.collateralLabel}</span>
				<span className="value">{collateralValue}</span>
			</div>

			<div className="stat-row debt">
				<span className="label">{t.debtLabel}</span>
				<span className="value">{debtValue}</span>
			</div>

			<div className="stat-row net">
				<span className="label">{t.netLabel}</span>
				<span className="value">{netValue}</span>
			</div>

			<div className="spacer spacer--md"></div>

			<div className="divider"></div>

			<div className="spacer spacer--sm"></div>

			<div className="breakdown-title">{t.breakdownTitle}</div>

			<div className="breakdown" style={qtyWidthStyle}>
				<div className="breakdown-row breakdown-header" style={{ display: 'grid', gridTemplateColumns: '44px 2fr 2fr 2fr 2.5fr 1.5fr', columnGap: '0.5rem' }}>
					<span className="col-days">{t.colDays}</span>
					<span className="col-token">{t.colAsset}</span>
					<span className="col-qty">{t.colQty}</span>
					<span className="col-price">{t.colPrice}</span>
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
						const plColor = plPct === null ? undefined : plPct >= 0 ? 'var(--gain)' : 'var(--loss)';
						const plLabel = plPct !== null
							? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`
							: '—';

						return (
							<div className="breakdown-row" key={item.symbol} style={{ display: 'grid', gridTemplateColumns: '44px 2fr 2fr 2fr 2.5fr 1.5fr', columnGap: '0.5rem' }}>
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
					<div className="breakdown-empty">{t.breakdownEmpty}</div>
				)}
			</div>
			{state.status === 'ready' && state.unavailableMessage ? (
				<div className="defi-status defi-status--warning">{state.unavailableMessage}</div>
			) : null}
			{state.status === 'ready' && state.isStale ? (
				<div className="defi-status defi-status--refreshing">{t.refreshing}</div>
			) : null}
			{state.status === 'loading' ? (
				<div className="defi-status defi-status--loading">{t.loadingHealthFactor}</div>
			) : null}
			{state.status === 'error' ? (
				<div className="defi-status defi-status--error">{t.errorHealthFactor}</div>
			) : null}

			{liquidations.length > 0 && (
				<div className="aave-liquidations">
					{liquidations.map((liq) => (
						<LiquidationCallout key={`${liq.txHash}-${liq.chain}`} liq={liq} />
					))}
				</div>
			)}
		</div>
	);
}
