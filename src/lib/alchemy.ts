// src/lib/alchemy.ts

// Server startup env sanity (boolean only).
console.log('[env] ALCHEMY_API_KEY present', Boolean(process.env.ALCHEMY_API_KEY));

export type AlchemyChain = 'eth-mainnet' | 'polygon-mainnet';

type AlchemyRpcBody = {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: unknown[];
};

const ALCHEMY_BASE_URL: Record<AlchemyChain, string> = {
	'eth-mainnet': 'https://eth-mainnet.g.alchemy.com/v2',
	'polygon-mainnet': 'https://polygon-mainnet.g.alchemy.com/v2',
};

export async function alchemyRpc(chain: AlchemyChain, body: AlchemyRpcBody) {
	const apiKey = process.env.ALCHEMY_API_KEY ?? import.meta.env.ALCHEMY_API_KEY;
	if (!apiKey) throw new Error('Missing ALCHEMY_API_KEY');

	const url = `${ALCHEMY_BASE_URL[chain]}/${apiKey}`;
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	const payload = await response.json();

	if (!response.ok) {
		throw new Error(`Alchemy HTTP ${response.status}`);
	}
	if (payload?.error) {
		throw new Error(`Alchemy error: ${payload.error?.message ?? 'unknown'}`);
	}

	return payload?.result;
}

export async function getTokenBalances(chain: AlchemyChain, address: string) {
	return alchemyRpc(chain, {
		jsonrpc: '2.0',
		id: 1,
		method: 'alchemy_getTokenBalances',
		params: [address, 'erc20'],
	}) as Promise<{
		address: string;
		tokenBalances: Array<{ contractAddress: string; tokenBalance: string }>;
	}>;
}

/** alchemy_getAssetTransfers — used to find a token's acquisition transfer (receipt basis). */
export async function getAssetTransfers(chain: AlchemyChain, params: Record<string, unknown>) {
	return alchemyRpc(chain, {
		jsonrpc: '2.0',
		id: 1,
		method: 'alchemy_getAssetTransfers',
		params: [params],
	}) as Promise<{
		transfers: Array<{
			blockNum: string; hash: string; from: string; to: string;
			value: number | null; asset: string | null; category: string;
			rawContract?: { address?: string | null; value?: string | null };
			tokenId?: string | null;
			metadata?: { blockTimestamp?: string };
		}>;
	}>;
}

export async function getTokenMetadata(chain: AlchemyChain, contractAddress: string) {
	return alchemyRpc(chain, {
		jsonrpc: '2.0',
		id: 1,
		method: 'alchemy_getTokenMetadata',
		params: [contractAddress],
	}) as Promise<{
		decimals: number;
		logo?: string | null;
		name?: string | null;
		symbol?: string | null;
	}>;
}
