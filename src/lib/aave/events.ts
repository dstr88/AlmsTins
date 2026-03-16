/**
 * events.ts — Fetch and parse Aave event logs from tx receipts.
 *
 * Uses the existing ALCHEMY_API_KEY env var (same as alchemy.ts).
 * Zero extra dependencies — pure fetch + manual ABI decoding.
 *
 * Tax relevance:
 *   LiquidationCall → reclassify collateral outflow as 'liability_liquidation'
 *                     (forced sale: taxable capital gain/loss, NOT voluntary withdrawal)
 *
 * Supported chains:  ethereum · polygon · avalanche
 * Fallback:          if ALCHEMY_API_KEY is absent, batchFetchAaveEvents() resolves to
 *                    an empty Map and classification falls back to transfer-pattern logic.
 */

import {
	AAVE_POOL_ADDRESSES,
	RAY,
	type LiquidationCallEvent,
	type AaveSupplyEvent,
	type AaveWithdrawEvent,
	type ParsedAaveEvent,
} from './classify';

// ---------------------------------------------------------------------------
// Chain → Alchemy RPC URL
// ---------------------------------------------------------------------------

const ALCHEMY_URLS: Record<string, string> = {
	ethereum:  'https://eth-mainnet.g.alchemy.com/v2',
	polygon:   'https://polygon-mainnet.g.alchemy.com/v2',
	avalanche: 'https://avax-mainnet.g.alchemy.com/v2',
};

function getRpcUrl(chain: string): string | null {
	const apiKey = process.env.ALCHEMY_API_KEY ?? '';
	if (!apiKey) return null;
	const base = ALCHEMY_URLS[chain.toLowerCase()];
	return base ? `${base}/${apiKey}` : null;
}

// ---------------------------------------------------------------------------
// ABI decoding helpers — no external dependencies
// ---------------------------------------------------------------------------

/** Strip '0x' prefix from a hex string. */
function stripHex(hex: string): string {
	return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

/** Extract the Nth 32-byte (64 hex-char) word from ABI-encoded `data`. */
function word(data: string, n: number): string {
	const clean = stripHex(data);
	return clean.slice(n * 64, (n + 1) * 64).padStart(64, '0');
}

/** Parse a 32-byte word as a checksummed-lower Ethereum address. */
function parseAddress(w: string): string {
	return '0x' + w.slice(-40).toLowerCase();
}

/** Parse a 32-byte word as a BigInt (uint256). */
function parseUint256(w: string): bigint {
	return BigInt('0x' + w);
}

/** Parse a 32-byte word as a boolean (last byte != 0). */
function parseBool(w: string): boolean {
	return w.slice(-2) !== '00';
}

// ---------------------------------------------------------------------------
// Event topic constants
// ---------------------------------------------------------------------------

/**
 * keccak256("LiquidationCall(address,address,address,uint256,uint256,address,bool)")
 *
 * Verified against:
 *   • Aave V3 Pool source (github.com/aave/aave-v3-core)
 *   • Etherscan Event Logs filter on 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
 *
 * ABI layout:
 *   topics[1] → collateralAsset (indexed address)
 *   topics[2] → debtAsset       (indexed address)
 *   topics[3] → user            (indexed address)
 *   data word[0] → debtToCover                (uint256)
 *   data word[1] → liquidatedCollateralAmount  (uint256)
 *   data word[2] → liquidator                  (address, padded)
 *   data word[3] → receiveAToken               (bool)
 */
export const TOPIC_LIQUIDATION_CALL =
	'0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286';

/**
 * keccak256("Withdraw(address,address,address,uint256)")
 *
 * Aave V3 Pool Withdraw event:
 *   topics[1] → reserve (indexed)
 *   topics[2] → user    (indexed — wallet that withdrew)
 *   topics[3] → to      (indexed — recipient)
 *   data word[0] → amount (uint256 — underlying units; includes accrued interest)
 *
 * Same signature is used for both V2 and V3.
 */
export const TOPIC_WITHDRAW =
	'0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7';

/**
 * keccak256("Supply(address,address,address,uint256,uint16)")
 *
 * Aave V3 Pool Supply event:
 *   topics[1] → reserve    (indexed — underlying token, e.g. USDC)
 *   topics[2] → onBehalfOf (indexed — wallet receiving aToken)
 *   topics[3] → referralCode (indexed uint16)
 *   data word[0] → user    (non-indexed address — tx caller)
 *   data word[1] → amount  (uint256 — underlying units)
 *
 * Verified against Aave V3 Pool source (github.com/aave/aave-v3-core IPool.sol).
 */
export const TOPIC_SUPPLY =
	'0x2b627736bca15cd5381dcf80b0bf11fd197d62a23dd7b3e6d33c17375c5be930';

/**
 * keccak256("Deposit(address,address,address,uint256,uint16)")
 *
 * Aave V2 LendingPool Deposit event — same parameter layout as V3 Supply:
 *   topics[1] → reserve (indexed)
 *   topics[2] → onBehalfOf (indexed)
 *   topics[3] → referralCode (indexed)
 *   data[0] → user (non-indexed)
 *   data[1] → amount (uint256)
 */
export const TOPIC_DEPOSIT =
	'0xde6857219544bb5b7746f48ed30be6386fefc61b2f864cacf559893bf50fd951';

// Re-export so callers can import event types from either module
export type { LiquidationCallEvent, AaveSupplyEvent, AaveWithdrawEvent, ParsedAaveEvent } from './classify';
export { computeRebasingInterest, RAY } from './classify';

// ---------------------------------------------------------------------------
// Raw JSON-RPC receipt shape
// ---------------------------------------------------------------------------

export type RpcLog = {
	address: string;
	topics:  string[];
	data:    string;
	transactionHash: string;
};

type RpcReceiptResult = { blockNumber: string; logs: RpcLog[] } | null;

/** Full receipt returned by the internal fetcher. */
export type RpcReceipt = {
	blockNumber: number;
	logs: RpcLog[];
};

// ---------------------------------------------------------------------------
// Receipt fetching
// ---------------------------------------------------------------------------

/**
 * Internal: fetch a full transaction receipt (logs + blockNumber).
 * Returns null on network error or non-OK HTTP status.
 */
async function fetchRawReceipt(
	txHash: string,
	rpcUrl: string,
	signal?: AbortSignal,
): Promise<RpcReceipt | null> {
	try {
		const response = await fetch(rpcUrl, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id:      1,
				method:  'eth_getTransactionReceipt',
				params:  [txHash],
			}),
			signal,
		});

		if (!response.ok) return null;

		const json = (await response.json()) as { result: RpcReceiptResult };
		if (!json.result) return null;
		return {
			blockNumber: parseInt(json.result.blockNumber, 16) || 0,
			logs:        json.result.logs,
		};
	} catch {
		return null;
	}
}

/**
 * Fetch an Ethereum transaction receipt via JSON-RPC.
 * Returns null if the call fails or the RPC URL is unavailable.
 *
 * @deprecated Use fetchRawReceipt internally; this wrapper exists for
 *             backward-compatibility with callers that only need logs.
 */
export async function fetchTxReceipt(
	txHash: string,
	rpcUrl: string,
	signal?: AbortSignal,
): Promise<RpcLog[] | null> {
	const receipt = await fetchRawReceipt(txHash, rpcUrl, signal);
	return receipt?.logs ?? null;
}

// ---------------------------------------------------------------------------
// Log parsers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a single JSON-RPC log as a LiquidationCall event.
 * Returns null when the log is not a LiquidationCall (wrong topic or bad data).
 */
export function parseLiquidationCallLog(log: RpcLog): LiquidationCallEvent | null {
	if (!log.topics[0] || log.topics[0].toLowerCase() !== TOPIC_LIQUIDATION_CALL) {
		return null;
	}

	// topics[1..3] hold the three indexed addresses
	if (log.topics.length < 4) return null;

	const collateralAsset = parseAddress(stripHex(log.topics[1]));
	const debtAsset       = parseAddress(stripHex(log.topics[2]));
	const user            = parseAddress(stripHex(log.topics[3]));

	// data holds 4 words: debtToCover, liquidatedCollateralAmount, liquidator, receiveAToken
	const dataHex = stripHex(log.data);
	if (dataHex.length < 4 * 64) return null;

	const debtToCover                = parseUint256(word(log.data, 0));
	const liquidatedCollateralAmount = parseUint256(word(log.data, 1));
	const liquidator                 = parseAddress(word(log.data, 2));
	const receiveAToken              = parseBool(word(log.data, 3));

	return {
		type: 'LiquidationCall',
		collateralAsset,
		debtAsset,
		user,
		debtToCover,
		liquidatedCollateralAmount,
		liquidator,
		receiveAToken,
		txHash: log.transactionHash ?? '',
	};
}

/**
 * Attempt to parse a single log as an Aave V3 Supply (or V2 Deposit) event.
 *
 * ABI layout (V3 Supply / V2 Deposit — identical parameter structure):
 *   topics[1] = reserve    (indexed address)
 *   topics[2] = onBehalfOf (indexed address — aToken beneficiary)
 *   topics[3] = referralCode (indexed uint16)
 *   data[0]   = user       (non-indexed address — tx caller)
 *   data[1]   = amount     (uint256 — underlying units)
 */
export function parseSupplyLog(
	log: RpcLog,
	blockNumber: number,
): AaveSupplyEvent | null {
	const topic0 = log.topics[0]?.toLowerCase();
	if (topic0 !== TOPIC_SUPPLY && topic0 !== TOPIC_DEPOSIT) return null;
	if (log.topics.length < 4) return null;

	const dataHex = stripHex(log.data);
	if (dataHex.length < 2 * 64) return null;

	const reserve    = parseAddress(stripHex(log.topics[1]));
	const onBehalfOf = parseAddress(stripHex(log.topics[2]));
	const user       = parseAddress(word(log.data, 0));
	const amount     = parseUint256(word(log.data, 1));

	return {
		type:        'Supply',
		poolAddress: log.address.toLowerCase(),
		reserve,
		onBehalfOf,
		user,
		amount,
		blockNumber,
		txHash: log.transactionHash ?? '',
	};
}

/**
 * Attempt to parse a single log as an Aave V3 Withdraw event.
 *
 * ABI layout:
 *   topics[1] = reserve (indexed)
 *   topics[2] = user    (indexed — wallet that initiated the withdrawal)
 *   topics[3] = to      (indexed — recipient)
 *   data[0]   = amount  (uint256 — underlying; includes accrued interest)
 */
export function parseWithdrawLog(
	log: RpcLog,
	blockNumber: number,
): AaveWithdrawEvent | null {
	if (!log.topics[0] || log.topics[0].toLowerCase() !== TOPIC_WITHDRAW) return null;
	if (log.topics.length < 4) return null;

	const dataHex = stripHex(log.data);
	if (dataHex.length < 64) return null;

	const reserve = parseAddress(stripHex(log.topics[1]));
	const user    = parseAddress(stripHex(log.topics[2]));
	const to      = parseAddress(stripHex(log.topics[3]));
	const amount  = parseUint256(word(log.data, 0));

	return {
		type:        'Withdraw',
		poolAddress: log.address.toLowerCase(),
		reserve,
		user,
		to,
		amount,
		blockNumber,
		txHash: log.transactionHash ?? '',
	};
}

/**
 * Parse all Aave-relevant events from a list of receipt logs.
 *
 * Handles:
 *   - LiquidationCall → filtered by user ∈ walletAddresses
 *   - Supply / Deposit → filtered by onBehalfOf ∈ walletAddresses
 *   - Withdraw → filtered by user ∈ walletAddresses
 *
 * @param logs             Raw log entries from eth_getTransactionReceipt
 * @param walletAddresses  Lowercase wallet addresses for this tenant
 * @param blockNumber      Block in which the tx was confirmed (from receipt)
 */
export function parseAaveLogsFromReceipt(
	logs: RpcLog[],
	walletAddresses: Set<string>,
	blockNumber = 0,
): ParsedAaveEvent[] {
	const events: ParsedAaveEvent[] = [];

	for (const log of logs) {
		const topic0 = log.topics[0]?.toLowerCase();

		// ── LiquidationCall ──────────────────────────────────────────────────
		if (topic0 === TOPIC_LIQUIDATION_CALL) {
			const parsed = parseLiquidationCallLog(log);
			if (parsed && walletAddresses.has(parsed.user)) {
				events.push(parsed);
			}
			continue;
		}

		// ── Supply / Deposit (V3 / V2) ───────────────────────────────────────
		if (topic0 === TOPIC_SUPPLY || topic0 === TOPIC_DEPOSIT) {
			const parsed = parseSupplyLog(log, blockNumber);
			if (parsed && walletAddresses.has(parsed.onBehalfOf)) {
				events.push(parsed);
			}
			continue;
		}

		// ── Withdraw ─────────────────────────────────────────────────────────
		if (topic0 === TOPIC_WITHDRAW) {
			const parsed = parseWithdrawLog(log, blockNumber);
			if (parsed && walletAddresses.has(parsed.user)) {
				events.push(parsed);
			}
			continue;
		}
	}

	return events;
}

// ---------------------------------------------------------------------------
// Batch fetcher with concurrency control
// ---------------------------------------------------------------------------

const CONCURRENCY = 5;

/**
 * Batch-fetch Aave event logs for a set of tx hashes on the given chain.
 *
 * Internally: groups by chain → resolves RPC URL → fetches receipts with
 * concurrency ≤ 5 → parses logs → returns Map<txHash, ParsedAaveEvent[]>.
 *
 * Returns an empty Map (not an error) when:
 *   - ALCHEMY_API_KEY is missing
 *   - The chain has no known Alchemy endpoint
 *   - Individual receipts fail to fetch (they're skipped)
 */
export async function batchFetchAaveEvents(
	txHashes: string[],
	chain: string,
	walletAddresses: Set<string>,
	signal?: AbortSignal,
): Promise<Map<string, ParsedAaveEvent[]>> {
	const result = new Map<string, ParsedAaveEvent[]>();
	if (txHashes.length === 0) return result;

	const rpcUrl = getRpcUrl(chain);
	if (!rpcUrl) return result; // graceful degradation — no API key

	// Process in chunks to respect rate limits
	for (let i = 0; i < txHashes.length; i += CONCURRENCY) {
		if (signal?.aborted) break;

		const chunk = txHashes.slice(i, i + CONCURRENCY);
		const settled = await Promise.allSettled(
			chunk.map(async (hash) => {
				const receipt = await fetchRawReceipt(hash, rpcUrl, signal);
				const events = receipt
					? parseAaveLogsFromReceipt(receipt.logs, walletAddresses, receipt.blockNumber)
					: [];
				return { hash, events };
			}),
		);

		for (const outcome of settled) {
			if (outcome.status === 'fulfilled' && outcome.value.events.length > 0) {
				result.set(outcome.value.hash, outcome.value.events);
			}
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// eth_call infrastructure for on-chain index queries (zero extra dependencies)
// ---------------------------------------------------------------------------

/**
 * Function selector for Pool.getReserveData(address asset).
 * Aave V3: keccak256("getReserveData(address)")[0:4]
 * Verified against Aave V3 Pool source and Etherscan ABI.
 */
const SEL_GET_RESERVE_DATA = '0x35ea6a75';

/**
 * ABI-encode a calldata payload for a function that takes a single address arg.
 *   result = selector (4 bytes) + padded address (32 bytes)
 */
function encodeAddressCall(selector: string, addr: string): string {
	return selector + '000000000000000000000000' + stripHex(addr).toLowerCase().padStart(40, '0');
}

/**
 * Execute an eth_call at a specific block number.
 * Returns the raw hex result string, or null on error.
 */
async function ethCall(
	rpcUrl: string,
	to: string,
	data: string,
	blockNumber: number,
	signal?: AbortSignal,
): Promise<string | null> {
	const blockTag = '0x' + blockNumber.toString(16);
	try {
		const response = await fetch(rpcUrl, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id:      2,
				method:  'eth_call',
				params:  [{ to, data }, blockTag],
			}),
			signal,
		});
		if (!response.ok) return null;
		const json = (await response.json()) as { result?: string };
		const result = json.result ?? '';
		return result === '0x' || result === '' ? null : result;
	} catch {
		return null;
	}
}

/**
 * Fetch the liquidityIndex (a ray-scale uint128) from Aave's Pool.getReserveData()
 * at a specific historical block.
 *
 * Aave V3 ReserveData ABI layout (each field padded to 32 bytes in ABI encoding):
 *   word 0: configuration  (uint256)
 *   word 1: liquidityIndex (uint128) ← this is what we want
 *   word 2: currentLiquidityRate (uint128)
 *   ... (additional fields)
 *
 * Requires an archive node (Alchemy supports this for all supported chains).
 *
 * @param poolAddress  Aave pool contract (from AAVE_POOL_ADDRESSES)
 * @param assetAddress Underlying token address (e.g. USDC)
 * @param blockNumber  Block at which to query (supply block or withdraw block)
 * @param rpcUrl       Alchemy RPC URL (must include API key)
 * @returns            liquidityIndex as a BigInt (ray = 1e27 units), or null on failure
 */
export async function fetchLiquidityIndexAtBlock(
	poolAddress:  string,
	assetAddress: string,
	blockNumber:  number,
	rpcUrl:       string,
	signal?:      AbortSignal,
): Promise<bigint | null> {
	const data   = encodeAddressCall(SEL_GET_RESERVE_DATA, assetAddress);
	const result = await ethCall(rpcUrl, poolAddress, data, blockNumber, signal);
	if (!result) return null;

	// word 1 = liquidityIndex (uint128, ABI-padded to 32 bytes)
	const rawWord = word(result, 1);
	const index   = parseUint256(rawWord);
	return index > 0n ? index : null;
}

/**
 * Batch-fetch liquidityIndex values for a set of (pool, reserve, blockNumber) triples.
 *
 * Deduplicates identical (pool+reserve+block) queries and respects the same
 * CONCURRENCY limit as batchFetchAaveEvents.
 *
 * @param queries      Unique (pool, reserve, block) triples to query
 * @param rpcUrl       Alchemy RPC URL
 * @returns            Map keyed by "poolAddr:reserveAddr:blockNum" → liquidityIndex
 */
export async function batchFetchLiquidityIndices(
	queries: Array<{ poolAddress: string; assetAddress: string; blockNumber: number }>,
	rpcUrl:  string,
	signal?: AbortSignal,
): Promise<Map<string, bigint>> {
	const result = new Map<string, bigint>();
	if (queries.length === 0) return result;

	for (let i = 0; i < queries.length; i += CONCURRENCY) {
		if (signal?.aborted) break;

		const chunk = queries.slice(i, i + CONCURRENCY);
		const settled = await Promise.allSettled(
			chunk.map(async ({ poolAddress, assetAddress, blockNumber }) => {
				const key   = `${poolAddress}:${assetAddress}:${blockNumber}`;
				const index = await fetchLiquidityIndexAtBlock(poolAddress, assetAddress, blockNumber, rpcUrl, signal);
				return { key, index };
			}),
		);

		for (const outcome of settled) {
			if (outcome.status === 'fulfilled' && outcome.value.index !== null) {
				result.set(outcome.value.key, outcome.value.index);
			}
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Utility: identify which tx hashes in a group involve Aave pool addresses
// ---------------------------------------------------------------------------

/**
 * Given a map of txHash → ClassifyRows, return the hashes whose transfers
 * touch an Aave pool address.  These are candidates for receipt fetching.
 */
export function findAaveTxHashes(
	txHashToRows: Map<string, Array<{ fromAddress: string | null; toAddress: string | null }>>,
): string[] {
	const hashes: string[] = [];
	for (const [hash, rows] of txHashToRows) {
		const touched = rows.some((r) => {
			const from = (r.fromAddress ?? '').toLowerCase();
			const to   = (r.toAddress   ?? '').toLowerCase();
			return AAVE_POOL_ADDRESSES.has(from) || AAVE_POOL_ADDRESSES.has(to);
		});
		if (touched) hashes.push(hash);
	}
	return hashes;
}
