import React, { useRef, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getAddressLabels } from '@/i18n/components/addressLabels';

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
	// Distinct per-network series colors (chart-readability exception, see CLAUDE.md)
	EVM: '#a78bfa',
	BTC: '#f97316',
	LTC: '#94a3b8',
	SOL: '#22d3ee',
	SUI: '#34d399',
	'???': 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
	flex: 1,
	minWidth: '180px',
	padding: '0.45rem 0.75rem',
	borderRadius: '8px',
	border: '1px solid var(--border-bright)',
	background: 'var(--border-subtle)',
	color: 'var(--text-secondary)',
	fontSize: '0.875rem',
	outline: 'none',
	boxSizing: 'border-box' as const,
};

function CopyButton({ text }: { text: string }) {
	const t = getAddressLabels(getClientLang());
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
			title={t.copyTitle}
			style={{
				background: 'none', border: 'none', cursor: 'pointer',
				padding: '0 0.2rem',
				color: copied ? 'var(--gain)' : 'var(--text-muted)',
				fontSize: '0.8rem', lineHeight: 1, transition: 'color 0.15s', flexShrink: 0,
			}}
		>
			{copied ? '✓' : '⧉'}
		</button>
	);
}

// ── Component ─────────────────────────────────────────────────────────────────
export function AddressLabels({ labels: initial }: Props) {
	const t = getAddressLabels(getClientLang());
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
		setStatus(t.statusScanning);

		try {
			const form = new FormData();
			form.append('image', file);

			const res  = await fetch('/api/extract-address', { method: 'POST', body: form });
			const data = await res.json() as { addresses?: string[]; error?: boolean; message?: string };

			if (!res.ok || data.error) {
				setStatus(t.statusScanFailed(data.message ?? 'Unknown error'));
				setScanning(false);
				return;
			}

			const found = data.addresses ?? [];
			if (found.length === 0) {
				setStatus(t.statusNoAddress);
				setScanning(false);
				return;
			}

			// Pre-fill with the first address; if multiple, show a picker
			setAddress(found[0]);
			if (found.length === 1) {
				setScanResult(`✓ Found: ${found[0]}`);
				setStatus(null);
			} else {
				setScanResult(t.statusFoundMultiple(found.length));
				setStatus(null);
			}
		} catch (err: unknown) {
			setStatus(t.statusScanError(err instanceof Error ? err.message : 'Unknown'));
		}

		setScanning(false);
	}

	async function handleAdd() {
		const addr = address.replace(/\s+/g, '');
		const lbl  = labelText.trim();
		if (!addr) { setStatus(t.statusAddressRequired); return; }
		if (!lbl)  { setStatus(t.statusLabelRequired);  return; }

		setSaving(true);
		setStatus(t.statusSaving);
		try {
			const res  = await fetch('/api/address-labels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: addr, label: lbl, category, chain: chain || null, notes: notes || null, phoneNumber: phoneNumber || null }),
			});
			const data = await res.json();
			if (!res.ok) { setStatus(data.message ?? t.statusSaveFailed); setSaving(false); return; }

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
			setStatus(t.statusSaved);
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
					{t.eyebrow}
				</p>
				<h2 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
					{t.heading}
				</h2>
				<p style={{ margin: '0.3rem 0 0', fontSize: '0.78rem', opacity: 0.4, lineHeight: 1.5, maxWidth: '560px' }}>
					{t.description}
				</p>
			</header>

			{/* ── Add form ─────────────────────────────────────────────────── */}
			<div style={{
				background: 'var(--border-subtle)',
				border: '1px solid var(--border-bright)',
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
						{t.formEyebrow}
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
						title={t.scanBtnTitle}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.4rem',
							padding: '0.35rem 0.85rem',
							borderRadius: '8px',
							border: '1px solid var(--accent-dim)',
							background: scanning ? 'var(--accent-soft)' : 'var(--accent-soft)',
							color: scanning ? 'var(--accent-dim)' : 'var(--accent)',
							fontWeight: 700,
							fontSize: '0.78rem',
							cursor: scanning ? 'not-allowed' : 'pointer',
							whiteSpace: 'nowrap',
							transition: 'background 0.15s',
						}}
					>
						{scanning ? t.scanBtnScanning : t.scanBtnLabel}
					</button>
				</div>

				{/* Scan result banner */}
				{scanResult && (
					<div style={{
						fontSize: '0.78rem',
						color: 'var(--gain)',
						background: 'var(--gain-bg)',
						border: '1px solid var(--gain-bg)',
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
						placeholder={t.placeholderAddress}
						value={address}
						onChange={e => { setAddress(e.target.value); setScanResult(null); }}
						onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
						style={inputStyle}
					/>
					<input
						type="text"
						placeholder={t.placeholderLabel}
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
						<option value="counterparty">{t.catCounterparty}</option>
						<option value="defi">{t.catDefiProtocol}</option>
						<option value="exchange">{t.catExchange}</option>
						<option value="personal">{t.catPersonalWallet}</option>
						<option value="bridge">{t.catBridge}</option>
						<option value="other">{t.catOther}</option>
					</select>
					<select
						value={chain}
						onChange={e => setChain(e.target.value)}
						style={{ ...inputStyle, maxWidth: '150px' }}
					>
						<option value="">{t.allChains}</option>
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
						placeholder={t.placeholderPhone}
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
							border: '1px solid var(--accent-dim)',
							background: saving ? 'var(--accent-soft)' : 'var(--accent-soft)',
							color: saving ? 'var(--accent-dim)' : 'var(--accent)',
							fontWeight: 700,
							fontSize: '0.875rem',
							cursor: saving ? 'not-allowed' : 'pointer',
							whiteSpace: 'nowrap',
							transition: 'background 0.15s',
						}}
					>
						{saving ? t.saveBtnSaving : t.saveBtnSave}
					</button>
				</div>
				{status && (
					<p style={{
						margin: '0.6rem 0 0',
						fontSize: '0.8rem',
						color: status.startsWith('✓') ? 'var(--gain)' : status.startsWith('Error') ? 'var(--loss)' : 'var(--text-muted)',
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
					border: '1px dashed var(--border-bright)',
					textAlign: 'center',
					color: 'var(--text-muted)',
					fontSize: '0.875rem',
				}}>
					{t.emptyState}
				</div>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
					{labels.map(l => {
						const network = detectNetwork(l.address);
						const netColor = NETWORK_COLORS[network] ?? 'var(--text-muted)';
						return (
							<div
								key={l.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.75rem',
									padding: '0.75rem 1rem',
									borderRadius: '10px',
									background: 'var(--border-subtle)',
									border: '1px solid var(--border-bright)',
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
									// Distinct per-category series colors (chart-readability exception)
									const catColors: Record<string, string> = {
										defi:     '#a78bfa',
										exchange: '#fbbf24',
										personal: '#34d399',
										bridge:   '#60a5fa',
									};
									const catLabels: Record<string, string> = {
										defi:     t.catBadgeDefi,
										exchange: t.catBadgeExchange,
										personal: t.catBadgePersonal,
										bridge:   t.catBadgeBridge,
										other:    t.catBadgeOther,
									};
									const cat = l.category ?? '';
									if (!cat || cat === 'counterparty') return null;
									const color = catColors[cat] ?? 'var(--text-muted)';
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
										color: 'var(--text-secondary)',
										background: 'var(--surface-card-2)',
										border: '1px solid var(--surface-card-2)',
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
									color: 'var(--text-secondary)',
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
										color: 'var(--text-muted)',
									}}>
										{truncateAddress(l.address)}
										<CopyButton text={l.address} />
									</span>
									{l.phone_number && (
										<span style={{
											fontSize: '0.72rem',
											color: 'var(--accent)',
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
										color: 'var(--accent)',
										background: 'var(--accent-soft)',
										border: '1px solid var(--accent-soft)',
										padding: '0.1rem 0.4rem',
										borderRadius: '999px',
										flexShrink: 0,
									}}>
										{t.sourceCommunity}
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
											border: '1px solid var(--loss-border)',
											background: 'transparent',
											color: 'var(--loss)',
											fontSize: '0.75rem',
											fontWeight: 600,
											cursor: 'pointer',
											flexShrink: 0,
											transition: 'background 0.12s',
										}}
									>
										{t.removeBtn}
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
