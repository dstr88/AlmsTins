import { db } from '@/lib/db';
import type { Wallet } from '@/lib/wallets';
import { getAllActiveWallets } from '@/lib/wallets';
import { bulkUpsertTransactions, type NewTransaction } from '@/lib/transactions';
import {
	buildScanUrl,
	fetchAccountData,
	fetchEthereumScan,
	normalizeScanResults,
	type ScanChain,
	type ScanTx,
} from '@/lib/scanSync';
import type { SupportedChain } from '@/lib/constants';
import { DEFAULT_ERC20_CHAINS } from '@/lib/constants';
import { fetchAndStoreAaveLiquidations } from '@/lib/sync/syncAaveLiquidations';

const MAX_OFFSET = 100;
const MAX_PAGES = 100;
const ETHERSCAN_MIN_DELAY_MS = 700;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFFS = [800, 1600, 3200];
let lastEtherscanCallAt = 0;

export type WalletSyncCursor = {
	block: number;
	timestamp: string | null;
};

export type WalletSyncChainStats = {
	walletId: string;
	chain: string;
	fetched: number;
	fetchedNative: number;
	fetchedToken: number;
	inserted: number;
	skipped: number;
	highestBlock: number;
	highestTimestamp: string | null;
	error?: string | null;
	ok?: boolean;
};

export type WalletSyncStats = {
	walletId: string;
	totalInserted: number;
	totalSkipped: number;
	chains: WalletSyncChainStats[];
};

export type AllWalletSyncStats = {
	totalWallets: number;
	totalInserted: number;
	totalSkipped: number;
	perWallet: WalletSyncStats[];
};

/**
 * Fetches the last synced block/timestamp cursor for a wallet + chain.
 */
export async function getLastSyncedCursorForWallet(
	tenantId: string,
	walletId: string,
	chain: string,
): Promise<WalletSyncCursor> {
	try {
		const result = await db.execute({
			sql: `SELECT last_block_number, last_timestamp
        FROM wallet_sync_state
        WHERE wallet_id = ? AND chain = ? AND tenant_id = ?
        LIMIT 1`,
			args: [walletId, chain, tenantId],
		});

		if (!result.rows.length) {
			return { block: 0, timestamp: null };
		}

		const row = result.rows[0] as Record<string, any>;
		return {
			block: Number(row.last_block_number ?? 0) || 0,
			timestamp: row.last_timestamp ?? null,
		};
	} catch (error) {
		console.error(`Failed reading sync cursor for wallet ${walletId} (${chain})`, error);
		return { block: 0, timestamp: null };
	}
}

/**
 * Upserts the last synced cursor for a wallet + chain.
 */
export async function updateLastSyncedCursorForWallet(
	tenantId: string,
	walletId: string,
	chain: string,
	cursor: { block: number; timestamp?: string | null },
) {
	await db.execute({
		sql: `INSERT INTO wallet_sync_state (tenant_id, wallet_id, chain, last_block_number, last_timestamp, last_run_at)
        VALUES (?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
        ON CONFLICT(tenant_id, wallet_id, chain) DO UPDATE SET
          last_block_number = excluded.last_block_number,
          last_timestamp = excluded.last_timestamp,
          last_run_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
		args: [tenantId, walletId, chain, cursor.block ?? 0, cursor.timestamp ?? null],
	});
}

/**
 * Fetches transactions newer than the provided marker for a wallet + chain, handling pagination.
 */
export async function fetchTransactionsSince(wallet: Wallet, chain: ScanChain, marker: WalletSyncCursor) {
	const aggregated: NewTransaction[] = [];
	let highestBlock = marker.block ?? 0;
	let highestTimestamp: string | null = marker.timestamp ?? null;
	const seenKeys = new Set<string>();
	const startTimestampMs = marker.timestamp ? new Date(marker.timestamp).getTime() : null;
	let fetchedNative = 0;
	let fetchedToken = 0;
	const address = wallet.address?.trim?.() || wallet.address;
	console.log('[SYNC] cursor', {
		walletId: wallet.id,
		chain,
		address,
		startBlock: Math.max(0, marker.block ?? 0) + 1,
		endBlock: 9999999999,
		lastBlock: marker.block ?? 0,
		lastTimestamp: marker.timestamp ?? null,
	});

	for (let page = 1; page <= MAX_PAGES; page++) {
		const commonParams = {
			module: 'account',
			address,
			startblock: Math.max(0, marker.block ?? 0) + 1,
			endblock: 9999999999,
			page,
			offset: MAX_OFFSET,
			sort: 'asc' as const,
		};

		const tasks: SyncTask[] = [
			{ provider: chain === 'avalanche' ? 'snowtrace' : 'etherscan', chain, params: { ...commonParams, action: 'txlist' } },
			{ provider: chain === 'avalanche' ? 'snowtrace' : 'etherscan', chain, params: { ...commonParams, action: 'tokentx' } },
		];

		const [nativeResp, tokenResp] = await executeTasksSequential(tasks);

		const nativeTxs = Array.isArray(nativeResp.result) ? (nativeResp.result as ScanTx[]) : [];
		const tokenTxs = Array.isArray(tokenResp.result) ? (tokenResp.result as ScanTx[]) : [];
		fetchedNative += nativeTxs.length;
		fetchedToken += tokenTxs.length;

		if (!nativeTxs.length && !tokenTxs.length) {
			break;
		}

		const normalized = normalizeScanResults(nativeTxs, tokenTxs, chain, wallet);
		let pageOldestBlock = Number.MAX_SAFE_INTEGER;
		let pageOldestTimestamp: number | null = null;

		normalized.sort((a, b) => {
			const blockDiff = (a.blockNumber ?? 0) - (b.blockNumber ?? 0);
			if (blockDiff !== 0) return blockDiff;
			return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
		});

		for (const tx of normalized) {
			const blockNum = tx.blockNumber ?? 0;
			pageOldestBlock = Math.min(pageOldestBlock, blockNum);
			const txTimestampMs = new Date(tx.timestamp).getTime();
			pageOldestTimestamp = pageOldestTimestamp === null ? txTimestampMs : Math.min(pageOldestTimestamp, txTimestampMs);

			if (blockNum <= marker.block) continue;
			if (startTimestampMs && txTimestampMs <= startTimestampMs) continue;

			const key = `${tx.hash}-${tx.chain}-${tx.tokenSymbol ?? 'native'}`;
			if (seenKeys.has(key)) continue;
			seenKeys.add(key);

			aggregated.push(tx);
			highestBlock = Math.max(highestBlock, blockNum);
			if (!highestTimestamp || txTimestampMs > new Date(highestTimestamp).getTime()) {
				highestTimestamp = new Date(tx.timestamp).toISOString();
			}
		}

		const nativeFullPage = nativeTxs.length === MAX_OFFSET;
		const tokenFullPage = tokenTxs.length === MAX_OFFSET;
		if (!nativeFullPage && !tokenFullPage) {
			// Neither endpoint returned a full page of results, so we likely exhausted the range.
			break;
		}

		if (pageOldestBlock <= marker.block) {
			break;
		}
		if (startTimestampMs && pageOldestTimestamp !== null && pageOldestTimestamp <= startTimestampMs) {
			break;
		}
	}

	return { txs: aggregated, highestBlock, highestTimestamp, fetchedNative, fetchedToken };
}

/**
 * Syncs a single wallet + chain combination.
 */
export async function syncWalletChain(tenantId: string, wallet: Wallet, chain: string): Promise<WalletSyncChainStats> {
	const normalizedChain = normalizeChain(chain);
	if (!normalizedChain) {
		console.warn(`Skipping unsupported chain "${chain}" for wallet ${wallet.id}`);
		return {
			walletId: wallet.id,
			chain,
			fetched: 0,
			fetchedNative: 0,
			fetchedToken: 0,
			inserted: 0,
			skipped: 0,
			highestBlock: 0,
			highestTimestamp: null,
			error: 'unsupported_chain',
			ok: false,
		};
	}

	const marker = await getLastSyncedCursorForWallet(tenantId, wallet.id, normalizedChain);
	const { txs, highestBlock, highestTimestamp, fetchedNative, fetchedToken } = await fetchTransactionsSince(
		wallet,
		normalizedChain,
		marker,
	);

	let inserted = 0;
	let skipped = 0;

	if (txs.length) {
		const result = await bulkUpsertTransactions(tenantId, txs);
		inserted = result.length;
		skipped = txs.length - inserted;
		await updateLastSyncedCursorForWallet(tenantId, wallet.id, normalizedChain, {
			block: highestBlock,
			timestamp: highestTimestamp ?? marker.timestamp,
		});
	} else {
		await updateLastSyncedCursorForWallet(tenantId, wallet.id, normalizedChain, {
			block: marker.block,
			timestamp: marker.timestamp,
		});
	}

	// Fetch and store Aave liquidation events from The Graph subgraph.
	// Liquidations are executed by bots, so they never appear in the wallet's
	// own txlist — the subgraph is the only reliable source.
	try {
		const liqStats = await fetchAndStoreAaveLiquidations(tenantId, wallet, normalizedChain);
		if (liqStats.fetched > 0) {
			console.info(
				`[aaveLiquidations] wallet=${wallet.id} chain=${normalizedChain} fetched=${liqStats.fetched} inserted=${liqStats.inserted}`,
			);
		}
	} catch (liqError) {
		// Non-fatal: liquidation fetch failure should not block the normal tx sync
		console.warn(`[aaveLiquidations] failed for wallet ${wallet.id} on ${normalizedChain}`, liqError);
	}

	console.info(
		`Synced wallet ${wallet.id} (${wallet.address}) on ${normalizedChain}: fetched=${txs.length}, inserted=${inserted}, highestBlock=${highestBlock}`,
	);

	return {
		walletId: wallet.id,
		chain: normalizedChain,
		fetched: txs.length,
		fetchedNative,
		fetchedToken,
		inserted,
		skipped,
		highestBlock,
		highestTimestamp: highestTimestamp ?? marker.timestamp,
		ok: true,
	};
}

/**
 * Syncs all chains for a wallet and aggregates stats.
 */
const EVM_CHAINS = new Set(['ethereum', 'polygon', 'avalanche']);

export async function syncWalletTransactions(tenantId: string, wallet: Wallet): Promise<WalletSyncStats> {
	const baseChains =
		Array.isArray(wallet.chains) && wallet.chains.length ? wallet.chains : [...DEFAULT_ERC20_CHAINS];
	const chainSet = new Set(baseChains.map((value) => value.toLowerCase()));
	chainSet.add('polygon');
	// Only pass EVM chains to the EVM sync machinery — non-EVM chains (bitcoin, sui, etc.)
	// have their own dedicated sync endpoints and would throw "Unsupported chain" here.
	const chains = Array.from(chainSet).filter(c => EVM_CHAINS.has(c));
	const stats: WalletSyncChainStats[] = [];
	let totalInserted = 0;
	let totalSkipped = 0;

	for (const chain of chains) {
		try {
			const chainStats = await syncWalletChain(tenantId, wallet, chain);
			stats.push(chainStats);
			totalInserted += chainStats.inserted;
			totalSkipped += chainStats.skipped;
		} catch (error) {
			console.error(`Failed to sync wallet ${wallet.id} on chain ${chain}`, error);
			stats.push({
				walletId: wallet.id,
				chain,
				fetched: 0,
				fetchedNative: 0,
				fetchedToken: 0,
				inserted: 0,
				skipped: 0,
				highestBlock: 0,
				highestTimestamp: null,
				error: error instanceof Error ? error.message : 'sync_failed',
				ok: false,
			});
		}
	}

	return {
		walletId: wallet.id,
		totalInserted,
		totalSkipped,
		chains: stats,
	};
}

/**
 * Syncs every active wallet in the system and returns aggregate stats.
 */
export async function syncAllWallets(tenantId: string): Promise<AllWalletSyncStats> {
	const wallets = await getAllActiveWallets(tenantId);
	const perWallet: WalletSyncStats[] = [];
	let totalInserted = 0;
	let totalSkipped = 0;

	for (const wallet of wallets) {
		try {
			const stats = await syncWalletTransactions(tenantId, wallet);
			perWallet.push(stats);
			totalInserted += stats.totalInserted;
			totalSkipped += stats.totalSkipped;
		} catch (error) {
			console.error(`Failed syncing wallet ${wallet.id}`, error);
		}
	}

	return {
		totalWallets: wallets.length,
		totalInserted,
		totalSkipped,
		perWallet,
	};
}

async function callScanApi(chain: ScanChain, params: Record<string, string | number>) {
	const apiKeyEnv =
		chain === 'avalanche' ? 'SNOWTRACE_API_KEY' : 'ETHERSCAN_API_KEY';
	const apiKeyPresent = chain === 'avalanche'
		? Boolean(import.meta.env.SNOWTRACE_API_KEY)
		: Boolean(import.meta.env.ETHERSCAN_API_KEY);
	const requestPath = `module=${params.module}&action=${params.action}&address=${params.address}&startblock=${params.startblock}&endblock=${params.endblock}&page=${params.page}&offset=${params.offset}&sort=${params.sort}`;

	// Use Etherscan V2 for supported chains; Snowtrace for Avalanche.
	if (chain === 'ethereum') {
		const payload = await fetchEthereumScan(params);
		console.log('[SCAN] provider=etherscan_v2', { chain, apiKeyEnv, apiKeyPresent });
		console.log('[SCAN] chain:', chain, 'path:', requestPath, 'status:', payload.status, 'message:', payload.message);
		return payload;
	}
	if (chain === 'polygon') {
		const payload = await fetchAccountData(chain, params);
		console.log('[SCAN] provider=etherscan_v2', { chain, apiKeyEnv, apiKeyPresent });
		console.log('[SCAN] chain:', chain, 'path:', requestPath, 'status:', payload.status, 'message:', payload.message);
		return payload;
	}

	const url = buildScanUrl(chain, params);
	if (!url) {
		console.warn('[SCAN] No URL for chain', chain, '— API key likely missing. Returning empty result.');
		return { status: '0', message: 'skipped', result: [] };
	}
	const response = await fetch(url);
	const payload = await response.json();
	const redactedUrl = url.replace(/apikey=[^&]+/i, 'apikey=[redacted]');
	console.log('[SCAN] provider=snowtrace', { chain, apiKeyEnv, apiKeyPresent, url: redactedUrl, httpStatus: response.status, path: requestPath });
	console.log('[SCAN] chain:', chain, 'url:', redactedUrl, 'status:', payload.status, 'message:', payload.message);
	if (!response.ok) {
		throw new Error(`Scan API HTTP error (${chain}): ${response.status}`);
	}
	if (payload.status === '0' && payload.message !== 'No transactions found') {
		throw new Error(`Scan API error (${chain}): ${payload.message ?? 'unknown error'}`);
	}
	return payload;
}

function normalizeChain(chain: string): SupportedChain | null {
	const lowered = chain?.toLowerCase?.() ?? '';
	if (lowered === 'ethereum' || lowered === 'eth' || lowered === 'mainnet') return 'ethereum';
	if (lowered === 'polygon' || lowered === 'matic') return 'polygon';
	if (lowered === 'avalanche' || lowered === 'avax') return 'avalanche';
	return null;
}

type SyncTask = {
	provider: 'etherscan' | 'snowtrace';
	chain: ScanChain;
	params: Record<string, string | number>;
};

async function executeTasksSequential(tasks: SyncTask[]) {
	const results = [];
	for (const task of tasks) {
		results.push(await executeTask(task));
	}
	return results;
}

async function executeTask(task: SyncTask) {
	if (task.provider === 'etherscan') {
		return executeEtherscanTask(task);
	}
	return callScanApi(task.chain, task.params);
}

async function executeEtherscanTask(task: SyncTask) {
	for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
		await enforceEtherscanDelay();
		try {
			return await callScanApi(task.chain, task.params);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const rateLimited = /rate limit/i.test(message);
			if (!rateLimited || attempt === RATE_LIMIT_RETRIES) {
				throw error;
			}
			await sleep(RATE_LIMIT_BACKOFFS[attempt] ?? 3200);
		}
	}
	throw new Error('Etherscan request failed after retries');
}

async function enforceEtherscanDelay() {
	const now = Date.now();
	const waitMs = Math.max(0, lastEtherscanCallAt + ETHERSCAN_MIN_DELAY_MS - now);
	if (waitMs > 0) {
		await sleep(waitMs);
	}
	lastEtherscanCallAt = Date.now();
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
