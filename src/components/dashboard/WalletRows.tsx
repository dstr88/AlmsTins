import React, { useEffect, useState } from 'react';
import NetWorthWalletCard from './NetWorthWalletCard';
import AaveWalletCard from './AaveWalletCard';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getWalletRows } from '@/i18n/components/walletRows';

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
	const t = getWalletRows(getClientLang());
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

	if (loading) return <p>{t.loading}</p>;
	if (error) return <p>{t.errorPrefix} {error}</p>;
	if (wallets.length === 0) return <p>{t.noWallets}</p>;

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
