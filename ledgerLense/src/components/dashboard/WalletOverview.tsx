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

export function WalletOverview({ wallets: initialWallets }: Props) {
	const [wallets, setWallets] = useState<WalletState>(initialWallets);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftLabel, setDraftLabel] = useState('');
	const [status, setStatus] = useState<string | null>(null);

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
												</div>
											) : (
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
