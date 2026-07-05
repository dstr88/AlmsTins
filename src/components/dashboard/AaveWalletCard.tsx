import React, { useEffect, useState } from 'react';
import { getClientLang } from '@/lib/i18n/clientLang';
import { getAaveWalletCard } from '@/i18n/components/aaveWalletCard';

type Props = {
	walletId: string;
	walletLabel: string;
	walletAddress?: string;
};

type AavePosition = {
	side: 'supply' | 'borrow';
	marketName?: string;
	assetSymbol: string;
	amount: number;
	apy: number;
};

type AaveChainSummary = {
	chain: string; // "ethereum" | "polygon" | "avalanche"
	ok: boolean;
	positions: AavePosition[];
	suppliedUsd: number;
	debtUsd: number;
	suppliedUsdTotal?: number;
	debtUsdTotal?: number;
	error?: string;
};

type AavePositionsResponse = {
	ok: boolean;
	address: string;
	chains: AaveChainSummary[] | Record<string, AaveChainSummary> | AavePositionsResponse;
	error?: string;
};

// Map an Aave API market name to the Aave app URL for that market, so the user can
// click straight through to the position (falls back to the app root if unknown).
const AAVE_MARKET_PARAM: Record<string, string> = {
	AaveV3Ethereum: 'proto_mainnet_v3',
	AaveV3EthereumLido: 'proto_lido_v3',
	AaveV3EthereumEtherFi: 'proto_etherfi_v3',
	AaveV3EthereumHorizon: 'proto_horizon_v3',
	AaveV3Polygon: 'proto_polygon_v3',
	AaveV3Avalanche: 'proto_avalanche_v3',
};
function aaveMarketUrl(marketName?: string): string {
	const param = marketName ? AAVE_MARKET_PARAM[marketName] : undefined;
	return param ? `https://app.aave.com/?marketName=${param}` : 'https://app.aave.com/';
}

const AaveWalletCard: React.FC<Props> = ({ walletId, walletLabel, walletAddress }) => {
	const t = getAaveWalletCard(getClientLang());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [positions, setPositions] = useState<AavePosition[]>([]);

	// Render-state diagnostics
	console.log('[AaveWalletCard v3] render state', {
		loading,
		error,
		positionsLen: positions.length,
	});

	useEffect(() => {
		const queryAddress = walletAddress ?? walletId;

		if (!queryAddress) {
			console.warn('[AaveWalletCard v3] no walletAddress or walletId provided');
			setLoading(false);
			return;
		}

		const url = `/api/aave/positions?address=${encodeURIComponent(queryAddress)}`;
		console.log('[AaveWalletCard v3] fetching', url);

		const load = async () => {
			try {
				setLoading(true);
				setError(null);

				const res = await fetch(url);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);

				const json: AavePositionsResponse = await res.json();
				console.log('[AaveWalletCard v3] response', json);

				// Unwrap in case the API returns { ok, address, chains: { ok, address, chains } }
				let rawChains: any = json.chains;
				if (rawChains && typeof rawChains === 'object' && 'chains' in rawChains) {
					console.log('[AaveWalletCard v3] detected nested chains payload, unwrapping');
					rawChains = (rawChains as any).chains;
				}

				const chainList: AaveChainSummary[] = Array.isArray(rawChains)
					? rawChains
					: Object.entries(rawChains ?? {}).map(([key, value]) => {
							const v = value && typeof value === 'object' ? (value as Partial<AaveChainSummary>) : {};
							const chain = typeof v.chain === 'string' ? v.chain : key;
							const { chain: _chain, ...rest } = v;
							return { ...rest, chain };
					  });

				console.log('[AaveWalletCard v3] normalized chains', chainList);

				let polygon = chainList.find((c) => c.chain === 'polygon');
				if (!polygon && rawChains && !Array.isArray(rawChains)) {
					const polyObj = (rawChains as Record<string, AaveChainSummary>).polygon;
					if (polyObj) {
						const { chain: _chain, ...rest } = polyObj;
						polygon = { ...rest, chain: 'polygon' };
					}
				}

				const polygonPositions = polygon?.positions ?? [];
				console.log('[AaveWalletCard v3] polygon positions', polygonPositions);

				if (polygon && !polygon.ok) {
					setError(polygon.error ?? t.errorPolygonUnavailable);
					setPositions([]);
					return;
				}

				setPositions(polygonPositions);
			} catch (err: any) {
				console.error('[AaveWalletCard v3] failed to load positions', err);
				setError(err?.message ?? t.errorFallback);
				setPositions([]);
			} finally {
				setLoading(false);
			}
		};

		load();
	}, [walletAddress, walletId]);

	if (loading) {
		return (
			<div className="card aave-card tin-panel">
				<h3 className="tin-title">{t.cardTitle(walletLabel)}</h3>
				<p>{t.loading}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="card aave-card tin-panel">
				<h3 className="tin-title">{t.cardTitle(walletLabel)}</h3>
				<p>{t.errorUnable}</p>
				<small style={{ opacity: 0.7 }}>{error}</small>
			</div>
		);
	}

	if (!positions.length) {
		return (
			<div className="card aave-card tin-panel">
				<h3 className="tin-title">{t.cardTitle(walletLabel)}</h3>
				<p>{t.empty}</p>
			</div>
		);
	}

	return (
		<div className="card aave-card tin-panel">
			<h3 className="tin-title">{t.cardTitle(walletLabel)}</h3>
			<div className="aave-positions-table">
				<table>
					<thead>
						<tr>
							<th>{t.colSide}</th>
							<th>{t.colAsset}</th>
							<th>{t.colAmount}</th>
							<th>{t.colApy}</th>
						</tr>
					</thead>
					<tbody>
						{positions.map((p, idx) => (
							<tr key={`${p.side}-${p.assetSymbol}-${idx}`}>
								<td>{p.side === 'supply' ? t.sideSupply : t.sideBorrow}</td>
								<td>
									{p.assetSymbol}
									{p.marketName && (
									<a
										href={aaveMarketUrl(p.marketName)}
										target="_blank"
										rel="noopener noreferrer"
										title={`Open ${p.marketName} on Aave`}
										style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: '4px' }}
									>
										↗
									</a>
									)}
								</td>
								<td>{p.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
								<td>{(p.apy * 100).toFixed(2)}%</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default AaveWalletCard;
