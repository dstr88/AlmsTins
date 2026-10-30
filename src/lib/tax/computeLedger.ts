/**
 * computeLedger.ts: run the lot ledger over a tenant's whole history, once, for every page.
 *
 * Bookkeeping, the Year Summary, Form 8949, the exports and the P&L figure all read their gains
 * and holdings from here, so they cannot disagree. Two adapters read the tenant's rows into ledger
 * events (ledgerAdapters/); the ledger core decides lots, moves, terms and findings.
 *
 *   'pipeline'   the tax pipeline's classification (yearEnd/classifyAll.ts: the same passes the
 *                owner's classify run uses, including the owner's manual classifications), read
 *                live rather than from the tables the last run left behind. Chosen for a tenant
 *                that has a successful pipeline run.
 *   'lifecycle'  the lifecycle events (asset_lifecycle_events), for everyone else.
 *
 * The whole history is always run, with a snapshot at the end of every year, so a year's sales,
 * unmatched remainders and holdings are slices of one computation. The result is kept for a short
 * while per tenant, engine, method and set of pins; a pipeline run, a lifecycle rebuild and an
 * import drop it (invalidateLedger).
 */

import { db } from '../db';
import { loadImportTransactions, loadManualClassifications, loadOnchainTransactions, loadWalletAddresses } from '../yearEnd/loaders';
import { classifyAll } from '../yearEnd/classifyAll';
import { getJurisdictionProfile } from '../jurisdictionProfile';
import { isOwner } from '../owner';
import { loadAllocationOverrides } from './allocationOverride';
import { loadIdentifications } from '../lotIdentificationStore';
import { selectionResolver } from './lotIdentification';
import { inPerWalletRollout, PER_WALLET_FROM, PER_WALLET_METHOD, PER_WALLET_ROLLOUT, UNIVERSAL_METHOD, type BasisMethod } from './basisMethod';
import { lifecycleToLedger, type LifecycleEventRow } from './ledgerAdapters/lifecycle';
import { pipelineToLedger } from './ledgerAdapters/pipeline';
import type { RefInfo } from './ledgerAdapters/shared';
import { loadLedgerContext, type LedgerContext } from './ledgerContext';
import { parseInstant } from './normalize';
import { runLotLedger, type AllocationOverride, type CostBasisMethod, type LedgerEvent, type LedgerResult } from './lotLedger';

export type LedgerEngine = 'lifecycle' | 'pipeline';

export interface ComputedLedger {
	engine: LedgerEngine;
	result: LedgerResult;
	/** The lot rule the run used: per wallet from 2025-01-01 (earlier years one pool), or one pool throughout. */
	basisMethod: BasisMethod;
	/** What the row behind each event was, by the event's sourceRef. */
	refs: Map<string, RefInfo>;
}

export type LotPins = Map<string, { acquiredAt: string; amountHint: number }>;

type Row = Record<string, unknown>;
const toStr = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));

// ── Which engine ─────────────────────────────────────────────────────────────

/** The engine a tenant's pages read from: the pipeline once it has run successfully, else the lifecycle. */
export async function engineForTenant(tenantId: string): Promise<LedgerEngine> {
	try {
		const res = await db.execute({
			sql: `/* tax:source */ SELECT 1 FROM tax_pipeline_runs WHERE tenant_id = ? AND status = 'success' LIMIT 1`,
			args: [tenantId],
		});
		return res.rows.length > 0 ? 'pipeline' : 'lifecycle';
	} catch {
		// tax_pipeline_runs may not exist
		return 'lifecycle';
	}
}

/**
 * Whether a tenant's sales from 2025-01-01 on are matched wallet by wallet (basisMethod.ts says who
 * is in the rollout). The jurisdiction is read only for a tenant the rollout could include.
 */
export async function perWalletEnabled(tenantId: string): Promise<boolean> {
	const owner = isOwner(tenantId);
	if (PER_WALLET_ROLLOUT === 'owner' && !owner) return false;
	const profile = await getJurisdictionProfile(tenantId);
	return inPerWalletRollout(owner, profile.jurisdiction);
}

// ── Lifecycle rows ───────────────────────────────────────────────────────────

/** The tenant's lifecycle events with the import or on-chain row each one came from, Sui and custom entries included. */
export async function loadLifecycleRows(tenantId: string): Promise<LifecycleEventRow[]> {
	const eventsResult = await db.execute({
		sql: `/* tax:ledger-events */ SELECT g.asset_symbol AS asset_symbol,
		             e.direction         AS direction,
		             e.amount            AS amount,
		             e.native_usd        AS native_usd,
		             e.timestamp_utc     AS timestamp_utc,
		             e.transaction_class AS transaction_class,
		             e.source_id         AS source_id,
		             e.group_id          AS group_id,
		             e.tx_hash           AS tx_hash,
		             e.source_type       AS source_type,
		             i.wallet_id         AS import_wallet_id,
		             i.source            AS import_source,
		             i.account_id        AS import_account_id,
		             i.kind              AS import_kind,
		             i.description       AS import_description,
		             i.import_batch_id   AS import_batch_id,
		             t.wallet_id         AS tx_wallet_id,
		             t.chain             AS tx_chain,
		             t.from_address      AS from_address,
		             t.to_address        AS to_address
		        FROM asset_lifecycle_events e
		        LEFT JOIN asset_lifecycle_groups g
		          ON g.id = e.group_id AND g.tenant_id = e.tenant_id
		        LEFT JOIN import_transactions i
		          ON e.source_type = 'import' AND i.id = e.source_id AND i.tenant_id = e.tenant_id
		        LEFT JOIN transactions t
		          ON e.source_type = 'onchain' AND t.id = e.source_id AND t.tenant_id = e.tenant_id
		       WHERE e.tenant_id = ?
		       ORDER BY e.timestamp_utc ASC`,
		args: [tenantId],
	});

	// Classes the lifecycle never lots. liability_increase covers both the debt token minted and the
	// borrow proceeds in from the pool: neither is a real owned lot. interest_income feeds the income
	// section separately.
	const SKIP_CLASSES = new Set(['liability_increase', 'interest_income']);
	const rows: LifecycleEventRow[] = (eventsResult.rows as unknown as LifecycleEventRow[]).filter(
		(r) => r && !SKIP_CLASSES.has(toStr(r.transaction_class)),
	);

	// Sui wallet transactions: no source row to join, so no wallet.
	const suiResult = await db.execute({
		sql: `/* tax:ledger-sui */ SELECT symbol, amount, decimals, timestamp
		        FROM sui_transactions
		       WHERE tenant_id = ?
		         AND CAST(amount AS REAL) != 0
		       ORDER BY timestamp ASC`,
		args: [tenantId],
	});
	const suiRawToDecimal = (raw: string, decimals: number): number => {
		try {
			const negative = raw.startsWith('-');
			const abs = BigInt(negative ? raw.slice(1) : raw);
			const base = 10n ** BigInt(decimals);
			const num = Number(`${abs / base}.${String(abs % base).padStart(decimals, '0')}`);
			return negative ? -num : num;
		} catch {
			return 0;
		}
	};
	for (const r of suiResult.rows as unknown as Row[]) {
		const value = suiRawToDecimal(toStr(r.amount), Number(r.decimals ?? 9));
		if (!value) continue;
		rows.push({
			asset_symbol: toStr(r.symbol).toUpperCase(), direction: value < 0 ? 'out' : 'in', amount: Math.abs(value), native_usd: null,
			timestamp_utc: toStr(r.timestamp), transaction_class: 'owned_acquisition', source_id: '', group_id: '', tx_hash: null, source_type: 'sui',
		});
	}

	// Custom wallet manual entries: stored in `transactions` with metadata_json isCustomEntry.
	const customResult = await db.execute({
		sql: `/* tax:ledger-custom */ SELECT token_symbol, tx_type, timestamp, metadata_json
		        FROM transactions
		       WHERE tenant_id = ?
		         AND metadata_json LIKE '%"isCustomEntry":true%'
		       ORDER BY timestamp ASC`,
		args: [tenantId],
	});
	for (const r of customResult.rows as unknown as Row[]) {
		try {
			const meta = JSON.parse(toStr(r.metadata_json));
			const amount = Number(meta.amount ?? 0);
			if (!amount) continue;
			rows.push({
				asset_symbol: toStr(r.token_symbol).toUpperCase(), direction: meta.direction === 'out' ? 'out' : 'in', amount,
				native_usd: typeof meta.usdValue === 'number' ? meta.usdValue : null, timestamp_utc: toStr(r.timestamp),
				transaction_class: 'owned_acquisition', source_id: '', group_id: '', tx_hash: null, source_type: 'manual',
			});
		} catch {
			// an entry that is not readable is left out, as it always has been
		}
	}

	return rows;
}

async function lifecycleEvents(tenantId: string, ctx: LedgerContext): Promise<{ events: LedgerEvent[]; refs: Map<string, RefInfo> }> {
	return lifecycleToLedger({
		events: await loadLifecycleRows(tenantId),
		wallets: ctx.wallets,
		walletIdByTxHash: ctx.walletIdByTxHash,
		transferMatches: ctx.transferMatches,
		ownerIndex: ctx.ownerIndex,
		manualBasis: ctx.manualBasis,
	});
}

// ── Pipeline rows ────────────────────────────────────────────────────────────

async function pipelineEvents(tenantId: string, ctx: LedgerContext): Promise<{ events: LedgerEvent[]; refs: Map<string, RefInfo> }> {
	const [importRows, onchainRows, walletAddresses, manualOverrides] = await Promise.all([
		loadImportTransactions(tenantId),
		loadOnchainTransactions(tenantId),
		loadWalletAddresses(tenantId),
		loadManualClassifications(tenantId),
	]);
	const { classifications } = classifyAll(importRows, onchainRows, walletAddresses, manualOverrides);
	return pipelineToLedger({
		importRows,
		onchainRows,
		classifications,
		manualKeys: new Set(manualOverrides.keys()),
		wallets: ctx.walletsById,
		walletIdByTxHash: ctx.walletIdByTxHash,
		transferMatches: ctx.transferMatches,
		ownerIndex: ctx.ownerIndex,
		manualBasis: ctx.manualBasis,
	});
}

/** The tenant's history as ledger events, read through the chosen engine's adapter. */
export async function loadLedgerEvents(tenantId: string, engine: LedgerEngine): Promise<{ events: LedgerEvent[]; refs: Map<string, RefInfo> }> {
	const ctx = await loadLedgerContext(tenantId);
	return engine === 'pipeline' ? pipelineEvents(tenantId, ctx) : lifecycleEvents(tenantId, ctx);
}

// ── Snapshots ────────────────────────────────────────────────────────────────

/** The end of every year the events cover, through the current year. */
function yearEnds(events: readonly LedgerEvent[]): string[] {
	let first = Number.POSITIVE_INFINITY;
	let last = new Date().getUTCFullYear();
	for (const e of events) {
		const times = e.kind === 'move' ? [e.outAt, e.inAt] : [e.at];
		for (const t of times) {
			const ms = parseInstant(t);
			if (ms === null) continue;
			const y = new Date(ms).getUTCFullYear();
			if (y < first) first = y;
			if (y > last) last = y;
		}
	}
	if (!Number.isFinite(first)) return [];
	const out: string[] = [];
	for (let y = first; y <= last; y++) out.push(`${y}-12-31T23:59:59.999Z`);
	return out;
}

// ── Compute and keep ─────────────────────────────────────────────────────────

const MEMO_MS = 45_000;
/** Off under test, where one process runs many cases against different mocked data. */
export const ledgerMemo = { enabled: process.env.NODE_ENV !== 'test' };
const memo = new Map<string, { at: number; value: Promise<ComputedLedger> }>();

/** Drop the kept results for a tenant: its data changed. */
export function invalidateLedger(tenantId: string): void {
	for (const key of memo.keys()) if (key.startsWith(`${tenantId}|`)) memo.delete(key);
}

const pinsKey = (pins: LotPins | undefined): string =>
	pins && pins.size ? JSON.stringify([...pins].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : '';

/**
 * `trial` runs the ledger as if the tenant had saved these January 1 allocations (instead of the
 * saved ones), without keeping the result: how an allocation is checked before it is stored.
 */
export interface LedgerTrial {
	allocationOverrides: readonly AllocationOverride[];
}

export async function computeLedger(
	tenantId: string,
	engine: LedgerEngine,
	method: CostBasisMethod = 'fifo',
	lotPins?: LotPins,
	trial?: LedgerTrial,
): Promise<ComputedLedger> {
	const key = `${tenantId}|${engine}|${method}|${pinsKey(lotPins)}`;
	const keep = ledgerMemo.enabled && !trial;
	if (keep) {
		const kept = memo.get(key);
		if (kept && Date.now() - kept.at < MEMO_MS) return kept.value;
	}
	const value = (async () => {
		const { events, refs } = await loadLedgerEvents(tenantId, engine);
		const perWallet = await perWalletEnabled(tenantId);
		const allocationOverrides = perWallet ? (trial ? trial.allocationOverrides : await loadAllocationOverrides(tenantId)) : [];
		// Identifications are part of the wallet-by-wallet rule: they apply only where it does.
		const selectionFor = perWallet ? selectionResolver(await loadIdentifications(tenantId)) : undefined;
		const result = runLotLedger(events, {
			perWalletFrom: perWallet ? PER_WALLET_FROM : null,
			allocationOverrides,
			selectionFor,
			method,
			lotPins,
			snapshotsAt: yearEnds(events),
		});
		return { engine, result, refs, basisMethod: perWallet ? PER_WALLET_METHOD : UNIVERSAL_METHOD };
	})();
	if (keep) {
		// Expired results are dropped as new ones are kept, so a tenant seen once does not stay in memory.
		for (const [k, v] of memo) if (Date.now() - v.at >= MEMO_MS) memo.delete(k);
		memo.set(key, { at: Date.now(), value });
		// A failed run is not kept.
		value.catch(() => memo.delete(key));
	}
	return value;
}
