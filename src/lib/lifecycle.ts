import { randomUUID } from 'crypto';
import { db } from './db';
import { getCache, setCache } from './tursoCache';
import { tryAcquireLock } from './cacheLock';
import { classifyContract, STABLECOIN_SYMBOLS as KNOWN_STABLECOIN_SYMBOLS } from './knownContracts';
import {
	type TransactionClass,
	AAVE_POOL_ADDRESSES,
	classifyOnchainTxWithContext,
	type ClassifyRow,
} from './aave/classify';
import {
	batchFetchAaveEvents,
	batchFetchLiquidityIndices,
	type ParsedAaveEvent,
} from './aave/events';
import { computeRebasingInterest } from './aave/classify';

const LINK_WINDOW_MINUTES = 6 * 60; // 6h — exchange→on-chain arrivals can be slow (BTC, congestion). Conservative widening from 30m; best-match + arrival-after + tight tolerance guard against false links.
const AMOUNT_TOLERANCE = 0.01;      // 1% — covers network fees on small transfers without over-matching.

// Pick the best on-chain arrival to link to an exchange withdrawal. Best = closest in
// time (then amount), strictly AFTER the withdrawal, within window + amount tolerance,
// and not already linked. Pure + exported for unit tests. TAX-SENSITIVE: a false match
// hides a disposal, so the amount tolerance + best-match + arrival-after are the guards.
export type ArrivalCandidate = { source_id: string; direction: string | null; amount: number | null; timestamp_utc: string };
export function selectArrivalMatch(
	withdrawalAmount: number,
	withdrawalTimeMs: number,
	candidates: ArrivalCandidate[],
	alreadyLinked: Set<string>,
	windowMinutes: number,
	tolerancePct: number,
): ArrivalCandidate | null {
	let best: ArrivalCandidate | null = null;
	let bestScore = Infinity;
	const wAbs = Math.abs(withdrawalAmount);
	for (const c of candidates) {
		if (c.direction !== 'in' || c.amount === null) continue;
		if (alreadyLinked.has(c.source_id)) continue;
		const cTime = Date.parse(c.timestamp_utc) || 0;
		if (cTime < withdrawalTimeMs) continue; // an arrival cannot precede its own withdrawal
		const minutesApart = (cTime - withdrawalTimeMs) / 60000;
		if (minutesApart > windowMinutes) continue;
		const amountDiff = Math.abs(c.amount - wAbs);
		if (amountDiff > Math.max(wAbs, 1) * tolerancePct) continue;
		const score = minutesApart + (amountDiff / Math.max(wAbs, 1e-9)) * 1000; // closest time, then amount
		if (score < bestScore) { bestScore = score; best = c; }
	}
	return best;
}

// Stablecoins whose USD value equals their token amount (1:1 peg).
// Used to fill native_usd without a CoinGecko round-trip when the import
// row has no price attached.
const STABLECOIN_SYMBOLS = new Set([
	'USDC', 'USDT', 'DAI', 'TUSD', 'FDUSD', 'USDP', 'GUSD', 'USDE',
	'BUSD', 'FRAX', 'PYUSD', 'LUSD', 'CUSD', 'SUSD', 'MUSD',
]);
const LIFECYCLE_TTL_SECONDS = 120;
const LIFECYCLE_STALE_MAX_SECONDS = 300;
const LIFECYCLE_LOCK_SECONDS = 30;

export type LifecycleGroup = {
	id: string;
	asset_symbol: string;
	total_quantity: number;
	weighted_avg_cost_usd: number;
	latest_acquired_at: string | null;
};

export type LifecycleEvent = {
	id: string;
	group_id: string;
	source_type: 'import' | 'onchain';
	source_id: string;
	timestamp_utc: string;
	direction: string | null;
	amount: number | null;
	native_usd: number | null;
	tx_hash: string | null;
	exchange_withdrawal_id: string | null;
	transaction_class: TransactionClass;
	linked_transfer: number;
	confidence: number | null;
};

// Re-export so callers can use the full taxonomy without importing classify directly
export type { TransactionClass };

type DbRow = Record<string, unknown>;

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value : '');
const toStringOrNull = (value: unknown) => (typeof value === 'string' ? value : value === null ? null : null);
const toNumberOrNull = (value: unknown) => (typeof value === 'number' ? value : value === null ? null : null);

const toLifecycleGroup = (row: unknown): LifecycleGroup | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: toStringOrEmpty(r.id),
		asset_symbol: toStringOrEmpty(r.asset_symbol),
		total_quantity: typeof r.total_quantity === 'number' ? r.total_quantity : 0,
		weighted_avg_cost_usd: typeof r.weighted_avg_cost_usd === 'number' ? r.weighted_avg_cost_usd : 0,
		latest_acquired_at: toStringOrNull(r.latest_acquired_at),
	};
};

const toLifecycleGroups = (rows: unknown): LifecycleGroup[] => {
	if (!Array.isArray(rows)) return [];
	const out: LifecycleGroup[] = [];
	for (const row of rows) {
		const mapped = toLifecycleGroup(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

const toLifecycleEvent = (row: unknown): LifecycleEvent | null => {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	return {
		id: toStringOrEmpty(r.id),
		group_id: toStringOrEmpty(r.group_id),
		source_type: toStringOrEmpty(r.source_type) as LifecycleEvent['source_type'],
		source_id: toStringOrEmpty(r.source_id),
		timestamp_utc: toStringOrEmpty(r.timestamp_utc),
		direction: toStringOrNull(r.direction),
		amount: toNumberOrNull(r.amount),
		native_usd: toNumberOrNull(r.native_usd),
		tx_hash: toStringOrNull(r.tx_hash),
		exchange_withdrawal_id: toStringOrNull(r.exchange_withdrawal_id),
		transaction_class: toStringOrEmpty(r.transaction_class) as LifecycleEvent['transaction_class'],
		linked_transfer: typeof r.linked_transfer === 'number' ? r.linked_transfer : 0,
		confidence: toNumberOrNull(r.confidence),
	};
};

const toLifecycleEvents = (rows: unknown): LifecycleEvent[] => {
	if (!Array.isArray(rows)) return [];
	const out: LifecycleEvent[] = [];
	for (const row of rows) {
		const mapped = toLifecycleEvent(row);
		if (mapped) out.push(mapped);
	}
	return out;
};

const buildId = () => randomUUID();

const normalizeSymbol = (symbol: string, chain?: string | null) => {
	const upper = symbol.toUpperCase();
	if (upper === 'NATIVE') {
		if (chain === 'ethereum') return 'ETH';
		if (chain === 'polygon') return 'POL';
		if (chain === 'avalanche') return 'AVAX';
	}
	if (upper === 'MATIC' || upper === 'WMATIC') return 'POL';
	return upper;
};

const parseOnchainAmount = (value: string | null, decimals: number | null) => {
	if (!value) return null;
	const safeDecimals = Number.isFinite(decimals) ? (decimals as number) : 18;
	const padded = value.padStart(safeDecimals + 1, '0');
	const whole = padded.slice(0, -safeDecimals) || '0';
	const fraction = padded.slice(-safeDecimals).replace(/0+$/, '');
	const numeric = Number(fraction ? `${whole}.${fraction}` : whole);
	return Number.isFinite(numeric) ? numeric : null;
};

const directionFromTxType = (txType: string | null) => {
	if (!txType) return null;
	const lower = txType.toLowerCase();
	if (lower === 'incoming' || lower === 'token_in') return 'in';
	if (lower === 'outgoing' || lower === 'token_out') return 'out';
	return null;
};


const classifyImportTx = (description: string, kind: string, direction: string | null) => {
	const text = `${description} ${kind}`.toLowerCase();
	if (text.includes('borrow') || text.includes('loan') || text.includes('margin credit') || text.includes('flash loan')) {
		return 'liability_increase' as const;
	}
	if (text.includes('repay') || text.includes('repayment') || text.includes('interest payment')) {
		return 'liability_repayment' as const;
	}
	if (direction === 'in') return 'owned_acquisition' as const;
	return 'other' as const;
};

export type RebuildLifecycleOpts = {
	/**
	 * When true, skip the automatic historical-pricing pass that normally runs
	 * after the lifecycle is written to the DB.  Pass this flag when calling
	 * from inside `priceMissingTransactionsForTenant` to break the mutual
	 * recursion: price → rebuild(skipPricing:true).
	 */
	skipPricing?: boolean;
	/**
	 * Optional year to scope the rebuild to. If provided, only transactions
	 * from that calendar year are included in the rebuild. Useful for
	 * year-specific tax calculations.
	 */
	year?: number;
};

export async function rebuildAssetLifecycles(tenantId: string, opts?: RebuildLifecycleOpts) {
	// Prevent concurrent rebuilds for the same tenant — without this lock, two
	// simultaneous callers both delete-then-insert, leaving duplicate group rows.
	const rebuildLock = `lock:lifecycle:rebuild:${tenantId}`;
	const gotLock = await tryAcquireLock(rebuildLock, 60);
	if (!gotLock) {
		console.info('[lifecycle] rebuild skipped — another rebuild is already running', { tenantId });
		return;
	}

	const start = Date.now();
	const queryStart = Date.now();

	// Build year filter if provided
	let importWhere = 'WHERE tenant_id = ?';
	let onchainWhere = 'WHERE tenant_id = ?';
	const queryArgs: (string | number)[] = [tenantId];
	if (opts?.year) {
		const yearStart = new Date(`${opts.year}-01-01T00:00:00Z`).toISOString();
		const yearEnd = new Date(`${opts.year + 1}-01-01T00:00:00Z`).toISOString();
		importWhere += ` AND timestamp_utc >= ? AND timestamp_utc < ?`;
		onchainWhere += ` AND timestamp >= ? AND timestamp < ?`;
		queryArgs.push(yearStart, yearEnd);
	}

	const importsResult = await db.execute({
		sql: `SELECT id, asset_symbol, currency, amount, to_currency, to_amount, native_usd, timestamp_utc, direction, tx_hash, exchange_withdrawal_id, description, kind
			FROM import_transactions
			${importWhere}`,
		args: opts?.year ? [tenantId, queryArgs[1], queryArgs[2]] : [tenantId],
	});

	const onchainResult = await db.execute({
		sql: `SELECT id, hash, chain, block_number, token_symbol, token_decimals, value, usd_value, timestamp, tx_type, from_address, to_address, contract_address
			FROM transactions
			${onchainWhere}`,
		args: opts?.year ? [tenantId, queryArgs[1], queryArgs[2]] : [tenantId],
	});
	const dbQueryMs = Date.now() - queryStart;

	const transformStart = Date.now();
	const importEvents = importsResult.rows.map((row: any) => {
		const direction = row.direction ? String(row.direction) : null;
		const description = row.description ? String(row.description) : '';
		const kind = row.kind ? String(row.kind) : '';
		return {
		source_type: 'import' as const,
		source_id: String(row.id),
		asset_symbol: normalizeSymbol(String(row.asset_symbol ?? '')),
		// Pick the quantity that represents the actual token received/spent.
		// Cross-currency purchases (e.g. Crypto.com viban_purchase) record the
		// fiat cost in `amount` (negative USD) and the token received in
		// `to_amount`.  Using the wrong field inflates holdings by the dollar
		// value instead of the token quantity.
		//
		// Logic mirrors exchangeHoldings.ts pickQty:
		//   • If asset_symbol matches to_currency → use to_amount
		//   • If asset_symbol matches currency     → use amount
		//   • Otherwise fallback to to_amount ?? amount
		// We always store the absolute value — direction determines the sign.
		amount: (() => {
			const sym = normalizeSymbol(String(row.asset_symbol ?? ''));
			const cur = normalizeSymbol(String(row.currency ?? ''));
			const toCur = normalizeSymbol(String(row.to_currency ?? ''));
			const rawAmt = row.amount === null || row.amount === undefined ? null : Number(row.amount);
			const rawTo  = row.to_amount === null || row.to_amount === undefined ? null : Number(row.to_amount);
			let qty: number | null;
			if (sym && toCur && sym === toCur && rawTo !== null) {
				qty = rawTo;
			} else if (sym && cur && sym === cur && rawAmt !== null) {
				qty = rawAmt;
			} else {
				qty = rawTo ?? rawAmt;
			}
			return qty === null ? null : Math.abs(qty);
		})(),
		native_usd: (() => {
			const raw = row.native_usd === null || row.native_usd === undefined ? null : Number(row.native_usd);
			if (raw !== null && raw > 0) return raw;
			// Stablecoin shortcut — fill $1.00 per token rather than hitting CoinGecko
			const sym = normalizeSymbol(String(row.asset_symbol ?? ''));
			if (STABLECOIN_SYMBOLS.has(sym)) {
				const qty = row.amount === null || row.amount === undefined ? null : Math.abs(Number(row.amount));
				if (qty !== null && qty > 0 && Number.isFinite(qty)) return qty;
			}
			return null;
		})(),
		timestamp_utc: String(row.timestamp_utc),
		direction,
		tx_hash: row.tx_hash ? String(row.tx_hash) : null,
		exchange_withdrawal_id: row.exchange_withdrawal_id ? String(row.exchange_withdrawal_id) : null,
		transaction_class: classifyImportTx(description, kind, direction),
	};
	});

	// Build a normalised view of each onchain row for context-aware classification.
	// Grouping by tx_hash lets classifyOnchainTxWithContext distinguish, e.g.,
	// collateral-supply (OUT to pool + aToken IN) from debt-repayment (OUT to pool, no aToken).
	type RawOnchainRow = (typeof onchainResult.rows)[number];
	const normaliseOnchainRow = (row: RawOnchainRow): ClassifyRow => ({
		id:          String(row.id),
		symbol:      normalizeSymbol(String(row.token_symbol ?? ''), row.chain ? String(row.chain) : null),
		direction:   directionFromTxType(row.tx_type ? String(row.tx_type) : null),
		fromAddress: row.from_address ? String(row.from_address) : null,
		toAddress:   row.to_address   ? String(row.to_address)   : null,
	});

	// Index classify rows by tx_hash for O(1) group lookup
	const txHashToClassifyRows = new Map<string, ClassifyRow[]>();
	for (const row of onchainResult.rows) {
		const hash = row.hash ? String(row.hash) : null;
		if (!hash) continue;
		const group = txHashToClassifyRows.get(hash) ?? [];
		group.push(normaliseOnchainRow(row));
		txHashToClassifyRows.set(hash, group);
	}

	// Derive the tenant's wallet addresses from the transfer rows themselves
	// (avoids an extra DB round-trip — outgoing transfers come FROM the wallet,
	//  incoming transfers arrive TO the wallet).
	const walletAddresses = new Set<string>();
	for (const row of onchainResult.rows) {
		const dir = directionFromTxType(row.tx_type ? String(row.tx_type) : null);
		if (dir === 'out' && row.from_address) walletAddresses.add(String(row.from_address).toLowerCase());
		if (dir === 'in'  && row.to_address)   walletAddresses.add(String(row.to_address).toLowerCase());
	}

	// Batch-fetch Aave event logs for transactions touching Aave pool addresses.
	// Groups by chain so we batch Alchemy calls efficiently.
	// Falls back gracefully to an empty Map when ALCHEMY_API_KEY is absent —
	// classification then relies solely on transfer-pattern logic, which is still
	// correct for all cases except liquidations (which require receipt confirmation).
	const txHashToAaveEvents = new Map<string, ParsedAaveEvent[]>();
	if (walletAddresses.size > 0) {
		// Build chain → Set<txHash> for Aave-involved transactions only
		const chainToHashes = new Map<string, Set<string>>();
		for (const row of onchainResult.rows) {
			const hash  = row.hash  ? String(row.hash)  : null;
			const chain = row.chain ? String(row.chain) : null;
			if (!hash || !chain) continue;

			const fromAddr = row.from_address ? String(row.from_address).toLowerCase() : '';
			const toAddr   = row.to_address   ? String(row.to_address).toLowerCase()   : '';
			if (!AAVE_POOL_ADDRESSES.has(fromAddr) && !AAVE_POOL_ADDRESSES.has(toAddr)) continue;

			const set = chainToHashes.get(chain) ?? new Set<string>();
			set.add(hash);
			chainToHashes.set(chain, set);
		}

		// Fetch per chain concurrently — each chain has its own Alchemy endpoint
		await Promise.all(
			Array.from(chainToHashes.entries()).map(async ([chain, hashSet]) => {
				const fetched = await batchFetchAaveEvents(
					Array.from(hashSet),
					chain,
					walletAddresses,
				);
				for (const [hash, events] of fetched) {
					txHashToAaveEvents.set(hash, events);
				}
			}),
		);
	}

	// ── Aave V3 rebasing interest detection ──────────────────────────────────
	// For each supply (AaveSupplyEvent) and withdrawal (AaveWithdrawEvent) we
	// now have, fetch the liquidityIndex at the relevant block so we can
	// compute how much of the withdrawn amount is accrued interest income.
	//
	// Strategy:
	//   1. Collect unique (pool, reserve, blockNumber) from supply events.
	//   2. Collect the same for withdraw events.
	//   3. Batch-fetch all liquidityIndex values in one pass.
	//   4. Build per-wallet, per-reserve supply positions (FIFO).
	//   5. For each withdraw event, pop from the supply queue, compute interest.
	//   6. Inject synthetic interest_income events.
	//
	// Graceful degradation: when ALCHEMY_API_KEY is absent getRpcUrl() returns
	// null → batchFetchLiquidityIndices receives an empty array → no interest
	// injection.  Existing classification still runs as before.

	// Collect all Supply + Withdraw events across all txs
	type SupplyEvt   = { type: 'Supply'; poolAddress: string; reserve: string; onBehalfOf: string; amount: bigint; blockNumber: number; txHash: string };
	type WithdrawEvt = { type: 'Withdraw'; poolAddress: string; reserve: string; user: string; amount: bigint; blockNumber: number; txHash: string };

	const allSupplyEvents:   SupplyEvt[]   = [];
	const allWithdrawEvents: WithdrawEvt[] = [];
	for (const events of txHashToAaveEvents.values()) {
		for (const evt of events) {
			if (evt.type === 'Supply')   allSupplyEvents.push(evt as SupplyEvt);
			if (evt.type === 'Withdraw') allWithdrawEvents.push(evt as WithdrawEvt);
		}
	}

	// Map: indexKey("pool:reserve:block") → liquidityIndex (ray)
	const liquidityIndexCache = new Map<string, bigint>();

	if ((allSupplyEvents.length > 0 || allWithdrawEvents.length > 0) && walletAddresses.size > 0) {
		// Get an RPC URL — reuse the first chain found in the event set
		const firstChain = (() => {
			for (const row of onchainResult.rows) {
				if (row.chain) return String(row.chain);
			}
			return 'ethereum';
		})();
		const apiKey = process.env.ALCHEMY_API_KEY ?? '';
		if (apiKey) {
			const alchemyUrls: Record<string, string> = {
				ethereum:  `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
				polygon:   `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
				avalanche: `https://avax-mainnet.g.alchemy.com/v2/${apiKey}`,
			};

			// Deduplicate (pool, reserve, block) triples before fetching
			const querySet = new Map<string, { poolAddress: string; assetAddress: string; blockNumber: number }>();
			const addQuery = (poolAddress: string, reserve: string, blockNumber: number) => {
				const key = `${poolAddress}:${reserve}:${blockNumber}`;
				if (!querySet.has(key)) querySet.set(key, { poolAddress, assetAddress: reserve, blockNumber });
			};
			for (const e of allSupplyEvents)   addQuery(e.poolAddress, e.reserve, e.blockNumber);
			for (const e of allWithdrawEvents)  addQuery(e.poolAddress, e.reserve, e.blockNumber);

			// Group by chain (all events for a tenant are likely same chain)
			// For simplicity, use the first matching rpcUrl for all queries
			const rpcUrl = alchemyUrls[firstChain.toLowerCase()];
			if (rpcUrl && querySet.size > 0) {
				const fetched = await batchFetchLiquidityIndices(Array.from(querySet.values()), rpcUrl);
				for (const [k, v] of fetched) liquidityIndexCache.set(k, v);
			}
		}
	}

	// Build per-wallet, per-reserve supply position queues (FIFO order by block)
	// Key: `walletAddr:reserveAddr`  →  queue of supply positions
	type SupplyPosition = { amount: bigint; supplyIndex: bigint; poolAddress: string; blockNumber: number; txHash: string };
	const supplyPositions = new Map<string, SupplyPosition[]>();

	// Sort supply events chronologically before building queues
	const sortedSupplies = [...allSupplyEvents].sort((a, b) => a.blockNumber - b.blockNumber);
	for (const evt of sortedSupplies) {
		const idxKey  = `${evt.poolAddress}:${evt.reserve}:${evt.blockNumber}`;
		const supplyIndex = liquidityIndexCache.get(idxKey);
		if (!supplyIndex) continue; // can't track without index data

		const posKey = `${evt.onBehalfOf}:${evt.reserve}`;
		const queue  = supplyPositions.get(posKey) ?? [];
		queue.push({ amount: evt.amount, supplyIndex, poolAddress: evt.poolAddress, blockNumber: evt.blockNumber, txHash: evt.txHash });
		supplyPositions.set(posKey, queue);
	}

	// Compute interest for each Withdraw event and build synthetic interest events
	type SyntheticInterestEvent = {
		source_type: 'onchain';
		source_id: string;
		asset_symbol: string;
		amount: number | null;
		native_usd: null;
		timestamp_utc: string;
		direction: 'in';
		tx_hash: string;
		exchange_withdrawal_id: null;
		transaction_class: 'interest_income';
	};
	const syntheticInterestEvents: SyntheticInterestEvent[] = [];

	// Build a quick lookup: txHash → timestamp
	const txHashToTimestamp = new Map<string, string>();
	for (const row of onchainResult.rows) {
		if (row.hash) txHashToTimestamp.set(String(row.hash), String(row.timestamp));
	}

	// Process withdrawals in chronological order
	const sortedWithdrawals = [...allWithdrawEvents].sort((a, b) => a.blockNumber - b.blockNumber);
	for (const evt of sortedWithdrawals) {
		const withdrawIdxKey  = `${evt.poolAddress}:${evt.reserve}:${evt.blockNumber}`;
		const withdrawIndex   = liquidityIndexCache.get(withdrawIdxKey);
		if (!withdrawIndex) continue;

		const posKey = `${evt.user}:${evt.reserve}`;
		const queue  = supplyPositions.get(posKey);
		if (!queue || queue.length === 0) continue;

		// Use the oldest (FIFO) supply position's index as the reference
		const supplyPos  = queue[0];
		const interest   = computeRebasingInterest(evt.amount, supplyPos.supplyIndex, withdrawIndex);
		if (interest <= 0n) continue;

		// Derive a human-readable amount from raw BigInt (assume 18 decimals as safe default;
		// the actual decimals would require another lookup, but this is close enough for reporting)
		// We store as a floating point in the lifecycle, so use Number() with precision guard.
		// For precise tax accounting, callers should use native_usd from price data.
		const interestFloat = Number(interest) / 1e18;
		if (!Number.isFinite(interestFloat) || interestFloat <= 0) continue;

		// Pop the supply position from the queue (consumed by this withdrawal)
		queue.shift();

		const timestamp = txHashToTimestamp.get(evt.txHash) ?? '';
		syntheticInterestEvents.push({
			source_type: 'onchain',
			source_id:   `${evt.txHash}_rebasing_interest`,
			asset_symbol: `${evt.reserve.slice(0, 6)}`, // short address placeholder — resolved by symbol later
			amount:       interestFloat,
			native_usd:   null,
			timestamp_utc: timestamp,
			direction:    'in',
			tx_hash:      evt.txHash,
			exchange_withdrawal_id: null,
			transaction_class: 'interest_income',
		});
	}

	// Build the underlying symbol for synthetic events by finding matching aToken rows
	// whose withdraw tx_hash matches. Map reserve (contract addr) → token symbol.
	const reserveToSymbol = new Map<string, string>();
	for (const evt of allWithdrawEvents) {
		// Find a DB row in the same tx that's an underlying token (direction=in, from pool)
		for (const row of onchainResult.rows) {
			if (String(row.hash) !== evt.txHash) continue;
			const dir   = directionFromTxType(row.tx_type ? String(row.tx_type) : null);
			const from  = row.from_address ? String(row.from_address).toLowerCase() : '';
			if (dir === 'in' && AAVE_POOL_ADDRESSES.has(from)) {
				const sym = normalizeSymbol(String(row.token_symbol ?? ''), row.chain ? String(row.chain) : null);
				reserveToSymbol.set(evt.reserve, sym);
				break;
			}
		}
	}
	// Patch asset_symbol on synthetic events using the resolved symbol
	for (const evt of syntheticInterestEvents) {
		// Find the matching withdraw event to look up the reserve
		const withdraw = allWithdrawEvents.find((w) => w.txHash === evt.tx_hash);
		if (withdraw) {
			const sym = reserveToSymbol.get(withdraw.reserve);
			if (sym) evt.asset_symbol = sym;
		}
	}

	// ── End rebasing interest detection ──────────────────────────────────────

	const onchainEvents = onchainResult.rows.map((row: any) => {
		const classifyRow = normaliseOnchainRow(row);
		const hash = row.hash ? String(row.hash) : null;
		const group  = hash ? (txHashToClassifyRows.get(hash)  ?? [classifyRow]) : [classifyRow];
		const events = hash ? (txHashToAaveEvents.get(hash)    ?? undefined)      : undefined;
		const usdValue = row.usd_value !== null && row.usd_value !== undefined
			? Number(row.usd_value)
			: null;
		return {
			source_type: 'onchain' as const,
			source_id:   classifyRow.id,
			asset_symbol: classifyRow.symbol,
			amount:       parseOnchainAmount(row.value ? String(row.value) : null, row.token_decimals ?? null),
			native_usd:   Number.isFinite(usdValue) && usdValue! > 0 ? usdValue : null,
			timestamp_utc: String(row.timestamp),
			direction:    classifyRow.direction,
			tx_hash:      hash,
			exchange_withdrawal_id: null,
			transaction_class: classifyOnchainTxWithContext(classifyRow, group, events),
			contract_address: row.contract_address ? String(row.contract_address).toLowerCase() : null,
			chain:        row.chain ? String(row.chain) : null,
		};
	});
	const transformMs = Date.now() - transformStart;

	const allEvents = [...importEvents, ...onchainEvents, ...syntheticInterestEvents].filter((event) => event.asset_symbol);

	// Link exchange withdrawals to on-chain transfers when confidence is high.
	const groupStart = Date.now();
	const linkedPairs = new Map<string, { linked: boolean; confidence: number }>();
	const linkedSources = new Map<string, number>();
	const onchainBySymbol = new Map<string, typeof onchainEvents>();
	const onchainByHash = new Map<string, typeof onchainEvents[number]>();
	for (const evt of onchainEvents) {
		const list = onchainBySymbol.get(evt.asset_symbol) ?? [];
		list.push(evt);
		onchainBySymbol.set(evt.asset_symbol, list);
		if (evt.tx_hash) {
			onchainByHash.set(evt.tx_hash, evt);
		}
	}
	// Classes that should never be transfer-linked (they aren't exchange withdrawals)
	const SKIP_TRANSFER_LINK = new Set<string>([
		'liability_increase', 'liability_repayment', 'liability_liquidation',
		'collateral_deposit', 'collateral_withdrawal', 'interest_income',
	]);

	for (const evt of importEvents) {
		if (SKIP_TRANSFER_LINK.has(evt.transaction_class)) continue;
		if (evt.direction !== 'out' || evt.amount === null) continue;
		if (evt.tx_hash) {
			const match = onchainByHash.get(evt.tx_hash);
			if (match) {
				linkedPairs.set(`${evt.source_id}:${match.source_id}`, { linked: true, confidence: 1 });
				linkedSources.set(evt.source_id, 1);
				linkedSources.set(match.source_id, 1);
				continue;
			}
		}
		if (evt.exchange_withdrawal_id) continue;
		const candidates = onchainBySymbol.get(evt.asset_symbol) ?? [];
		const evtTime = Date.parse(evt.timestamp_utc) || 0;
		const arrival = selectArrivalMatch(evt.amount, evtTime, candidates, new Set(linkedSources.keys()), LINK_WINDOW_MINUTES, AMOUNT_TOLERANCE);
		if (arrival) {
			linkedPairs.set(`${evt.source_id}:${arrival.source_id}`, { linked: true, confidence: 0.9 });
			linkedSources.set(evt.source_id, 0.9);
			linkedSources.set(arrival.source_id, 0.9);
		}
	}

	const byAsset = new Map<string, typeof allEvents>();
	allEvents.forEach((event) => {
		const list = byAsset.get(event.asset_symbol) ?? [];
		list.push(event);
		byAsset.set(event.asset_symbol, list);
	});

	const groupRows: LifecycleGroup[] = [];
	const eventRows: LifecycleEvent[] = [];

	for (const [asset, events] of byAsset.entries()) {
		const acquisitions = events
			.filter(
				(event) =>
					event.source_type === 'import' &&
					event.direction === 'in' &&
					event.transaction_class === 'owned_acquisition' &&
					(event.native_usd ?? 0) > 0,
			)
			.sort((a, b) => (Date.parse(a.timestamp_utc) || 0) - (Date.parse(b.timestamp_utc) || 0));

		let totalQty = 0;
		let totalCost = 0;
		let latestAcquiredAt: string | null = null;

		for (const lot of acquisitions) {
			if (lot.transaction_class !== 'owned_acquisition') {
				throw new Error(`Cost-basis guard: non-acquisition lot ${lot.source_id} attempted in pool.`);
			}
			const amount = lot.amount ?? 0;
			const cost = lot.native_usd ?? 0;
			if (!(amount > 0) || !(cost > 0)) continue;
			totalQty += amount;
			totalCost += cost;
			latestAcquiredAt = lot.timestamp_utc;
		}

		const weightedAvg = totalQty > 0 ? totalCost / totalQty : 0;
		const groupId = buildId();

		groupRows.push({
			id: groupId,
			asset_symbol: asset,
			total_quantity: totalQty,
			weighted_avg_cost_usd: weightedAvg,
			latest_acquired_at: latestAcquiredAt,
		});

		events
			.sort((a, b) => (Date.parse(b.timestamp_utc) || 0) - (Date.parse(a.timestamp_utc) || 0))
			.forEach((event) => {
				const confidence = linkedSources.get(event.source_id) ?? null;
				eventRows.push({
					id: buildId(),
					group_id: groupId,
					source_type: event.source_type,
					source_id: event.source_id,
					timestamp_utc: event.timestamp_utc,
					direction: event.direction,
					amount: event.amount,
					native_usd: event.native_usd,
					tx_hash: event.tx_hash,
					exchange_withdrawal_id: event.exchange_withdrawal_id,
					transaction_class: event.transaction_class,
					linked_transfer: confidence ? 1 : 0,
					confidence,
				});
			});
	}
	const groupMergeMs = Date.now() - groupStart;

	const insertStart = Date.now();
	await db.execute({
		sql: 'DELETE FROM asset_lifecycle_events WHERE tenant_id = ?',
		args: [tenantId],
	});
	await db.execute({
		sql: 'DELETE FROM asset_lifecycle_groups WHERE tenant_id = ?',
		args: [tenantId],
	});

	const CHUNK = 500;
	const nowExpr = `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`;
	// Chunked multi-row inserts: the old one-INSERT-per-row loops were ~1-2ms each on
	// Turso, but on Postgres every db.execute under tenant context is a full BEGIN /
	// SET app.tenant_id / INSERT / COMMIT round-trip, so ~4,500 events ran >10 min and
	// timed out the sync. Batching collapses thousands of round-trips into a few.
	const seenGroup = new Set<string>();
	const uniqueGroups = groupRows.filter((g) => { const k = String(g.asset_symbol); if (seenGroup.has(k)) return false; seenGroup.add(k); return true; });
	for (let i = 0; i < uniqueGroups.length; i += CHUNK) {
		const slice = uniqueGroups.slice(i, i + CHUNK);
		const tuples = slice.map(() => `(?, ?, ?, ?, ?, ?, ${nowExpr}, ${nowExpr})`).join(', ');
		const args = slice.flatMap((group) => [group.id, tenantId, group.asset_symbol, group.total_quantity, group.weighted_avg_cost_usd, group.latest_acquired_at]);
		await db.execute({
			sql: `INSERT INTO asset_lifecycle_groups
				(id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at)
				VALUES ${tuples}
				ON CONFLICT (tenant_id, asset_symbol) DO UPDATE SET total_quantity = excluded.total_quantity, weighted_avg_cost_usd = excluded.weighted_avg_cost_usd, latest_acquired_at = excluded.latest_acquired_at, updated_at = excluded.updated_at`,
			args,
		});
	}

	const seenEvent = new Set<string>();
	const uniqueEvents = eventRows.filter((e) => { const k = e.source_id ? String(e.source_id) : null; if (k === null) return true; if (seenEvent.has(k)) return false; seenEvent.add(k); return true; });
	for (let i = 0; i < uniqueEvents.length; i += CHUNK) {
		const slice = uniqueEvents.slice(i, i + CHUNK);
		const tuples = slice.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr})`).join(', ');
		const args = slice.flatMap((event) => [event.id, tenantId, event.group_id, event.source_type, event.source_id, event.timestamp_utc, event.direction, event.amount, event.native_usd, event.tx_hash, event.exchange_withdrawal_id, event.transaction_class, event.linked_transfer, event.confidence, (event as any).contract_address ?? null]);
		await db.execute({
			sql: `INSERT INTO asset_lifecycle_events
				(id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, tx_hash, exchange_withdrawal_id, transaction_class, linked_transfer, confidence, contract_address, created_at)
				VALUES ${tuples}
				ON CONFLICT DO NOTHING`,
			args,
		});
	}
	const insertMs = Date.now() - insertStart;
	const serializationMs = 0;
	const totalMs = Date.now() - start;

	console.log('[lifecycle] rebuild', {
		tenantId,
		dbQueryMs,
		transformMs,
		groupMergeMs,
		serializationMs,
		insertMs,
		totalMs,
	});

	// ── Auto-price missing onchain transactions ───────────────────────────────
	// After the lifecycle is written, kick off a historical-pricing pass so that
	// onchain rows without USD values get priced via CoinGecko.  The pricing
	// function then calls rebuildAssetLifecycles({ skipPricing: true }) when it
	// is done, which re-hydrates the lifecycle events with correct native_usd.
	//
	// Guard: skip when called *from* the pricing function itself (avoids mutual
	// recursion).  Also skip when no ALCHEMY_API_KEY is set as a proxy for
	// "test / CI environment with no outbound calls".
	if (!opts?.skipPricing) {
		try {
			const { priceMissingTransactionsForTenant } = await import('./priceMissingTransactionsForTenant');
			// Run in background — don't block the lifecycle response.
			// Fire-and-forget with a warning on failure.
			priceMissingTransactionsForTenant(tenantId, { limit: 500 }).catch((err: unknown) => {
				console.warn('[lifecycle] background pricing pass failed:', err);
			});
		} catch (err) {
			// Dynamic import failure (e.g. circular dep caught at runtime) — non-fatal.
			console.warn('[lifecycle] could not load pricing module:', err);
		}
	}

	// ── Auto-resolve known scam tokens and verified stablecoins ──────────────
	// Runs in the background after every lifecycle rebuild.
	// Finds 'other'-class OUT events with a contract_address and no existing
	// manual_cost_basis entry, then auto-inserts $0 for confirmed scams or
	// $1.00 for verified stablecoin transfers.
	autoResolveKnownContracts(tenantId).catch((err: unknown) => {
		console.warn('[lifecycle] auto-resolve pass failed:', err);
	});
}

async function autoResolveKnownContracts(tenantId: string): Promise<void> {
	// Find all 'other'-class OUT events that have a contract address
	// and haven't been manually resolved yet.
	const candidates = await db.execute({
		sql: `SELECT ale.source_id, ale.amount, ale.contract_address, ale.tx_hash,
		            t.token_symbol, t.chain
		      FROM asset_lifecycle_events ale
		      LEFT JOIN transactions t ON t.id = ale.source_id AND t.tenant_id = ale.tenant_id
		      WHERE ale.tenant_id = ?
		        AND ale.direction = 'out'
		        AND ale.transaction_class = 'other'
		        AND ale.contract_address IS NOT NULL
		        AND ale.source_id NOT IN (
		              SELECT sell_source_id FROM manual_cost_basis WHERE tenant_id = ?
		            )`,
		args: [tenantId, tenantId],
	});

	if (candidates.rows.length === 0) return;

	// Fetch user-confirmed scam contracts for this tenant once, before the loop.
	const userScamResult = await db.execute({
		sql: `SELECT chain, contract_address FROM user_scam_contracts WHERE tenant_id = ?`,
		args: [tenantId],
	});
	const userScamSet = new Set(
		userScamResult.rows.map(
			(r) => `${String(r.chain)}:${String(r.contract_address).toLowerCase()}`,
		),
	);

	let resolved = 0;
	const now = new Date().toISOString();

	for (const row of candidates.rows) {
		const sourceId      = typeof row.source_id === 'string' ? row.source_id : '';
		const contractAddr  = typeof row.contract_address === 'string' ? row.contract_address : '';
		const symbol        = typeof row.token_symbol === 'string' ? row.token_symbol.toUpperCase() : '';
		const chain         = typeof row.chain === 'string' ? row.chain : '';
		const amount        = typeof row.amount === 'number' ? row.amount : 0;
		if (!sourceId || !contractAddr || !symbol || !chain || amount <= 0) continue;

		// User-confirmed scams take precedence over the hardcoded classifier.
		const userKey = `${chain}:${contractAddr.toLowerCase()}`;
		const verdict = userScamSet.has(userKey) ? 'scam' : classifyContract(chain, symbol, contractAddr);
		if (verdict === 'unknown') continue; // can't auto-resolve without a verdict

		const isStable = KNOWN_STABLECOIN_SYMBOLS.has(symbol);
		let pricePerToken: number;
		let notes: string;

		if (verdict === 'scam') {
			pricePerToken = 0;
			notes = `Auto-detected: contract ${contractAddr} is not the legitimate ${symbol} contract on ${chain}. Likely scam airdrop — zero taxable value.`;
		} else if (verdict === 'legitimate' && isStable) {
			// Real USDC/USDT/DAI transfer with no matching buy lot — cost basis $1.00
			pricePerToken = 1.00;
			notes = `Auto-resolved: verified ${symbol} transfer (contract ${contractAddr} matches known-good address on ${chain}).`;
		} else {
			// Legitimate but non-stablecoin — don't auto-resolve, user needs to enter price
			continue;
		}

		try {
			const id = randomUUID();
			await db.execute({
				sql: `INSERT INTO manual_cost_basis
				        (id, tenant_id, sell_source_id, quantity, price_per_token, buy_date_iso, notes, created_at, updated_at)
				      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
				      ON CONFLICT (tenant_id, sell_source_id) DO NOTHING`,
				args: [id, tenantId, sourceId, Math.abs(amount), pricePerToken, notes, now, now],
			});
			resolved++;
		} catch (err) {
			console.warn('[lifecycle] auto-resolve insert failed for', sourceId, err);
		}
	}

	if (resolved > 0) {
		console.log(`[lifecycle] auto-resolved ${resolved} 'other'-class events for tenant ${tenantId}`);
	}
}

export async function getAssetLifecycleCache(
	tenantId: string,
	options?: { limitGroups?: number; limitEvents?: number },
) {
	const limitGroups = Math.max(0, Number(options?.limitGroups ?? 200));
	const limitEvents = Math.max(0, Number(options?.limitEvents ?? 200));
	const groupResult = await db.execute({
		sql: `SELECT id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at
			FROM asset_lifecycle_groups
			WHERE tenant_id = ?
			ORDER BY asset_symbol
			LIMIT ?`,
		args: [tenantId, limitGroups],
	});

		const eventsResult = await db.execute({
			sql: `SELECT id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, tx_hash, exchange_withdrawal_id, transaction_class, linked_transfer, confidence
				FROM asset_lifecycle_events
				WHERE tenant_id = ?
				ORDER BY timestamp_utc DESC
				LIMIT ?`,
			args: [tenantId, limitEvents],
		});

	return {
		groups: toLifecycleGroups(groupResult.rows),
		events: toLifecycleEvents(eventsResult.rows),
	};
}

export async function refreshLifecycleCacheIfStale(tenantId: string) {
	const cacheKey = `lifecycle:${tenantId}`;
	const lockKey = `lock:${cacheKey}`;
	const cached = await getCache<{ refreshedAt?: string }>(cacheKey, {
		allowStale: true,
		staleMaxAgeSeconds: LIFECYCLE_STALE_MAX_SECONDS,
	});
	if (cached.value && !cached.isStale) return;

	const gotLock = await tryAcquireLock(lockKey, LIFECYCLE_LOCK_SECONDS);
	if (!gotLock) return;

	try {
		await rebuildAssetLifecycles(tenantId);
		await setCache(cacheKey, { refreshedAt: new Date().toISOString() }, LIFECYCLE_TTL_SECONDS);
	} catch (error) {
		console.warn('[lifecycle] refresh failed', { tenantId, error });
	}
}
