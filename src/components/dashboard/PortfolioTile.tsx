import React, { useEffect, useRef, useState } from 'react';
import { normalizeNetWorthSummary, type NetWorthSummary } from '@/lib/networth/summaryContract';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type UploadStatus = { ok: boolean; message: string } | null;

function CameraIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
			<circle cx="12" cy="13" r="4" />
		</svg>
	);
}

export default function PortfolioTile() {
	const [summary, setSummary] = useState<NetWorthSummary | null>(null);
	const [uploading, setUploading] = useState(false);
	const [status, setStatus] = useState<UploadStatus>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let mounted = true;
		fetch('/api/networth/summary')
			.then((r) => r.json())
			.then((data) => { if (mounted) setSummary(normalizeNetWorthSummary(data)); })
			.catch(() => {});
		return () => { mounted = false; };
	}, []);

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		setUploading(true);
		setStatus(null);
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch('/api/portfolio/import-screenshot', { method: 'POST', body: fd });
			const data = await res.json();
			if (!res.ok) {
				setStatus({ ok: false, message: data.error || 'Upload failed.' });
			} else if (data.duplicate) {
				setStatus({ ok: true, message: 'Already imported (duplicate).' });
			} else {
				const tx = data.transaction;
				const desc = tx?.description ? `${tx.description} — ` : '';
				const amt = tx?.amount ? `${tx.amount} ${tx.currency}` : (tx?.currency ?? '');
				setStatus({ ok: true, message: `Imported: ${desc}${amt}` });
			}
		} catch {
			setStatus({ ok: false, message: 'Upload failed.' });
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = '';
		}
	};

	// tins = per-wallet data that IS sent by the API (byWallet is not in the payload)
	// Use assetsUsd (gross) instead of netUsd so Aave debt doesn't go negative
	const tins = (summary?.tins ?? [])
		.filter((t) => t.assetsUsd > 0.005)
		.sort((a, b) => b.assetsUsd - a.assetsUsd);

	// Gross total = sum of per-tin asset values (ignore debt)
	const assetsTotal = tins.reduce((s, t) => s + t.assetsUsd, 0);
	const debtTotal   = summary?.totalDebtUsd ?? 0;

	return (
		<div className="pt-root">

			{/* ── Import screenshot ─────────────────────────────── */}
			<div className="pt-upload">
				<input ref={fileRef} type="file" accept="image/*"
					style={{ display: 'none' }}
					onChange={(e) => handleFile(e.target.files?.[0])} />
				<button type="button"
					className={`pt-upload-btn${uploading ? ' is-uploading' : ''}`}
					onClick={() => fileRef.current?.click()}
					disabled={uploading}
					aria-label="Import transaction screenshot">
					<CameraIcon />
					{uploading ? 'Parsing…' : 'Import Screenshot'}
				</button>
				{status && (
					<span className={`pt-status${status.ok ? ' pt-status--ok' : ' pt-status--err'}`}>
						{status.ok ? '✓' : '✗'} {status.message}
					</span>
				)}
			</div>

			{/* ── Divider ──────────────────────────────────────── */}
			<div className="pt-divider" />

			{/* ── Grand total ──────────────────────────────────── */}
			{!summary
				? <p className="pt-loading">Loading…</p>
				: (
					<div className="pt-hero">
						<span className="pt-hero__label">Market Value</span>
						<strong className="pt-hero__value">{fmt.format(assetsTotal)}</strong>
					</div>
				)
			}

			{/* ── Per-wallet list ───────────────────────────────── */}
			{summary && tins.length === 0 && (
				<p className="pt-empty">No wallet balances found.</p>
			)}
			{tins.length > 0 && (
				<ul className="pt-wallets">
					{tins.map((t) => (
						<li key={t.tinId} className="pt-wallet-row">
							<span className="pt-wallet-name">{t.tinName}</span>
							<span className="pt-wallet-value">{fmtFull.format(t.assetsUsd)}</span>
						</li>
					))}
				</ul>
			)}

			{/* ── Aave debt footnote (not included above) ────────── */}
			{debtTotal > 0 && (
				<p className="pt-debt-note">
					⚠ {fmtFull.format(debtTotal)} Aave debt not reflected above
				</p>
			)}

			<style>{`
				.pt-root {
					display: flex;
					flex-direction: column;
					gap: 0.6rem;
					padding: 0.25rem 0;
					height: 100%;
					min-height: 0;
				}
				.pt-upload {
					display: flex;
					align-items: center;
					gap: 0.6rem;
					flex-wrap: wrap;
					flex-shrink: 0;
				}
				.pt-upload-btn {
					display: inline-flex;
					align-items: center;
					gap: 0.45rem;
					padding: 0.35rem 0.85rem;
					border-radius: 999px;
					border: 1px solid rgba(255,255,255,0.2);
					background: rgba(255,255,255,0.05);
					color: inherit;
					font-size: 0.75rem;
					font-weight: 600;
					letter-spacing: 0.04em;
					cursor: pointer;
					transition: background 0.15s, opacity 0.15s;
					white-space: nowrap;
				}
				.pt-upload-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
				.pt-upload-btn:disabled,
				.pt-upload-btn.is-uploading { opacity: 0.5; cursor: default; }
				.pt-status { font-size: 0.72rem; line-height: 1.3; flex: 1; min-width: 0; }
				.pt-status--ok  { color: #86efac; }
				.pt-status--err { color: #fca5a5; }
				.pt-divider {
					height: 1px;
					background: rgba(255,255,255,0.09);
					flex-shrink: 0;
				}

				/* ── Big total ─── */
				.pt-hero {
					display: flex;
					flex-direction: column;
					gap: 0.1rem;
					flex-shrink: 0;
				}
				.pt-hero__label {
					font-size: 0.68rem;
					text-transform: uppercase;
					letter-spacing: 0.1em;
					opacity: 0.45;
				}
				.pt-hero__value {
					font-size: 1.9rem;
					font-weight: 800;
					font-variant-numeric: tabular-nums;
					letter-spacing: -0.02em;
					line-height: 1;
				}

				/* ── Wallet list ─── */
				.pt-wallets {
					list-style: none;
					margin: 0;
					padding: 0;
					display: flex;
					flex-direction: column;
					overflow-y: auto;
					flex: 1;
					min-height: 0;
					gap: 0;
				}
				.pt-wallet-row {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					gap: 0.75rem;
					padding: 0.45rem 0.5rem;
					border-radius: 6px;
					transition: background 0.1s;
				}
				.pt-wallet-row:hover { background: rgba(255,255,255,0.05); }
				.pt-wallet-name {
					font-size: 0.85rem;
					opacity: 0.8;
					min-width: 0;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}
				.pt-wallet-value {
					font-size: 0.9rem;
					font-weight: 700;
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
					flex-shrink: 0;
				}

				/* ── Debt footnote ─── */
				.pt-debt-note {
					font-size: 0.72rem;
					opacity: 0.4;
					margin: 0;
					padding: 0.35rem 0.5rem;
					border-top: 1px solid rgba(255,255,255,0.07);
					flex-shrink: 0;
				}
				.pt-loading,
				.pt-empty {
					font-size: 0.8rem;
					opacity: 0.45;
					margin: 0;
				}
			`}</style>
		</div>
	);
}
