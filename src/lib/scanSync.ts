import type { SupportedChain } from './constants';

type EtherscanChain = Extract<SupportedChain, 'ethereum' | 'polygon'>;

const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';
const ETHEREUM_CHAIN_ID = 1;
const ETHERSCAN_CHAIN_IDS: Record<EtherscanChain, number> = {
	ethereum: ETHEREUM_CHAIN_ID,
	polygon: 137,
};

const SNOWTRACE_BASE_URL = 'https://api.snowtrace.io/api';

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
	if (chain === 'ethereum') {
		return buildEthereumUrl(params);
	}
	if (chain === 'polygon') {
		return buildEtherscanUrl(chain, params);
	}
	if (chain === 'avalanche') {
		return buildSnowtraceUrl(params);
	}
	throw new Error(`Unsupported chain: ${chain}`);
}

export async function fetchAccountData(chain: EtherscanChain, params: ScanParams) {
	if (chain === 'ethereum') {
		return fetchEthereumScan(params);
	}

	const url = buildEtherscanUrl(chain, params);
	const response = await fetch(url);
	const payload = await response.json();
	const redactedUrl = url.replace(/apikey=[^&]+/i, 'apikey=[redacted]');
	console.log('[ETH scan]', {
		provider: 'etherscan_v2',
		chain,
		chainId: ETHERSCAN_CHAIN_IDS[chain],
		keyPresent: Boolean(import.meta.env.ETHERSCAN_API_KEY),
		url: redactedUrl,
		httpStatus: response.status,
		status: payload.status,
		message: payload.message,
	});
	if (!response.ok) {
		throw new Error(`Etherscan V2 HTTP error (${chain}): ${response.status}`);
	}
	if (payload.status === '0' && payload.message !== 'No transactions found') {
		const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
		throw new Error(`Etherscan V2 error (${chain}): ${payload.message ?? 'unknown error'} | result=${details}`);
	}
	return payload;
}

export async function fetchEthereumScan(params: ScanParams) {
	const apiKey = import.meta.env.ETHERSCAN_API_KEY;
	if (!apiKey) {
		throw new Error('Missing ETHERSCAN_API_KEY');
	}

	const query = new URLSearchParams({ apikey: apiKey, chainid: String(ETHEREUM_CHAIN_ID) });
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			query.set(key, String(value));
		}
	}

	const url = `${ETHERSCAN_V2_BASE_URL}?${query.toString()}`;
	const redactedUrl = url.replace(/apikey=[^&]+/i, 'apikey=[redacted]');

	const response = await fetch(url);
	const payload = await response.json();
	console.log('[ETH scan]', {
		provider: 'etherscan_v2',
		chain: 'ethereum',
		chainId: ETHEREUM_CHAIN_ID,
		keyPresent: Boolean(apiKey),
		url: redactedUrl,
		httpStatus: response.status,
		status: payload.status,
		message: payload.message,
	});

	if (!response.ok) {
		throw new Error(`Etherscan V2 HTTP error (ethereum): ${response.status}`);
	}
	if (!payload || typeof payload !== 'object') {
		throw new Error('Etherscan V2 error (ethereum): malformed payload');
	}
	if (payload.status === '0' && payload.message !== 'No transactions found') {
		const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
		throw new Error(`Etherscan V2 error (ethereum): ${payload.message ?? 'unknown error'} | result=${details}`);
	}
	return payload;
}

function buildEthereumUrl(params: ScanParams) {
	const apiKey = import.meta.env.ETHERSCAN_API_KEY;
	if (!apiKey) throw new Error('Missing ETHERSCAN_API_KEY');
	const query = new URLSearchParams({ apikey: apiKey, chainid: String(ETHEREUM_CHAIN_ID) });
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			query.set(key, String(value));
		}
	}
	return `${ETHERSCAN_V2_BASE_URL}?${query.toString()}`;
}

function buildEtherscanUrl(chain: EtherscanChain, params: ScanParams) {
	const apiKey = import.meta.env.ETHERSCAN_API_KEY;
	if (!apiKey) throw new Error('Missing ETHERSCAN_API_KEY');
	const chainId = ETHERSCAN_CHAIN_IDS[chain];
	if (!chainId) throw new Error(`Unsupported Etherscan chain: ${chain}`);

	const query = new URLSearchParams({ apikey: apiKey, chainid: String(chainId) });
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			query.set(key, String(value));
		}
	}
	return `${ETHERSCAN_V2_BASE_URL}?${query.toString()}`;
}

function buildSnowtraceUrl(params: ScanParams) {
	const apiKey = import.meta.env.SNOWTRACE_API_KEY;
	if (!apiKey) throw new Error('Missing SNOWTRACE_API_KEY');
	const query = new URLSearchParams({ apikey: apiKey });
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
			txType: tx.to?.toLowerCase() === wallet.address ? 'incoming' : 'outgoing',
			status: tx.isError === '1' ? 'failed' : 'confirmed',
			feePaid: tx.gasUsed && tx.gasPrice ? (BigInt(tx.gasUsed) * BigInt(tx.gasPrice)).toString() : null,
			metadata: { source: 'scan_native' },
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
			txType: tx.to?.toLowerCase() === wallet.address ? 'token_in' : 'token_out',
			status: 'confirmed',
			metadata: { tokenName: tx.tokenName, source: 'scan_token' },
		});
	});

	return Array.from(transactions.values());
}
