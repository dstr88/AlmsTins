import type { SupportedChain } from './constants';
import { buildEtherscanV2Url, requestEtherscan } from '@/lib/etherscan';

// Aave V3 Pool contract addresses (all lowercase) for Aave call detection
const AAVE_POOL_ADDRESSES = new Set([
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', // Ethereum V3
	'0x794a61358d6845594f94dc1db02a252b5b4814ad', // Avalanche V3 (also Polygon V3)
]);

// Aave V3 function 4-byte selectors → action label
const AAVE_SELECTORS = new Map<string, string>([
	['0x617ba037', 'supply'],
	['0xa415bcad', 'borrow'],
	['0x573ade81', 'repay'],
	['0x69328dec', 'withdraw'],
]);

type EtherscanChain = Extract<SupportedChain, 'ethereum' | 'polygon'>;

const ETHEREUM_CHAIN_ID = 1;
const ETHERSCAN_CHAIN_IDS: Record<EtherscanChain, number> = {
	ethereum: ETHEREUM_CHAIN_ID,
	polygon: 137,
};

// Snowtrace was rebranded to Routescan in 2023; api.snowtrace.io is dead (404).
const SNOWTRACE_BASE_URL = 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';

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
	if (chain === 'polygon') {
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

function isEtherscanChain(chain: ScanChain): chain is EtherscanChain {
	return chain === 'ethereum' || chain === 'polygon';
}

export function normalizeScanResults(nativeTxs: ScanTx[], tokenTxs: ScanTx[], chain: string, wallet: { id: string; address: string }) {
	const transactions = new Map<string, any>();

	nativeTxs.forEach((tx) => {
		const key = `${tx.hash}-${chain}`;
		const toLower = tx.to?.toLowerCase() ?? '';
		const selector = tx.input?.slice(0, 10)?.toLowerCase() ?? '';
		const aaveAction = AAVE_POOL_ADDRESSES.has(toLower) ? AAVE_SELECTORS.get(selector) : undefined;
		const txType = aaveAction
			? `aave_${aaveAction}`
			: toLower === wallet.address.toLowerCase()
				? 'incoming'
				: 'outgoing';
		const metadata: Record<string, any> = aaveAction
			? { source: 'aave', aaveAction }
			: { source: 'scan_native' };
		transactions.set(key, {
			walletId: wallet.id,
			hash: tx.hash,
			chain,
			blockNumber: Number(tx.blockNumber),
			timestamp: new Date(Number(tx.timeStamp) * 1000),
			from: tx.from,
			to: tx.to,
			value: tx.value,
			tokenSymbol: 'native',
			tokenDecimals: 18,
			txType,
			status: tx.isError === '1' ? 'failed' : 'confirmed',
			feePaid: tx.gasUsed && tx.gasPrice ? (BigInt(tx.gasUsed) * BigInt(tx.gasPrice)).toString() : null,
			metadata,
		});
	});

	tokenTxs.forEach((tx) => {
		const key = `${tx.hash}-${chain}-${tx.tokenSymbol}`;
		transactions.set(key, {
			walletId: wallet.id,
			hash: tx.hash,
			chain,
			blockNumber: Number(tx.blockNumber),
			timestamp: new Date(Number(tx.timeStamp) * 1000),
			from: tx.from,
			to: tx.to,
			value: tx.value,
			tokenSymbol: tx.tokenSymbol,
			tokenDecimals: tx.tokenDecimal ? Number(tx.tokenDecimal) : undefined,
			contractAddress: tx.contractAddress ? tx.contractAddress.toLowerCase() : undefined,
			txType: tx.to?.toLowerCase() === wallet.address ? 'token_in' : 'token_out',
			status: 'confirmed',
			metadata: { tokenName: tx.tokenName, source: 'scan_token' },
		});
	});

	return Array.from(transactions.values());
}
