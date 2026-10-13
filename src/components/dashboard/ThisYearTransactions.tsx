import React, { useEffect, useMemo, useState } from 'react';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getThisYearTransactions } from '@/i18n/components/thisYearTransactions';

type WalletResponse = {
	id: string;
	address: string;
};

type TransactionRow = {
	id: string;
	chain: string;
	timestamp: string;
	from_address?: string | null;
	to_address?: string | null;
	fee_paid?: string | null;
};

type TransactionsResponse = {
	ok?: boolean;
	transactions?: TransactionRow[];
	error?: string;
};

type PricesResponse = {
	prices?: Record<string, number>;
};

type FetchState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| {
			status: 'ready';
			transactions: TransactionRow[];
			walletAddress: string;
			priceMap: Record<string, number>;
	  };

function formatDateLabel(value: string, lang: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	const locale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
	return date.toLocaleString(locale);
}

function quarterLabel(date: Date) {
	const q = Math.floor(date.getMonth() / 3) + 1;
	const year = date.getFullYear().toString().slice(-2);
	return `Q${q} \u2019${year}`;
}

function truncateWords(text: string, maxWords = 20) {
	const words = text.trim().split(/\s+/);
	if (words.length <= maxWords) return text;
	return `${words.slice(0, maxWords).join(' ')}…`;
}

function chainToSymbol(chain: string) {
	const lower = chain.toLowerCase();
	if (lower.includes('polygon')) return 'POL';
	if (lower.includes('avax') || lower.includes('avalanche')) return 'AVAX';
	return 'ETH';
}

export default function ThisYearTransactions({ walletId }: { walletId: string }) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });
	const t = getThisYearTransactions(getClientLang());

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
				const walletAddress = wallet.address?.toLowerCase() ?? '';

				const now = new Date();
				const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
				const from = yearStart.toISOString();
				const to = now.toISOString();
				const txRes = await fetch(
					`/api/transactions?walletId=${encodeURIComponent(walletId)}&from=${encodeURIComponent(
						from,
					)}&to=${encodeURIComponent(to)}&limit=5000`,
				);
				if (!txRes.ok) {
					throw new Error(`Transactions HTTP ${txRes.status}`);
				}
				const txData = (await txRes.json()) as TransactionsResponse;
				const transactions = Array.isArray(txData.transactions) ? txData.transactions : [];

				if (!cancelled) {
					setState({ status: 'ready', transactions, walletAddress, priceMap: {} });
				}

				const fetchPrices = async () => {
					try {
						const symbols = allowlistSymbols(['ETH', 'POL', 'AVAX']);
						if (!symbols.length) return;
						const pricesRes = await fetch(
							`/api/market/coingecko-prices?symbols=${encodeURIComponent(symbols.join(','))}`,
						);
						const pricesData = pricesRes.ok ? ((await pricesRes.json()) as PricesResponse) : { prices: {} };
						const priceMap = pricesData.prices ?? {};
						if (!cancelled) {
							setState((prev) =>
								prev.status === 'ready'
									? { ...prev, priceMap }
									: { status: 'ready', transactions, walletAddress, priceMap },
							);
						}
					} catch {
						// best-effort pricing only
					}
				};

				if (typeof requestIdleCallback === 'function') {
					requestIdleCallback(() => void fetchPrices(), { timeout: 1500 });
				} else {
					setTimeout(() => void fetchPrices(), 0);
				}
			} catch (err: any) {
				if (!cancelled) {
					setState({ status: 'error', message: err?.message ?? 'Failed to load transactions' });
				}
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	const summary = useMemo(() => {
		if (state.status !== 'ready') return null;
		const { transactions, walletAddress, priceMap } = state;
		const txCount = transactions.length;

		const uniqueContracts = new Set<string>();
		let latestTimestamp = '';
		let gasUsdTotal = 0;

		for (const tx of transactions) {
			const from = tx.from_address?.toLowerCase();
			const to = tx.to_address?.toLowerCase();
			if (from && from !== walletAddress) uniqueContracts.add(from);
			if (to && to !== walletAddress) uniqueContracts.add(to);

			if (!latestTimestamp || new Date(tx.timestamp) > new Date(latestTimestamp)) {
				latestTimestamp = tx.timestamp;
			}

			if (tx.fee_paid) {
				try {
					const feeWei = BigInt(tx.fee_paid);
					const feeNative = Number(feeWei) / 1e18;
					const symbol = chainToSymbol(tx.chain);
					const price = priceMap[symbol] ?? 0;
					gasUsdTotal += feeNative * price;
				} catch {
					// ignore parsing errors
				}
			}
		}

		const summaryText = truncateWords(
			t.summaryText(txCount, uniqueContracts.size, gasUsdTotal.toFixed(2)),
			20,
		);

		return {
			txCount,
			uniqueContracts: uniqueContracts.size,
			gasUsdTotal,
			latestTimestamp,
			summaryText,
		};
	}, [state]);

	const quarters = useMemo(() => {
		if (state.status !== 'ready') return [];
		const groups = new Map<string, TransactionRow[]>();
		for (const tx of state.transactions) {
			const date = new Date(tx.timestamp);
			if (Number.isNaN(date.getTime())) continue;
			const label = quarterLabel(date);
			const existing = groups.get(label) ?? [];
			existing.push(tx);
			groups.set(label, existing);
		}
		return Array.from(groups.entries()).map(([label, txs]) => ({
			label,
			count: txs.length,
			latest: txs
				.map((tx) => tx.timestamp)
				.sort()
				.reverse()[0],
		}));
	}, [state]);

	if (state.status === 'loading') {
		return <div className="this-year-status">{t.loading}</div>;
	}

	if (state.status === 'error') {
		return <div className="this-year-status this-year-status--error">{t.errorMessage}</div>;
	}

	if (!summary) {
		return <div className="this-year-status">{t.emptyMessage}</div>;
	}

	return (
		<div className="this-year">
			<div className="this-year__summary">
				<div className="summary-row">
					<span className="label">{t.labelTransactions}</span>
					<span className="value">{summary.txCount}</span>
				</div>
				<div className="summary-row">
					<span className="label">{t.labelContracts}</span>
					<span className="value">{summary.uniqueContracts}</span>
				</div>
				<div className="summary-row">
					<span className="label">{t.labelGasSpent}</span>
					<span className="value">${summary.gasUsdTotal.toFixed(2)}</span>
				</div>
				<div className="summary-row">
					<span className="label">{t.labelMostRecent}</span>
					<span className="value">{summary.latestTimestamp ? formatDateLabel(summary.latestTimestamp, t.lang) : '—'}</span>
				</div>
			</div>

			<p className="summary-text">{summary.summaryText}</p>

			<div className="quarter-list">
				{quarters.map((quarter) => (
					<div key={quarter.label} className="quarter">
						<div className="quarter-divider"></div>
						<div className="quarter-label">{quarter.label}</div>
						<div className="quarter-meta">
							<span>{t.quarterTransactions(quarter.count)}</span>
							<span>{quarter.latest ? formatDateLabel(quarter.latest, t.lang) : '—'}</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
