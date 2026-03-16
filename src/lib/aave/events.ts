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

import { AAVE_POOL_ADDRESSES, type LiquidationCallEvent, type ParsedAaveEvent } from './classify';

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
 * Aave V3 Pool Withdraw event — used as a secondary signal:
 *   topics[1] → reserve (indexed)
 *   topics[2] → user    (indexed)
 *   topics[3] → to      (indexed)
 *   data word[0] → amount (uint256)
 */
export const TOPIC_WITHDRAW =
	'0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7';

// Re-export so callers can import event types from either module
export type { LiquidationCallEvent, ParsedAaveEvent } from './classify';

// ---------------------------------------------------------------------------
// Raw JSON-RPC receipt shape
// ---------------------------------------------------------------------------

export type RpcLog = {
	address: string;
	topics:  string[];
	data:    string;
	transactionHash: string;
};

type RpcReceiptResult = { logs: RpcLog[] } | null;

// ---------------------------------------------------------------------------
// Receipt fetching
// ---------------------------------------------------------------------------

/**
 * Fetch an Ethereum transaction receipt via JSON-RPC.
 * Returns null if the call fails or the RPC URL is unavailable.
 */
export async function fetchTxReceipt(
	txHash: string,
	rpcUrl: string,
	signal?: AbortSignal,
): Promise<RpcLog[] | null> {
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
		return json.result?.logs ?? null;
	} catch {
		return null;
	}
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
 * Parse all Aave-relevant events from a list of receipt logs.
 *
 * @param logs             Raw log entries from eth_getTransactionReceipt
 * @param walletAddresses  Lowercase wallet addresses for this tenant — used to
 *                         filter LiquidationCall events to only those affecting
 *                         the tracked user (event.user ∈ walletAddresses).
 */
export function parseAaveLogsFromReceipt(
	logs: RpcLog[],
	walletAddresses: Set<string>,
): ParsedAaveEvent[] {
	const events: ParsedAaveEvent[] = [];

	for (const log of logs) {
		const topic0 = log.topics[0]?.toLowerCase();

		// ── LiquidationCall ──────────────────────────────────────────────────
		if (topic0 === TOPIC_LIQUIDATION_CALL) {
			const parsed = parseLiquidationCallLog(log);
			// Only include if the liquidated user is one of our tracked wallets
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
				const logs = await fetchTxReceipt(hash, rpcUrl, signal);
				const events = logs ? parseAaveLogsFromReceipt(logs, walletAddresses) : [];
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
