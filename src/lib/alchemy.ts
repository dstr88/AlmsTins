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

/**
 * One page of a wallet's ERC-20 balances. Alchemy returns at most 100 per page and a pageKey
 * when there are more; a wallet full of spam airdrops runs to several pages, so a caller that
 * wants every token must follow pageKey (see getAllTokenBalances).
 */
export async function getTokenBalances(chain: AlchemyChain, address: string, pageKey?: string) {
	return alchemyRpc(chain, {
		jsonrpc: '2.0',
		id: 1,
		method: 'alchemy_getTokenBalances',
		params: pageKey ? [address, 'erc20', { pageKey }] : [address, 'erc20'],
	}) as Promise<{
		address: string;
		tokenBalances: Array<{ contractAddress: string; tokenBalance: string }>;
		pageKey?: string;
	}>;
}

// A runaway guard, not a real limit: 50 pages is 5,000 token contracts.
const MAX_TOKEN_BALANCE_PAGES = 50;

/** Every page of a wallet's ERC-20 balances, following pageKey to the end. */
export async function getAllTokenBalances(chain: AlchemyChain, address: string) {
	const tokenBalances: Array<{ contractAddress: string; tokenBalance: string }> = [];
	let pageKey: string | undefined;
	for (let page = 0; page < MAX_TOKEN_BALANCE_PAGES; page++) {
		const result = await getTokenBalances(chain, address, pageKey);
		if (Array.isArray(result?.tokenBalances)) tokenBalances.push(...result.tokenBalances);
		pageKey = result?.pageKey || undefined;
		if (!pageKey) return tokenBalances;
	}
	console.warn('[alchemy] getAllTokenBalances stopped at the page guard', { chain, pages: MAX_TOKEN_BALANCE_PAGES });
	return tokenBalances;
}

/** The wallet's native coin balance (ETH on eth-mainnet, POL on polygon-mainnet), in wei. */
export async function getNativeBalanceWei(chain: AlchemyChain, address: string): Promise<bigint> {
	const result = await alchemyRpc(chain, {
		jsonrpc: '2.0',
		id: 1,
		method: 'eth_getBalance',
		params: [address, 'latest'],
	});
	return BigInt(String(result ?? '0x0'));
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
