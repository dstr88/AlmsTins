import type { SupportedChain } from './constants';
import { CHAIN_IDS, SNOWTRACE_BASE_URL, buildEtherscanV2Url, requestEtherscan } from '@/lib/etherscan';

// The explorer calls behind Wallet Watcher's EVM sync. The rows they return are read by
// src/lib/sync/evmSyncRows.ts (Aave call detection included), through the reader Agentics shares
// (src/lib/evmTransfers.ts).

type EtherscanChain = Extract<SupportedChain, 'ethereum' | 'polygon' | 'arbitrum'>;

const ETHEREUM_CHAIN_ID = CHAIN_IDS.ethereum;
const ETHERSCAN_CHAIN_IDS: Record<EtherscanChain, number> = {
	ethereum: CHAIN_IDS.ethereum,
	polygon: CHAIN_IDS.polygon,
	arbitrum: CHAIN_IDS.arbitrum,
};

export type ScanChain = SupportedChain;

export type ScanParams = Record<string, string | number>;

export type ScanTx = {
	blockNumber: string;
	timeStamp: string;
	hash: string;
	nonce: string;
	blockHash: string;
	transactionIndex: string;
	from: string;
	to: string;
	value: string;
	gas: string;
	gasPrice: string;
	isError?: string;
	txreceipt_status?: string;
	input?: string;
	contractAddress?: string;
	cumulativeGasUsed: string;
	gasUsed: string;
	confirmations: string;
	tokenDecimal?: string;
	tokenSymbol?: string;
	tokenName?: string;
};

export function buildScanUrl(chain: ScanChain, params: ScanParams) {
	// Etherscan URL construction is centralized in src/lib/etherscan.ts.
	if (chain === 'ethereum') {
		return buildEtherscanV2Url(ETHEREUM_CHAIN_ID, params);
	}
	if (chain === 'polygon' || chain === 'arbitrum') {
		return buildEtherscanV2Url(ETHERSCAN_CHAIN_IDS[chain], params);
	}
	if (chain === 'avalanche') {
		return buildSnowtraceUrl(params);
	}
	throw new Error(`Unsupported chain: ${chain}`);
}

export async function fetchAccountData(chain: EtherscanChain, params: ScanParams) {
	// Etherscan fetch is centralized in src/lib/etherscan.ts.
	if (chain === 'ethereum') {
		return fetchEthereumScan(params);
	}

	const chainId = ETHERSCAN_CHAIN_IDS[chain];
	const url = buildEtherscanV2Url(chainId, params);
	const payload = await requestEtherscan(url);
	const redactedUrl = url ? url.replace(/apikey=[^&]+/i, 'apikey=[redacted]') : '(no url — key missing)';
	console.log('[ETH scan]', {
		provider: 'etherscan_v2',
		chain,
		chainId,
		keyPresent: Boolean(import.meta.env.ETHERSCAN_API_KEY),
		url: redactedUrl,
		status: (payload as any).status,
		message: (payload as any).message,
	});
	return payload;
}

export async function fetchEthereumScan(params: ScanParams) {
	// Etherscan fetch is centralized in src/lib/etherscan.ts.
	const url = buildEtherscanV2Url(ETHEREUM_CHAIN_ID, params);
	const payload = await requestEtherscan(url);
	const redactedUrl = url ? url.replace(/apikey=[^&]+/i, 'apikey=[redacted]') : '(no url — key missing)';

	console.log('[ETH scan]', {
		provider: 'etherscan_v2',
		chain: 'ethereum',
		chainId: ETHEREUM_CHAIN_ID,
		keyPresent: Boolean(import.meta.env.ETHERSCAN_API_KEY),
		url: redactedUrl,
		status: (payload as any).status,
		message: (payload as any).message,
	});
	return payload;
}

function buildSnowtraceUrl(params: ScanParams): string {
	// API key is optional — Routescan free tier works without one.
	// If SNOWTRACE_API_KEY is set it will be included for higher rate limits.
	const apiKey = import.meta.env.SNOWTRACE_API_KEY;
	const query = new URLSearchParams(apiKey ? { apikey: apiKey } : {});
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			query.set(key, String(value));
		}
	}
	return `${SNOWTRACE_BASE_URL}?${query.toString()}`;
}
