import { db } from '@/lib/db';
import type { Wallet } from '@/lib/wallets';
import { getAllActiveWallets } from '@/lib/wallets';
import { bulkUpsertTransactions } from '@/lib/transactions';
import { buildScanUrl, fetchAccountData, fetchEthereumScan, type ScanChain } from '@/lib/scanSync';
import { walletSyncRows, type WalletSyncEvmChain } from '@/lib/sync/evmSyncRows';
import type { SupportedChain } from '@/lib/constants';
import { DEFAULT_ERC20_CHAINS } from '@/lib/constants';
import { fetchAndStoreAaveLiquidations } from '@/lib/sync/syncAaveLiquidations';
import { WALLET_SYNC_EVM_CHAINS, normalizeChain } from '@/lib/chains';
import { isEvmAddress } from '@/lib/addressFormats';

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
	/** Rows of the internal-transactions listing (coin a contract moved), on EVM chains. */
	fetchedInternal?: number;
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
	/**
	 * Set when the wallet was not read at all because its address is not an EVM address (a custom
	 * wallet's `custom_…`, a Solana or Bitcoin address). Not a failure: there is nothing to read.
	 */
	skippedReason?: 'not_evm_address';
	/** Set when the wallet failed before any chain was read. */
	error?: string;
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

type ListingAction = 'txlist' | 'txlistinternal' | 'tokentx';
const LISTINGS: readonly ListingAction[] = ['txlist', 'txlistinternal', 'tokentx'];

/**
 * One listing's rows from an explorer answer. "No transactions found" (and a call skipped for a
 * missing API key) is an empty listing; anything else that is not a list of rows (NOTOK, a rate
 * limit) throws, so the cursor never moves past rows that were not read.
 */
export function listingRows(payload: unknown, chain: string, action: ListingAction): Array<Record<string, unknown>> {
	const p = (payload && typeof payload === 'object' ? payload : {}) as { status?: unknown; message?: unknown; result?: unknown };
	if (Array.isArray(p.result)) return p.result as Array<Record<string, unknown>>;
	const message = String(p.message ?? '');
	const result = typeof p.result === 'string' ? p.result : '';
	if (/no transactions found/i.test(message) || /no transactions found/i.test(result) || message === 'skipped') return [];
	throw new Error(`Scan API error (${chain} ${action}): ${message || 'unknown'}${result ? `: ${result.slice(0, 120)}` : ''}`);
}

type ListingRead = { action: ListingAction; rows: Array<Record<string, unknown>>; complete: boolean };

/** Reads one listing from `startBlock` on, oldest first, page by page until a short page or the page limit. */
async function readListing(chain: ScanChain, address: string, action: ListingAction, startBlock: number): Promise<ListingRead> {
	const rows: Array<Record<string, unknown>> = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const task: SyncTask = {
			provider: chain === 'avalanche' ? 'snowtrace' : 'etherscan',
			chain,
			params: { module: 'account', action, address, startblock: startBlock, endblock: 9999999999, page, offset: MAX_OFFSET, sort: 'asc' },
		};
		const pageRows = await readPage(task, chain, action);
		rows.push(...pageRows);
		if (pageRows.length < MAX_OFFSET) return { action, rows, complete: true };
	}
	return { action, rows, complete: false };
}

/** One page of a listing, tried again after a pause when the explorer answers with a rate limit. */
async function readPage(task: SyncTask, chain: ScanChain, action: ListingAction) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return listingRows(await executeTask(task), chain, action);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/rate limit/i.test(message) || attempt >= RATE_LIMIT_RETRIES) throw error;
			await sleep(RATE_LIMIT_BACKOFFS[attempt] ?? 3200);
		}
	}
}

/**
 * The blocks every listing was read through. A listing that hit the page limit may have cut its
 * last block short, so only the blocks before that one are kept (from every listing, so a
 * transaction's rows are read whole: its legs are named by counting identical rows in it). The
 * next sync starts from the first block not kept. Null when every listing was read to the end.
 */
export function readThroughBlock(reads: readonly ListingRead[]): number | null {
	let through: number | null = null;
	for (const r of reads) {
		if (r.complete || !r.rows.length) continue;
		const last = Math.max(...r.rows.map((row) => Number(row.blockNumber) || 0));
		through = through === null ? last - 1 : Math.min(through, last - 1);
	}
	return through;
}

/**
 * Fetches the wallet's rows on `chain` newer than the cursor: all three listings (coin,
 * internal, tokens), each read whole, turned into one row per movement by walletSyncRows.
 */
export async function fetchTransactionsSince(wallet: Wallet, chain: ScanChain, marker: WalletSyncCursor) {
	const address = (wallet.address?.trim?.() || wallet.address).toLowerCase();
	const startBlock = Math.max(0, marker.block ?? 0) + 1;
	console.log('[SYNC] cursor', { walletId: wallet.id, chain, startBlock, lastBlock: marker.block ?? 0 });

	const reads: ListingRead[] = [];
	for (const action of LISTINGS) reads.push(await readListing(chain, address, action, startBlock));

	let through = readThroughBlock(reads);
	if (through !== null && through < startBlock) {
		// One block holds more rows than a listing can page through: keep what was read rather than stall.
		console.warn('[SYNC] a block fills a listing past its page limit; keeping the rows read', { walletId: wallet.id, chain });
		through = null;
	}
	const keep = (rows: Array<Record<string, unknown>>) => (through === null ? rows : rows.filter((r) => Number(r.blockNumber) <= through!));
	const [txlist, txlistinternal, tokentx] = reads.map((r) => keep(r.rows));

	const { rows, unreadable } = walletSyncRows(chain as WalletSyncEvmChain, { id: wallet.id, address }, { txlist, txlistinternal, tokentx });
	if (unreadable) console.warn('[SYNC] listing rows that could not be read were left out', { walletId: wallet.id, chain, unreadable });

	let highestBlock = marker.block ?? 0;
	let highestTimestamp: string | null = marker.timestamp ?? null;
	for (const tx of rows) {
		highestBlock = Math.max(highestBlock, tx.blockNumber ?? 0);
		if (!highestTimestamp || tx.timestamp.getTime() > new Date(highestTimestamp).getTime()) highestTimestamp = tx.timestamp.toISOString();
	}
	if (through !== null) highestBlock = Math.max(highestBlock, through);

	return {
		txs: rows,
		highestBlock,
		highestTimestamp,
		fetchedNative: txlist.length,
		fetchedInternal: txlistinternal.length,
		fetchedToken: tokentx.length,
	};
}

/**
 * Syncs a single wallet + chain combination.
 */
export async function syncWalletChain(tenantId: string, wallet: Wallet, chain: string): Promise<WalletSyncChainStats> {
	const normalizedChain = walletSyncChain(chain);
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
	const { txs, highestBlock, highestTimestamp, fetchedNative, fetchedInternal, fetchedToken } = await fetchTransactionsSince(
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
		fetchedInternal,
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
const EVM_CHAINS: ReadonlySet<string> = new Set(WALLET_SYNC_EVM_CHAINS);

export async function syncWalletTransactions(tenantId: string, wallet: Wallet): Promise<WalletSyncStats> {
	// The explorers read only 0x addresses. A custom wallet (`custom_…`, entries added by hand) or a
	// Solana, Bitcoin or Sui address got "Invalid address format" back on every sync.
	if (!isEvmAddress(wallet.address)) {
		console.info(`[SYNC] skipping wallet ${wallet.id}: its address is not an EVM address`);
		return { walletId: wallet.id, totalInserted: 0, totalSkipped: 0, chains: [], skippedReason: 'not_evm_address' };
	}
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
			perWallet.push({
				walletId: wallet.id,
				totalInserted: 0,
				totalSkipped: 0,
				chains: [],
				error: error instanceof Error ? error.message : 'sync_failed',
			});
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

/** The chain name if the EVM sync reads it (aliases such as 'eth' and 'matic' included), else null. */
function walletSyncChain(chain: string): SupportedChain | null {
	const c = normalizeChain(chain);
	return EVM_CHAINS.has(c) ? (c as SupportedChain) : null;
}

type SyncTask = {
	provider: 'etherscan' | 'snowtrace';
	chain: ScanChain;
	params: Record<string, string | number>;
};

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
