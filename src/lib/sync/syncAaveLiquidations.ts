import type { Wallet } from '@/lib/wallets';
import { bulkUpsertTransactions, type NewTransaction } from '@/lib/transactions';

// Aave V3 subgraph endpoints per chain
const AAVE_SUBGRAPH_URLS: Record<string, string> = {
	ethereum: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3',
	polygon: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon',
	avalanche: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-avalanche',
};

const LIQUIDATION_QUERY = /* GraphQL */ `
	query LiquidationsByUser($user: String!, $skip: Int!) {
		liquidationCalls(
			where: { user: $user }
			orderBy: timestamp
			orderDirection: desc
			first: 100
			skip: $skip
		) {
			id
			timestamp
			collateralAsset {
				symbol
				decimals
			}
			debtAsset {
				symbol
				decimals
			}
			collateralAmount
			debtAmountCovered
			liquidator
			pool {
				id
			}
		}
	}
`;

type LiquidationCallEvent = {
	id: string;
	timestamp: string;
	collateralAsset: { symbol: string; decimals: number };
	debtAsset: { symbol: string; decimals: number };
	collateralAmount: string;
	debtAmountCovered: string;
	liquidator: string;
	pool: { id: string };
};

/**
 * Fetches all Aave V3 liquidation events for a wallet+chain from The Graph,
 * then persists them into the transactions table as tx_type='aave_liquidation'.
 *
 * Liquidations are NOT in the victim's txlist (a bot sends the tx), so we
 * must query the subgraph directly.
 */
export async function fetchAndStoreAaveLiquidations(
	tenantId: string,
	wallet: Wallet,
	chain: string,
): Promise<{ fetched: number; inserted: number }> {
	const subgraphUrl = AAVE_SUBGRAPH_URLS[chain];
	if (!subgraphUrl) {
		// Chain not supported by Aave subgraph — skip silently
		return { fetched: 0, inserted: 0 };
	}

	const userAddress = wallet.address?.toLowerCase?.() ?? wallet.address;
	const allEvents: LiquidationCallEvent[] = [];

	// Paginate — The Graph returns at most 100 per query
	let skip = 0;
	while (true) {
		try {
			const response = await fetch(subgraphUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: LIQUIDATION_QUERY,
					variables: { user: userAddress, skip },
				}),
			});

			if (!response.ok) {
				console.warn(`[aaveLiquidations] subgraph HTTP ${response.status} for ${chain} wallet ${wallet.id}`);
				break;
			}

			const payload = (await response.json()) as {
				data?: { liquidationCalls: LiquidationCallEvent[] };
				errors?: unknown;
			};

			if (payload.errors) {
				console.warn('[aaveLiquidations] subgraph errors', payload.errors);
				break;
			}

			const page = payload.data?.liquidationCalls ?? [];
			allEvents.push(...page);

			if (page.length < 100) break; // last page
			skip += 100;
		} catch (error) {
			console.error(`[aaveLiquidations] fetch failed for ${chain} wallet ${wallet.id}`, error);
			break;
		}
	}

	console.log(`[aaveLiquidations] wallet=${wallet.id} chain=${chain} found=${allEvents.length} liquidations`);

	if (!allEvents.length) return { fetched: 0, inserted: 0 };

	// Map subgraph events to NewTransaction rows
	const txs: NewTransaction[] = allEvents.map((event) => {
		// id is "txHash-logIndex" in The Graph; extract just the txHash portion
		const txHashPart = event.id.split('-')[0] ?? event.id;
		const decimalsCollateral = Number(event.collateralAsset.decimals) || 18;
		const decimalsDebt = Number(event.debtAsset.decimals) || 18;
		const collateralAmountHuman = (Number(event.collateralAmount) / 10 ** decimalsCollateral).toString();
		const debtAmountHuman = (Number(event.debtAmountCovered) / 10 ** decimalsDebt).toString();

		return {
			walletId: wallet.id,
			// Prefix with 'liq-' so the ON CONFLICT key is unique from native txs
			hash: `liq-${event.id}`,
			chain,
			timestamp: new Date(Number(event.timestamp) * 1000),
			txType: 'aave_liquidation',
			status: 'confirmed',
			// Store collateral seized as the "value" so it shows up meaningfully in the UI
			value: event.collateralAmount,
			tokenSymbol: event.collateralAsset.symbol,
			metadata: {
				source: 'aave_subgraph',
				aaveAction: 'liquidation',
				txHash: txHashPart,
				collateralAsset: event.collateralAsset.symbol,
				collateralAmount: collateralAmountHuman,
				collateralAmountRaw: event.collateralAmount,
				collateralDecimals: decimalsCollateral,
				debtAsset: event.debtAsset.symbol,
				debtAmountCovered: debtAmountHuman,
				debtAmountCoveredRaw: event.debtAmountCovered,
				debtDecimals: decimalsDebt,
				liquidator: event.liquidator,
				poolId: event.pool?.id,
			},
		};
	});

	const results = await bulkUpsertTransactions(tenantId, txs);
	// bulkUpsertTransactions returns one row per upsert; count non-null rows as inserted
	const inserted = results.filter(Boolean).length;

	console.log(`[aaveLiquidations] wallet=${wallet.id} chain=${chain} inserted/updated=${inserted}`);
	return { fetched: allEvents.length, inserted };
}
