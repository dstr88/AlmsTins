/**
 * Core BTC sync logic — shared between the per-wallet sync endpoint, the
 * bulk /api/import/btc-sync route (Sync Tins), the weekly sync-btc cron and
 * the wallet card's refresh.
 *
 * Uses Blockstream (no key required) to fetch transactions and balance,
 * Coinpaprika for BTC/USD price. Litecoin gets a balance snapshot only, from
 * litecoinspace.org (the same Esplora API); its history is not imported.
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
import { fillCounterparties, importCounterpartyUpdate } from '@/lib/counterpartyColumn';

const BLOCKSTREAM = 'https://blockstream.info/api';
const SATS_PER_BTC = 100_000_000;

export type UtxoChain = 'bitcoin' | 'litecoin';

const ESPLORA: Record<UtxoChain, string> = {
	bitcoin: BLOCKSTREAM,
	litecoin: 'https://litecoinspace.org/api',
};
const UTXO_SYMBOL: Record<UtxoChain, string> = { bitcoin: 'BTC', litecoin: 'LTC' };

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

export async function fetchAllTxs(addr: string): Promise<any[]> {
	const all: any[] = [];
	let lastSeen: string | null = null;

	while (true) {
		const url = lastSeen
			? `${BLOCKSTREAM}/address/${addr}/txs/chain/${lastSeen}`
			: `${BLOCKSTREAM}/address/${addr}/txs`;

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
		return walletTokenUsdPrice(UTXO_SYMBOL[chain], buildTickerPriceMap(await getTickersUSD()));
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
	const tokens = [{ symbol: UTXO_SYMBOL[chain], amount: balance, priceUsd, valueUsd, tokenAddress: null }];

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

export async function ensureBtcWallet(tenantId: string, address: string): Promise<string> {
	const existing = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
		args: [tenantId, address],
	});
	if (existing.rows?.length) return String(existing.rows[0].id ?? '');

	const id = randomUUID();
	const label = `Bitcoin Wallet (${address.slice(0, 12)}…)`;
	await db.execute({
		sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		      VALUES (?, ?, ?, ?, ?, 0, 'onchain')
ON CONFLICT DO NOTHING`,
		args: [id, tenantId, address, label, JSON.stringify(['bitcoin'])],
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

export async function syncBtcAddress(
	tenantId: string,
	rawAddress: string,
	knownWalletId?: string,
): Promise<{ inserted: number; skipped: number; txCount: number; snapshotWritten: boolean }> {
	const address   = canonicalAddress(rawAddress);
	const ownKey    = address.toLowerCase(); // explorer output compared case-insensitively, as autoClassify does
	const walletId  = knownWalletId || await ensureBtcWallet(tenantId, address);
	const batchId   = randomUUID();
	const [allTxs, btcPrice] = await Promise.all([
		fetchAllTxs(address),
		fetchUtxoPriceUsd('bitcoin'),
	]);

	// Balance first: a failure importing the history must never cost the wallet its balance.
	const snapshotWritten = await snapshotUtxoBalance(tenantId, walletId, 'bitcoin', address, btcPrice).catch(err => {
		console.error('[btc-sync] snapshot failed', err);
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
		const nativeUsd = btcPrice !== null ? Math.round(amountBtc * btcPrice * 100) / 100 : null;

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
			.update(JSON.stringify(['bitcoin', txHash, timestamp, direction, String(amountBtc)]))
			.digest('hex');

		normRows.push({
			txHash, timestamp, direction, amount: amountBtc, nativeUsd, kind, description, rowHash,
			counterparty: btcCounterparty(tx, ownKey, direction),
		});
	}

	// Resolve or create exchange_account row for BTC
	const accRes = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'bitcoin' AND lower(name) = ? LIMIT 1`,
		args: [tenantId, ownKey],
	});
	let accountId = String(accRes.rows[0]?.id ?? '');
	if (!accountId) {
		const fallback = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'bitcoin' LIMIT 1`,
			args: [tenantId],
		});
		accountId = String(fallback.rows[0]?.id ?? '');
	}
	if (!accountId) {
		accountId = randomUUID();
		const label = `Bitcoin Wallet (${address.slice(0, 12)}…)`;
		await db.execute({
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, 'bitcoin', ?)`,
			args: [accountId, tenantId, label],
		});
	}

	const BATCH = 100;
	// The table's columns are import_batch_id and row_json (migrations/0001_crypto_com.sql). This
	// insert used to name batch_id and raw_json, which don't exist, so every sync threw here, after
	// creating the wallet row and before the snapshot: no Bitcoin wallet ever got a balance.
	const rawStmts = normRows.map(r => ({
		sql: `INSERT INTO import_raw_rows
		      (id, tenant_id, account_id, import_batch_id, source, row_json, row_hash, imported_at)
		      VALUES (?, ?, ?, ?, 'bitcoin', ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [randomUUID(), tenantId, accountId, batchId, JSON.stringify(r), r.rowHash],
	}));

	const normStmts = normRows.map(r => ({
		sql: `INSERT INTO import_transactions
		      (id, tenant_id, source, account_id, wallet_id, import_batch_id, timestamp_utc,
		       description, currency, amount,
		       to_currency, to_amount,
		       native_currency, native_amount, native_usd,
		       kind, tx_hash, direction, asset_symbol, row_hash, created_at)
		      VALUES (?, ?, 'bitcoin', ?, ?, ?, ?,  ?, 'BTC', ?,  NULL, NULL,  'USD', NULL, ?,  ?, ?, ?, 'BTC', ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [
			randomUUID(), tenantId, accountId, walletId, batchId, r.timestamp,
			r.description,
			r.direction === 'out' ? -r.amount : r.amount,
			r.nativeUsd,
			r.kind, r.txHash, r.direction, r.rowHash,
		],
	}));

	let insertedNorm = 0;
	for (let i = 0; i < rawStmts.length; i += BATCH) {
		await db.batch(rawStmts.slice(i, i + BATCH), 'write');
	}
	for (let i = 0; i < normStmts.length; i += BATCH) {
		const res = await db.batch(normStmts.slice(i, i + BATCH), 'write');
		insertedNorm += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}
	// Every sync reads the whole history, so this also fills rows an earlier sync saved without one.
	await fillCounterparties(normRows.flatMap((r) =>
		r.counterparty ? [importCounterpartyUpdate(tenantId, 'bitcoin', accountId, r.rowHash, r.counterparty)] : []));

	return {
		inserted: insertedNorm,
		skipped:  normStmts.length - insertedNorm,
		txCount:  allTxs.length,
		snapshotWritten,
	};
}

// ── Sync BTC wallet and return WalletSyncStats-compatible result ──────────────

export async function syncBtcWallet(
	tenantId: string,
	walletId: string,
	address: string,
): Promise<WalletSyncStats> {
	const result = await syncBtcAddress(tenantId, address, walletId);

	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(
		tenantId,
		'import',
		`${result.inserted} imported, ${result.skipped} skipped`,
		{ walletId, inserted: result.inserted, skipped: result.skipped },
		{ source: 'btc_sync', chain: 'bitcoin' },
	);

	return {
		walletId,
		totalInserted: result.inserted,
		totalSkipped:  result.skipped,
		chains: [{
			walletId,
			chain: 'bitcoin',
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
