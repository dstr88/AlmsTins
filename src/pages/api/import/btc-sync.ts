/**
 * POST /api/import/btc-sync
 *
 * Fetches native BTC transactions for one or more wallet addresses from the
 * Blockstream API (free, no key required) and imports any new rows into
 * import_transactions.  Also writes a wallet_snapshot so the Portfolio tin
 * reflects the current BTC balance.
 *
 * Request body (JSON, optional):
 *   { address: "bc1q…" }   — sync a specific address
 *   {}                      — sync all bitcoin wallets stored for this tenant
 *
 * Blockstream API used:
 *   GET https://blockstream.info/api/address/{addr}
 *   GET https://blockstream.info/api/address/{addr}/txs
 *   GET https://blockstream.info/api/address/{addr}/txs/chain/{last_seen_txid}
 */

import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runTransferMatching } from '@/lib/transferMatcher';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';

const BLOCKSTREAM = 'https://blockstream.info/api';
const SATS_PER_BTC = 100_000_000;

// ── Blockstream helpers ───────────────────────────────────────────────────────

async function fetchAddressInfo(addr: string): Promise<{ confirmed_balance: number } | null> {
	try {
		const res = await fetch(`${BLOCKSTREAM}/address/${addr}`);
		if (!res.ok) return null;
		const data = await res.json();
		// chain_stats.funded_txo_sum - chain_stats.spent_txo_sum = confirmed balance in sats
		const funded = Number(data?.chain_stats?.funded_txo_sum ?? 0);
		const spent  = Number(data?.chain_stats?.spent_txo_sum  ?? 0);
		return { confirmed_balance: funded - spent };
	} catch {
		return null;
	}
}

async function fetchAllTxs(addr: string): Promise<any[]> {
	const all: any[] = [];
	let lastSeen: string | null = null;

	// Blockstream returns up to 25 txs per page; paginate via /txs/chain/{txid}
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
		if (!lastSeen || page.length < 25) break;   // last page
	}
	return all;
}

// ── BTC price via Coinpaprika ─────────────────────────────────────────────────

async function fetchBtcPriceUsd(): Promise<number | null> {
	try {
		const tickers = (await getTickersUSD()) as Array<{
			symbol?: string; rank?: number; quotes?: { USD?: { price?: number } };
		}>;
		const btc = tickers.find(t => String(t.symbol ?? '').toUpperCase() === 'BTC');
		const price = btc?.quotes?.USD?.price;
		return typeof price === 'number' && price > 0 ? price : null;
	} catch {
		return null;
	}
}

// ── Wallet snapshot ───────────────────────────────────────────────────────────

async function writeBtcSnapshot(
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
		      VALUES (?, ?, 'bitcoin', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		args: [tenantId, walletId, totalUsd, JSON.stringify(tokens)],
	});

	// Invalidate cached networth summary
	await db.execute({
		sql: `DELETE FROM cache WHERE cache_key = ?`,
		args: [`t:${tenantId}:networth:summary:v3`],
	}).catch(() => {});
}

// ── Resolve or create a wallet row for the BTC address ───────────────────────

async function ensureBtcWallet(
	tenantId: string,
	address: string,
): Promise<string> {
	const existing = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
		args: [tenantId, address],
	});
	if (existing.rows?.length) return String(existing.rows[0].id ?? '');

	const id = randomUUID();
	const label = `Bitcoin Wallet (${address.slice(0, 12)}…)`;
	await db.execute({
		sql: `INSERT OR IGNORE INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
		args: [id, tenantId, address, label, JSON.stringify(['bitcoin'])],
	});
	return id;
}

// ── Sync one address ─────────────────────────────────────────────────────────

async function syncOneAddress(
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
		amount:    number;          // BTC (positive)
		nativeUsd: number | null;
		kind:      string;
		description: string;
		rowHash:   string;
	}> = [];

	for (const tx of allTxs) {
		// Only process confirmed transactions
		if (!tx?.status?.confirmed) continue;

		const tsMs = Number(tx.status.block_time ?? 0) * 1000;
		if (!tsMs) continue;
		const timestamp = new Date(tsMs).toISOString();

		// Sum sats received to our address from vout
		let receivedSats = 0;
		for (const out of (tx.vout ?? [])) {
			if (String(out.scriptpubkey_address ?? '').toLowerCase() === address) {
				receivedSats += Number(out.value ?? 0);
			}
		}

		// Sum sats spent from our address in vin
		let spentSats = 0;
		for (const inp of (tx.vin ?? [])) {
			if (String(inp.prevout?.scriptpubkey_address ?? '').toLowerCase() === address) {
				spentSats += Number(inp.prevout?.value ?? 0);
			}
		}

		const netSats = receivedSats - spentSats;
		if (netSats === 0) continue;   // no flow for this wallet

		const direction: 'in' | 'out' = netSats > 0 ? 'in' : 'out';
		const amountBtc = Math.abs(netSats) / SATS_PER_BTC;
		const nativeUsd = btcPrice !== null ? Math.round(amountBtc * btcPrice * 100) / 100 : null;

		const txHash  = String(tx.txid ?? '');
		const kind    = direction === 'in' ? 'receive' : 'send';

		// Build a brief counterparty hint
		let counterparty = '';
		if (direction === 'in') {
			// Counterparty = first input address
			const fromAddr = tx.vin?.[0]?.prevout?.scriptpubkey_address ?? '';
			counterparty = fromAddr ? `from ${fromAddr.slice(0, 12)}…` : '';
		} else {
			// Counterparty = first output that isn't our address
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

	// Resolve (or create) exchange_account row for BTC — used to tie transactions to the wallet
	const accRes = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'bitcoin' AND lower(name) = ? LIMIT 1`,
		args: [tenantId, address],
	});
	let accountId = String(accRes.rows[0]?.id ?? '');
	if (!accountId) {
		// Fall back: any existing bitcoin account
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

	// Build SQL statements
	const BATCH = 100;
	const rawStmts = normRows.map(r => ({
		sql: `INSERT OR IGNORE INTO import_raw_rows
		      (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'bitcoin', ?, ?)`,
		args: [randomUUID(), tenantId, accountId, batchId, JSON.stringify(r), r.rowHash],
	}));

	const normStmts = normRows.map(r => ({
		sql: `INSERT OR IGNORE INTO import_transactions
		      (id, tenant_id, source, account_id, import_batch_id, timestamp_utc,
		       description, currency, amount,
		       to_currency, to_amount,
		       native_currency, native_amount, native_usd,
		       kind, tx_hash, direction, asset_symbol, row_hash, created_at)
		      VALUES (?, ?, 'bitcoin', ?, ?, ?,  ?, 'BTC', ?,  NULL, NULL,  'USD', NULL, ?,  ?, ?, ?, 'BTC', ?, CURRENT_TIMESTAMP)`,
		args: [
			randomUUID(), tenantId, accountId, batchId, r.timestamp,
			r.description,
			r.direction === 'out' ? -r.amount : r.amount,
			r.nativeUsd,
			r.kind, r.txHash, r.direction, r.rowHash,
		],
	}));

	let insertedRaw = 0, insertedNorm = 0;
	for (let i = 0; i < rawStmts.length; i += BATCH) {
		const res = await db.batch(rawStmts.slice(i, i + BATCH), 'write');
		insertedRaw += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}
	for (let i = 0; i < normStmts.length; i += BATCH) {
		const res = await db.batch(normStmts.slice(i, i + BATCH), 'write');
		insertedNorm += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}

	// Write portfolio snapshot using live balance from Blockstream
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

// ── Main handler ──────────────────────────────────────────────────────────────

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	let addresses: string[] = [];

	const requestedAddr = (body?.address as string | undefined)?.trim().toLowerCase() ?? '';
	if (requestedAddr) {
		addresses = [requestedAddr];
	} else {
		// Look up all Bitcoin wallets stored for this tenant:
		// either tagged with the 'bitcoin' chain, or whose address looks like BTC.
		const res = await db.execute({
			sql: `SELECT address FROM wallets
			      WHERE tenant_id = ?
			        AND (chains LIKE '%bitcoin%'
			          OR address LIKE 'bc1%'
			          OR (length(address) BETWEEN 26 AND 35 AND (address LIKE '1%' OR address LIKE '3%')))
			      LIMIT 20`,
			args: [tenantId],
		});
		addresses = (res.rows as any[])
			.map(r => String(r.address ?? '').toLowerCase())
			.filter(a => a.startsWith('bc1') || /^[13]/.test(a));
	}

	if (!addresses.length) {
		return new Response(JSON.stringify({
			error: 'No Bitcoin wallet found. Add a wallet with a bc1… address first, or pass { address: "bc1q…" } in the request body.',
		}), { status: 400 });
	}

	let totalInserted = 0;
	let totalSkipped  = 0;
	let totalTxCount  = 0;
	const perWallet: Array<{ address: string; inserted: number; skipped: number }> = [];

	for (const addr of addresses) {
		try {
			const result = await syncOneAddress(tenantId, addr);
			totalInserted += result.inserted;
			totalSkipped  += result.skipped;
			totalTxCount  += result.txCount;
			perWallet.push({ address: addr, inserted: result.inserted, skipped: result.skipped });
		} catch (err) {
			console.error('[btc-sync] failed for address', addr, err);
			perWallet.push({ address: addr, inserted: 0, skipped: 0 });
		}
	}

	// Run transfer matching tenant-wide so BTC OUTs/INs can match CEX sends/receives
	void runTransferMatching(tenantId);

	return new Response(JSON.stringify({
		inserted:  totalInserted,
		skipped:   totalSkipped,
		fetched:   totalTxCount,
		wallets:   addresses,
		perWallet,
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
