import React, { useEffect, useState } from 'react';

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
	const [rows, setRows] = useState<TransactionWithAnnotation[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [chainFilter, setChainFilter] = useState<'all' | 'ethereum' | 'polygon'>('all');
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
			setError('Failed to load transactions.');
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
		return <p>Loading transactions…</p>;
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
	   return <p className="text-sm text-gray-500">No transactions yet.</p>;
	}

	const formatDate = (iso: string) => new Date(iso).toLocaleString();

	const shorten = (addr: string | null) =>
		addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

	function renderFlags(tx: TransactionWithAnnotation) {
		const tags = tx.riskTags ?? [];
		if (!tags.length) return '—';
		return (
			<div className="flex flex-wrap gap-1">
				{tags.map((tag) => {
					const label =
						tag === 'newDeposit'
							? 'New'
							: tag === 'aaveMovement'
							? 'Aave'
							: tag === 'likelyLost'
							? 'Lost?'
							: tag === 'internalTransfer'
							? 'Internal'
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
				<h2 className="text-lg font-semibold">Transactions</h2>
				<div className="flex items-center gap-2">
					<select
						className="border rounded px-2 py-1 text-xs"
						value={chainFilter}
						onChange={(e) => setChainFilter(e.target.value as 'all' | 'ethereum' | 'polygon')}
					>
						<option value="all">All chains</option>
						<option value="ethereum">Ethereum</option>
						<option value="polygon">Polygon</option>
					</select>
					<select
						className="border rounded px-2 py-1 text-xs"
						value={dateFilter}
						onChange={(e) => setDateFilter(e.target.value as 'all' | '30d' | 'ytd')}
					>
						<option value="all">All time</option>
						<option value="30d">Last 30 days</option>
						<option value="ytd">This year</option>
					</select>
					<button
						className="border rounded px-3 py-1 text-sm"
						onClick={handleRefresh}
						disabled={refreshing}
					>
						{refreshing ? 'Refreshing…' : 'Refresh from chain'}
					</button>
				</div>
			</div>
			<table className="min-w-full text-sm">
				<thead>
					<tr className="text-left border-b">
						<th className="py-2 pr-4">Date</th>
						<th className="py-2 pr-4">Chain / Token</th>
						<th className="py-2 pr-4">From → To</th>
						<th className="py-2 pr-4">Value</th>
						<th className="py-2 pr-4">Flags</th>
						<th className="py-2 pr-4">Category</th>
						<th className="py-2 pr-4">Note</th>
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
									<option value="">–</option>
									<option value="deposit">Deposit</option>
									<option value="borrow">Borrow</option>
									<option value="repay">Repay</option>
									<option value="yield">Yield</option>
									<option value="fee">Fee</option>
									<option value="internal_transfer">Internal</option>
									<option value="lost">Lost</option>
									<option value="other">Other</option>
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
									placeholder="Purpose / notes…"
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
