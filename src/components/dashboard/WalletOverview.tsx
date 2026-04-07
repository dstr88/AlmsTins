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

export function WalletOverview({ wallets: initialWallets }: Props) {
	const [wallets, setWallets] = useState<WalletState>(initialWallets);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftLabel, setDraftLabel] = useState('');
	const [status, setStatus] = useState<string | null>(null);

	const [addAddress, setAddAddress] = useState('');
	const [addLabel,   setAddLabel]   = useState('');
	const [addSymbol,  setAddSymbol]  = useState('');
	const [addStatus,  setAddStatus]  = useState<string | null>(null);
	const [adding,     setAdding]     = useState(false);

	// Simple hydration check to ensure the component is interactive in the browser.
	React.useEffect(() => {
		console.log('[WalletOverview] hydrated with', initialWallets.length, 'wallet(s)');
	}, [initialWallets.length]);

	function handleEditClick(wallet: WalletOverviewWallet) {
		console.log('[WalletOverview] edit click', wallet.id);
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
			if (!res.ok && res.status !== 204) {
				throw new Error('Failed to delete wallet');
			}
			setWallets((prev) => prev.filter((w) => w.id !== wallet.id));
			setEditingId(null);
			setStatus('Wallet deleted.');
		} catch (err) {
			console.error('Error deleting wallet', err);
			setStatus('Unable to delete right now.');
		}
	}

	async function handleSave(wallet: WalletOverviewWallet) {
		const trimmed = draftLabel.trim();
		if (!trimmed) {
			setStatus('Label is required');
			return;
		}

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

			setWallets((prev) =>
				prev.map((w) => (w.id === wallet.id ? { ...w, label: trimmed } : w)),
			);
			setEditingId(null);
			setDraftLabel('');
			setStatus('Saved.');
		} catch (err) {
			console.error('Error updating wallet label', err);
			setStatus('Unable to save right now.');
		}
	}

	const inputStyle: React.CSSProperties = {
		flex: 1,
		minWidth: '200px',
		padding: '0.38rem 0.6rem',
		borderRadius: '8px',
		border: '1px solid rgba(255,255,255,0.15)',
		background: 'rgba(255,255,255,0.05)',
		color: 'inherit',
		fontSize: '0.85rem',
	};

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
			setAddStatus('Wallet added.');
		} catch (e: any) {
			setAddStatus('Error: ' + e.message);
		}
		setAdding(false);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
			<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<div>
					<p style={{ margin: 0, opacity: 0.7 }}>Wallet management</p>
					<h1 style={{ margin: 0, fontSize: '1.4rem' }}>Wallet overview</h1>
				</div>
				{status ? (
					<span style={{ fontSize: '0.9rem', opacity: 0.8 }}>{status}</span>
				) : null}
			</header>

			<div style={{
				background: 'rgba(255,255,255,0.03)',
				border: '1px solid rgba(255,255,255,0.09)',
				borderRadius: '12px',
				padding: '1rem 1.1rem',
			}}>
				<div style={{ fontSize: '0.82rem', opacity: 0.55, marginBottom: '0.6rem' }}>Add a wallet</div>
				<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
					<input
						type="text"
						placeholder="Address"
						value={addAddress}
						onChange={e => setAddAddress(e.target.value)}
						style={inputStyle}
					/>
					<input
						type="text"
						placeholder="Label"
						value={addLabel}
						onChange={e => setAddLabel(e.target.value)}
						style={{ ...inputStyle, maxWidth: '180px' }}
					/>
					<input
						type="text"
						placeholder="Symbol (e.g. LTC)"
						value={addSymbol}
						onChange={e => setAddSymbol(e.target.value)}
						style={{ ...inputStyle, maxWidth: '130px' }}
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={adding}
						style={{
							padding: '0.38rem 1rem',
							borderRadius: '8px',
							border: 'none',
							background: '#fbbf24',
							color: '#000',
							fontWeight: 700,
							fontSize: '0.85rem',
							cursor: adding ? 'default' : 'pointer',
							opacity: adding ? 0.6 : 1,
							whiteSpace: 'nowrap',
						}}
					>
						Add
					</button>
				</div>
				{addStatus && (
					<div style={{ fontSize: '0.78rem', opacity: 0.65, marginTop: '0.4rem' }}>{addStatus}</div>
				)}
			</div>

		<div style={{ overflowX: 'auto' }}>
				<table
					style={{
						width: '100%',
						borderCollapse: 'collapse',
						fontSize: '0.95rem',
						minWidth: '520px',
					}}
				>
					<thead>
						<tr>
							<th style={{ textAlign: 'left', padding: '0.5rem' }}>Label</th>
							<th style={{ textAlign: 'left', padding: '0.5rem' }}>Address</th>
							<th style={{ padding: '0.5rem' }}>Actions</th>
						</tr>
					</thead>
					<tbody>
						{wallets.length === 0 ? (
							<tr>
								<td colSpan={3} style={{ padding: '0.75rem', opacity: 0.7 }}>
									No wallets found.
								</td>
							</tr>
						) : (
							wallets.map((wallet) => {
								const isEditing = editingId === wallet.id;
								return (
									<tr key={wallet.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
										<td style={{ padding: '0.5rem' }}>
											{isEditing ? (
												<input
													value={draftLabel}
													onChange={(e) => setDraftLabel(e.target.value)}
													style={{
														width: '100%',
														padding: '0.35rem 0.45rem',
														borderRadius: '8px',
														border: '1px solid rgba(255,255,255,0.2)',
														background: 'rgba(255,255,255,0.04)',
														color: 'inherit',
													}}
												/>
											) : (
												wallet.label || <span style={{ opacity: 0.6 }}>Unnamed</span>
											)}
										</td>
										<td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{wallet.address}</td>
										<td style={{ padding: '0.5rem', textAlign: 'center' }}>
											{isEditing ? (
												<div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
													<button
														type="button"
														onClick={() => handleSave(wallet)}
														style={{
															padding: '0.3rem 0.7rem',
															borderRadius: '8px',
															border: '1px solid rgba(255,255,255,0.25)',
															background: 'rgba(255,255,255,0.1)',
															color: 'inherit',
														}}
													>
														Save
													</button>
													<button
														type="button"
														onClick={handleCancel}
														style={{
															padding: '0.3rem 0.7rem',
															borderRadius: '8px',
															border: '1px solid rgba(255,255,255,0.15)',
															background: 'transparent',
															color: 'inherit',
														}}
													>
														Cancel
													</button>
													<button
														type="button"
														onClick={() => handleDelete(wallet)}
														style={{
															padding: '0.3rem 0.7rem',
															borderRadius: '8px',
															border: '1px solid rgba(255,100,100,0.5)',
															background: 'transparent',
															color: '#ff9f9f',
															cursor: 'pointer',
														}}
													>
														Delete
													</button>
												</div>
											) : (
												<div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
													<button
														type="button"
														onClick={() => handleEditClick(wallet)}
														style={{
															padding: '0.3rem 0.7rem',
															borderRadius: '8px',
															border: '1px solid rgba(255,255,255,0.25)',
															background: 'transparent',
															color: 'inherit',
														}}
													>
														Edit
													</button>
													<button
														type="button"
														onClick={() => handleDelete(wallet)}
														style={{
															padding: '0.3rem 0.7rem',
															borderRadius: '8px',
															border: '1px solid rgba(255,100,100,0.5)',
															background: 'transparent',
															color: '#ff9f9f',
															cursor: 'pointer',
														}}
													>
														Delete
													</button>
												</div>
											)}
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default WalletOverview;
