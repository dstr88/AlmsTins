import { randomUUID } from 'crypto';
import { db } from './db';
import { getCache, setCache } from './tursoCache';
import { tryAcquireLock } from './cacheLock';
import {
	type TransactionClass,
	AAVE_POOL_ADDRESSES,
	classifyOnchainTxWithContext,
	type ClassifyRow,
} from './aave/classify';
import {
	batchFetchAaveEvents,
	type ParsedAaveEvent,
} from './aave/events';

const LINK_WINDOW_MINUTES = 30;
const AMOUNT_TOLERANCE = 0.005; // 0.5% tolerance
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

export async function rebuildAssetLifecycles(tenantId: string) {
	const start = Date.now();
	const queryStart = Date.now();
	const importsResult = await db.execute({
		sql: `SELECT id, asset_symbol, amount, native_usd, timestamp_utc, direction, tx_hash, exchange_withdrawal_id, description, kind
			FROM import_transactions
			WHERE tenant_id = ?`,
		args: [tenantId],
	});

	const onchainResult = await db.execute({
		sql: `SELECT id, hash, chain, token_symbol, token_decimals, value, timestamp, tx_type, from_address, to_address
			FROM transactions
			WHERE tenant_id = ?`,
		args: [tenantId],
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
		amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
		native_usd: row.native_usd === null || row.native_usd === undefined ? null : Number(row.native_usd),
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

	const onchainEvents = onchainResult.rows.map((row: any) => {
		const classifyRow = normaliseOnchainRow(row);
		const hash = row.hash ? String(row.hash) : null;
		const group  = hash ? (txHashToClassifyRows.get(hash)  ?? [classifyRow]) : [classifyRow];
		const events = hash ? (txHashToAaveEvents.get(hash)    ?? undefined)      : undefined;
		return {
			source_type: 'onchain' as const,
			source_id:   classifyRow.id,
			asset_symbol: classifyRow.symbol,
			amount:       parseOnchainAmount(row.value ? String(row.value) : null, row.token_decimals ?? null),
			native_usd:   null,
			timestamp_utc: String(row.timestamp),
			direction:    classifyRow.direction,
			tx_hash:      hash,
			exchange_withdrawal_id: null,
			transaction_class: classifyOnchainTxWithContext(classifyRow, group, events),
		};
	});
	const transformMs = Date.now() - transformStart;

	const allEvents = [...importEvents, ...onchainEvents].filter((event) => event.asset_symbol);

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
		for (const candidate of candidates) {
			if (candidate.direction !== 'in' || candidate.amount === null) continue;
			const candidateTime = Date.parse(candidate.timestamp_utc) || 0;
			const minutesApart = Math.abs(candidateTime - evtTime) / (60 * 1000);
			if (minutesApart > LINK_WINDOW_MINUTES) continue;
			const amountDiff = Math.abs(candidate.amount - Math.abs(evt.amount));
			const tolerance = Math.max(Math.abs(evt.amount), 1) * AMOUNT_TOLERANCE;
			if (amountDiff > tolerance) continue;
			linkedPairs.set(`${evt.source_id}:${candidate.source_id}`, { linked: true, confidence: 0.9 });
			linkedSources.set(evt.source_id, 0.9);
			linkedSources.set(candidate.source_id, 0.9);
			break;
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

	for (const group of groupRows) {
		await db.execute({
			sql: `INSERT INTO asset_lifecycle_groups
				(id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			args: [
				group.id,
				tenantId,
				group.asset_symbol,
				group.total_quantity,
				group.weighted_avg_cost_usd,
				group.latest_acquired_at,
			],
		});
	}

	for (const event of eventRows) {
			await db.execute({
				sql: `INSERT INTO asset_lifecycle_events
					(id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, tx_hash, exchange_withdrawal_id, transaction_class, linked_transfer, confidence, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
				args: [
					event.id,
					tenantId,
					event.group_id,
					event.source_type,
					event.source_id,
					event.timestamp_utc,
					event.direction,
					event.amount,
					event.native_usd,
					event.tx_hash,
					event.exchange_withdrawal_id,
					event.transaction_class,
					event.linked_transfer,
					event.confidence,
				],
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
