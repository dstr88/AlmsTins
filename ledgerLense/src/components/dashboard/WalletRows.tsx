import React, { useEffect, useState } from 'react';
import NetWorthWalletCard from './NetWorthWalletCard';
import AaveWalletCard from './AaveWalletCard';

type WalletSummary = {
	walletId: string;
	walletLabel: string;
	walletAddress: string;
	totalUsd: number;
};

type NetworthSummaryResponse =
	| {
			ok: true;
			summary: {
				byWallet: WalletSummary[];
			};
	  }
	| { ok: false; error: string; message?: string };

export default function WalletRows() {
	const [wallets, setWallets] = useState<WalletSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			setError(null);

			try {
				const res = await fetch('/api/networth/summary');
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}

				const data: NetworthSummaryResponse = await res.json();
				if (!('ok' in data) || !data.ok) {
					throw new Error((data as any).error || 'SUMMARY_ERROR');
				}

				const list = data.summary.byWallet ?? [];
				if (!cancelled) {
					setWallets(list);
				}
			} catch (err: any) {
				if (cancelled) return;
				console.error('[WalletRows] failed to load summary', err);
				setError(err.message ?? 'Failed to load wallets');
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	if (loading) return <p>Loading wallets…</p>;
	if (error) return <p>Error: {error}</p>;
	if (wallets.length === 0) return <p>No wallets found.</p>;

	return (
		<div className="wallet-rows">
			{wallets.map((w) => (
				<div key={w.walletId} className="wallet-stack">
					<div className="tin-panel">
						<NetWorthWalletCard walletId={w.walletId} walletLabel={w.walletLabel} walletAddress={w.walletAddress} />
					</div>
					<div className="tin-panel aave-panel">
						<AaveWalletCard walletId={w.walletId} walletLabel={w.walletLabel} walletAddress={w.walletAddress} />
					</div>
				</div>
			))}
		</div>
	);
}
