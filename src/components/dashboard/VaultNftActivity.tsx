import React, { useCallback, useEffect, useRef, useState } from 'react';
import './VaultNftActivity.css';

console.log('[island.mount]', 'VaultNftActivity');

type NftStatus = 'purchased' | 'whitelisted' | 'blacklisted' | 'airdrop';

type NftItem = {
	chainId?: number;
	chain?: string;
	contract?: string;
	tokenId?: string;
	name?: string | null;
	symbol?: string | null;
	url?: string | null;
	status?: NftStatus;
};

type ContractItem = {
	name?: string | null;
	address?: string | null;
	url?: string | null;
	chain?: string | null;
	txCount?: number;
	lastSeen?: string | null;
	totalValue?: number;
	isKnown?: boolean;
};

type FetchState<T> =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; items: T[] };

type ApiResponse<T> = { ok?: boolean; items?: T[]; allItems?: T[]; error?: string };

type VaultNftActivityProps = { walletId: string };

const getLabel = (item: NftItem) => {
	const raw = item.symbol?.trim() || item.name?.trim();
	return raw && raw.length ? raw : 'NFT';
};

const STATUS_LABELS: Record<NftStatus, string> = {
	purchased: 'Purchased',
	whitelisted: '✓ Whitelisted',
	blacklisted: 'Blocked',
	airdrop: 'Airdrop',
};

export default function VaultNftActivity({ walletId }: VaultNftActivityProps) {
	const [nftState, setNftState] = useState<FetchState<NftItem>>({ status: 'loading' });
	const [allNfts, setAllNfts] = useState<NftItem[]>([]);
	const [contractState, setContractState] = useState<FetchState<ContractItem>>({ status: 'loading' });
	const [nftMeta, setNftMeta] = useState<{ cached?: boolean; stale?: boolean; asOf?: string | null } | null>(null);
	const [manageOpen, setManageOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [resetting, setResetting] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const didRevealRef = useRef(false);

	const loadNfts = useCallback(async (signal?: AbortSignal) => {
		try {
			const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts`, { signal });
			const payload = (await response.json()) as ApiResponse<NftItem>;
			console.log('[VaultNftActivity] NFT payload', payload);
			if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Unable to load NFTs.');
			setNftState({ status: 'ready', items: payload.items ?? [] });
			setAllNfts(payload.allItems ?? payload.items ?? []);
			setNftMeta({
				cached: (payload as any).cached,
				stale: (payload as any).stale,
				asOf: (payload as any).asOf ?? null,
			});
		} catch (error) {
			if (signal?.aborted) return;
			setNftState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load NFTs.' });
			setNftMeta(null);
		}
	}, [walletId]);

	const callNftEndpoint = async (endpoint: string, item: NftItem) => {
		const chainId = item.chainId ?? 0;
		const contract = String(item.contract ?? '').trim();
		const tokenId = String(item.tokenId ?? '').trim();
		if (!chainId || !contract || !tokenId) return;
		try {
			const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts/${endpoint}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chainId, contract, tokenId }),
			});
			if (response.ok) await loadNfts();
		} catch {
			// Ignore action failures silently
		}
	};

	const resetAll = async () => {
		if (!window.confirm('Clear all whitelist and blacklist rules? NFT visibility will revert to purchase-based detection.')) return;
		setResetting(true);
		try {
			const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/nfts/unhide-all`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});
			if (response.ok) await loadNfts();
		} finally {
			setResetting(false);
		}
	};

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();

		const loadContracts = async () => {
			try {
				const response = await fetch(`/api/wallets/${encodeURIComponent(walletId)}/interactions`, { signal: controller.signal });
				const payload = (await response.json()) as ApiResponse<ContractItem>;
				console.log('[VaultNftActivity] Interactions payload', payload);
				if (!response.ok || payload.ok === false) throw new Error(payload.error || 'Unable to load contracts.');
				if (!cancelled) setContractState({ status: 'ready', items: payload.items ?? [] });
			} catch (error) {
				if (cancelled || controller.signal.aborted) return;
				setContractState({ status: 'error', message: error instanceof Error ? error.message : 'Unable to load contracts.' });
			}
		};

		setNftState({ status: 'loading' });
		setContractState({ status: 'loading' });
		void loadNfts(controller.signal);
		void loadContracts();

		return () => { cancelled = true; controller.abort(); };
	}, [walletId]);

	useEffect(() => {
		if (nftState.status !== 'ready' || nftState.items.length === 0 || didRevealRef.current) return;
		const root = rootRef.current;
		if (!root) return;
		const tin = root.closest('.salmon-tin');
		const label = tin?.querySelector('.salmon-tin__label');
		if (tin?.classList.contains('is-collapsed')) {
			tin.classList.remove('is-collapsed');
			if (label instanceof HTMLElement) label.setAttribute('aria-expanded', 'true');
		}
		didRevealRef.current = true;
	}, [nftState]);

	const filteredAllNfts = searchQuery.trim()
		? allNfts.filter((item) => {
			const q = searchQuery.toLowerCase();
			return (
				item.name?.toLowerCase().includes(q) ||
				item.symbol?.toLowerCase().includes(q) ||
				item.tokenId?.toLowerCase().includes(q) ||
				item.contract?.toLowerCase().includes(q)
			);
		})
		: allNfts;

	return (
		<div className="vault-activity" ref={rootRef}>
			<div className="vault-activity__section">
				<div className="vault-activity__header">
					<h4>NFTs</h4>
					<button className="vault-activity__action" type="button" onClick={() => setManageOpen((v) => !v)}>
						{manageOpen ? 'Close' : 'Manage'}
					</button>
				</div>

				{nftMeta?.stale ? <div className="vault-activity__note">Refreshing…</div> : null}

				{/* Manage / search panel */}
				{manageOpen && (
					<div className="vault-nft__manage-panel">
						<input
							className="vault-nft__search"
							type="search"
							placeholder="Search by name, symbol, token ID or contract…"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>

						{filteredAllNfts.length === 0 && (
							<p className="vault-activity__empty" style={{ padding: '0.5rem 0' }}>
								{searchQuery ? 'No NFTs match your search.' : 'No NFTs found for this wallet.'}
							</p>
						)}

						{filteredAllNfts.map((item) => {
							const label = getLabel(item);
							const thumb = label.slice(0, 2).toUpperCase();
							const tokenId = item.tokenId ? `#${item.tokenId}` : '';
							const status = item.status ?? 'airdrop';
							return (
								<div
									key={`manage:${item.contract ?? 'nft'}:${item.tokenId ?? '0'}`}
									className="vault-nft__compact-row"
								>
									<div className="vault-nft__compact-thumb">{thumb}</div>
									<div className="vault-nft__compact-meta">
										<span className="vault-nft__compact-name">{label}</span>
										<span className="vault-nft__compact-id">{tokenId}</span>
									</div>
									<span className="vault-nft__badge" data-status={status}>
										{STATUS_LABELS[status]}
									</span>
									{status !== 'whitelisted' && status !== 'purchased' && (
										<button
											type="button"
											className="vault-nft__action vault-nft__action--whitelist"
											onClick={() => void callNftEndpoint('whitelist', item)}
										>
											Keep
										</button>
									)}
									{status !== 'blacklisted' && (
										<button
											type="button"
											className="vault-nft__action vault-nft__action--blacklist"
											onClick={() => void callNftEndpoint('blacklist', item)}
										>
											Block
										</button>
									)}
								</div>
							);
						})}

						<div className="vault-nft__manage-footer">
							<button
								type="button"
								className="vault-activity__action"
								onClick={resetAll}
								disabled={resetting}
							>
								{resetting ? 'Resetting…' : 'Reset all rules'}
							</button>
							<span className="vault-nft__manage-hint">Clears all rules — visibility reverts to purchase detection.</span>
						</div>
					</div>
				)}

				<div className="vault-activity__nfts">
					{nftState.status === 'loading' && <p className="vault-activity__empty">Loading NFTs…</p>}
					{nftState.status === 'error' && <p className="vault-activity__empty">{nftState.message}</p>}
					{nftState.status === 'ready' && nftState.items.length === 0 && (
						<p className="vault-activity__empty">No valued NFTs detected. Use Manage to whitelist others.</p>
					)}
					{nftState.status === 'ready' &&
						nftState.items.map((item) => {
							const label = getLabel(item);
							const thumb = label.slice(0, 3).toUpperCase();
							const tokenId = item.tokenId ? `#${item.tokenId}` : '';
							return (
								<div key={`${item.contract ?? 'nft'}:${item.tokenId ?? '0'}`} className="vault-nft">
									<a className="vault-nft__link" href={item.url ?? '#'} target="_blank" rel="noreferrer">
										<div className="vault-nft__thumb">{thumb}</div>
										<div className="vault-nft__meta">
											<div className="vault-nft__title">{label}</div>
											<div className="vault-nft__token">{tokenId || '—'}</div>
											{item.status && (
												<span className="vault-nft__badge" data-status={item.status}>
													{STATUS_LABELS[item.status]}
												</span>
											)}
										</div>
									</a>
									<button
										type="button"
										className="vault-nft__action vault-nft__action--blacklist"
										onClick={(e) => { e.preventDefault(); e.stopPropagation(); void callNftEndpoint('blacklist', item); }}
									>
										Block
									</button>
								</div>
							);
						})}
				</div>
			</div>

			<div className="vault-activity__section">
				<h4>Contracts interacted with</h4>
				<p className="vault-activity__subhead">Smart contracts this wallet has sent transactions to — potential locked funds.</p>
				<div className="vault-activity__contracts">
					{contractState.status === 'loading' && <p className="vault-activity__empty">Loading contracts…</p>}
					{contractState.status === 'error' && <p className="vault-activity__empty">{contractState.message}</p>}
					{contractState.status === 'ready' && contractState.items.length === 0 && (
						<p className="vault-activity__empty">No contracts found. Sync this wallet to populate.</p>
					)}
					{contractState.status === 'ready' &&
						contractState.items.map((item) => {
							const label = item.name?.trim() || item.address || 'Contract';
							const shortAddr = item.address
								? `${item.address.slice(0, 6)}…${item.address.slice(-4)}`
								: null;
							const lastSeenDate = item.lastSeen
								? new Date(Number(item.lastSeen) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
								: null;
							return (
								<a
									key={`${item.chain ?? ''}:${item.address ?? label}`}
									className={`vault-contract-row${item.isKnown ? ' vault-contract-row--known' : ''}`}
									href={item.url ?? '#'}
									target="_blank"
									rel="noreferrer"
								>
									<div className="vault-contract-row__icon">
										{(label.slice(0, 2)).toUpperCase()}
									</div>
									<div className="vault-contract-row__body">
										<span className="vault-contract-row__name">{label}</span>
										<span className="vault-contract-row__meta">
											{shortAddr && !item.isKnown ? `${shortAddr} · ` : ''}
											{item.chain ? `${item.chain} · ` : ''}
											{item.txCount ? `${item.txCount} tx${(item.txCount ?? 0) > 1 ? 's' : ''}` : ''}
											{lastSeenDate ? ` · last ${lastSeenDate}` : ''}
										</span>
									</div>
									{item.isKnown && <span className="vault-contract-row__known-badge">Known</span>}
								</a>
							);
						})}
				</div>
			</div>
		</div>
	);
}
