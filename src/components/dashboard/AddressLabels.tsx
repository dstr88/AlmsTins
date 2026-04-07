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

// ── Address type detection ─────────────────────────────────────────────────────
function detectNetwork(address: string): string {
	const a = address.toLowerCase();
	if (a.startsWith('ltc1'))                              return 'LTC';
	if (a.startsWith('bc1') || /^[13][a-z0-9]/i.test(a)) return 'BTC';
	if (/^0x[a-f0-9]{64}$/.test(a))                       return 'SUI';
	if (/^0x[a-f0-9]{40}$/.test(a))                       return 'EVM';
	if (/^[1-9a-hj-np-za-km-z]{32,44}$/.test(address))   return 'SOL';
	return '???';
}

function truncateAddress(addr: string): string {
	if (addr.length <= 18) return addr;
	return `${addr.slice(0, 9)}…${addr.slice(-7)}`;
}

const NETWORK_COLORS: Record<string, string> = {
	EVM: '#a78bfa',
	BTC: '#f97316',
	LTC: '#94a3b8',
	SOL: '#22d3ee',
	SUI: '#34d399',
	'???': 'rgba(255,255,255,0.3)',
};

const inputStyle: React.CSSProperties = {
	flex: 1,
	minWidth: '180px',
	padding: '0.45rem 0.75rem',
	borderRadius: '8px',
	border: '1px solid rgba(255,255,255,0.12)',
	background: 'rgba(255,255,255,0.05)',
	color: 'rgba(255,255,255,0.9)',
	fontSize: '0.875rem',
	outline: 'none',
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
				background: 'none', border: 'none', cursor: 'pointer',
				padding: '0 0.2rem',
				color: copied ? '#4ade80' : 'rgba(255,255,255,0.3)',
				fontSize: '0.8rem', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0,
			}}
		>
			{copied ? '✓' : '⧉'}
		</button>
	);
}

// ── Component ─────────────────────────────────────────────────────────────────
export function AddressLabels({ labels: initial }: Props) {
	const [labels,    setLabels]    = useState<AddressLabel[]>(initial);
	const [address,   setAddress]   = useState('');
	const [labelText, setLabelText] = useState('');
	const [status,    setStatus]    = useState<string | null>(null);
	const [saving,    setSaving]    = useState(false);

	async function handleAdd() {
		const addr = address.replace(/\s+/g, '');
		const lbl  = labelText.trim();
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
			setStatus('✓ Label saved.');
		} catch (e: unknown) {
			setStatus('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
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
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

			{/* ── Header ──────────────────────────────────────────────────── */}
			<header>
				<p style={{ margin: '0 0 0.15rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.45 }}>
					Counterparties
				</p>
				<h2 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
					Address Labels
				</h2>
				<p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', opacity: 0.4, lineHeight: 1.5, maxWidth: '560px' }}>
					Tag exchange hot wallets, other people's wallets, and services so they show up with a name in your history. These are <em>not</em> your wallets and are <em>not</em> added to the Vault.
				</p>
			</header>

			{/* ── Add form ─────────────────────────────────────────────────── */}
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
					Tag an address
				</div>
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
						placeholder="Label  (e.g. Venmo LTC pool)"
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
							padding: '0.45rem 1.2rem',
							borderRadius: '8px',
							border: '1px solid rgba(34,211,238,0.4)',
							background: saving ? 'rgba(34,211,238,0.05)' : 'rgba(34,211,238,0.12)',
							color: saving ? 'rgba(34,211,238,0.35)' : '#67e8f9',
							fontWeight: 700,
							fontSize: '0.875rem',
							cursor: saving ? 'not-allowed' : 'pointer',
							whiteSpace: 'nowrap',
							transition: 'background 0.15s',
						}}
					>
						{saving ? 'Saving…' : 'Save Label'}
					</button>
				</div>
				{status && (
					<p style={{
						margin: '0.6rem 0 0',
						fontSize: '0.8rem',
						color: status.startsWith('✓') ? '#4ade80' : status.startsWith('Error') ? '#f87171' : 'rgba(255,255,255,0.5)',
					}}>
						{status}
					</p>
				)}
			</div>

			{/* ── Labels list ──────────────────────────────────────────────── */}
			{labels.length === 0 ? (
				<div style={{
					padding: '2rem 1.5rem',
					borderRadius: '14px',
					border: '1px dashed rgba(255,255,255,0.09)',
					textAlign: 'center',
					color: 'rgba(255,255,255,0.3)',
					fontSize: '0.875rem',
				}}>
					No address labels yet.
				</div>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
					{labels.map(l => {
						const network = detectNetwork(l.address);
						const netColor = NETWORK_COLORS[network] ?? 'rgba(255,255,255,0.35)';
						return (
							<div
								key={l.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.75rem',
									padding: '0.75rem 1rem',
									borderRadius: '10px',
									background: 'rgba(255,255,255,0.03)',
									border: '1px solid rgba(255,255,255,0.07)',
									transition: 'background 0.12s',
									flexWrap: 'wrap',
								}}
							>
								{/* Network badge */}
								<span style={{
									fontSize: '0.65rem',
									fontWeight: 700,
									letterSpacing: '0.08em',
									color: netColor,
									background: `${netColor}18`,
									border: `1px solid ${netColor}33`,
									padding: '0.15rem 0.45rem',
									borderRadius: '999px',
									flexShrink: 0,
									minWidth: '2.5rem',
									textAlign: 'center',
								}}>
									{network}
								</span>

								{/* Label */}
								<span style={{
									fontWeight: 600,
									fontSize: '0.9rem',
									color: 'rgba(255,255,255,0.85)',
									minWidth: '100px',
									flex: '0 0 auto',
								}}>
									{l.label}
								</span>

								{/* Address */}
								<span style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.2rem',
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
									fontSize: '0.75rem',
									color: 'rgba(255,255,255,0.4)',
									flex: 1,
									minWidth: '120px',
								}}>
									{truncateAddress(l.address)}
									<CopyButton text={l.address} />
								</span>

								{/* Source badge */}
								{l.source === 'auto' && (
									<span style={{
										fontSize: '0.65rem',
										color: 'rgba(167,139,250,0.7)',
										background: 'rgba(167,139,250,0.1)',
										border: '1px solid rgba(167,139,250,0.2)',
										padding: '0.1rem 0.4rem',
										borderRadius: '999px',
										flexShrink: 0,
									}}>
										community
									</span>
								)}

								{/* Remove */}
								{l.source === 'user' && (
									<button
										type="button"
										onClick={() => handleDelete(l.id)}
										style={{
											padding: '0.25rem 0.6rem',
											borderRadius: '7px',
											border: '1px solid rgba(248,113,113,0.3)',
											background: 'transparent',
											color: 'rgba(248,113,113,0.7)',
											fontSize: '0.75rem',
											fontWeight: 600,
											cursor: 'pointer',
											flexShrink: 0,
											transition: 'background 0.12s',
										}}
									>
										Remove
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

export default AddressLabels;
