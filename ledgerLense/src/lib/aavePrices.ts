const GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3';

export type AaveKeySymbol = 'BTC' | 'ETH' | 'POL' | 'AVAX';

export interface AaveKeyPrice {
	symbol: AaveKeySymbol;
	priceUsd: number;
	change24hPct?: number;
}

type ReserveResponse = {
	reserves: Array<ReserveEntry>;
};

type ReserveEntry = {
	symbol?: string | null;
	name?: string | null;
	underlyingAsset?: string | null;
	decimals?: number | null;
	priceInUsd?: string | null;
	priceInMarketReferenceCurrency?: string | null;
	priceOracle?: string | null;
	pool?: {
		id?: string | null;
		marketReferenceCurrencyDecimals?: number | null;
		marketReferenceCurrencyPriceInUsd?: string | null;
		marketReferenceCurrencyUnit?: string | null;
	} | null;
};

type AaveReserveTarget = {
	aaveSymbol: string;
	underlyingAsset: string;
	marketLabel: string;
};

// Map key assets to the specific v3 market + wrapped reserve we care about.
// - BTC  -> WBTC on Ethereum v3
// - ETH  -> WETH (native) on Ethereum v3
// - POL  -> WMATIC on Polygon v3
// - AVAX -> WAVAX on Avalanche v3
const AAVE_KEY_TARGETS: Record<AaveKeySymbol, AaveReserveTarget> = {
	BTC: {
		aaveSymbol: 'WBTC',
		underlyingAsset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
		marketLabel: 'ethereum-v3',
	},
	ETH: {
		aaveSymbol: 'WETH',
		underlyingAsset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
		marketLabel: 'ethereum-v3',
	},
	POL: {
		aaveSymbol: 'WMATIC',
		underlyingAsset: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
		marketLabel: 'polygon-v3',
	},
	AVAX: {
		aaveSymbol: 'WAVAX',
		underlyingAsset: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
		marketLabel: 'avalanche-v3',
	},
};

const KEY_PRICE_QUERY = /* GraphQL */ `
	query KeyReserves($symbols: [String!]) {
		reserves(where: { symbol_in: $symbols }) {
			symbol
			name
			underlyingAsset
			decimals
			priceInUsd
			priceInMarketReferenceCurrency
			priceOracle
			pool {
				id
				marketReferenceCurrencyDecimals
				marketReferenceCurrencyPriceInUsd
				marketReferenceCurrencyUnit
			}
		}
	}
`;

export async function getAaveKeyPrices(symbols: AaveKeySymbol[]): Promise<AaveKeyPrice[]> {
	if (!symbols.length) return [];

	const targets = symbols.map((symbol) => AAVE_KEY_TARGETS[symbol]);
	const mappedSymbols = Array.from(new Set(targets.map((t) => t?.aaveSymbol).filter(Boolean))) as string[];

	if (!mappedSymbols.length) {
		return symbols.map((symbol) => ({ symbol, priceUsd: 0 }));
	}

	try {
		const response = await fetch(GRAPH_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: KEY_PRICE_QUERY, variables: { symbols: mappedSymbols } }),
		});

		if (!response.ok) {
			throw new Error(`Aave subgraph responded with ${response.status}`);
		}

		const payload = (await response.json()) as { data?: ReserveResponse; errors?: unknown };
		if (payload.errors && (payload.errors as any[]).length) {
			throw new Error('Aave subgraph returned errors');
		}

		const reserves = payload.data?.reserves ?? [];
		console.log('[aavePrices] reserves length =', reserves.length);
		console.log(
			'[aavePrices] reserve symbols preview =',
			reserves.slice(0, 10).map((r) => ({
				symbol: r.symbol,
				underlyingAsset: r.underlyingAsset,
				poolId: r.pool?.id,
			})),
		);

		const pricesFromAave = symbols.map((symbol) => {
			const target = AAVE_KEY_TARGETS[symbol];
			const matched = findReserveMatch(reserves, target);

			if (!matched) {
				console.warn(`[aavePrices] Missing reserve for ${symbol} on ${target.marketLabel}`);
				return { symbol, priceUsd: 0 };
			}

			if (symbol === 'BTC') {
				console.log('[aavePrices] WBTC matched reserve', {
					symbol: matched.symbol,
					name: matched.name,
					underlyingAsset: matched.underlyingAsset,
					priceInUsd: matched.priceInUsd,
					priceInMarketReferenceCurrency: matched.priceInMarketReferenceCurrency,
					priceOracle: matched.priceOracle,
					decimals: matched.decimals,
					poolId: matched.pool?.id,
					marketReferenceCurrencyDecimals: matched.pool?.marketReferenceCurrencyDecimals,
					marketReferenceCurrencyPriceInUsd: matched.pool?.marketReferenceCurrencyPriceInUsd,
					marketReferenceCurrencyUnit: matched.pool?.marketReferenceCurrencyUnit,
				});
			}

			const priceUsd = computePriceUsd(matched);

			if (symbol === 'BTC') {
				console.log('[aavePrices] WBTC computed priceUsd', {
					priceUsd,
					priceInUsdRaw: matched.priceInUsd,
					priceInMarketReferenceCurrency: matched.priceInMarketReferenceCurrency,
					referenceCurrencyPriceUsd: matched.pool?.marketReferenceCurrencyPriceInUsd,
					referenceCurrencyDecimals: matched.pool?.marketReferenceCurrencyDecimals,
					referenceCurrencyUnit: matched.pool?.marketReferenceCurrencyUnit,
				});
			}

			return { symbol, priceUsd };
		});

		const zeroSymbols = pricesFromAave
			.filter((entry) => !Number.isFinite(entry.priceUsd) || entry.priceUsd <= 0)
			.map((entry) => entry.symbol);

		if (zeroSymbols.length) {
			console.warn('[aavePrices] zero/missing reserves for symbols', zeroSymbols);
		}

		console.log('[aavePrices] using Aave prices only (no fallback)');
		return pricesFromAave;
	} catch (error) {
		console.error('getAaveKeyPrices failed', error);
		return symbols.map((symbol) => ({ symbol, priceUsd: 0 }));
	}
}

function findReserveMatch(reserves: ReserveEntry[], target: AaveReserveTarget) {
	const targetSymbol = target.aaveSymbol.toUpperCase();
	const targetAsset = normalizeAddress(target.underlyingAsset);

	return reserves.find((reserve) => {
		const symbol = reserve.symbol?.toUpperCase();
		const underlying = normalizeAddress(reserve.underlyingAsset);
		return symbol === targetSymbol && underlying === targetAsset;
	});
}

function normalizeAddress(value?: string | null) {
	return value ? value.toLowerCase() : '';
}

function computePriceUsd(reserve: ReserveEntry): number {
	// Prefer subgraph-provided USD price when available
	const directPrice = Number(reserve.priceInUsd);
	if (Number.isFinite(directPrice) && directPrice > 0) {
		return directPrice;
	}

	// Fallback: convert reference currency price to USD using pool metadata
	const priceInRef = Number(reserve.priceInMarketReferenceCurrency);
	const refPriceUsdRaw = Number(reserve.pool?.marketReferenceCurrencyPriceInUsd);
	const refDecimals = Number(reserve.pool?.marketReferenceCurrencyDecimals);
	const refUnit = Number(reserve.pool?.marketReferenceCurrencyUnit);

	if (!Number.isFinite(priceInRef) || !Number.isFinite(refPriceUsdRaw) || !Number.isFinite(refDecimals)) {
		return 0;
	}

	const refUnitValue = Number.isFinite(refUnit) && refUnit > 0 ? refUnit : 10 ** refDecimals;
	const refPriceUsd = refPriceUsdRaw / 1e8; // marketReferenceCurrencyPriceInUsd is scaled by 1e8 per Aave subgraph
	const priceInRefUnits = priceInRef / refUnitValue;

	return priceInRefUnits * refPriceUsd;
}
