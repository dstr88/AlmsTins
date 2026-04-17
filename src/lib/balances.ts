import type { SupportedChain } from '@/lib/constants';
import { buildScanUrl, fetchEthereumScan } from '@/lib/scanSync';

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

const NATIVE_TOKEN_META: Partial<Record<SupportedChain, { symbol: string; decimals: number }>> = {
	ethereum: { symbol: 'ETH', decimals: 18 },
	polygon: { symbol: 'MATIC', decimals: 18 },
	avalanche: { symbol: 'AVAX', decimals: 18 },
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
		{ symbol: 'ETH', type: 'native', decimals: 18, coingeckoId: 'ethereum' },
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
		},
	],
	polygon: [
		{ symbol: 'MATIC', type: 'native', decimals: 18, coingeckoId: 'matic-network' },
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
			contractAddress: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD',
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
		{ symbol: 'AVAX', type: 'native', decimals: 18, coingeckoId: 'avalanche-2' },
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
		const native = await getNativeBalance(chain, address);
		const erc20 = await getErc20Balances(chain, address);
		results.push(native, ...erc20);
	}

	return results;
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
