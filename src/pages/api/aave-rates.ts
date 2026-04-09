import type { APIRoute } from 'astro';

// ── The Graph hosted-service endpoints for Aave v3 subgraphs ──────────────────
// These are free to query without an API key (rate-limited for heavy use).
// If The Graph ever requires an API key, set THEGRAPH_API_KEY in your env and
// the gateway URL pattern is:
//   https://gateway.thegraph.com/api/{key}/subgraphs/id/{subgraph-id}
const SUBGRAPH_URLS: Record<string, string> = {
	mainnet_v3:   'https://api.thegraph.com/subgraphs/name/aave/protocol-v3',
	polygon_v3:   'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon',
	avalanche_v3: 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-avalanche',
	arbitrum_v3:  'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum-one',
	optimism_v3:  'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-optimism',
	base_v3:      'https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base',
};

const REQUEST_TIMEOUT_MS = 15_000;
// One year of daily snapshots is plenty for a 90-day chart window.
const MAX_ITEMS = 1_000;

// RAY-encoded rates (liquidityRate, variableBorrowRate, stableBorrowRate) match
// exactly what the client-side aaveChartClient.ts already expects, so no
// transformation is needed beyond unwrapping the GraphQL envelope.
const RATES_QUERY = /* GraphQL */ `
  query RatesHistory($reserveId: String!, $first: Int!) {
    reserveParamsHistoryItems(
      where: { reserve: $reserveId }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      timestamp
      liquidityRate
      variableBorrowRate
      stableBorrowRate
    }
  }
`;

export const GET: APIRoute = async ({ url }) => {
	const poolId    = url.searchParams.get('poolId')    ?? '';
	const reserveId = url.searchParams.get('reserveId') ?? '';

	if (!poolId || !reserveId) {
		return json({ error: true, message: 'poolId and reserveId are required' }, 400);
	}

	const subgraphUrl = SUBGRAPH_URLS[poolId];
	if (!subgraphUrl) {
		return json(
			{
				error: true,
				message: `Unknown poolId "${poolId}". Supported values: ${Object.keys(SUBGRAPH_URLS).join(', ')}`,
			},
			400,
		);
	}

	try {
		const response = await fetchWithTimeout(
			subgraphUrl,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: RATES_QUERY,
					variables: {
						// The Graph stores reserve IDs as lowercase hex
						reserveId: reserveId.toLowerCase(),
						first: MAX_ITEMS,
					},
				}),
			},
			REQUEST_TIMEOUT_MS,
		);

		if (!response.ok) {
			return json(
				{ error: true, message: `Subgraph responded with HTTP ${response.status}` },
				response.status,
			);
		}

		const payload = await response.json();

		if (payload.errors?.length) {
			console.error('[aave-rates] GraphQL errors', payload.errors);
			return json(
				{ error: true, message: payload.errors[0]?.message ?? 'GraphQL error' },
				502,
			);
		}

		const items: unknown[] = payload?.data?.reserveParamsHistoryItems ?? [];
		return new Response(JSON.stringify(items), {
			status: 200,
			headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[aave-rates] fetch failed', error);
		const message = error instanceof Error ? error.message : 'Unable to reach subgraph';
		const status  = message.includes('aborted') ? 504 : 500;
		return json({ error: true, message }, status);
	}
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: corsHeaders(),
	});
}

function corsHeaders() {
	return {
		'Access-Control-Allow-Origin':  '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Content-Type': 'application/json',
	};
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(id);
	}
}
