import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getTransactionsTable } from '@/i18n/components/transactionsTable';

type TransactionWithAnnotation = {
	id: string;
	walletId: string;
	hash: string;
	chain: string;
	blockNumber: number | null;
	timestamp: string;
	fromAddress: string | null;
	toAddress: string | null;
	value: string;
	tokenSymbol: string | null;
	tokenDecimals: number | null;
	txType: string | null;
	status: string | null;
	feePaid: string | null;
	metadata: any;
	annotationId?: string | null;
	category: string | null;
	note: string | null;
	internalTransfer: boolean;
	likelyLost: boolean;
	aaveMovement: boolean;
	newDeposit: boolean;
	riskTags: string[];
};

type Props = {
	walletId: string;
};

function formatTokenAmount(value: string, tokenDecimals: number | null | undefined) {
	if (!value) return '0';
	const decimals = tokenDecimals ?? 18;
	const padded = value.padStart(decimals + 1, '0');
	const whole = padded.slice(0, -decimals) || '0';
	const frac = padded.slice(-decimals).replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : whole;
}

export default function TransactionsTable({ walletId }: Props) {
	const lang = getClientLang();
	const t = getTransactionsTable(lang);
	const [rows, setRows] = useState<TransactionWithAnnotation[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [chainFilter, setChainFilter] = useState<'all' | 'ethereum' | 'polygon' | 'avalanche' | 'bitcoin'>('all');
	const [dateFilter, setDateFilter] = useState<'all' | '30d' | 'ytd'>('all');

	const loadTransactions = async (signal?: AbortSignal) => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(
				`/api/transactions?walletId=${encodeURIComponent(walletId)}&limit=50`,
				{ signal },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			if (signal?.aborted) return;
			setRows(data.transactions ?? []);
		} catch (err) {
			if ((err as any).name === 'AbortError') return;
			console.error(err);
			setError(t.errorFailed);
		} finally {
			if (!signal?.aborted) {
				setLoading(false);
			}
		}
	};

	useEffect(() => {
		const controller = new AbortController();
		loadTransactions(controller.signal);
		return () => controller.abort();
	}, [walletId]);

	const handleRefresh = async () => {
		setRefreshing(true);
		try {
			await fetch('/api/wallets/sync-all', { method: 'POST' });
			await loadTransactions();
		} catch (err) {
			console.error('Refresh failed', err);
		} finally {
			setRefreshing(false);
		}
	};

	const updateRowField = (txId: string, field: 'category' | 'note', value: string) => {
		setRows((prev) =>
			prev.map((row) => (row.id === txId ? { ...row, [field]: value } : row)),
		);
	};

	const saveAnnotation = async (txId: string, category: string | null, note: string | null) => {
		try {
			await fetch('/api/transactions/annotate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ transactionId: txId, category, note }),
			});
		} catch (err) {
			console.error('Failed to save annotation', err);
		}
	};

	if (loading && !rows.length) {
		return <p>{t.loading}</p>;
	}

	if (error) {
		return <p className="text-red-600 text-sm">{error}</p>;
	}

	const chainFiltered =
		chainFilter === 'all' ? rows : rows.filter((tx) => tx.chain === chainFilter);
	const visibleRows = chainFiltered.filter((tx) => {
		if (dateFilter === 'all') return true;
		const txDate = new Date(tx.timestamp);
		if (dateFilter === '30d') {
			const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
			return txDate.getTime() >= cutoff;
		}
		if (dateFilter === 'ytd') {
			return txDate.getFullYear() === new Date().getFullYear();
		}
		return true;
	});

	if (!visibleRows.length) {
	   return <p className="text-sm text-gray-500">{t.empty}</p>;
	}

	const dateLocale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
	const formatDate = (iso: string) => new Date(iso).toLocaleString(dateLocale);

	const shorten = (addr: string | null) =>
		addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

	function renderFlags(tx: TransactionWithAnnotation) {
		const tags = tx.riskTags ?? [];
		if (!tags.length) return t.flagsNone;
		return (
			<div className="flex flex-wrap gap-1">
				{tags.map((tag) => {
					const label =
						tag === 'newDeposit'
							? t.tagNew
							: tag === 'aaveMovement'
							? 'Aave'
							: tag === 'likelyLost'
							? t.tagLost
							: tag === 'internalTransfer'
							? t.tagInternal
							: tag;
					return (
						<span
							key={tag}
							className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide"
						>
							{label}
						</span>
					);
				})}
			</div>
		);
	}

	return (
		<div className="overflow-x-auto border rounded-lg p-4 mt-4">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-lg font-semibold">{t.heading}</h2>
				<div className="flex items-center gap-2">
					<select
						className="border rounded px-2 py-1 text-xs"
						value={chainFilter}
						onChange={(e) => setChainFilter(e.target.value as 'all' | 'ethereum' | 'polygon' | 'avalanche' | 'bitcoin')}
					>
						<option value="all">{t.filterAllChains}</option>
						<option value="bitcoin">Bitcoin</option>
						<option value="ethereum">Ethereum</option>
						<option value="polygon">Polygon</option>
						<option value="avalanche">Avalanche</option>
					</select>
					<select
						className="border rounded px-2 py-1 text-xs"
						value={dateFilter}
						onChange={(e) => setDateFilter(e.target.value as 'all' | '30d' | 'ytd')}
					>
						<option value="all">{t.filterAllTime}</option>
						<option value="30d">{t.filterLast30}</option>
						<option value="ytd">{t.filterThisYear}</option>
					</select>
					<button
						className="border rounded px-3 py-1 text-sm"
						onClick={handleRefresh}
						disabled={refreshing}
					>
						{refreshing ? t.refreshing : t.refreshBtn}
					</button>
				</div>
			</div>
			<table className="min-w-full text-sm">
				<thead>
					<tr className="text-left border-b">
						<th className="py-2 pr-4">{t.colDate}</th>
						<th className="py-2 pr-4">{t.colChainToken}</th>
						<th className="py-2 pr-4">{t.colFromTo}</th>
						<th className="py-2 pr-4">{t.colValue}</th>
						<th className="py-2 pr-4">{t.colFlags}</th>
						<th className="py-2 pr-4">{t.colCategory}</th>
						<th className="py-2 pr-4">{t.colNote}</th>
					</tr>
				</thead>
				<tbody>
					{visibleRows.map((tx) => (
						<tr key={tx.id} className="border-b align-top">
							<td className="py-1 pr-4 whitespace-nowrap">{formatDate(tx.timestamp)}</td>
							<td className="py-1 pr-4 whitespace-nowrap">
								{tx.chain}
								{tx.tokenSymbol && (
									<span className="text-gray-500"> · {tx.tokenSymbol}</span>
								)}
							</td>
							<td className="py-1 pr-4">
								<div>{shorten(tx.fromAddress)}</div>
								<div className="text-xs text-gray-500">↓</div>
								<div>{shorten(tx.toAddress)}</div>
							</td>
							<td className="px-3 py-2 text-right font-mono text-sm whitespace-nowrap">
								{formatTokenAmount(tx.value, tx.tokenDecimals)} {tx.tokenSymbol ?? ''}
							</td>
							<td className="px-3 py-2 align-top">{renderFlags(tx)}</td>
							<td className="py-1 pr-4">
								<select
									className="border rounded px-2 py-1 text-xs"
									value={tx.category ?? ''}
									onChange={(e) => updateRowField(tx.id, 'category', e.target.value)}
									onBlur={(e) =>
										saveAnnotation(tx.id, e.target.value || null, tx.note ?? null)
									}
								>
									<option value="">{t.catEmpty}</option>
									<option value="deposit">{t.catDeposit}</option>
									<option value="borrow">{t.catBorrow}</option>
									<option value="repay">{t.catRepay}</option>
									<option value="yield">{t.catYield}</option>
									<option value="fee">{t.catFee}</option>
									<option value="internal_transfer">{t.catInternalTransfer}</option>
									<option value="lost">{t.catLost}</option>
									<option value="other">{t.catOther}</option>
								</select>
							</td>
							<td className="py-1 pr-4">
								<input
									className="border rounded px-2 py-1 text-xs w-full"
									value={tx.note ?? ''}
									onChange={(e) => updateRowField(tx.id, 'note', e.target.value)}
									onBlur={(e) =>
										saveAnnotation(tx.id, tx.category ?? null, e.target.value || null)
									}
									placeholder={t.notePlaceholder}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
