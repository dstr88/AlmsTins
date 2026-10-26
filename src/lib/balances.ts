import type { SupportedChain } from '@/lib/constants';
import { buildScanUrl, fetchEthereumScan } from '@/lib/scanSync';
import { CHAINS } from '@/lib/chains';

export interface TokenBalance {
	chain: SupportedChain;
	address: string;
	tokenSymbol: string;
	tokenAddress: string | null;
	decimals: number;
	rawBalance: bigint;
}

type ScanBalanceResponse = {
	status: string;
	message: string;
	result: string;
};

const SCAN_DELAY_MS = 450;
let scanQueue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scheduleScan<T>(fn: () => Promise<T>, delayMs = SCAN_DELAY_MS): Promise<T> {
	const run = async () => {
		if (delayMs > 0) await sleep(delayMs);
		return fn();
	};
	const next = scanQueue.then(run, run);
	scanQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

// The native coins this file reads (src/lib/chains.ts). Polygon's is POL; until October 2026 it
// was stored as MATIC.
const NATIVE_TOKEN_META: Partial<Record<SupportedChain, { symbol: string; decimals: number }>> = {
	ethereum: CHAINS.ethereum.native,
	polygon: CHAINS.polygon.native,
	avalanche: CHAINS.avalanche.native,
};

type ChainToken = {
	symbol: string;
	type: 'native' | 'erc20';
	decimals: number;
	coingeckoId: string;
	contractAddress?: string;
};

// Core L1 + blue-chip tokens we track across chains and Aave markets.
const TRACKED_TOKENS: Partial<Record<SupportedChain, ChainToken[]>> = {
	ethereum: [
		{ symbol: CHAINS.ethereum.native.symbol, type: 'native', decimals: 18, coingeckoId: 'ethereum' },
		{
			symbol: 'WETH',
			type: 'erc20',
			contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
			decimals: 18,
			coingeckoId: 'weth',
		},
		{
			symbol: 'WBTC',
			type: 'erc20',
			contractAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
			decimals: 8,
			coingeckoId: 'wrapped-bitcoin',
		},
		{
			symbol: 'USDC',
			type: 'erc20',
			contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
			decimals: 6,
			coingeckoId: 'usd-coin',
		},
		{
			symbol: 'USDT',
			type: 'erc20',
			contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
			decimals: 6,
			coingeckoId: 'tether',
		},
		{
			symbol: 'DAI',
			type: 'erc20',
			contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
			decimals: 18,
			coingeckoId: 'dai',
		},
		{
			symbol: 'LINK',
			type: 'erc20',
			contractAddress: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
			decimals: 18,
			coingeckoId: 'chainlink',
		},		{
			symbol: 'AAVE',
			type: 'erc20',
			contractAddress: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
			decimals: 18,
			coingeckoId: 'aave',
		},
		{
			symbol: 'BAND',
			type: 'erc20',
			contractAddress: '0xBA11D00c5f74255f56a5E366F4F77f5A186d7f55',
			decimals: 18,
			coingeckoId: 'band-protocol',
		},
	],
	polygon: [
		{ symbol: CHAINS.polygon.native.symbol, type: 'native', decimals: 18, coingeckoId: 'polygon-ecosystem-token' },
		{
			symbol: 'WPOL',
			type: 'erc20',
			contractAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
			decimals: 18,
			coingeckoId: 'wmatic',
		},
		{
			symbol: 'WETH',
			type: 'erc20',
			contractAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
			decimals: 18,
			coingeckoId: 'weth',
		},
		{
			symbol: 'WBTC',
			type: 'erc20',
			contractAddress: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
			decimals: 8,
			coingeckoId: 'wrapped-bitcoin',
		},
		{
			symbol: 'USDC',
			type: 'erc20',
			contractAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
			decimals: 6,
			coingeckoId: 'usd-coin',
		},
		{
			symbol: 'USDT',
			type: 'erc20',
			contractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
			decimals: 6,
			coingeckoId: 'tether',
		},
		{
			symbol: 'DAI',
			type: 'erc20',
			contractAddress: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
			decimals: 18,
			coingeckoId: 'dai',
		},
		{
			symbol: 'LINK',
			type: 'erc20',
			contractAddress: '0x53E0bCA35eC356BD5DdDFebbD1Fc0fD03FAb1eDf',
			decimals: 18,
			coingeckoId: 'chainlink',
		},
	],
	avalanche: [
		{ symbol: CHAINS.avalanche.native.symbol, type: 'native', decimals: 18, coingeckoId: 'avalanche-2' },
		{
			symbol: 'WAVAX',
			type: 'erc20',
			contractAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
			decimals: 18,
			coingeckoId: 'wrapped-avax',
		},
		{
			symbol: 'USDC',
			type: 'erc20',
			contractAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
			decimals: 6,
			coingeckoId: 'usd-coin',
		},
		{
			symbol: 'USDT.e',
			type: 'erc20',
			contractAddress: '0xde3A24028580884448a5397872046a019649b084',
			decimals: 6,
			coingeckoId: 'tether',
		},
		{
			symbol: 'DAI.e',
			type: 'erc20',
			contractAddress: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70',
			decimals: 18,
			coingeckoId: 'dai',
		},
		{
			symbol: 'LINK.e',
			type: 'erc20',
			contractAddress: '0x5947BB275c521040051D82396192181b413227A3',
			decimals: 18,
			coingeckoId: 'chainlink',
		},
		{
			symbol: 'WETH',
			type: 'erc20',
			contractAddress: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
			decimals: 18,
			coingeckoId: 'weth',
		},
		{
			symbol: 'WBTC',
			type: 'erc20',
			contractAddress: '0x50b7545627a5162f82a992c33b87adc75187b218',
			decimals: 8,
			coingeckoId: 'wrapped-bitcoin',
		},
	],
};

/**
 * The tracked ERC-20 at this contract on this chain, if any. Lets a caller that discovered a
 * token by address recover its symbol and decimals when the metadata lookup failed.
 */
export function trackedTokenForContract(
	chain: SupportedChain,
	contractAddress: string,
): { symbol: string; decimals: number } | null {
	const addr = contractAddress.toLowerCase();
	const token = TRACKED_TOKENS[chain]?.find((t) => t.contractAddress?.toLowerCase() === addr);
	return token ? { symbol: token.symbol, decimals: token.decimals } : null;
}

/**
 * Fetches the native asset balance for a wallet on a given chain.
 */
export async function getNativeBalance(chain: SupportedChain, address: string): Promise<TokenBalance> {
	if (chain === 'ethereum') {
		const payload = await scheduleScan(() =>
			fetchEthereumScan({
				module: 'account',
				action: 'balance',
				address,
				tag: 'latest',
			}),
		);

		return {
			chain,
			address,
			tokenSymbol: NATIVE_TOKEN_META[chain]?.symbol ?? chain.toUpperCase(),
			tokenAddress: null,
			decimals: NATIVE_TOKEN_META[chain]?.decimals ?? 18,
			rawBalance: toBigInt(payload.result),
		};
	}

	const url = buildScanUrl(chain, {
		module: 'account',
		action: 'balance',
		address,
		tag: 'latest',
	});

	if (!url) {
		throw new Error(`[balances] No scan URL for chain ${chain} — API key may be missing`);
	}

	const payload = await scheduleScan(() => fetchScan<ScanBalanceResponse>(chain, url));

	return {
		chain,
		address,
		tokenSymbol: NATIVE_TOKEN_META[chain]?.symbol ?? chain.toUpperCase(),
		tokenAddress: null,
		decimals: NATIVE_TOKEN_META[chain]?.decimals ?? 18,
		rawBalance: toBigInt(payload.result),
	};
}

/**
 * Fetches balances for a curated list of ERC-20 tokens on the specified chain.
 * Soft-fails per token (never throws the whole chain just because 1 token fails).
 */
export async function getErc20Balances(chain: SupportedChain, address: string): Promise<TokenBalance[]> {
	const tokens = TRACKED_TOKENS[chain]?.filter((t) => t.type === 'erc20') ?? [];
	if (!tokens.length) return [];

	const balances: TokenBalance[] = [];

	for (const token of tokens) {
		// ✅ FIX: contractAddress is optional in the type, so guard it here.
		// This removes: "string | undefined not assignable to string"
		if (!token.contractAddress) {
			console.warn('[balances] missing contract address for token', {
				chain,
				symbol: token.symbol,
			});
			continue;
		}

		// Ethereum: safe wrapper already soft-fails (returns 0n on errors)
		if (chain === 'ethereum') {
			const payload = await safeFetchEthereumTokenBalance({
				address,
				contractAddress: token.contractAddress,
				symbol: token.symbol,
				decimals: token.decimals,
			});

			if (!payload) {
				console.warn('[scan.skip]', {
					chain,
					address,
					symbol: token.symbol,
					contractAddress: token.contractAddress,
					message: 'ethereum token scan failed',
				});
				continue;
			}

			balances.push({
				chain,
				address,
				tokenSymbol: token.symbol,
				tokenAddress: token.contractAddress,
				decimals: token.decimals,
				rawBalance: payload.rawBalance,
			});
			continue;
		}

		// Non-ethereum: soft-fail per token (don’t throw)
		try {
			const url = buildScanUrl(chain, {
				module: 'account',
				action: 'tokenbalance',
				address,
				contractaddress: token.contractAddress, // ✅ guaranteed string now
				tag: 'latest',
			});

			if (!url) {
				console.warn('[scan.skip] no URL for chain', chain, '— API key may be missing');
				continue;
			}

			const payload = await scheduleScan(() => fetchScan<ScanBalanceResponse>(chain, url));

			balances.push({
				chain,
				address,
				tokenSymbol: token.symbol,
				tokenAddress: token.contractAddress,
				decimals: token.decimals,
				rawBalance: toBigInt(payload.result),
			});
		} catch (err) {
			console.warn('[scan.skip]', {
				chain,
				address,
				symbol: token.symbol,
				contractAddress: token.contractAddress,
				error: String(err),
			});
			continue;
		}
	}

	return balances;
}

/**
 * Loads native + ERC-20 balances across every chain assigned to a wallet.
 */
export async function getAllBalancesForWallet(chains: SupportedChain[], address: string): Promise<TokenBalance[]> {
	console.log('[balances] START', { address, chains });

	const results: TokenBalance[] = [];

	for (const chain of chains) {
		if (chain === 'avalanche') {
			try {
				results.push(...(await getAvalancheBalancesViaRpc(address)));
				continue;
			} catch (err) {
				console.warn('[balances] avalanche RPC read failed, trying Routescan', { address, error: String(err) });
			}
		}
		const native = await getNativeBalance(chain, address);
		const erc20 = await getErc20Balances(chain, address);
		results.push(native, ...erc20);
	}

	return results;
}

// Public Avalanche C-Chain JSON-RPC endpoints, no key needed, tried in order. Avalanche balances
// used to come only from Routescan's explorer API, which answered fine from a laptop but whose
// read failed in production every time, so the chain was dropped and its months-old snapshot stood.
export const AVALANCHE_RPC_URLS = [
	'https://api.avax.network/ext/bc/C/rpc',
	'https://avalanche-c-chain-rpc.publicnode.com',
];

const ERC20_BALANCE_OF = '0x70a08231';

async function avalancheRpc(url: string, method: string, params: unknown[]): Promise<string> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	if (!response.ok) throw new Error(`Avalanche RPC HTTP ${response.status}`);
	const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
	if (payload?.error) throw new Error(`Avalanche RPC error: ${payload.error.message ?? 'unknown'}`);
	if (typeof payload?.result !== 'string') throw new Error('Avalanche RPC returned no result');
	return payload.result;
}

/**
 * Native AVAX plus each tracked Avalanche ERC-20, read straight from the chain. Throws only when no
 * endpoint can read the native balance; a single token call that fails is skipped, as in
 * getErc20Balances.
 */
export async function getAvalancheBalancesViaRpc(address: string): Promise<TokenBalance[]> {
	const chain: SupportedChain = 'avalanche';
	const holder = address.trim().toLowerCase().replace(/^0x/, '').padStart(64, '0');
	let lastError: unknown = null;

	for (const url of AVALANCHE_RPC_URLS) {
		let nativeHex: string;
		try {
			nativeHex = await avalancheRpc(url, 'eth_getBalance', [address, 'latest']);
		} catch (err) {
			lastError = err;
			continue;
		}

		const results: TokenBalance[] = [
			{
				chain,
				address,
				tokenSymbol: NATIVE_TOKEN_META.avalanche?.symbol ?? 'AVAX',
				tokenAddress: null,
				decimals: NATIVE_TOKEN_META.avalanche?.decimals ?? 18,
				rawBalance: toBigInt(nativeHex),
			},
		];

		for (const token of TRACKED_TOKENS.avalanche ?? []) {
			if (token.type !== 'erc20' || !token.contractAddress) continue;
			try {
				const hex = await avalancheRpc(url, 'eth_call', [
					{ to: token.contractAddress, data: `${ERC20_BALANCE_OF}${holder}` },
					'latest',
				]);
				results.push({
					chain,
					address,
					tokenSymbol: token.symbol,
					tokenAddress: token.contractAddress,
					decimals: token.decimals,
					rawBalance: toBigInt(hex === '0x' ? '0x0' : hex),
				});
			} catch (err) {
				console.warn('[scan.skip]', { chain, address, symbol: token.symbol, error: String(err) });
			}
		}

		return results;
	}

	throw lastError instanceof Error ? lastError : new Error('No Avalanche RPC endpoint answered');
}

async function fetchScan<T>(chain: SupportedChain, url: string): Promise<T> {
	const redactedUrl = url.replace(/apikey=[^&]+/i, 'apikey=[redacted]');
	const response = await fetch(url);
	const payload = (await response.json()) as ScanBalanceResponse;

	console.log('[SCAN balance]', {
		chain,
		url: redactedUrl,
		httpStatus: response.status,
		apiStatus: payload.status,
		message: payload.message,
	});

	if (!response.ok) {
		throw new Error(`Scan balance error (${chain}): HTTP ${response.status}`);
	}
	if (payload.status === '0' && payload.message !== 'No transactions found') {
		throw new Error(`Scan balance error (${chain}): ${payload.message}`);
	}

	return payload as unknown as T;
}

function toBigInt(value: string): bigint {
	try {
		return BigInt(value);
	} catch {
		return 0n;
	}
}

// ✅ Updated to return rawBalance bigint directly (no Number/float math)
async function safeFetchEthereumTokenBalance(opts: {
	address: string;
	contractAddress: string;
	symbol: string;
	decimals: number;
}): Promise<{ symbol: string; tokenAddress: string; rawBalance: bigint } | null> {
	const { address, contractAddress, symbol } = opts;

	try {
		const data = await scheduleScan(() =>
			fetchEthereumScan({
				module: 'account',
				action: 'tokenbalance',
				address,
				contractaddress: contractAddress,
				tag: 'latest',
			}),
		);

		return {
			symbol,
			tokenAddress: contractAddress,
			rawBalance: toBigInt(data.result ?? '0'),
		};
	} catch (err) {
		console.warn('[scan.skip]', {
			address,
			symbol,
			contractAddress,
			error: String(err),
		});

		return null;
	}
}
