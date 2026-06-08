import React, { useRef, useState } from 'react';

export type AddressLabel = {
	id: string;
	address: string;
	label: string;
	source: string;
	category?: string | null;
	chain?: string | null;
	notes?: string | null;
	phone_number?: string | null;
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
	const [labels,       setLabels]       = useState<AddressLabel[]>(initial);
	const [address,      setAddress]      = useState('');
	const [labelText,    setLabelText]    = useState('');
	const [status,       setStatus]       = useState<string | null>(null);
	const [saving,       setSaving]       = useState(false);
	const [category,     setCategory]     = useState('counterparty');
	const [chain,        setChain]        = useState('');
	const [notes,        setNotes]        = useState('');
	const [phoneNumber,  setPhoneNumber]  = useState('');
	const [scanning,     setScanning]     = useState(false);
	const [scanResult,   setScanResult]   = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	async function handleScanUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		// Reset so the same file can be picked again
		e.target.value = '';

		setScanning(true);
		setScanResult(null);
		setStatus('Scanning image…');

		try {
			const form = new FormData();
			form.append('image', file);

			const res  = await fetch('/api/extract-address', { method: 'POST', body: form });
			const data = await res.json() as { addresses?: string[]; error?: boolean; message?: string };

			if (!res.ok || data.error) {
				setStatus(`Scan failed: ${data.message ?? 'Unknown error'}`);
				setScanning(false);
				return;
			}

			const found = data.addresses ?? [];
			if (found.length === 0) {
				setStatus('No wallet address found in that image. Try a clearer crop.');
				setScanning(false);
				return;
			}

			// Pre-fill with the first address; if multiple, show a picker
			setAddress(found[0]);
			if (found.length === 1) {
				setScanResult(`✓ Found: ${found[0]}`);
				setStatus(null);
			} else {
				setScanResult(`Found ${found.length} addresses — first one pre-filled. Check the field.`);
				setStatus(null);
			}
		} catch (err: unknown) {
			setStatus('Scan error: ' + (err instanceof Error ? err.message : 'Unknown'));
		}

		setScanning(false);
	}

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
				body: JSON.stringify({ address: addr, label: lbl, category, chain: chain || null, notes: notes || null, phoneNumber: phoneNumber || null }),
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
			setCategory('counterparty');
			setChain('');
			setNotes('');
			setPhoneNumber('');
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
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					marginBottom: '0.85rem',
					flexWrap: 'wrap',
					gap: '0.5rem',
				}}>
					<span style={{
						fontSize: '0.72rem',
						fontWeight: 700,
						letterSpacing: '0.1em',
						textTransform: 'uppercase',
						opacity: 0.4,
					}}>
						Tag an address
					</span>

					{/* Hidden file input */}
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						style={{ display: 'none' }}
						onChange={handleScanUpload}
					/>

					{/* Scan screenshot button */}
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={scanning}
						title="Upload a screenshot — Claude will read the wallet address for you"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.4rem',
							padding: '0.35rem 0.85rem',
							borderRadius: '8px',
							border: '1px solid rgba(167,139,250,0.35)',
							background: scanning ? 'rgba(167,139,250,0.06)' : 'rgba(167,139,250,0.12)',
							color: scanning ? 'rgba(167,139,250,0.4)' : '#c4b5fd',
							fontWeight: 700,
							fontSize: '0.78rem',
							cursor: scanning ? 'not-allowed' : 'pointer',
							whiteSpace: 'nowrap',
							transition: 'background 0.15s',
						}}
					>
						{scanning ? 'Scanning…' : 'Scan Screenshot'}
					</button>
				</div>

				{/* Scan result banner */}
				{scanResult && (
					<div style={{
						fontSize: '0.78rem',
						color: '#4ade80',
						background: 'rgba(74,222,128,0.07)',
						border: '1px solid rgba(74,222,128,0.2)',
						borderRadius: '7px',
						padding: '0.45rem 0.75rem',
						marginBottom: '0.75rem',
					}}>
						{scanResult}
					</div>
				)}

				<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
					<input
						type="text"
						placeholder="Address (any network)"
						value={address}
						onChange={e => { setAddress(e.target.value); setScanResult(null); }}
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
					<select
						value={category}
						onChange={e => setCategory(e.target.value)}
						style={{ ...inputStyle, maxWidth: '180px' }}
					>
						<option value="counterparty">Counterparty</option>
						<option value="defi">DeFi Protocol</option>
						<option value="exchange">Exchange</option>
						<option value="personal">Personal Wallet</option>
						<option value="bridge">Bridge</option>
						<option value="other">Other</option>
					</select>
					<select
						value={chain}
						onChange={e => setChain(e.target.value)}
						style={{ ...inputStyle, maxWidth: '150px' }}
					>
						<option value="">All chains</option>
						<option value="ethereum">Ethereum</option>
						<option value="polygon">Polygon</option>
						<option value="avalanche">Avalanche</option>
						<option value="bsc">BSC</option>
						<option value="arbitrum">Arbitrum</option>
						<option value="optimism">Optimism</option>
						<option value="litecoin">Litecoin</option>
					</select>
					<input
						type="tel"
						placeholder="Phone # (optional, e.g. Venmo)"
						value={phoneNumber}
						onChange={e => setPhoneNumber(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={{ ...inputStyle, maxWidth: '220px' }}
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

								{/* Category badge */}
								{(() => {
									const catColors: Record<string, string> = {
										defi:     '#a78bfa',
										exchange: '#fbbf24',
										personal: '#34d399',
										bridge:   '#60a5fa',
									};
									const catLabels: Record<string, string> = {
										defi:     'DeFi',
										exchange: 'Exchange',
										personal: 'Personal',
										bridge:   'Bridge',
										other:    'Other',
									};
									const cat = l.category ?? '';
									if (!cat || cat === 'counterparty') return null;
									const color = catColors[cat] ?? 'rgba(255,255,255,0.4)';
									return (
										<span style={{
											fontSize: '0.65rem',
											fontWeight: 700,
											letterSpacing: '0.06em',
											color,
											background: `${color}18`,
											border: `1px solid ${color}33`,
											padding: '0.15rem 0.45rem',
											borderRadius: '999px',
											flexShrink: 0,
											textAlign: 'center',
										}}>
											{catLabels[cat] ?? cat}
										</span>
									);
								})()}

								{/* Chain badge */}
								{l.chain && (
									<span style={{
										fontSize: '0.65rem',
										fontWeight: 600,
										letterSpacing: '0.05em',
										color: '#94a3b8',
										background: 'rgba(148,163,184,0.08)',
										border: '1px solid rgba(148,163,184,0.18)',
										padding: '0.15rem 0.45rem',
										borderRadius: '999px',
										flexShrink: 0,
										opacity: 0.6,
										textAlign: 'center',
									}}>
										{l.chain}
									</span>
								)}

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

								{/* Address + optional phone number */}
								<div style={{
									display: 'flex',
									flexDirection: 'column',
									gap: '0.15rem',
									flex: 1,
									minWidth: '120px',
								}}>
									<span style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.2rem',
										fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
										fontSize: '0.75rem',
										color: 'rgba(255,255,255,0.4)',
									}}>
										{truncateAddress(l.address)}
										<CopyButton text={l.address} />
									</span>
									{l.phone_number && (
										<span style={{
											fontSize: '0.72rem',
											color: 'rgba(251,191,36,0.7)',
											fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
											letterSpacing: '0.02em',
										}}>
											{l.phone_number}
										</span>
									)}
								</div>

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
