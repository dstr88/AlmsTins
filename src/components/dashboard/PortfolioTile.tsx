import React, { useEffect, useRef, useState } from 'react';
import { normalizeNetWorthSummary, type NetWorthSummary } from '@/lib/networth/summaryContract';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getPortfolioTile } from '@/i18n/components/portfolioTile';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type UploadStatus = { ok: boolean; message: string } | null;
type SyncStatus = { ok: boolean; processed: number; failed: number; failedNames?: string[] } | null;

const fmtPnl = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'always' });

function SyncIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
			strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<polyline points="23 4 23 10 17 10" />
			<polyline points="1 20 1 14 7 14" />
			<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
		</svg>
	);
}

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
	const [costBasis, setCostBasis] = useState<number | null>(null);
	const [uploading, setUploading] = useState(false);
	const [status, setStatus] = useState<UploadStatus>(null);
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const t = getPortfolioTile(getClientLang());

	const loadSummary = (mounted: { current: boolean }) => {
		fetch('/api/networth/summary')
			.then((r) => r.json())
			.then((data) => { if (mounted.current) setSummary(normalizeNetWorthSummary(data)); })
			.catch(() => {});
		fetch('/api/networth/pnl')
			.then((r) => r.json())
			.then((data) => { if (mounted.current && typeof data.heldCostBasisUsd === 'number') setCostBasis(data.heldCostBasisUsd); })
			.catch(() => {});
	};

	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		loadSummary(mountedRef);
		return () => { mountedRef.current = false; };
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
				setStatus({ ok: false, message: data.error || t.uploadFailed });
			} else if (data.duplicate) {
				setStatus({ ok: true, message: t.alreadyImported });
			} else {
				const tx = data.transaction;
				const desc = tx?.description ? `${tx.description} — ` : '';
				const amt = tx?.amount ? `${tx.amount} ${tx.currency}` : (tx?.currency ?? '');
				setStatus({ ok: true, message: `Imported: ${desc}${amt}` });
			}
		} catch {
			setStatus({ ok: false, message: t.uploadFailed });
		} finally {
			setUploading(false);
			if (fileRef.current) fileRef.current.value = '';
		}
	};

	const handleSync = async () => {
		setSyncing(true);
		setSyncStatus(null);
		try {
			const [exchangeRes, walletRes, avaxRes, btcRes] = await Promise.all([
				fetch('/api/import/snapshot-all', { method: 'POST' }),
				fetch('/api/wallets/value/sync-all', { method: 'POST' }),
				fetch('/api/import/snowtrace-sync', { method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
				fetch('/api/import/btc-sync', { method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				}),
			]);
			const exchangeData = await exchangeRes.json().catch(() => ({}));
			const avaxData     = await avaxRes.json().catch(() => ({}));
			const btcData      = await btcRes.json().catch(() => ({}));

			// Collect per-exchange failure names from snapshot-all results
			const SOURCE_DISPLAY: Record<string, string> = {
				coinbase: 'Coinbase', kraken: 'Kraken', gemini: 'Gemini',
				crypto_com: 'Crypto.com', exodus: 'Exodus', cashapp: 'Cash App',
				venmo: 'Venmo', robinhood: 'Robinhood',
			};
			const failedExchangeNames: string[] = (exchangeData.results ?? [])
				.filter((r: { ok: boolean; source?: string }) => !r.ok)
				.map((r: { source?: string }) => SOURCE_DISPLAY[r.source ?? ''] ?? r.source ?? 'Exchange');

			// btc-sync returns 400 when no BTC wallet is configured — that's not a failure
			const btcOk = btcRes.ok || btcRes.status === 400;
			const ok = exchangeRes.ok || walletRes.ok || avaxRes.ok || btcRes.ok;
			const processed = (exchangeData.processed ?? 0) + (walletRes.ok ? 1 : 0) + (avaxRes.ok ? 1 : 0) + (btcRes.ok ? 1 : 0);
			const exchangeFailed = (exchangeData.failed ?? (!exchangeRes.ok ? 1 : 0));
			const failed = exchangeFailed + (!walletRes.ok ? 1 : 0) + (!avaxRes.ok ? 1 : 0) + (!btcOk ? 1 : 0);
			setSyncStatus({ ok, processed, failed, failedNames: failedExchangeNames.length ? failedExchangeNames : undefined });
			if (ok) loadSummary(mountedRef);

			// Rebuild asset lifecycles so bookkeeping FIFO reflects the latest imports
			await fetch('/api/lifecycle/rebuild', { method: 'POST' });
		} catch {
			setSyncStatus({ ok: false, processed: 0, failed: 1 });
		} finally {
			setSyncing(false);
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

			{/* ── Import screenshot + Sync exchange balances ───── */}
			<div className="pt-upload">
				<input ref={fileRef} type="file" accept="image/*"
					style={{ display: 'none' }}
					onChange={(e) => handleFile(e.target.files?.[0])} />
				<button type="button"
					className={`pt-upload-btn${uploading ? ' is-uploading' : ''}`}
					onClick={() => fileRef.current?.click()}
					disabled={uploading}
					aria-label={t.importScreenshotAriaLabel}>
					<CameraIcon />
					{uploading ? t.importScreenshotParsing : t.importScreenshot}
				</button>
				<button type="button"
					className={`pt-upload-btn${syncing ? ' is-uploading' : ''}`}
					onClick={handleSync}
					disabled={syncing}
					aria-label={t.syncAllAriaLabel}>
					<SyncIcon />
					{syncing ? t.syncingSyncing : t.syncTins}
				</button>
				{status && (
					<span className={`pt-status${status.ok ? ' pt-status--ok' : ' pt-status--err'}`}>
						{status.ok ? '✓' : '✗'} {status.message}
					</span>
				)}
				{syncStatus && (
					<span className={`pt-status${syncStatus.ok ? ' pt-status--ok' : ' pt-status--err'}`}>
						{syncStatus.ok ? '✓' : '✗'}{' '}
						{syncStatus.ok
							? t.syncedAccounts(syncStatus.processed)
							: syncStatus.failedNames?.length
								? t.syncFailed(syncStatus.failedNames)
								: t.syncFailedCount(syncStatus.failed)}
					</span>
				)}
			</div>

			{/* ── Divider ──────────────────────────────────────── */}
			<div className="pt-divider" />

			{/* ── Grand total ──────────────────────────────────── */}
			{!summary
				? <p className="pt-loading">{t.loading}</p>
				: (() => {
					const pnl = costBasis != null ? assetsTotal - costBasis : null;
					const pnlColor = pnl == null ? undefined : pnl >= 0 ? 'var(--gain)' : 'var(--loss)';
					return (
						<div className="pt-hero">
							<span className="pt-hero__label">{t.marketValue}</span>
							<div className="pt-hero__row">
								<strong className="pt-hero__value">{fmt.format(assetsTotal)}</strong>
								{pnl != null && (
									<span className="pt-hero__pnl" style={{ color: pnlColor }}>
										{fmtPnl.format(pnl)}
									</span>
								)}
							</div>
						</div>
					);
				})()
			}

			{/* ── Per-wallet list ───────────────────────────────── */}
			{summary && tins.length === 0 && (
				<p className="pt-empty">{t.noWalletBalances}</p>
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
					{t.aaveDebtNote(fmtFull.format(debtTotal))}
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
				.pt-status--ok  { color: var(--gain); }
				.pt-status--err { color: var(--loss); }
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
				.pt-hero__row {
					display: flex;
					align-items: baseline;
					gap: 0.75rem;
					flex-wrap: wrap;
				}
				.pt-hero__value {
					font-size: 1.9rem;
					font-weight: 800;
					font-variant-numeric: tabular-nums;
					letter-spacing: -0.02em;
					line-height: 1;
				}
				.pt-hero__pnl {
					font-size: 1rem;
					font-weight: 700;
					font-variant-numeric: tabular-nums;
					letter-spacing: -0.01em;
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
