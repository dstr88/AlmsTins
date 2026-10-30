/**
 * Core BTC sync logic — shared between the per-wallet sync endpoint, the
 * bulk /api/import/btc-sync route (Sync Tins), the weekly sync-btc cron and
 * the wallet card's refresh.
 *
 * Uses Blockstream (no key required) to fetch transactions and balance,
 * Coinpaprika for the BTC/USD price of the balance snapshot, and each transaction's own day's price
 * for its row (src/lib/sync/utxoHistoricalPrice.ts). Litecoin goes through the same code with
 * litecoinspace.org (the same Esplora API) and LTC/USD: its rows are stored
 * under source `litecoin`, its own exchange_accounts row and its own row_hash
 * prefix, so a Bitcoin and a Litecoin transaction never collide.
 *
 * Addresses are passed exactly as stored (canonicalAddress): a legacy 1… or
 * 3… address is base58 and case-sensitive, so lowercasing it asks Blockstream
 * about a different, invalid address.
 */

import { createHash, randomUUID } from 'node:crypto';
import { networthSummaryCacheKey } from '@/lib/snapshotRows';
import { db } from '@/lib/db';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';
import type { WalletSyncStats } from '@/lib/sync/syncTransactions';
import { canonicalAddress, safeParseChains } from '@/lib/wallets-service';
import { buildTickerPriceMap } from '@/lib/aave/pricing';
import { walletTokenUsdPrice } from '@/lib/prices/walletTokenPricing';
import { insertImportBatch } from '@/lib/importRows';
import { ensurePriceSourceColumn } from '@/lib/priceSourceColumn';
import { priceDays, usdAt, utcDay, type DayPrice } from '@/lib/sync/utxoHistoricalPrice';
import { CHAINS } from '@/lib/chains';

const BLOCKSTREAM = 'https://blockstream.info/api';
/** Satoshis per BTC; litoshis per LTC are the same (both have 8 decimals, src/lib/chains.ts). */
const SATS_PER_BTC = 100_000_000;

export type UtxoChain = 'bitcoin' | 'litecoin';

const ESPLORA: Record<UtxoChain, string> = {
	bitcoin: BLOCKSTREAM,
	litecoin: 'https://litecoinspace.org/api',
};
const UTXO_SYMBOL = (chain: UtxoChain): string => CHAINS[chain].native.symbol;

// ── Blockstream helpers ───────────────────────────────────────────────────────

export async function fetchAddressInfo(addr: string, chain: UtxoChain = 'bitcoin'): Promise<{ confirmed_balance: number } | null> {
	try {
		const res = await fetch(`${ESPLORA[chain]}/address/${addr}`);
		if (!res.ok) return null;
		const data = await res.json();
		const funded = Number(data?.chain_stats?.funded_txo_sum ?? 0);
		const spent  = Number(data?.chain_stats?.spent_txo_sum  ?? 0);
		return { confirmed_balance: funded - spent };
	} catch {
		return null;
	}
}

export async function fetchAllTxs(addr: string, chain: UtxoChain = 'bitcoin'): Promise<any[]> {
	const all: any[] = [];
	let lastSeen: string | null = null;

	while (true) {
		const url = lastSeen
			? `${ESPLORA[chain]}/address/${addr}/txs/chain/${lastSeen}`
			: `${ESPLORA[chain]}/address/${addr}/txs`;

		const res = await fetch(url);
		if (!res.ok) break;
		const page: any[] = await res.json();
		if (!Array.isArray(page) || !page.length) break;

		all.push(...page);
		lastSeen = page[page.length - 1]?.txid ?? null;
		if (!lastSeen || page.length < 25) break;
	}
	return all;
}

// ── BTC / LTC price via Coinpaprika ───────────────────────────────────────────

export async function fetchUtxoPriceUsd(chain: UtxoChain): Promise<number | null> {
	try {
		return walletTokenUsdPrice(UTXO_SYMBOL(chain), buildTickerPriceMap(await getTickersUSD()));
	} catch {
		return null;
	}
}

// ── Wallet snapshot ───────────────────────────────────────────────────────────

export async function writeUtxoSnapshot(
	tenantId: string,
	walletId: string,
	chain: UtxoChain,
	balance: number,
	priceUsd: number | null,
): Promise<void> {
	const valueUsd = priceUsd !== null ? balance * priceUsd : null;
	const totalUsd = valueUsd ?? 0;
	const tokens = [{ symbol: UTXO_SYMBOL(chain), amount: balance, priceUsd, valueUsd, tokenAddress: null }];

	await db.execute({
		sql: `INSERT INTO wallet_snapshots
		        (tenant_id, wallet_id, chain, totals_usd,
		         collateral_usd, debt_usd, collateral_apy_pct,
		         borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [tenantId, walletId, chain, totalUsd, JSON.stringify(tokens)],
	});

	await db.execute({
		sql: `DELETE FROM cache WHERE cache_key = ?`,
		args: [networthSummaryCacheKey(tenantId)],
	}).catch(() => {});
}

/**
 * Read the address's confirmed balance and store it as the wallet's snapshot for that chain.
 * Balance only, no history, so it is quick enough for the wallet card's refresh. Returns false
 * (and writes nothing) when the explorer can't answer, so an outage never reads as a zero balance.
 */
export async function snapshotUtxoBalance(
	tenantId: string,
	walletId: string,
	chain: UtxoChain,
	address: string,
	priceUsd?: number | null,
): Promise<boolean> {
	const info = await fetchAddressInfo(address, chain);
	if (!info) return false;
	const price = priceUsd !== undefined ? priceUsd : await fetchUtxoPriceUsd(chain);
	await writeUtxoSnapshot(tenantId, walletId, chain, info.confirmed_balance / SATS_PER_BTC, price);
	return true;
}

// ── Resolve or create wallet row ──────────────────────────────────────────────

export async function ensureBtcWallet(tenantId: string, address: string, chain: UtxoChain = 'bitcoin'): Promise<string> {
	const existing = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
		args: [tenantId, address],
	});
	if (existing.rows?.length) return String(existing.rows[0].id ?? '');

	const id = randomUUID();
	const label = `${CHAINS[chain].name} Wallet (${address.slice(0, 12)}…)`;
	await db.execute({
		sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		      VALUES (?, ?, ?, ?, ?, 0, 'onchain')
ON CONFLICT DO NOTHING`,
		args: [id, tenantId, address, label, JSON.stringify([chain])],
	});
	return id;
}

// ── Counterparty ─────────────────────────────────────────────────────────────

/**
 * The full address on the other side of a transaction, from this wallet's view: for a receive the
 * first input that is not this wallet, for a send the first output that is not this wallet (its
 * change). A transaction can have several of each; only the first is kept. null when there is none.
 * In canonicalAddress form: bech32 lowercased, base58 exactly as the explorer wrote it.
 */
export function btcCounterparty(tx: any, ownKey: string, direction: 'in' | 'out'): string | null {
	const addrs: string[] = direction === 'in'
		? (tx?.vin ?? []).map((i: any) => String(i?.prevout?.scriptpubkey_address ?? ''))
		: (tx?.vout ?? []).map((o: any) => String(o?.scriptpubkey_address ?? ''));
	const other = addrs.find((a) => a.trim() !== '' && a.toLowerCase() !== ownKey);
	return other ? canonicalAddress(other) : null;
}

// ── Sync one address ─────────────────────────────────────────────────────────

export type UtxoSyncResult = { inserted: number; skipped: number; txCount: number; snapshotWritten: boolean };

export function syncBtcAddress(tenantId: string, rawAddress: string, knownWalletId?: string): Promise<UtxoSyncResult> {
	return syncUtxoAddress(tenantId, 'bitcoin', rawAddress, knownWalletId);
}

/**
 * Store a Bitcoin or Litecoin address's balance snapshot, then import its whole history. Every
 * sync reads the full history: rows already stored are skipped (same account and row_hash), and
 * their counterparty is filled if it is still empty.
 */
export async function syncUtxoAddress(
	tenantId: string,
	chain: UtxoChain,
	rawAddress: string,
	knownWalletId?: string,
): Promise<UtxoSyncResult> {
	const address   = canonicalAddress(rawAddress);
	const ownKey    = address.toLowerCase(); // explorer output compared case-insensitively, as autoClassify does
	const walletId  = knownWalletId || await ensureBtcWallet(tenantId, address, chain);
	const batchId   = randomUUID();
	const symbol    = UTXO_SYMBOL(chain);
	const [allTxs, coinPrice] = await Promise.all([
		fetchAllTxs(address, chain),
		fetchUtxoPriceUsd(chain),
	]);

	// Balance first: a failure importing the history must never cost the wallet its balance.
	const snapshotWritten = await snapshotUtxoBalance(tenantId, walletId, chain, address, coinPrice).catch(err => {
		console.error(`[${chain === 'bitcoin' ? 'btc' : 'ltc'}-sync] snapshot failed`, err);
		return false;
	});

	const normRows: Array<{
		txHash:    string;
		timestamp: string;
		direction: 'in' | 'out';
		amount:    number;
		nativeUsd: number | null;
		kind:      string;
		description: string;
		rowHash:   string;
		counterparty: string | null;
	}> = [];

	for (const tx of allTxs) {
		if (!tx?.status?.confirmed) continue;

		const tsMs = Number(tx.status.block_time ?? 0) * 1000;
		if (!tsMs) continue;
		const timestamp = new Date(tsMs).toISOString();

		let receivedSats = 0;
		for (const out of (tx.vout ?? [])) {
			if (String(out.scriptpubkey_address ?? '').toLowerCase() === ownKey) {
				receivedSats += Number(out.value ?? 0);
			}
		}

		let spentSats = 0;
		for (const inp of (tx.vin ?? [])) {
			if (String(inp.prevout?.scriptpubkey_address ?? '').toLowerCase() === ownKey) {
				spentSats += Number(inp.prevout?.value ?? 0);
			}
		}

		const netSats = receivedSats - spentSats;
		if (netSats === 0) continue;

		const direction: 'in' | 'out' = netSats > 0 ? 'in' : 'out';
		const amountBtc = Math.abs(netSats) / SATS_PER_BTC;

		const txHash = String(tx.txid ?? '');
		const kind   = direction === 'in' ? 'receive' : 'send';

		let counterparty = '';
		if (direction === 'in') {
			const fromAddr = tx.vin?.[0]?.prevout?.scriptpubkey_address ?? '';
			counterparty = fromAddr ? `from ${fromAddr.slice(0, 12)}…` : '';
		} else {
			const toAddr = (tx.vout ?? [])
				.map((o: any) => String(o.scriptpubkey_address ?? ''))
				.find((a: string) => a.toLowerCase() !== ownKey) ?? '';
			counterparty = toAddr ? `to ${toAddr.slice(0, 12)}…` : '';
		}
		const description = counterparty ? `${kind} ${counterparty}` : kind;

		const rowHash = createHash('sha256')
			.update(JSON.stringify([chain, txHash, timestamp, direction, String(amountBtc)]))
			.digest('hex');

		normRows.push({
			txHash, timestamp, direction, amount: amountBtc, nativeUsd: null, kind, description, rowHash,
			counterparty: btcCounterparty(tx, ownKey, direction),
		});
	}

	// Resolve or create the exchange_accounts row the chain's rows are filed under. Its source is
	// in ON_CHAIN_IMPORT_SOURCES (src/lib/chains.ts), so neither it nor its mirror wallet is valued:
	// the coins are counted once, at the address's snapshot above.
	const accRes = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = ? AND lower(name) = ? LIMIT 1`,
		args: [tenantId, chain, ownKey],
	});
	let accountId = String(accRes.rows[0]?.id ?? '');
	if (!accountId) {
		const fallback = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = ? LIMIT 1`,
			args: [tenantId, chain],
		});
		accountId = String(fallback.rows[0]?.id ?? '');
	}
	if (!accountId) {
		accountId = randomUUID();
		const label = `${CHAINS[chain].name} Wallet (${address.slice(0, 12)}…)`;
		await db.execute({
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, ?, ?)`,
			args: [accountId, tenantId, chain, label],
		});
	}

	// Each row's USD value at its own UTC day's price, never the sync day's: it is the row's cost
	// basis or proceeds. Only rows not stored yet are priced, plus a stored row of this account
	// whose value is still empty; a value stored by an older sync is left alone (it is corrected
	// once by src/scripts/correctUtxoPrices.ts). A day with no price stores NULL.
	const stored = await db.execute({
		sql: `SELECT row_hash, native_usd FROM import_transactions WHERE tenant_id = ? AND source = ? AND account_id = ?`,
		args: [tenantId, chain, accountId],
	});
	const storedUsd = new Map(stored.rows.map((r) => [String((r as { row_hash?: unknown }).row_hash ?? ''), (r as { native_usd?: unknown }).native_usd ?? null]));
	const toPrice = normRows.filter((r) => storedUsd.get(r.rowHash) == null);
	const dayPrices = await priceDays(symbol, toPrice.flatMap((r) => utcDay(r.timestamp) ?? []));
	const priced = new Map<string, DayPrice>();
	for (const r of toPrice) {
		const p = dayPrices.get(utcDay(r.timestamp) ?? '');
		if (!p) continue;
		priced.set(r.rowHash, p);
		r.nativeUsd = usdAt(r.amount, p.unitPriceUsd);
	}

	// Through the shared writer (src/lib/importRows.ts): an earlier inline copy of this insert named
	// batch_id and raw_json, which don't exist, so every sync threw before the snapshot. Every sync
	// reads the whole history, so the counterparty fill also covers rows an earlier sync saved.
	const { inserted, insertedNormalized: insertedNorm } = await insertImportBatch({
		tenantId, accountId, walletId, source: chain, batchId,
		rawRows: normRows.map((r) => ({ rowJson: JSON.stringify(r), rowHash: r.rowHash })),
		rows: normRows.map((r) => ({
			timestampUtc: r.timestamp,
			description: r.description,
			currency: symbol,
			amount: r.direction === 'out' ? -r.amount : r.amount,
			nativeCurrency: 'USD',
			nativeUsd: r.nativeUsd,
			kind: r.kind,
			txHash: r.txHash,
			direction: r.direction,
			assetSymbol: symbol,
			rowHash: r.rowHash,
			counterparty: r.counterparty,
		})),
	});

	await recordRowPrices({ tenantId, chain, accountId, rows: normRows, inserted, storedUsd, priced });

	return {
		inserted: insertedNorm,
		skipped:  normRows.length - insertedNorm,
		txCount:  allTxs.length,
		snapshotWritten,
	};
}

/**
 * After the insert: tags each newly stored priced row with its price_source, and gives a stored row
 * whose value was still empty its price. Never throws: a price that cannot be saved leaves the row
 * as the insert stored it, for the next sync or "Fill Missing Prices". Shared with the XPR sync
 * (src/lib/sync/syncXprAddress.ts).
 */
export async function recordRowPrices(opts: {
	tenantId: string;
	chain: string;
	accountId: string;
	rows: ReadonlyArray<{ rowHash: string; nativeUsd: number | null }>;
	inserted: readonly boolean[];
	storedUsd: ReadonlyMap<string, unknown>;
	priced: ReadonlyMap<string, DayPrice>;
}): Promise<void> {
	const { tenantId, chain, accountId, rows, inserted, storedUsd, priced } = opts;
	if (priced.size === 0) return;
	const withSource = await ensurePriceSourceColumn();
	const where = `tenant_id = ? AND source = ? AND account_id = ? AND row_hash = ?`;
	const stmts: Array<{ sql: string; args: Array<string | number | null> }> = [];
	rows.forEach((r, i) => {
		const p = priced.get(r.rowHash);
		if (!p || r.nativeUsd === null) return;
		const key = [tenantId, chain, accountId, r.rowHash];
		if (inserted[i]) {
			if (withSource) stmts.push({ sql: `UPDATE import_transactions SET price_source = ? WHERE ${where} AND price_source IS NULL`, args: [p.source, ...key] });
		} else if (storedUsd.has(r.rowHash)) {
			stmts.push(withSource
				? { sql: `UPDATE import_transactions SET native_usd = ?, price_source = ? WHERE ${where} AND native_usd IS NULL`, args: [r.nativeUsd, p.source, ...key] }
				: { sql: `UPDATE import_transactions SET native_usd = ? WHERE ${where} AND native_usd IS NULL`, args: [r.nativeUsd, ...key] });
		}
	});
	try {
		for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100), 'write');
	} catch (err) {
		console.warn(`[${chain === 'bitcoin' ? 'btc' : chain === 'litecoin' ? 'ltc' : chain}-sync] could not record row prices`, err);
	}
}

// ── Sync a BTC or LTC wallet and return WalletSyncStats-compatible result ─────

export function syncBtcWallet(tenantId: string, walletId: string, address: string): Promise<WalletSyncStats> {
	return syncUtxoWallet(tenantId, walletId, address, 'bitcoin');
}

export async function syncUtxoWallet(
	tenantId: string,
	walletId: string,
	address: string,
	chain: UtxoChain,
): Promise<WalletSyncStats> {
	const result = await syncUtxoAddress(tenantId, chain, address, walletId);

	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(
		tenantId,
		'import',
		`${result.inserted} imported, ${result.skipped} skipped`,
		{ walletId, inserted: result.inserted, skipped: result.skipped },
		{ source: 'btc_sync', chain },
	);

	return {
		walletId,
		totalInserted: result.inserted,
		totalSkipped:  result.skipped,
		chains: [{
			walletId,
			chain,
			fetched: result.txCount,
			fetchedNative: result.txCount,
			fetchedToken: 0,
			inserted: result.inserted,
			skipped:  result.skipped,
			highestBlock: 0,
			highestTimestamp: null,
			ok: true,
		}],
	};
}

// ── Helper: is this address a Bitcoin address? ────────────────────────────────

export function isBitcoinAddress(address: string): boolean {
	const a = address.toLowerCase();
	return a.startsWith('bc1') || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
}

export function isBitcoinWallet(chains: string[], address: string): boolean {
	return chains.includes('bitcoin') || isBitcoinAddress(address);
}

/** Which UTXO chain a wallet row is on, if any. Litecoin first: an ltc1 wallet is never Bitcoin. */
export function utxoChainOf(chains: unknown, address: string): UtxoChain | null {
	const list = Array.isArray(chains) ? chains.map(String) : safeParseChains(chains);
	if (list.includes('solana')) return null; // a base58 Solana key can look like a legacy 1… address
	if (list.includes('litecoin') || /^ltc1/i.test(address.trim())) return 'litecoin';
	if (isBitcoinWallet(list, address.trim())) return 'bitcoin';
	return null;
}

/** SQL filter (on alias-free `wallets` columns) for rows utxoChainOf may call bitcoin or litecoin. */
export const UTXO_WALLET_SQL = `(chains LIKE '%bitcoin%'
	OR chains LIKE '%litecoin%'
	OR lower(address) LIKE 'bc1%'
	OR lower(address) LIKE 'ltc1%'
	OR (length(address) BETWEEN 26 AND 35 AND (address LIKE '1%' OR address LIKE '3%')))`;
