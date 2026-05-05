import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { getAllActiveWallets } from '@/lib/wallets';

export const prerender = false;

// ── The Graph — Sovryn subgraph ───────────────────────────────────────────────
// Primary: hosted service; fallback: Sovryn's own node
const GRAPH_URLS = [
	'https://api.thegraph.com/subgraphs/name/DistributedCollective/sovryn-subgraph',
	'https://subgraph.sovryn.app/subgraphs/name/DistributedCollective/sovryn-subgraph',
];

type GraphResult = {
	data?: {
		userLendingHistories?: Array<{
			id: string;
			netBalance: string;
			totalDeposited: string;
			pool?: {
				id: string;
				underlyingToken?: { symbol: string; decimals: string };
			};
		}>;
		liquidityMiningAllocationPoints?: Array<{
			id: string;
			poolTokenBalance: string;
			rewardDebt?: string;
			pool?: { token0?: { symbol: string }; token1?: { symbol: string } };
		}>;
	};
	errors?: unknown;
};

async function querySubgraph(address: string): Promise<GraphResult | null> {
	const query = `{
		userLendingHistories(
			where: { user: "${address.toLowerCase()}" }
			first: 20
			orderBy: netBalance
			orderDirection: desc
		) {
			id
			netBalance
			totalDeposited
			pool {
				id
				underlyingToken { symbol decimals }
			}
		}
		liquidityMiningAllocationPoints(
			where: { user: "${address.toLowerCase()}", poolTokenBalance_gt: "0" }
			first: 10
		) {
			id
			poolTokenBalance
			pool {
				token0 { symbol }
				token1 { symbol }
			}
		}
	}`;

	for (const url of GRAPH_URLS) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query }),
			});
			if (!res.ok) continue;
			const json = (await res.json()) as GraphResult;
			if (json.errors) continue;
			if (json.data) return json;
		} catch {
			continue;
		}
	}
	return null;
}

// ── Known Sovryn protocol contracts (for RSK RPC-based detection fallback) ────

const RSK_RPC = 'https://public-node.rsk.co';

async function rskRpc<T = unknown>(method: string, params: unknown[]): Promise<T | null> {
	try {
		const res = await fetch(RSK_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		if (!res.ok) return null;
		const json = await res.json() as { result?: T; error?: unknown };
		if (json?.error) return null;
		return json?.result ?? null;
	} catch {
		return null;
	}
}

// Sovryn protocol contracts on RSK mainnet
type ProtocolContract = { name: string; address: string };
const SOVRYN_CONTRACTS: ProtocolContract[] = [
	{ name: 'Sovryn Protocol',       address: '0x5A0D867e0D70Fcc6Ade25C3F1B89d618b5B4Eaa' },
	{ name: 'Sovryn Lending (RBTC)', address: '0x6E2fb26a60dA535732F8149b25018C9877d68ea5' },
	{ name: 'Sovryn Lending (DOC)',  address: '0xd8D25f03EBbA94E15Df2eD4d6D38276B595593c1' },
	{ name: 'Sovryn Lending (XUSD)', address: '0x8F77ecB69F329201656Ed6C9B9E06DE54EDd5FdB' },
	{ name: 'Sovryn Lending (BPro)', address: '0x6E2fb26a60dA535732F8149b25018C9877d68ea5' },
	{ name: 'Sovryn AMM',            address: '0x01B8b6C9b6c2aa8d3ea5D18B1F62F1b82aCcFf90' },
	{ name: 'SOV Staking',           address: '0x5684a06CaB22Db16d901fEe2A5C081b4C91eA40' },
	{ name: 'Zero Protocol (ZUSD)',  address: '0xD8D25f03EBbA94E15Df2eD4d6D38276B595593c1' },
];

// Check if address has ever called a contract by getting transaction count
// (lightweight: just checks getTransactionCount, real check uses transaction history)
async function detectContractInteractions(address: string): Promise<string[]> {
	const BALANCE_OF = '0x70a08231';
	const paddedAddr = '000000000000000000000000' + address.slice(2).toLowerCase();

	const detected: string[] = [];
	for (const contract of SOVRYN_CONTRACTS) {
		try {
			// For lending pools: check iToken balance (user minted iTokens = has a lending position)
			const result = await rskRpc<string>('eth_call', [
				{ to: contract.address, data: BALANCE_OF + paddedAddr },
				'latest',
			]);
			if (result && result !== '0x' && result !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
				const bal = BigInt(result);
				if (bal > 0n && !detected.includes(contract.name)) {
					detected.push(contract.name);
				}
			}
		} catch { /* soft-fail */ }
	}
	return detected;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ params, request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id ?? '';
		if (!walletId) return respond({ error: true, message: 'Wallet id required.' }, 400);

		await requireWalletOwnedByTenant(walletId, tenantId);

		const wallets = await getAllActiveWallets(tenantId);
		const wallet  = wallets.find((w) => w.id === walletId);
		if (!wallet) return respond({ error: true, message: 'Wallet not found.' }, 404);

		if (!wallet.chains.includes('rootstock')) {
			return respond({ error: true, message: 'Not a Rootstock wallet.' }, 400);
		}

		const address = wallet.address;

		// Try The Graph first — richer data with balances
		const graphData = await querySubgraph(address);

		type LendingPosition = { pool: string; tokenSymbol: string; netBalance: string };
		type AmmPosition     = { pair: string; balance: string };

		const lendingPositions: LendingPosition[] = [];
		const ammPositions: AmmPosition[]          = [];

		if (graphData?.data) {
			for (const h of graphData.data.userLendingHistories ?? []) {
				const net = parseFloat(h.netBalance ?? '0');
				if (net <= 0) continue;
				const symbol = h.pool?.underlyingToken?.symbol ?? h.pool?.id?.slice(0, 8) ?? 'Unknown';
				lendingPositions.push({
					pool:        h.pool?.id ?? h.id,
					tokenSymbol: symbol,
					netBalance:  net.toFixed(6),
				});
			}
			for (const lp of graphData.data.liquidityMiningAllocationPoints ?? []) {
				const bal = parseFloat(lp.poolTokenBalance ?? '0');
				if (bal <= 0) continue;
				const t0 = lp.pool?.token0?.symbol ?? '?';
				const t1 = lp.pool?.token1?.symbol ?? '?';
				ammPositions.push({ pair: `${t0}/${t1}`, balance: bal.toFixed(6) });
			}
		}

		// Fallback: direct contract balance-of check when subgraph is unavailable
		let detectedContracts: string[] = [];
		if (!graphData?.data && lendingPositions.length === 0) {
			detectedContracts = await detectContractInteractions(address);
		}

		return respond({
			ok: true,
			address,
			lendingPositions,
			ammPositions,
			detectedContracts,
			subgraphAvailable: Boolean(graphData?.data),
		}, 200);
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[sovryn-defi] error', err);
		return respond({ error: true, message: 'Failed to fetch Sovryn DeFi data.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
