/**
 * XPR Network sync: an account's balance snapshot and its transfer history. Shared by the bulk
 * /api/import/xpr-sync route (Sync Tins), the weekly sync-xpr cron and the wallet's own sync
 * (POST /api/wallets/{id}/sync), the way src/lib/sync/syncBtcAddress.ts serves Bitcoin and Litecoin.
 *
 * Reads public servers with failover (src/lib/xpr/client.ts). A balance that cannot be read writes
 * no snapshot (the last one stands, the sync reports it unavailable), so an outage never reads as
 * zero. History rows go through the shared import writer (src/lib/importRows.ts) under source
 * 'xpr', in the chain's own 4 decimals, with the counterparty account on every row. The rows sit
 * under one exchange_accounts row whose source is in ON_CHAIN_IMPORT_SOURCES (src/lib/chains.ts),
 * so neither that account nor its mirror wallet is valued: the coins are counted once, at the
 * account's snapshot.
 *
 * The history is read incrementally, oldest first, one page at a time: each page is stored before
 * the next is read, a sync that runs out of its time budget keeps what it stored and the next one
 * continues from the newest stored row (less a few days, for a row the index added late; stored
 * rows are skipped by their hash). The first sync of a busy account may take several runs.
 */

import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { networthSummaryCacheKey } from '@/lib/snapshotRows';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';
import { insertImportBatch, type ImportTxRow } from '@/lib/importRows';
import { priceDays, usdAt, utcDay, coingeckoReachesDay, MAX_PRICE_DAYS_PER_SYNC, type DayPrice } from '@/lib/sync/utxoHistoricalPrice';
import { recordRowPrices } from '@/lib/sync/syncBtcAddress';
import { safeParseChains } from '@/lib/wallets-service';
import { normalizeXprAccountName } from '@/lib/addressFormats';
import { CHAINS, normalizeChain } from '@/lib/chains';
import { fetchXprBalances, type XprBalances } from '@/lib/xpr/balances';
import { readXprHistory, type XprTransfer } from '@/lib/xpr/history';
import { xprRowKind, xprRowNotes } from '@/lib/xpr/systemAccounts';
import { fetchXprPriceUsd } from '@/lib/xpr/price';
import type { XprRequestOptions } from '@/lib/xpr/client';
import type { WalletSyncStats } from '@/lib/sync/syncTransactions';

const SOURCE = 'xpr';
const SYMBOL = CHAINS.xpr.native.symbol;
const DECIMALS = CHAINS.xpr.native.decimals;

/** A sync stops starting new pages after this long (a web request must answer in time). */
export const XPR_SYNC_BUDGET_MS = 40_000;

/** How far back an incremental read starts before the newest stored row. */
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000;

/** SQL filter for a wallets row tagged with the XPR chain. A name has no shape to match, so the tag is the only signal. */
export const XPR_WALLET_SQL = `chains LIKE '%"xpr"%'`;

/** True when a wallet's chains list names XPR Network. */
export function isXprWallet(chains: unknown): boolean {
	const list = Array.isArray(chains) ? chains.map(String) : safeParseChains(chains);
	return list.some((c) => normalizeChain(c) === 'xpr');
}

// ── Balance snapshot ─────────────────────────────────────────────────────────

/** The snapshot's token list: the chain's own coin (priced) and every other token (listed, unpriced). */
export function xprSnapshotTokens(balances: XprBalances, priceUsd: number | null) {
	const native = {
		symbol: SYMBOL,
		amount: balances.native,
		priceUsd,
		valueUsd: priceUsd !== null ? balances.native * priceUsd : null,
		tokenAddress: null,
		liquid: balances.liquid,
		staked: balances.staked,
		unstaking: balances.unstaking,
	};
	const tokens = balances.tokens.map((t) => ({
		symbol: t.symbol,
		amount: t.amount,
		priceUsd: null,
		valueUsd: null,
		tokenAddress: t.contract,
	}));
	return balances.native > 0 || tokens.length === 0 ? [native, ...tokens] : tokens;
}

export async function writeXprSnapshot(tenantId: string, walletId: string, balances: XprBalances, priceUsd: number | null): Promise<void> {
	const tokens = xprSnapshotTokens(balances, priceUsd);
	const totalUsd = tokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);
	await db.execute({
		sql: `INSERT INTO wallet_snapshots
		        (tenant_id, wallet_id, chain, totals_usd,
		         collateral_usd, debt_usd, collateral_apy_pct,
		         borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [tenantId, walletId, 'xpr', totalUsd, JSON.stringify(tokens)],
	});
	await db.execute({ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [networthSummaryCacheKey(tenantId)] }).catch(() => {});
}

/**
 * Reads the account's balances and stores them as the wallet's snapshot. Returns false (and writes
 * nothing) when the balance cannot be read, so an outage never reads as a zero balance.
 */
export async function snapshotXprBalance(
	tenantId: string,
	walletId: string,
	account: string,
	priceUsd?: number | null,
	opts?: XprRequestOptions,
): Promise<boolean> {
	try {
		const [balances, price] = await Promise.all([fetchXprBalances(account, opts), priceUsd !== undefined ? priceUsd : fetchXprPriceUsd()]);
		await writeXprSnapshot(tenantId, walletId, balances, price);
		return true;
	} catch (err) {
		console.error('[xpr-sync] balance unavailable', err instanceof Error ? err.message : err);
		return false;
	}
}

// ── Wallet and account rows ──────────────────────────────────────────────────

export async function ensureXprWallet(tenantId: string, account: string): Promise<string> {
	const existing = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
		args: [tenantId, account],
	});
	if (existing.rows?.length) return String(existing.rows[0].id ?? '');
	const id = randomUUID();
	await db.execute({
		sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		      VALUES (?, ?, ?, ?, ?, 0, 'onchain')
		      ON CONFLICT DO NOTHING`,
		args: [id, tenantId, account, `${CHAINS.xpr.name} Account (${account})`, JSON.stringify(['xpr'])],
	});
	return id;
}

async function ensureXprExchangeAccount(tenantId: string, account: string): Promise<string> {
	const found = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = ? LIMIT 1`,
		args: [tenantId, SOURCE],
	});
	const existing = String(found.rows[0]?.id ?? '');
	if (existing) return existing;
	const id = randomUUID();
	await db.execute({
		sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, ?, ?)`,
		args: [id, tenantId, SOURCE, `${CHAINS.xpr.name} Account (${account})`],
	});
	return id;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** One action of one account: unique by the chain's global sequence, and by which account's view it is. */
export function xprRowHash(account: string, t: XprTransfer): string {
	return createHash('sha256')
		.update(JSON.stringify([SOURCE, t.globalSequence, t.txId, account, t.direction, t.asset, String(t.amount)]))
		.digest('hex');
}

export interface XprRow {
	transfer: XprTransfer;
	rowHash: string;
	kind: string;
	description: string;
	notes: string;
}

/**
 * The row for one transfer. The description is the plain word (send, receive): the other account
 * is in counterparty_address, and a stranger's account name in a description could trip a keyword
 * in the lifecycle classifier (loan, repay). The memo is kept in the raw row only.
 */
export function xprRowOf(account: string, t: XprTransfer): XprRow {
	return {
		transfer: t,
		rowHash: xprRowHash(account, t),
		kind: xprRowKind(t.direction, t.counterparty),
		description: t.direction === 'in' ? 'receive' : 'send',
		notes: xprRowNotes(t.counterparty),
	};
}

/** The row's amount in the chain's own decimals for the native coin, in the token's own precision otherwise. */
const roundTo = (n: number, decimals: number) => Number(n.toFixed(Math.min(Math.max(decimals, 0), 12)));

export type XprSyncResult = {
	inserted: number;
	skipped: number;
	/** Transfers read (every stored row and every one skipped as already stored). */
	txCount: number;
	snapshotWritten: boolean;
	/** False when the time budget or the server's cap stopped the read: the next sync continues. */
	complete: boolean;
};

export interface XprSyncOptions extends XprRequestOptions {
	budgetMs?: number;
}

/**
 * Stores an account's balance snapshot, then imports its transfer history. Throws when the
 * account name is not shaped like one, or when no server can answer the history (rows stored
 * before the failure stay, the snapshot is already written).
 */
export async function syncXprAddress(tenantId: string, rawName: string, knownWalletId?: string, opts: XprSyncOptions = {}): Promise<XprSyncResult> {
	const account = normalizeXprAccountName(rawName);
	if (!account) throw new Error('not an XPR account name');
	const walletId = knownWalletId || (await ensureXprWallet(tenantId, account));
	const accountId = await ensureXprExchangeAccount(tenantId, account);
	const batchId = randomUUID();

	// Balance first: a failure reading the history must never cost the wallet its balance.
	const snapshotWritten = await snapshotXprBalance(tenantId, walletId, account, undefined, opts);

	const newest = await db.execute({
		sql: `SELECT MAX(timestamp_utc) AS newest FROM import_transactions WHERE tenant_id = ? AND source = ? AND wallet_id = ?`,
		args: [tenantId, SOURCE, walletId],
	});
	const newestMs = Date.parse(String((newest.rows[0] as { newest?: unknown } | undefined)?.newest ?? ''));
	const after = Number.isFinite(newestMs) ? new Date(newestMs - OVERLAP_MS).toISOString() : null;

	let inserted = 0;
	let txCount = 0;
	// Day prices already looked up this sync, and how many of CoinGecko's reachable days are left to look up.
	const dayCache = new Map<string, DayPrice | null>();
	let dayBudget = MAX_PRICE_DAYS_PER_SYNC;

	const read = await readXprHistory(account, {
		...opts,
		after,
		budgetMs: opts.budgetMs ?? XPR_SYNC_BUDGET_MS,
		onPage: async ({ transfers }) => {
			const rows = transfers.map((t) => xprRowOf(account, t));
			txCount += rows.length;

			// Stored rows of this page: their hash and whether their value is still empty.
			const stored = new Map<string, unknown>();
			for (let i = 0; i < rows.length; i += 500) {
				const chunk = rows.slice(i, i + 500);
				const res = await db.execute({
					sql: `SELECT row_hash, native_usd FROM import_transactions
					      WHERE tenant_id = ? AND source = ? AND account_id = ? AND row_hash IN (${chunk.map(() => '?').join(', ')})`,
					args: [tenantId, SOURCE, accountId, ...chunk.map((r) => r.rowHash)],
				});
				for (const r of res.rows) stored.set(String((r as { row_hash?: unknown }).row_hash ?? ''), (r as { native_usd?: unknown }).native_usd ?? null);
			}

			// The chain's own coin is valued at its UTC day's price; a token is stored unpriced.
			const toPrice = rows.filter((r) => r.transfer.asset === SYMBOL && stored.get(r.rowHash) == null);
			const days = [...new Set(toPrice.flatMap((r) => utcDay(r.transfer.timestamp) ?? []))].filter((d) => !dayCache.has(d));
			const looked = await priceDays(SYMBOL, days, { max: dayBudget });
			for (const [day, price] of looked) {
				dayCache.set(day, price);
				if (coingeckoReachesDay(day)) dayBudget -= 1;
			}
			const priced = new Map<string, DayPrice>();
			const normRows = rows.map((r) => {
				const t = r.transfer;
				const day = utcDay(t.timestamp);
				const p = r.transfer.asset === SYMBOL && stored.get(r.rowHash) == null && day ? dayCache.get(day) : null;
				if (p) priced.set(r.rowHash, p);
				return { ...r, nativeUsd: p ? usdAt(t.amount, p.unitPriceUsd) : null };
			});

			const importRows: ImportTxRow[] = normRows.map((r) => {
				const t = r.transfer;
				const amount = roundTo(t.amount, t.asset === SYMBOL ? DECIMALS : t.precision);
				return {
					timestampUtc: t.timestamp,
					description: r.description,
					currency: t.asset,
					amount: t.direction === 'out' ? -amount : amount,
					nativeCurrency: 'USD',
					nativeUsd: r.nativeUsd,
					kind: r.kind,
					txHash: t.txId,
					direction: t.direction,
					assetSymbol: t.asset,
					notes: r.notes || null,
					rowHash: r.rowHash,
					counterparty: t.counterparty,
				};
			});
			const result = await insertImportBatch({
				tenantId, accountId, walletId, source: SOURCE, batchId,
				// The raw row keeps everything the chain said, memo included.
				rawRows: normRows.map((r) => ({ rowJson: JSON.stringify({ ...r.transfer, account }), rowHash: r.rowHash })),
				rows: importRows,
			});
			inserted += result.insertedNormalized;

			await recordRowPrices({
				tenantId, chain: SOURCE, accountId,
				rows: normRows.map((r) => ({ rowHash: r.rowHash, nativeUsd: r.nativeUsd })),
				inserted: result.inserted, storedUsd: stored, priced,
			});
		},
	});

	return { inserted, skipped: txCount - inserted, txCount, snapshotWritten, complete: read.complete };
}

// ── Sync a wallet: the WalletSyncStats shape the wallet routes return ────────

export async function syncXprWallet(tenantId: string, walletId: string, address: string, opts?: XprSyncOptions): Promise<WalletSyncStats> {
	const result = await syncXprAddress(tenantId, address, walletId, opts);

	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(
		tenantId,
		'import',
		`${result.inserted} imported, ${result.skipped} skipped`,
		{ walletId, inserted: result.inserted, skipped: result.skipped, complete: result.complete },
		{ source: 'xpr_sync', chain: 'xpr' },
	);

	return {
		walletId,
		totalInserted: result.inserted,
		totalSkipped: result.skipped,
		chains: [{
			walletId,
			chain: 'xpr',
			fetched: result.txCount,
			fetchedNative: result.txCount,
			fetchedToken: 0,
			inserted: result.inserted,
			skipped: result.skipped,
			highestBlock: 0,
			highestTimestamp: null,
			ok: result.snapshotWritten,
		}],
	};
}
