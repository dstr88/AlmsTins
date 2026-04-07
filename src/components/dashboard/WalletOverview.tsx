import React, { useState } from 'react';

export type WalletOverviewWallet = {
	id: string;
	address: string;
	label: string | null;
};

type Props = {
	wallets: WalletOverviewWallet[];
};

type WalletState = WalletOverviewWallet[];

// ── Chain detection ────────────────────────────────────────────────────────────
const SYMBOL_CHAINS: Record<string, string[]> = {
	LTC:  ['litecoin'],
	BTC:  ['bitcoin'],
	ETH:  ['ethereum', 'polygon', 'avalanche'],
	SOL:  ['solana'],
	SUI:  ['sui'],
	AVAX: ['avalanche'],
	MATIC:['polygon'],
};

function symbolToChains(symbol: string, address: string): string[] {
	const s = symbol.trim().toUpperCase();
	if (SYMBOL_CHAINS[s]) return SYMBOL_CHAINS[s];
	if (!s) {
		const l = address.toLowerCase();
		if (l.startsWith('ltc1'))                           return ['litecoin'];
		if (l.startsWith('bc1') || /^[13]/.test(address))  return ['bitcoin'];
		if (/^0x[a-f0-9]{64}$/.test(l))                    return ['sui'];
	}
	return s ? [s.toLowerCase()] : ['ethereum', 'polygon', 'avalanche'];
}

function detectChainLabel(address: string): { label: string; icon: string } {
	const a = address.toLowerCase();
	if (a.startsWith('ltc1'))                              return { label: 'Litecoin', icon: 'Ł' };
	if (a.startsWith('bc1') || /^[13][a-z0-9]/i.test(a)) return { label: 'Bitcoin',  icon: '₿' };
	if (/^0x[a-f0-9]{64}$/.test(a))                       return { label: 'Sui',      icon: '✦' };
	if (/^0x[a-f0-9]{40}$/.test(a))                       return { label: 'EVM',      icon: 'Ξ' };
	if (/^[1-9a-hj-np-za-km-z]{32,44}$/.test(address))   return { label: 'Solana',   icon: '◎' };
	return { label: 'Wallet', icon: '◈' };
}

function truncateAddress(addr: string): string {
	if (addr.length <= 20) return addr;
	return `${addr.slice(0, 10)}…${addr.slice(-8)}`;
}

// ── Vibrant card accent palette ────────────────────────────────────────────────
const PALETTE = [
	{ accent: '#ff6b6b', glow: 'rgba(255,107,107,0.15)', soft: 'rgba(255,107,107,0.08)' }, // coral salmon
	{ accent: '#00e5a0', glow: 'rgba(0,229,160,0.15)',   soft: 'rgba(0,229,160,0.08)'   }, // vibrant green
	{ accent: '#ff8c00', glow: 'rgba(255,140,0,0.15)',   soft: 'rgba(255,140,0,0.08)'   }, // fluorescent orange
	{ accent: '#a78bfa', glow: 'rgba(167,139,250,0.15)', soft: 'rgba(167,139,250,0.08)' }, // violet
	{ accent: '#22d3ee', glow: 'rgba(34,211,238,0.15)',  soft: 'rgba(34,211,238,0.08)'  }, // cyan
	{ accent: '#fb923c', glow: 'rgba(251,146,60,0.15)',  soft: 'rgba(251,146,60,0.08)'  }, // warm orange
];

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
	flex: 1,
	minWidth: '200px',
	padding: '0.45rem 0.75rem',
	borderRadius: '8px',
	border: '1px solid rgba(255,255,255,0.12)',
	background: 'rgba(255,255,255,0.05)',
	color: 'rgba(255,255,255,0.9)',
	fontSize: '0.875rem',
	outline: 'none',
	transition: 'border-color 0.15s',
	boxSizing: 'border-box' as const,
};

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(text).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
			title="Copy address"
			style={{
				background: 'none',
				border: 'none',
				cursor: 'pointer',
				padding: '0 0.2rem',
				color: copied ? '#4ade80' : 'rgba(255,255,255,0.3)',
				fontSize: '0.8rem',
				lineHeight: 1,
				transition: 'color 0.15s',
				flexShrink: 0,
			}}
		>
			{copied ? '✓' : '⧉'}
		</button>
	);
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WalletOverview({ wallets: initialWallets }: Props) {
	const [wallets, setWallets]     = useState<WalletState>(initialWallets);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftLabel, setDraftLabel] = useState('');
	const [status, setStatus]       = useState<string | null>(null);

	const [addAddress, setAddAddress] = useState('');
	const [addLabel,   setAddLabel]   = useState('');
	const [addSymbol,  setAddSymbol]  = useState('');
	const [addStatus,  setAddStatus]  = useState<string | null>(null);
	const [adding,     setAdding]     = useState(false);

	React.useEffect(() => {
		console.log('[WalletOverview] hydrated with', initialWallets.length, 'wallet(s)');
	}, [initialWallets.length]);

	function handleEditClick(wallet: WalletOverviewWallet) {
		setEditingId(wallet.id);
		setDraftLabel(wallet.label ?? '');
		setStatus(null);
	}

	function handleCancel() {
		setEditingId(null);
		setDraftLabel('');
		setStatus(null);
	}

	async function handleDelete(wallet: WalletOverviewWallet) {
		const confirmed = window.confirm(
			`Delete wallet "${wallet.label || wallet.address}"?\n\nThis will permanently delete the wallet and ALL of its transaction history. This cannot be undone.`,
		);
		if (!confirmed) return;
		try {
			setStatus('Deleting…');
			const res = await fetch(`/api/wallets/${wallet.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) throw new Error('Failed to delete wallet');
			setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
			setEditingId(null);
			setStatus('Wallet deleted.');
		} catch {
			setStatus('Unable to delete right now.');
		}
	}

	async function handleSave(wallet: WalletOverviewWallet) {
		const trimmed = draftLabel.trim();
		if (!trimmed) { setStatus('Label is required'); return; }
		try {
			setStatus('Saving…');
			const res = await fetch(`/api/wallets/${wallet.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: trimmed }),
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || 'Failed to update wallet');
			}
			setWallets((prev) => prev.map((w) => (w.id === wallet.id ? { ...w, label: trimmed } : w)));
			setEditingId(null);
			setDraftLabel('');
			setStatus('Saved.');
		} catch {
			setStatus('Unable to save right now.');
		}
	}

	async function handleAdd() {
		const address = addAddress.replace(/\s+/g, '');
		const label   = addLabel.trim();
		if (!address) { setAddStatus('Address is required'); return; }
		if (!label)   { setAddStatus('Label is required');   return; }
		const chains = symbolToChains(addSymbol, address);
		setAdding(true);
		setAddStatus('Saving…');
		try {
			const res  = await fetch('/api/wallets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address, label, chains }),
			});
			const data = await res.json();
			if (!res.ok) { setAddStatus(data.message ?? 'Failed to save'); setAdding(false); return; }
			setWallets(prev => [...prev, { id: data.id, address: data.address, label: data.label }]);
			setAddAddress('');
			setAddLabel('');
			setAddSymbol('');
			setAddStatus('✓ Wallet added.');
		} catch (e: unknown) {
			setAddStatus('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
		}
		setAdding(false);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

			{/* ── Header ──────────────────────────────────────────────────── */}
			<header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
				<div>
					<p style={{ margin: '0 0 0.15rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45 }}>
						Vault
					</p>
					<h1 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
						My Wallets
					</h1>
					<p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', opacity: 0.4, lineHeight: 1.5 }}>
						Wallets added here are synced to the Vault and tracked as yours.
					</p>
				</div>
				{status && (
					<span style={{
						fontSize: '0.82rem',
						padding: '0.3rem 0.75rem',
						borderRadius: '999px',
						background: status.includes('deleted') || status.includes('Saved') ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.05)',
						color: status.includes('deleted') || status.includes('Saved') ? '#4ade80' : 'rgba(255,255,255,0.6)',
						border: '1px solid rgba(255,255,255,0.08)',
					}}>
						{status}
					</span>
				)}
			</header>

			{/* ── Wallet cards ─────────────────────────────────────────────── */}
			{wallets.length === 0 ? (
				<div style={{
					padding: '2.5rem 1.5rem',
					borderRadius: '16px',
					border: '1px dashed rgba(255,255,255,0.1)',
					textAlign: 'center',
					color: 'rgba(255,255,255,0.35)',
					fontSize: '0.9rem',
				}}>
					No wallets yet — add your first one below.
				</div>
			) : (
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
					{wallets.map((wallet, idx) => {
						const color   = PALETTE[idx % PALETTE.length];
						const chain   = detectChainLabel(wallet.address);
						const isEditing = editingId === wallet.id;

						return (
							<div
								key={wallet.id}
								style={{
									position: 'relative',
									borderRadius: '14px',
									border: `1px solid ${color.accent}33`,
									background: `linear-gradient(135deg, ${color.soft}, rgba(10,14,28,0.95))`,
									boxShadow: `0 0 0 1px ${color.accent}11, 0 4px 24px ${color.glow}`,
									padding: '1.25rem 1.25rem 1rem',
									display: 'flex',
									flexDirection: 'column',
									gap: '0.75rem',
									transition: 'box-shadow 0.2s',
									overflow: 'hidden',
								}}
							>
								{/* Colored top stripe */}
								<div style={{
									position: 'absolute',
									top: 0, left: 0, right: 0,
									height: '3px',
									background: `linear-gradient(90deg, ${color.accent}, ${color.accent}66)`,
									borderRadius: '14px 14px 0 0',
								}} />

								{/* Chain badge + icon */}
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
									<span style={{
										fontSize: '0.68rem',
										fontWeight: 700,
										letterSpacing: '0.1em',
										textTransform: 'uppercase',
										color: color.accent,
										background: `${color.accent}18`,
										border: `1px solid ${color.accent}33`,
										padding: '0.2rem 0.55rem',
										borderRadius: '999px',
									}}>
										{chain.label}
									</span>
									<span style={{
										fontSize: '1.4rem',
										color: color.accent,
										opacity: 0.7,
										fontWeight: 700,
										lineHeight: 1,
										letterSpacing: '-0.02em',
									}}>
										{chain.icon}
									</span>
								</div>

								{/* Label */}
								{isEditing ? (
									<input
										value={draftLabel}
										onChange={(e) => setDraftLabel(e.target.value)}
										autoFocus
										style={{
											...inputStyle,
											minWidth: 'unset',
											fontSize: '1rem',
											fontWeight: 700,
											borderColor: `${color.accent}55`,
											background: 'rgba(0,0,0,0.3)',
										}}
									/>
								) : (
									<div style={{
										fontSize: '1.05rem',
										fontWeight: 700,
										color: '#fff',
										letterSpacing: '-0.01em',
										lineHeight: 1.2,
									}}>
										{wallet.label || <span style={{ opacity: 0.4, fontStyle: 'italic', fontWeight: 400 }}>Unnamed</span>}
									</div>
								)}

								{/* Address */}
								<div style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.25rem',
									background: 'rgba(0,0,0,0.25)',
									borderRadius: '7px',
									padding: '0.35rem 0.6rem',
									border: '1px solid rgba(255,255,255,0.06)',
								}}>
									<span style={{
										fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
										fontSize: '0.75rem',
										color: 'rgba(255,255,255,0.55)',
										flex: 1,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}>
										{truncateAddress(wallet.address)}
									</span>
									<CopyButton text={wallet.address} />
								</div>

								{/* Actions */}
								<div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.1rem' }}>
									{isEditing ? (
										<>
											<ActionBtn
												label="Save"
												onClick={() => handleSave(wallet)}
												color={color.accent}
												filled
											/>
											<ActionBtn label="Cancel" onClick={handleCancel} />
											<ActionBtn
												label="Delete"
												onClick={() => handleDelete(wallet)}
												color="#f87171"
											/>
										</>
									) : (
										<>
											<ActionBtn label="Edit" onClick={() => handleEditClick(wallet)} color={color.accent} />
											<ActionBtn label="Delete" onClick={() => handleDelete(wallet)} color="#f87171" />
										</>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* ── Add wallet form ──────────────────────────────────────────── */}
			<div style={{
				background: 'rgba(255,255,255,0.025)',
				border: '1px solid rgba(255,255,255,0.08)',
				borderRadius: '14px',
				padding: '1.25rem 1.35rem',
			}}>
				<div style={{
					fontSize: '0.72rem',
					fontWeight: 700,
					letterSpacing: '0.1em',
					textTransform: 'uppercase',
					opacity: 0.4,
					marginBottom: '0.85rem',
				}}>
					Add a wallet to the Vault
				</div>
				<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
					<input
						type="text"
						placeholder="Wallet address"
						value={addAddress}
						onChange={e => setAddAddress(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={inputStyle}
					/>
					<input
						type="text"
						placeholder="Label  (e.g. My Ledger)"
						value={addLabel}
						onChange={e => setAddLabel(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={{ ...inputStyle, maxWidth: '200px' }}
					/>
					<input
						type="text"
						placeholder="Symbol  (e.g. LTC)"
						value={addSymbol}
						onChange={e => setAddSymbol(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={{ ...inputStyle, maxWidth: '130px' }}
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={adding}
						style={{
							padding: '0.45rem 1.2rem',
							borderRadius: '8px',
							border: '1px solid rgba(99,102,241,0.5)',
							background: adding ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.18)',
							color: adding ? 'rgba(165,180,252,0.4)' : '#a5b4fc',
							fontWeight: 700,
							fontSize: '0.875rem',
							cursor: adding ? 'not-allowed' : 'pointer',
							whiteSpace: 'nowrap',
							transition: 'background 0.15s',
						}}
					>
						{adding ? 'Adding…' : 'Add Wallet'}
					</button>
				</div>
				{addStatus && (
					<p style={{
						margin: '0.6rem 0 0',
						fontSize: '0.8rem',
						color: addStatus.startsWith('✓') ? '#4ade80' : addStatus.startsWith('Error') ? '#f87171' : 'rgba(255,255,255,0.5)',
					}}>
						{addStatus}
					</p>
				)}
			</div>
		</div>
	);
}

// ── Small reusable action button ──────────────────────────────────────────────
function ActionBtn({
	label,
	onClick,
	color = 'rgba(255,255,255,0.5)',
	filled = false,
}: {
	label: string;
	onClick: () => void;
	color?: string;
	filled?: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				padding: '0.3rem 0.75rem',
				borderRadius: '7px',
				border: `1px solid ${color}55`,
				background: filled
					? hover ? `${color}33` : `${color}22`
					: hover ? `${color}18` : 'transparent',
				color: filled ? color : `${color}cc`,
				fontSize: '0.78rem',
				fontWeight: 600,
				cursor: 'pointer',
				transition: 'background 0.12s, color 0.12s',
				letterSpacing: '0.02em',
			}}
		>
			{label}
		</button>
	);
}

export default WalletOverview;
