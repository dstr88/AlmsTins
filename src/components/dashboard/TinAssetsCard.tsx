import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getTinAssetsCard } from '@/i18n/components/tinAssetsCard';

export type TinAssetsCardProps = {
	walletId: string;
	label: string | null;
};

type WalletTokenRow = {
	tokenSymbol: string;
	chain: string;
	amount: number;
	usdValue: number;
};

type TokensResponse = {
	ok?: boolean;
	tokens?: WalletTokenRow[];
	walletId?: string;
};

type FetchState =
	| { status: 'loading' }
	| { status: 'error' }
	| { status: 'ready'; tokens: WalletTokenRow[] };

const formatAmount = (value: number) =>
	Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function getDisplayLabel(wallet: { walletLabel?: string | null; walletAddress?: string | null; walletId: string }) {
	const baseLabel =
		wallet.walletLabel && wallet.walletLabel.trim().length > 0
			? wallet.walletLabel.trim()
			: wallet.walletAddress
			? wallet.walletAddress.slice(-5)
			: wallet.walletId;

	const shortAddr = wallet.walletAddress
		? wallet.walletAddress.slice(0, 6) + '...' + wallet.walletAddress.slice(-4)
		: null;

	return shortAddr ? `${baseLabel} (${shortAddr})` : baseLabel;
}

export function TinAssetsCard({ walletId, label }: TinAssetsCardProps) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });
	const [showAll, setShowAll] = useState(false);
	const t = getTinAssetsCard(getClientLang());

	const displayLabel = getDisplayLabel({ walletLabel: label, walletAddress: null, walletId });

	useEffect(() => {
		console.log('[WalletTin] props.wallet', { walletId, label });
	}, [walletId, label]);

	useEffect(() => {
		let cancelled = false;

		async function loadTokens() {
			try {
				setState({ status: 'loading' });
				const res = await fetch(`/api/wallets/${walletId}/tokens`);
				if (!res.ok) {
					throw new Error('Request failed');
				}
				const data = (await res.json()) as TokensResponse;
				const tokens = Array.isArray(data.tokens) ? data.tokens : [];
				if (!cancelled) {
					setState({ status: 'ready', tokens });
				}
			} catch (err) {
				if (!cancelled) {
					setState({ status: 'error' });
				}
			}
		}

		loadTokens();
		return () => {
			cancelled = true;
		};
	}, [walletId]);

	useEffect(() => {
		if (state.status === 'ready') {
			console.log('[WalletTin] tokens/fetchedBalances', {
				walletId,
				tokens: state.tokens,
			});
		}
	}, [walletId, state]);

	const title = displayLabel ? `${displayLabel}${t.assetsSuffix}` : t.assetsTitle;

	return (
		<div
			style={{
				backgroundColor: 'var(--surface-card-2)',
				borderRadius: '12px',
				padding: '1rem 1.1rem',
				color: 'var(--text-primary)',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.6rem',
				minHeight: '160px',
				position: 'relative',
				overflow: 'visible',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
				<h3
					style={{
						margin: 0,
						fontSize: '1rem',
						fontWeight: 600,
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
					}}
				>
					{title}
				</h3>
			</div>

			{state.status === 'loading' ? (
				<p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.8 }}>{t.loadingTokens}</p>
			) : null}

			{state.status === 'error' ? (
				<p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--loss)' }}>{t.errorTokens}</p>
			) : null}

			{state.status === 'ready' ? (
				state.tokens.length === 0 ? (
					(() => {
						console.warn('[WalletTin] No tokens for wallet', {
							walletId,
							label,
						});
						return <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.75 }}>{t.noTokens}</p>;
					})()
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
						{state.tokens.slice(0, 4).map((token) => (
							<div
								key={`${token.chain}-${token.tokenSymbol}`}
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									fontSize: '0.9rem',
									padding: '0.2rem 0',
								}}
							>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
									<span style={{ fontWeight: 600 }}>{token.tokenSymbol.toUpperCase()}</span>
									<span style={{ fontSize: '0.8rem', opacity: 0.75 }}>{token.chain}</span>
								</div>
								<div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
									<span style={{ fontWeight: 500 }}>{formatAmount(token.amount)}</span>
									<span style={{ fontSize: '0.85rem', opacity: 0.8 }}>${formatAmount(token.usdValue)}</span>
								</div>
							</div>
						))}
						{state.tokens.length > 4 ? (
							<button
								type="button"
								onClick={() => setShowAll((prev) => !prev)}
								style={{
									alignSelf: 'flex-start',
									marginTop: '0.15rem',
									padding: '0.25rem 0.55rem',
									borderRadius: '8px',
									border: '1px solid var(--text-muted)',
									background: 'var(--border-bright)',
									color: 'var(--text-primary)',
									fontSize: '0.85rem',
									cursor: 'pointer',
								}}
							>
								{showAll ? t.hideFullList : t.viewAllTokens(state.tokens.length)}
							</button>
						) : null}

						{showAll ? (
							<div
								style={{
									position: 'absolute',
									top: '100%',
									right: 0,
									marginTop: '0.35rem',
									zIndex: 10,
									maxHeight: '220px',
									overflowY: 'auto',
									background: 'var(--surface-card-2)',
									border: '1px solid var(--text-secondary)',
									borderRadius: '10px',
									boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
									padding: '0.6rem 0.75rem',
									minWidth: '240px',
								}}
							>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
									{state.tokens.map((token) => (
										<div
											key={`all-${token.chain}-${token.tokenSymbol}`}
											style={{
												display: 'flex',
												justifyContent: 'space-between',
												alignItems: 'center',
												fontSize: '0.9rem',
											}}
										>
											<div style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem' }}>
												<span style={{ fontWeight: 600 }}>{token.tokenSymbol.toUpperCase()}</span>
												<span style={{ fontSize: '0.8rem', opacity: 0.75 }}>{token.chain}</span>
											</div>
											<div
												style={{
													textAlign: 'right',
													display: 'flex',
													flexDirection: 'column',
													gap: '0.05rem',
												}}
											>
												<span style={{ fontWeight: 500 }}>{formatAmount(token.amount)}</span>
												<span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
													${formatAmount(token.usdValue)}
												</span>
											</div>
										</div>
									))}
								</div>
							</div>
						) : null}
					</div>
				)
			) : null}
		</div>
	);
}

export default TinAssetsCard;
