import React, { useState } from 'react';

export type AddressLabel = {
	id: string;
	address: string;
	label: string;
	source: string;
};

type Props = {
	labels: AddressLabel[];
};

const cellStyle: React.CSSProperties = {
	padding: '0.5rem',
	verticalAlign: 'middle',
};

const inputStyle: React.CSSProperties = {
	flex: 1,
	minWidth: '180px',
	padding: '0.38rem 0.6rem',
	borderRadius: '8px',
	border: '1px solid rgba(255,255,255,0.15)',
	background: 'rgba(255,255,255,0.05)',
	color: 'inherit',
	fontSize: '0.85rem',
};

export function AddressLabels({ labels: initial }: Props) {
	const [labels,    setLabels]    = useState<AddressLabel[]>(initial);
	const [address,   setAddress]   = useState('');
	const [labelText, setLabelText] = useState('');
	const [status,    setStatus]    = useState<string | null>(null);
	const [saving,    setSaving]    = useState(false);

	async function handleAdd() {
		const addr  = address.replace(/\s+/g, '');
		const lbl   = labelText.trim();
		if (!addr) { setStatus('Address is required'); return; }
		if (!lbl)  { setStatus('Label is required');   return; }

		setSaving(true);
		setStatus('Saving…');
		try {
			const res  = await fetch('/api/address-labels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: addr, label: lbl }),
			});
			const data = await res.json();
			if (!res.ok) { setStatus(data.message ?? 'Failed to save'); setSaving(false); return; }

			setLabels(prev => {
				// upsert — replace if address already exists
				const existing = prev.findIndex(l => l.address === data.address);
				if (existing >= 0) {
					const next = [...prev];
					next[existing] = data;
					return next;
				}
				return [data, ...prev];
			});
			setAddress('');
			setLabelText('');
			setStatus('Label saved.');
		} catch (e: any) {
			setStatus('Error: ' + e.message);
		}
		setSaving(false);
	}

	async function handleDelete(id: string) {
		const res = await fetch(`/api/address-labels?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (res.ok || res.status === 204) {
			setLabels(prev => prev.filter(l => l.id !== id));
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
			<header>
				<p style={{ margin: 0, opacity: 0.7 }}>Counterparty addresses</p>
				<h2 style={{ margin: 0, fontSize: '1.4rem' }}>Label Inbound &amp; Outbound Addresses</h2>
				<p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', opacity: 0.45 }}>
					Tag addresses that send to you or receive from you — exchange hot wallets, other people's wallets, services. These are <em>not</em> your wallets and are <em>not</em> added to the Vault. They just get a name so you can recognise them when they appear in your history.
				</p>
			</header>

			{/* Add form */}
			<div style={{
				background: 'rgba(255,255,255,0.03)',
				border: '1px solid rgba(255,255,255,0.09)',
				borderRadius: '12px',
				padding: '1rem 1.1rem',
			}}>
				<div style={{ fontSize: '0.82rem', opacity: 0.55, marginBottom: '0.6rem' }}>Tag an address</div>
				<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
					<input
						type="text"
						placeholder="Address (any network)"
						value={address}
						onChange={e => setAddress(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={inputStyle}
					/>
					<input
						type="text"
						placeholder="Label (e.g. Venmo LTC pool)"
						value={labelText}
						onChange={e => setLabelText(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={{ ...inputStyle, maxWidth: '260px' }}
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={saving}
						style={{
							padding: '0.38rem 1rem',
							borderRadius: '8px',
							border: 'none',
							background: '#fbbf24',
							color: '#000',
							fontWeight: 700,
							fontSize: '0.85rem',
							cursor: saving ? 'default' : 'pointer',
							opacity: saving ? 0.6 : 1,
							whiteSpace: 'nowrap',
						}}
					>
						Save label
					</button>
				</div>
				{status && (
					<div style={{ fontSize: '0.78rem', opacity: 0.65, marginTop: '0.4rem' }}>{status}</div>
				)}
			</div>

			{/* Table */}
			<div style={{ overflowX: 'auto' }}>
				<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem', minWidth: '480px' }}>
					<thead>
						<tr>
							<th style={{ ...cellStyle, textAlign: 'left' }}>Label</th>
							<th style={{ ...cellStyle, textAlign: 'left' }}>Address</th>
							<th style={{ ...cellStyle, textAlign: 'left', opacity: 0.5 }}>Source</th>
							<th style={{ ...cellStyle }}></th>
						</tr>
					</thead>
					<tbody>
						{labels.length === 0 ? (
							<tr>
								<td colSpan={4} style={{ ...cellStyle, opacity: 0.5 }}>No labels yet.</td>
							</tr>
						) : (
							labels.map(l => (
								<tr key={l.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
									<td style={cellStyle}>{l.label}</td>
									<td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '0.82rem', opacity: 0.75 }}>{l.address}</td>
									<td style={{ ...cellStyle, fontSize: '0.75rem', opacity: 0.4 }}>{l.source}</td>
									<td style={{ ...cellStyle, textAlign: 'right' }}>
										{l.source === 'user' && (
											<button
												type="button"
												onClick={() => handleDelete(l.id)}
												style={{
													padding: '0.25rem 0.6rem',
													borderRadius: '7px',
													border: '1px solid rgba(255,100,100,0.4)',
													background: 'transparent',
													color: '#ff9f9f',
													fontSize: '0.78rem',
													cursor: 'pointer',
												}}
											>
												Remove
											</button>
										)}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default AddressLabels;
