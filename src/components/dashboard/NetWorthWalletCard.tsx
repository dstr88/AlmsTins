import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getNetWorthWalletCard } from '@/i18n/components/netWorthWalletCard';

type Token = {
	tokenSymbol: string;
	chain: string;
	amount: number;
	usdValue: number;
};

type TokensResponse = { ok: true; walletId: string; tokens: Token[] } | { ok: false; error: string; message?: string };

interface Props {
	walletId: string;
	walletLabel: string;
	walletAddress?: string;
}

export default function NetWorthWalletCard({ walletId, walletLabel, walletAddress }: Props) {
	const [tokens, setTokens] = useState<Token[] | null>(null);
	const [totalUsd, setTotalUsd] = useState<number>(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const t = getNetWorthWalletCard(getClientLang());

	useEffect(() => {
		let cancelled = false;

		async function load() {
			if (cancelled) return;
			setLoading(true);
			setError(null);
			setTokens(null);

			try {
				const res = await fetch(`/api/wallets/${walletId}/tokens`);

				if (res.status === 404) {
					console.warn('[NetWorthWalletCard] No tokens for wallet', walletId);
					if (!cancelled) {
						setTokens([]);
						setError(null);
						setLoading(false);
					}
					return;
				}

				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}

				const data = await res.json();
				console.log('[NetWorthWalletCard] tokens response', data);
				const list = Array.isArray(data.tokens) ? data.tokens : [];
				if (!cancelled) {
					setTokens(list);
					setError(null);
				}
			} catch (err: any) {
				if (cancelled) return;
				console.error('[NetWorthWalletCard] failed to load tokens', err);
				setError(err.message ?? 'Failed to load');
				setTokens([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	useEffect(() => {
		if (!tokens) return;
		const sum = tokens.reduce((acc, t) => acc + (typeof t.usdValue === 'number' ? t.usdValue : 0), 0);
		setTotalUsd(sum);
		console.log('[NetWorthWalletCard] computed totalUsd', sum);
	}, [tokens]);

	

	const shortAddr = walletAddress ? shortenAddress(walletAddress) : '';
	const displayLabel = walletLabel || (walletAddress ? walletAddress.slice(-5) : walletId);

	return (
		<div className="wallet-card" style={{ border: '1px solid var(--border-bright)', borderRadius: '12px', padding: '1rem' }}>
			<div className="wallet-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<h3 className="wallet-title" style={{ margin: 0 }}>
					{displayLabel}
					{shortAddr ? (
						<>
							{' · '}
							<span className="wallet-address" style={{ opacity: 0.8, fontSize: '0.9rem' }}>
								{shortAddr}
							</span>
						</>
					) : null}
				</h3>
			</div>

			{loading && <p style={{ margin: '0.5rem 0' }}>{t.loadingBalances}</p>}

			{error && (
				<p style={{ margin: '0.5rem 0', color: 'var(--loss)' }}>
					{t.errorPrefix}{error}
				</p>
			)}

			{!loading && !error && (
				<>
					<p className="wallet-card-total" style={{ fontWeight: 700, margin: '0.5rem 0' }}>
						{t.totalPrefix}{totalUsd.toFixed(2)}
					</p>

					<table className="wallet-card-table" style={{ width: '100%', fontSize: '0.9rem', borderSpacing: 0 }}>
						<thead>
							<tr>
								<th style={{ textAlign: 'left', padding: '4px 0' }}>{t.colToken}</th>
								<th style={{ textAlign: 'left', padding: '4px 0' }}>{t.colChain}</th>
								<th style={{ textAlign: 'right', padding: '4px 0' }}>{t.colAmount}</th>
								<th style={{ textAlign: 'right', padding: '4px 0' }}>{t.colUsd}</th>
							</tr>
						</thead>
						<tbody>
							{tokens && tokens.length > 0 ? (
								tokens.map((t, idx) => (
									<tr key={`${t.chain}-${t.tokenSymbol}-${idx}`}>
										<td style={{ padding: '4px 0' }}>{t.tokenSymbol}</td>
										<td style={{ padding: '4px 0' }}>{t.chain}</td>
										<td style={{ padding: '4px 0', textAlign: 'right' }}>{t.amount}</td>
										<td style={{ padding: '4px 0', textAlign: 'right' }}>${t.usdValue.toFixed(2)}</td>
									</tr>
								))
							) : (
								<tr>
									<td colSpan={4} style={{ padding: '6px 0', opacity: 0.75 }}>
										{t.noTokens}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}

function shortenAddress(address: string) {
	if (!address) return '';
	return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
