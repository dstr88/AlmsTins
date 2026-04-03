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
	imageUrl?: string | null;
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

type NftCollection = {
	key: string;
	contract: string;
	chainId: number;
	chain: string;
	collectionName: string;
	items: NftItem[];
};

const ITEMS_PER_PAGE = 5;

const STATUS_LABELS: Record<NftStatus, string> = {
	purchased: 'Purchased',
	whitelisted: '✓ Keep',
	blacklisted: 'Blocked',
	airdrop: 'Airdrop',
};

const getLabel = (item: NftItem) => {
	const raw = item.symbol?.trim() || item.name?.trim();
	return raw && raw.length ? raw : 'NFT';
};

// Strip trailing " #NNNN" from individual token names to get the collection name.
// Prefer symbol if it looks like a short ticker (≤ 8 chars).
const getCollectionName = (item: NftItem): string => {
	const sym = item.symbol?.trim() ?? '';
	if (sym && sym.length <= 8) return sym;
	const name = item.name?.trim() ?? '';
	return name.replace(/\s*#\d+$/, '').trim() || name || 'Unknown Collection';
};

// Stable hue from contract address so each collection has a unique color.
const contractHue = (contract: string): number => {
	const hex = (contract || '0').replace(/^0x/i, '').slice(0, 6).padEnd(6, '0');
	return parseInt(hex, 16) % 360;
};

function CollectionThumb({ item, size }: { item: NftItem; size: number }) {
	const [imgFailed, setImgFailed] = useState(false);
	const label = getLabel(item);
	const initials = label.slice(0, 2).toUpperCase();
	const hue = contractHue(item.contract ?? '');

	if (item.imageUrl && !imgFailed) {
		return (
			<img
				className="vault-nft__img"
				src={item.imageUrl}
				alt={label}
				width={size}
				height={size}
				onError={() => setImgFailed(true)}
			/>
		);
	}

	return (
		<div
			className="vault-nft__initials"
			style={{
				width: size,
				height: size,
				background: `linear-gradient(135deg, hsl(${hue},52%,32%), hsl(${(hue + 55) % 360},48%,22%))`,
			}}
		>
			{initials}
		</div>
	);
}

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			width="12" height="12" viewBox="0 0 12 12"
			fill="none" stroke="currentColor" strokeWidth="2"
			strokeLinecap="round" strokeLinejoin="round"
			style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
			aria-hidden="true"
		>
			<polyline points="2,4 6,8 10,4" />
		</svg>
	);
}

function groupItems(items: NftItem[]): NftCollection[] {
	const map = new Map<string, NftCollection>();
	for (const item of items) {
		const key = `${item.chainId ?? 0}:${item.contract ?? ''}`;
		if (!map.has(key)) {
			map.set(key, {
				key,
				contract: item.contract ?? '',
				chainId: item.chainId ?? 0,
				chain: item.chain ?? '',
				collectionName: getCollectionName(item),
				items: [],
			});
		}
		map.get(key)!.items.push(item);
	}
	return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
}

export default function VaultNftActivity({ walletId }: VaultNftActivityProps) {
	const [nftState, setNftState] = useState<FetchState<NftItem>>({ status: 'loading' });
	const [allNfts, setAllNfts] = useState<NftItem[]>([]);
	const [contractState, setContractState] = useState<FetchState<ContractItem>>({ status: 'loading' });
	const [nftMeta, setNftMeta] = useState<{ cached?: boolean; stale?: boolean; asOf?: string | null } | null>(null);
	const [manageOpen, setManageOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [resetting, setResetting] = useState(false);
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
	const [itemLimits, setItemLimits] = useState<Map<string, number>>(new Map());
	const [contractsOpen, setContractsOpen] = useState(false);
	const [nftsOpen, setNftsOpen] = useState(false);
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

	const toggleCollection = (key: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const showMore = (key: string, total: number) => {
		setItemLimits((prev) => {
			const next = new Map(prev);
			next.set(key, total);
			return next;
		});
	};

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

	const collections = nftState.status === 'ready' ? groupItems(nftState.items) : [];
	const contractCount = contractState.status === 'ready' ? contractState.items.length : 0;

	return (
		<div className="vault-activity" ref={rootRef}>

			{/* ── NFTs section ─────────────────────────────── */}
			<div className="vault-activity__section">
				<button
					type="button"
					className="vault-contracts__toggle"
					onClick={() => setNftsOpen((v) => !v)}
					aria-expanded={nftsOpen}
				>
					<span className="vault-contracts__title">
						NFTs
						{nftState.status === 'ready' && collections.length > 0 && (
							<span className="vault-collection__count">{collections.length}</span>
						)}
					</span>
					<ChevronIcon open={nftsOpen} />
				</button>

				{nftsOpen && (
				<>
				<div className="vault-activity__header" style={{ marginTop: '0.5rem' }}>
					<span />
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
							const tokenId = item.tokenId ? `#${item.tokenId}` : '';
							const status = item.status ?? 'airdrop';
							return (
								<div
									key={`manage:${item.contract ?? 'nft'}:${item.tokenId ?? '0'}`}
									className="vault-nft__compact-row"
								>
									<CollectionThumb item={item} size={32} />
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

				{/* Collection groups */}
				<div className="vault-activity__nfts">
					{nftState.status === 'loading' && <p className="vault-activity__empty">Loading NFTs…</p>}
					{nftState.status === 'error' && <p className="vault-activity__empty">{nftState.message}</p>}
					{nftState.status === 'ready' && collections.length === 0 && (
						<p className="vault-activity__empty">No valued NFTs detected. Use Manage to whitelist others.</p>
					)}
					{collections.map((col) => {
						const isExpanded = expandedKeys.has(col.key);
						const limit = itemLimits.get(col.key) ?? ITEMS_PER_PAGE;
						const visible = col.items.slice(0, limit);
						const remaining = col.items.length - visible.length;
						const firstItem = col.items[0];

						return (
							<div key={col.key} className="vault-collection">
								{/* Collection header row */}
								<button
									type="button"
									className="vault-collection__row"
									onClick={() => toggleCollection(col.key)}
									aria-expanded={isExpanded}
								>
									<CollectionThumb item={firstItem} size={40} />
									<span className="vault-collection__name">{col.collectionName}</span>
									{col.items.length > 1 && (
										<span className="vault-collection__count">{col.items.length}</span>
									)}
									<span className="vault-collection__chain">{col.chain}</span>
									<ChevronIcon open={isExpanded} />
								</button>

								{/* Expanded individual NFT rows */}
								{isExpanded && (
									<div className="vault-collection__items">
										{visible.map((item) => (
											<div
												key={`${item.contract ?? 'nft'}:${item.tokenId ?? '0'}`}
												className="vault-nft-row"
											>
												<a
													className="vault-nft-row__link"
													href={item.url ?? '#'}
													target="_blank"
													rel="noreferrer"
												>
													<CollectionThumb item={item} size={28} />
													<span className="vault-nft-row__id">
														{item.tokenId ? `#${item.tokenId}` : '—'}
													</span>
													{item.status && (
														<span className="vault-nft__badge" data-status={item.status}>
															{STATUS_LABELS[item.status]}
														</span>
													)}
												</a>
												<button
													type="button"
													className="vault-nft__action vault-nft__action--blacklist"
													onClick={(e) => { e.preventDefault(); void callNftEndpoint('blacklist', item); }}
												>
													Block
												</button>
											</div>
										))}
										{remaining > 0 && (
											<button
												type="button"
												className="vault-collection__show-more"
												onClick={() => showMore(col.key, col.items.length)}
											>
												Show {remaining} more
											</button>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
				</>
				)}
			</div>

			{/* ── Contracts section (collapsible) ───────── */}
			<div className="vault-activity__section">
				<button
					type="button"
					className="vault-contracts__toggle"
					onClick={() => setContractsOpen((v) => !v)}
					aria-expanded={contractsOpen}
				>
					<span className="vault-contracts__title">
						Contracts interacted with
						{contractCount > 0 && (
							<span className="vault-collection__count">{contractCount}</span>
						)}
					</span>
					<ChevronIcon open={contractsOpen} />
				</button>

				{contractsOpen && (
					<>
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
					</>
				)}
			</div>
		</div>
	);
}
