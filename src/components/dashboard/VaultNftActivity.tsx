import React, { useCallback, useEffect, useRef, useState } from 'react';
import './VaultNftActivity.css';

type NftItem = {
	chainId?: number;
	chain?: string;
	contract?: string;
	tokenId?: string;
	name?: string | null;
	symbol?: string | null;
	url?: string | null;
};

type ContractItem = {
	name?: string | null;
	address?: string | null;
	url?: string | null;
};

type FetchState<T> =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; items: T[] };

type ApiResponse<T> = { ok?: boolean; items?: T[]; error?: string };

type VaultNftActivityProps = {
	walletId: string;
};

const getLabel = (item: NftItem) => {
	const raw = item.symbol?.trim() || item.name?.trim();
	return raw && raw.length ? raw : 'NFT';
};

export default function VaultNftActivity({ walletId }: VaultNftActivityProps) {
	const [nftState, setNftState] = useState<FetchState<NftItem>>({ status: 'loading' });
	const [contractState, setContractState] = useState<FetchState<ContractItem>>({ status: 'loading' });
	const [nftMeta, setNftMeta] = useState<{ cached?: boolean; stale?: boolean; asOf?: string | null } | null>(
		null,
	);
	const [isUnhiding, setIsUnhiding] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const didRevealRef = useRef(false);

	const loadNfts = useCallback(
		async (signal?: AbortSignal) => {
			try {
				const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts`, {
					signal,
				});
				const payload = (await response.json()) as ApiResponse<NftItem>;
				// Trace NFT payloads to verify upstream API responses.
				console.log('[VaultNftActivity] NFT payload', payload);
				if (!response.ok || payload.ok === false) {
					throw new Error(payload.error || 'Unable to load NFTs.');
				}
				setNftState({ status: 'ready', items: payload.items ?? [] });
				setNftMeta({
					cached: (payload as any).cached,
					stale: (payload as any).stale,
					asOf: (payload as any).asOf ?? null,
				});
			} catch (error) {
				if (signal?.aborted) return;
				setNftState({
					status: 'error',
					message: error instanceof Error ? error.message : 'Unable to load NFTs.',
				});
				setNftMeta(null);
			}
		},
		[walletId],
	);

	const hideNft = async (item: NftItem) => {
		const chainId = item.chainId ?? 0;
		const contract = String(item.contract ?? '').trim();
		const tokenId = String(item.tokenId ?? '').trim();
		if (!chainId || !contract || !tokenId) return;
		try {
			const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts/hide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chainId, contract, tokenId }),
			});
			if (!response.ok) return;
			setNftState((prev) => {
				if (prev.status !== 'ready') return prev;
				return {
					status: 'ready',
					items: prev.items.filter(
						(existing) =>
							!(
								existing.chainId === chainId &&
								existing.contract?.toLowerCase() === contract.toLowerCase() &&
								existing.tokenId === tokenId
							),
					),
				};
			});
		} catch {
			// Ignore hide failures.
		}
	};

	const unhideAll = async () => {
		if (isUnhiding) return;
		setIsUnhiding(true);
		try {
			const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts/unhide-all`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});
			if (response.ok) {
				await loadNfts();
			}
		} finally {
			setIsUnhiding(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();

		const loadContracts = async () => {
			try {
				const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/interactions`, {
					signal: controller.signal,
				});
				const payload = (await response.json()) as ApiResponse<ContractItem>;
				// Trace interactions payloads to verify upstream API responses.
				console.log('[VaultNftActivity] Interactions payload', payload);
				if (!response.ok || payload.ok === false) {
					throw new Error(payload.error || 'Unable to load contracts.');
				}
				if (!cancelled) {
					setContractState({ status: 'ready', items: payload.items ?? [] });
				}
			} catch (error) {
				if (cancelled || controller.signal.aborted) return;
				setContractState({
					status: 'error',
					message: error instanceof Error ? error.message : 'Unable to load contracts.',
				});
			}
		};

		setNftState({ status: 'loading' });
		setContractState({ status: 'loading' });
		void loadNfts(controller.signal);
		void loadContracts();

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [walletId]);

	useEffect(() => {
		if (nftState.status !== 'ready' || nftState.items.length === 0 || didRevealRef.current) return;
		const root = rootRef.current;
		if (!root) return;
		const tin = root.closest('.salmon-tin');
		const label = tin?.querySelector('.salmon-tin__label');
		if (tin?.classList.contains('is-collapsed')) {
			tin.classList.remove('is-collapsed');
			if (label instanceof HTMLElement) {
				label.setAttribute('aria-expanded', 'true');
			}
		}
		didRevealRef.current = true;
	}, [nftState]);

	return (
		<div className="vault-activity" ref={rootRef}>
			<div className="vault-activity__section">
				<div className="vault-activity__header">
					<h4>NFTs</h4>
					<button className="vault-activity__action" type="button" onClick={unhideAll} disabled={isUnhiding}>
						{isUnhiding ? 'Unhiding…' : 'Unhide all'}
					</button>
				</div>
				{nftMeta?.stale ? <div className="vault-activity__note">Refreshing…</div> : null}
				<div className="vault-activity__nfts">
					{nftState.status === 'loading' && (
						<p className="vault-activity__empty">Loading NFTs…</p>
					)}
					{nftState.status === 'error' && (
						<p className="vault-activity__empty">{nftState.message}</p>
					)}
					{nftState.status === 'ready' && nftState.items.length === 0 && (
						<p className="vault-activity__empty">No NFTs detected yet.</p>
					)}
					{nftState.status === 'ready' &&
						nftState.items.map((item) => {
							const label = getLabel(item);
							const thumb = label.slice(0, 3).toUpperCase();
							const tokenId = item.tokenId ? `#${item.tokenId}` : '';
							const url = item.url ?? '#';
							return (
								<div key={`${item.contract ?? 'nft'}:${item.tokenId ?? '0'}`} className="vault-nft">
									<a className="vault-nft__link" href={url} target="_blank" rel="noreferrer">
										<div className="vault-nft__thumb">{thumb}</div>
										<div className="vault-nft__meta">
											<div className="vault-nft__title">{label}</div>
											<div className="vault-nft__token">{tokenId || '—'}</div>
										</div>
									</a>
									<button
										type="button"
										className="vault-nft__hide"
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											void hideNft(item);
										}}
									>
										Hide
									</button>
								</div>
							);
						})}
				</div>
			</div>

			<div className="vault-activity__section">
				<h4>Pages interacted with</h4>
				<div className="vault-activity__links">
					{contractState.status === 'loading' && (
						<p className="vault-activity__empty">Loading contract list…</p>
					)}
					{contractState.status === 'error' && (
						<p className="vault-activity__empty">{contractState.message}</p>
					)}
					{contractState.status === 'ready' && contractState.items.length === 0 && (
						<p className="vault-activity__empty">No contracts found.</p>
					)}
					{contractState.status === 'ready' &&
						contractState.items.map((item) => {
							const label = item.name?.trim() || item.address || 'Contract';
							const url = item.url ?? '#';
							return (
								<a key={`${item.address ?? label}`} className="vault-contract" href={url} target="_blank" rel="noreferrer">
									{label}
								</a>
							);
						})}
				</div>
			</div>
		</div>
	);
}
