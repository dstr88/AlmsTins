/**
 * Core BTC sync logic — shared between the per-wallet sync endpoint and the
 * bulk /api/import/btc-sync route.
 *
 * Uses Blockstream (no key required) to fetch transactions and balance,
 * Coinpaprika for BTC/USD price.
 */

import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';
import type { WalletSyncStats } from '@/lib/sync/syncTransactions';

const BLOCKSTREAM = 'https://blockstream.info/api';
const SATS_PER_BTC = 100_000_000;

// ── Blockstream helpers ───────────────────────────────────────────────────────

export async function fetchAddressInfo(addr: string): Promise<{ confirmed_balance: number } | null> {
	try {
		const res = await fetch(`${BLOCKSTREAM}/address/${addr}`);
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

// ── BTC price via Coinpaprika ─────────────────────────────────────────────────

export async function fetchBtcPriceUsd(): Promise<number | null> {
	try {
		const tickers = (await getTickersUSD()) as Array<{
			symbol?: string; quotes?: { USD?: { price?: number } };
		}>;
		const btc = tickers.find(t => String(t.symbol ?? '').toUpperCase() === 'BTC');
		const price = btc?.quotes?.USD?.price;
		return typeof price === 'number' && price > 0 ? price : null;
	} catch {
		return null;
	}
}

// ── Wallet snapshot ───────────────────────────────────────────────────────────

export async function writeBtcSnapshot(
	tenantId: string,
	walletId: string,
	balanceBtc: number,
	btcPriceUsd: number | null,
): Promise<void> {
	const valueUsd = btcPriceUsd !== null ? balanceBtc * btcPriceUsd : null;
	const totalUsd = valueUsd ?? 0;
	const tokens = [{ symbol: 'BTC', amount: balanceBtc, priceUsd: btcPriceUsd, valueUsd, tokenAddress: null }];

	await db.execute({
		sql: `INSERT INTO wallet_snapshots
		        (tenant_id, wallet_id, chain, totals_usd,
		         collateral_usd, debt_usd, collateral_apy_pct,
		         borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		      VALUES (?, ?, 'bitcoin', ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
		args: [tenantId, walletId, totalUsd, JSON.stringify(tokens)],
	});

	await db.execute({
		sql: `DELETE FROM cache WHERE cache_key = ?`,
		args: [`t:${tenantId}:networth:summary:v3`],
	}).catch(() => {});
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

// ── Sync one address ─────────────────────────────────────────────────────────

export async function syncBtcAddress(
	tenantId: string,
	address: string,
): Promise<{ inserted: number; skipped: number; txCount: number }> {
	const walletId  = await ensureBtcWallet(tenantId, address);
	const batchId   = randomUUID();
	const [allTxs, btcPrice] = await Promise.all([
		fetchAllTxs(address),
		fetchBtcPriceUsd(),
	]);

	const normRows: Array<{
		txHash:    string;
		timestamp: string;
		direction: 'in' | 'out';
		amount:    number;
		nativeUsd: number | null;
		kind:      string;
		description: string;
		rowHash:   string;
	}> = [];

	for (const tx of allTxs) {
		if (!tx?.status?.confirmed) continue;

		const tsMs = Number(tx.status.block_time ?? 0) * 1000;
		if (!tsMs) continue;
		const timestamp = new Date(tsMs).toISOString();

		let receivedSats = 0;
		for (const out of (tx.vout ?? [])) {
			if (String(out.scriptpubkey_address ?? '').toLowerCase() === address) {
				receivedSats += Number(out.value ?? 0);
			}
		}

		let spentSats = 0;
		for (const inp of (tx.vin ?? [])) {
			if (String(inp.prevout?.scriptpubkey_address ?? '').toLowerCase() === address) {
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
				.find((a: string) => a.toLowerCase() !== address) ?? '';
			counterparty = toAddr ? `to ${toAddr.slice(0, 12)}…` : '';
		}
		const description = counterparty ? `${kind} ${counterparty}` : kind;

		const rowHash = createHash('sha256')
			.update(JSON.stringify(['bitcoin', txHash, timestamp, direction, String(amountBtc)]))
			.digest('hex');

		normRows.push({ txHash, timestamp, direction, amount: amountBtc, nativeUsd, kind, description, rowHash });
	}

	// Resolve or create exchange_account row for BTC
	const accRes = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'bitcoin' AND lower(name) = ? LIMIT 1`,
		args: [tenantId, address],
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
	const rawStmts = normRows.map(r => ({
		sql: `INSERT INTO import_raw_rows
		      (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'bitcoin', ?, ?)
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

	const addrInfo = await fetchAddressInfo(address);
	if (addrInfo) {
		const balanceBtc = addrInfo.confirmed_balance / SATS_PER_BTC;
		await writeBtcSnapshot(tenantId, walletId, balanceBtc, btcPrice).catch(err => {
			console.error('[btc-sync] snapshot failed', err);
		});
	}

	return {
		inserted: insertedNorm,
		skipped:  normStmts.length - insertedNorm,
		txCount:  allTxs.length,
	};
}

// ── Sync BTC wallet and return WalletSyncStats-compatible result ──────────────

export async function syncBtcWallet(
	tenantId: string,
	walletId: string,
	address: string,
): Promise<WalletSyncStats> {
	const result = await syncBtcAddress(tenantId, address.toLowerCase());

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
