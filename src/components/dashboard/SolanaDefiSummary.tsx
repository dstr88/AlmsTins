import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getSolanaDefiSummary } from '@/i18n/components/solanaDefiSummary';

console.log('[island.mount]', 'SolanaDefiSummary');

type Program = { programId: string; name: string | null };

type FetchState =
	| { status: 'loading' }
	| { status: 'error'; message?: string }
	| { status: 'ready'; protocols: string[]; recentPrograms: Program[] };

export default function SolanaDefiSummary({ walletId }: { walletId: string }) {
	const [state, setState] = useState<FetchState>({ status: 'loading' });
	const t = getSolanaDefiSummary(getClientLang());

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res  = await fetch(`/api/wallets/${walletId}/solana-defi`, { credentials: 'include' });
				const data = await res.json() as { ok?: boolean; protocols?: string[]; recentPrograms?: Program[]; message?: string };
				if (!cancelled) {
					if (!data.ok) throw new Error(data.message ?? 'DeFi lookup failed');
					setState({ status: 'ready', protocols: data.protocols ?? [], recentPrograms: data.recentPrograms ?? [] });
				}
			} catch (err: any) {
				if (!cancelled) setState({ status: 'error', message: err?.message });
			}
		})();
		return () => { cancelled = true; };
	}, [walletId]);

	if (state.status === 'loading') {
		return <div className="defi-stats"><div className="defi-status defi-status--loading">{t.loading}</div></div>;
	}
	if (state.status === 'error') {
		return <div className="defi-stats"><div className="defi-status defi-status--error">{t.error}</div></div>;
	}

	const { protocols, recentPrograms } = state;
	const named   = recentPrograms.filter((p) => p.name !== null);
	const unnamed = recentPrograms.filter((p) => p.name === null);

	// Merge: anything in recentPrograms that matches a detected protocol is already shown above
	const detectedSet = new Set(protocols);
	const namedNew    = named.filter((p) => !detectedSet.has(p.name!));

	return (
		<div className="defi-stats">
			<div className="breakdown-title">{t.activeProtocols}</div>
			<div className="breakdown">
				{protocols.length > 0 ? protocols.map((name) => (
					<div className="stat-row" key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
						<span className="label">{name}</span>
					</div>
				)) : (
					<div className="breakdown-empty">{t.noActiveProtocols}</div>
				)}
			</div>

			{(namedNew.length > 0 || unnamed.length > 0) && (
				<>
					<div className="spacer spacer--md" />
					<div className="divider" />
					<div className="spacer spacer--sm" />
					<div className="breakdown-title">{t.alsoSeenInHistory}</div>
					<div className="breakdown">
						{namedNew.map((p) => (
							<div className="stat-row" key={p.programId}>
								<span className="label">{p.name}</span>
							</div>
						))}
						{unnamed.map((p) => (
							<div className="stat-row" key={p.programId}>
								<span className="label" style={{ fontFamily: 'monospace', fontSize: '0.75em', color: 'var(--text-secondary)' }}>
									{p.programId.slice(0, 8)}…{p.programId.slice(-4)}
								</span>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}
