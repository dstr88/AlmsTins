import React, { useEffect, useRef, useState } from 'react';
import { normalizeNetWorthSummary, type NetWorthSummary } from '@/lib/networth/summaryContract';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type UploadStatus = { ok: boolean; message: string } | null;

function CameraIcon() {
	return (
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
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
			.then((data) => {
				if (mounted) setSummary(normalizeNetWorthSummary(data));
			})
			.catch(() => {});
		return () => {
			mounted = false;
		};
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
			// Reset input so the same file can be re-selected
			if (fileRef.current) fileRef.current.value = '';
		}
	};

	const tins = summary?.tins ?? [];
	const total = summary?.totalUsd ?? 0;

	return (
		<div className="pt-root">
			{/* ── Screenshot import ────────────────────────────── */}
			<div className="pt-upload">
				<input
					ref={fileRef}
					type="file"
					accept="image/*"
					style={{ display: 'none' }}
					onChange={(e) => handleFile(e.target.files?.[0])}
				/>
				<button
					type="button"
					className={`pt-upload-btn${uploading ? ' is-uploading' : ''}`}
					onClick={() => fileRef.current?.click()}
					disabled={uploading}
					aria-label="Import transaction screenshot"
				>
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

			{/* ── Total ────────────────────────────────────────── */}
			<div className="pt-total">
				<span className="pt-total__label">Total</span>
				<strong className="pt-total__value">{fmt.format(total)}</strong>
			</div>

			{/* ── Per-source balance list ───────────────────────── */}
			{!summary && <p className="pt-loading">Loading…</p>}
			{summary && tins.length === 0 && (
				<p className="pt-empty">No balance data yet.</p>
			)}
			{tins.length > 0 && (
				<ul className="pt-tins">
					{tins.map((tin) => (
						<li key={tin.tinId} className="pt-tin-row">
							<span className="pt-tin-name">{tin.tinName}</span>
							<span className={`pt-tin-value${tin.netUsd < 0 ? ' negative' : ''}`}>
								{fmt.format(tin.netUsd)}
							</span>
						</li>
					))}
				</ul>
			)}

			<style>{`
				.pt-root {
					display: flex;
					flex-direction: column;
					gap: 0.75rem;
					padding: 0.25rem 0;
					height: 100%;
				}
				.pt-upload {
					display: flex;
					align-items: center;
					gap: 0.6rem;
					flex-wrap: wrap;
				}
				.pt-upload-btn {
					display: inline-flex;
					align-items: center;
					gap: 0.45rem;
					padding: 0.38rem 0.9rem;
					border-radius: 999px;
					border: 1px solid rgba(255,255,255,0.22);
					background: rgba(255,255,255,0.06);
					color: inherit;
					font-size: 0.78rem;
					font-weight: 600;
					letter-spacing: 0.04em;
					cursor: pointer;
					transition: background 0.15s, opacity 0.15s;
					white-space: nowrap;
				}
				.pt-upload-btn:hover:not(:disabled) {
					background: rgba(255,255,255,0.14);
				}
				.pt-upload-btn:disabled,
				.pt-upload-btn.is-uploading {
					opacity: 0.55;
					cursor: default;
				}
				.pt-status {
					font-size: 0.73rem;
					line-height: 1.3;
					flex: 1;
					min-width: 0;
				}
				.pt-status--ok { color: #86efac; }
				.pt-status--err { color: #fca5a5; }
				.pt-divider {
					height: 1px;
					background: rgba(255,255,255,0.09);
					margin: 0.1rem 0;
				}
				.pt-total {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					gap: 0.5rem;
				}
				.pt-total__label {
					font-size: 0.72rem;
					text-transform: uppercase;
					letter-spacing: 0.08em;
					opacity: 0.5;
				}
				.pt-total__value {
					font-size: 1.35rem;
					font-weight: 800;
					font-variant-numeric: tabular-nums;
					letter-spacing: -0.01em;
				}
				.pt-loading,
				.pt-empty {
					font-size: 0.8rem;
					opacity: 0.45;
					margin: 0;
				}
				.pt-tins {
					list-style: none;
					margin: 0;
					padding: 0;
					display: flex;
					flex-direction: column;
					gap: 0.3rem;
					overflow-y: auto;
					flex: 1;
				}
				.pt-tin-row {
					display: flex;
					justify-content: space-between;
					align-items: baseline;
					gap: 0.5rem;
					padding: 0.3rem 0;
					border-bottom: 1px solid rgba(255,255,255,0.05);
				}
				.pt-tin-row:last-child { border-bottom: none; }
				.pt-tin-name {
					font-size: 0.82rem;
					opacity: 0.85;
					min-width: 0;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}
				.pt-tin-value {
					font-size: 0.82rem;
					font-weight: 700;
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
					flex-shrink: 0;
				}
				.pt-tin-value.negative { color: #fca5a5; }
			`}</style>
		</div>
	);
}
