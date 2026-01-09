// src/lib/aave/client.ts

// Aave v3 public GraphQL endpoint
const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';

// Aave v3 market addresses (from https://api.v3.aave.com/graphql markets query)
const ETHEREUM_MARKET_ADDRESS = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const ETHEREUM_CHAIN_ID = 1;
const POLYGON_MARKET_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const POLYGON_CHAIN_ID = 137;
const AVALANCHE_MARKET_ADDRESS = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AVALANCHE_CHAIN_ID = 43114;

// --- Public types your API/UI can rely on ---

export type AaveSide = 'supply' | 'borrow';

export type AavePosition = {
	side: AaveSide;
	marketName: string;
	assetSymbol: string;
	amount: number; // raw token amount
	apy: number; // decimal, e.g. 0.05 = 5%
};

export type AaveChainSummary = {
	chain: 'ethereum' | 'polygon' | 'avalanche';
	suppliedUsd: number;
	debtUsd: number;
	suppliedUsdTotal: number;
	debtUsdTotal: number;
	positions: AavePosition[];
	ok: boolean;
	error?: string;
};

export type AavePositionsResponse = {
	ok: boolean;
	address: string;
	chains: AaveChainSummary[];
	error?: string;
};

// --- GraphQL query we already proved works in the playground ---

function buildUserPositionsQuery(marketAddress: string, chainId: number) {
	// NOTE: This matches the query that returned WBTC, USDC, WETH, WPOL supplies and USDC/USDT0 borrows.
	return /* GraphQL */ `
  query UserPositions($user: EvmAddress!) {
    userSupplies(
      request: {
        markets: [
          {
            address: "${marketAddress}"
            chainId: ${chainId}
          }
        ]
        user: $user
        collateralsOnly: false
        orderBy: { name: ASC }
      }
    ) {
      market { name }
      currency { symbol }
      balance { amount { value } }
      apy { value }
    }

    userBorrows(
      request: {
        markets: [
          {
            address: "${marketAddress}"
            chainId: ${chainId}
          }
        ]
        user: $user
        orderBy: { name: ASC }
      }
    ) {
      market { name }
      currency { symbol }
      debt { amount { value } }
      apy { value }
    }
  }
`;
}

// --- Helper: safe numeric conversion ---

function toNumber(value: unknown): number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === 'string') {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

// --- Core: fetch polygon user positions from Aave v3 ---

async function fetchUserPositionsForMarket(
	userAddress: string,
	marketAddress: string,
	chainId: number,
	chain: AaveChainSummary['chain'],
): Promise<AaveChainSummary> {
	const user = userAddress.toLowerCase();

	try {
		const response = await fetch(AAVE_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: buildUserPositionsQuery(marketAddress, chainId),
				variables: { user },
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			console.error(`[AAVE ${chain}] HTTP error`, response.status, text);
			return {
				chain,
				suppliedUsd: 0,
				debtUsd: 0,
				suppliedUsdTotal: 0,
				debtUsdTotal: 0,
				positions: [],
				ok: false,
				error: `HTTP ${response.status}`,
			};
		}

		const json = await response.json();
		console.log(`[AAVE ${chain} raw]`, JSON.stringify(json));

		if (json.errors && json.errors.length) {
			console.error(`[AAVE ${chain}] GraphQL errors`, json.errors);
			return {
				chain,
				suppliedUsd: 0,
				debtUsd: 0,
				suppliedUsdTotal: 0,
				debtUsdTotal: 0,
				positions: [],
				ok: false,
				error: json.errors[0]?.message ?? 'GraphQL error',
			};
		}

		const data = json.data ?? {};
		const rawSupplies = (data.userSupplies ?? []) as any[];
		const rawBorrows = (data.userBorrows ?? []) as any[];

		const positions: AavePosition[] = [];

		// Supplies
		for (const s of rawSupplies) {
			const marketName = s.market?.name ?? 'Unknown';
			const symbol = s.currency?.symbol ?? 'UNKNOWN';
			const amount = toNumber(s.balance?.amount?.value);
			const apy = toNumber(s.apy?.value);

			positions.push({
				side: 'supply',
				marketName,
				assetSymbol: symbol,
				amount: Number.isFinite(amount) ? amount : 0,
				apy: Number.isFinite(apy) ? apy : 0,
			});
		}

		// Borrows
		for (const b of rawBorrows) {
			const marketName = b.market?.name ?? 'Unknown';
			const symbol = b.currency?.symbol ?? 'UNKNOWN';
			const amount = toNumber(b.debt?.amount?.value);
			const apy = toNumber(b.apy?.value);

			positions.push({
				side: 'borrow',
				marketName,
				assetSymbol: symbol,
				amount: Number.isFinite(amount) ? amount : 0,
				apy: Number.isFinite(apy) ? apy : 0,
			});
		}

		// Right now we are *not* computing USD from Aave; keep USD fields at 0.
		return {
			chain,
			suppliedUsd: 0,
			debtUsd: 0,
			suppliedUsdTotal: 0,
			debtUsdTotal: 0,
			positions,
			ok: true,
		};
	} catch (err: any) {
		console.error(`[AAVE ${chain}] fetch failed`, err);
		return {
			chain,
			suppliedUsd: 0,
			debtUsd: 0,
			suppliedUsdTotal: 0,
			debtUsdTotal: 0,
			positions: [],
			ok: false,
			error: err?.message ?? 'Unknown error',
		};
	}
}

// --- Public function used by /api/aave/positions ---

export async function getAavePositionsForWallet(address: string): Promise<AavePositionsResponse> {
	const normalized = address.toLowerCase();

	try {
		const ethereum = await fetchUserPositionsForMarket(
			normalized,
			ETHEREUM_MARKET_ADDRESS,
			ETHEREUM_CHAIN_ID,
			'ethereum',
		);
		const polygon = await fetchUserPositionsForMarket(
			normalized,
			POLYGON_MARKET_ADDRESS,
			POLYGON_CHAIN_ID,
			'polygon',
		);
		const avalanche = await fetchUserPositionsForMarket(
			normalized,
			AVALANCHE_MARKET_ADDRESS,
			AVALANCHE_CHAIN_ID,
			'avalanche',
		);

		return {
			ok: true,
			address: normalized,
			chains: [ethereum, polygon, avalanche],
		};
	} catch (err: any) {
		console.error('[AAVE] getAavePositionsForWallet failed', err);
		return {
			ok: false,
			address: normalized,
			chains: [],
			error: err?.message ?? 'Unknown error',
		};
	}
}

// Optional: keep this if something else imports it.
// For now, we don’t have price data from Aave, so totals stay 0.
export async function getAaveTotalsForWallet(address: string) {
	const result = await getAavePositionsForWallet(address);
	return result;
}
