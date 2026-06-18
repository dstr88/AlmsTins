/**
 * Core Solana transaction sync — mirrors syncBtcAddress.ts.
 *
 * Fetches a wallet's signature history from a Solana RPC, derives the wallet's
 * own SPL-token and native-SOL balance change per transaction (by diffing
 * pre/post balances), and writes each change as a normalized row into
 * `import_transactions` (source 'solana') — the SAME table the transfer matcher
 * and Resolve flow read. That is what lets a Solana receive pair with an
 * exchange withdrawal and resolve as a self-transfer.
 *
 * Provider-agnostic standard RPC (getSignaturesForAddress + getTransaction).
 * Requires SOLANA_RPC_URL (Helius/Triton); the public RPC rate-limits hard.
 *
 * Scope: wallet token/SOL transfers only. Does NOT decode DeFi positions
 * (Save/dumpy) — a deposit appears as a plain out-transfer, which is accurate
 * at the wallet level.
 */

import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { logActivity } from '@/lib/activityLog';
import type { Wallet } from '@/lib/wallets';
import type { WalletSyncStats } from '@/lib/sync/syncTransactions';

const SOLANA_CHAIN = 'solana';
const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const SIG_PAGE_LIMIT = 1000;     // max getSignaturesForAddress page size
const MAX_PAGES = 20;            // safety cap on history depth
const SOL_DUST = 0.001;          // ignore native-SOL deltas below this (fee noise)

// mint → symbol (extend as needed); fallback to a short mint fingerprint.
const KNOWN_MINTS: Record<string, string> = {
	So11111111111111111111111111111111111111112: 'SOL',
	HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: 'PYTH',
	EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
	Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
};

function rpcUrl(): string {
	return (
		process.env.SOLANA_RPC_URL ||
		(import.meta as { env?: Record<string, string | undefined> }).env?.SOLANA_RPC_URL ||
		PUBLIC_SOLANA_RPC
	);
}

function symbolForMint(mint: string): string {
	return KNOWN_MINTS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

async function solanaRpc<T = unknown>(method: string, params: unknown[], url: string): Promise<T | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			});
			if (!res.ok) {
				if (res.status === 429 && attempt === 0) { await sleep(500); continue; }
				return null;
			}
			const json = (await res.json()) as { result?: T; error?: { message?: string } };
			if (json?.error) {
				if (/rate|too many/i.test(json.error.message ?? '') && attempt === 0) { await sleep(500); continue; }
				return null;
			}
			return json?.result ?? null;
		} catch {
			if (attempt === 0) { await sleep(500); continue; }
			return null;
		}
	}
	return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SigInfo = { signature: string; blockTime?: number | null; err?: unknown };

/** Paginate getSignaturesForAddress back to `untilSignature` (the last-synced cursor). */
async function fetchSignatures(address: string, url: string, untilSignature: string | null): Promise<SigInfo[]> {
	const all: SigInfo[] = [];
	let before: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const opts: Record<string, unknown> = { limit: SIG_PAGE_LIMIT };
		if (before) opts.before = before;
		if (untilSignature) opts.until = untilSignature;
		const batch = await solanaRpc<SigInfo[]>('getSignaturesForAddress', [address, opts], url);
		if (!Array.isArray(batch) || batch.length === 0) break;
		all.push(...batch);
		before = batch[batch.length - 1]?.signature;
		if (batch.length < SIG_PAGE_LIMIT) break;
	}
	return all;
}

type TokenBalance = {
	accountIndex: number;
	mint: string;
	owner?: string;
	uiTokenAmount: { uiAmount: number | null; decimals: number };
};
type ParsedTx = {
	blockTime?: number | null;
	meta?: {
		err?: unknown;
		fee?: number;
		preBalances?: number[];
		postBalances?: number[];
		preTokenBalances?: TokenBalance[];
		postTokenBalances?: TokenBalance[];
	} | null;
	transaction?: { message?: { accountKeys?: Array<{ pubkey: string } | string> } };
};

type NormRow = {
	signature: string;
	timestamp: string;
	direction: 'in' | 'out';
	amount: number;        // absolute
	symbol: string;
	kind: string;
	description: string;
	rowHash: string;
};

/** Diff one transaction's pre/post balances into per-asset rows for `address`. */
function rowsFromTx(tx: ParsedTx, signature: string, address: string): NormRow[] {
	const meta = tx.meta;
	if (!meta || meta.err) return [];   // skip failed txs
	const tsMs = (tx.blockTime ?? 0) * 1000;
	if (!tsMs) return [];
	const timestamp = new Date(tsMs).toISOString();
	const rows: NormRow[] = [];

	// ── SPL tokens: aggregate uiAmount delta per mint for accounts owned by us ──
	const pre = (meta.preTokenBalances ?? []).filter((b) => b.owner === address);
	const post = (meta.postTokenBalances ?? []).filter((b) => b.owner === address);
	const deltaByMint = new Map<string, number>();
	for (const b of pre) {
		deltaByMint.set(b.mint, (deltaByMint.get(b.mint) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
	}
	for (const b of post) {
		deltaByMint.set(b.mint, (deltaByMint.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
	}
	for (const [mint, delta] of deltaByMint) {
		if (Math.abs(delta) < 1e-9) continue;
		rows.push(makeRow(signature, timestamp, delta, symbolForMint(mint), mint));
	}

	// ── Native SOL: delta on our account index (fee-inclusive; dust filtered) ──
	const keys = tx.transaction?.message?.accountKeys ?? [];
	const idx = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === address);
	if (idx >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
		const deltaSol = ((meta.postBalances[idx] ?? 0) - (meta.preBalances[idx] ?? 0)) / 1e9;
		if (Math.abs(deltaSol) >= SOL_DUST) {
			rows.push(makeRow(signature, timestamp, deltaSol, 'SOL', 'native'));
		}
	}
	return rows;
}

function makeRow(signature: string, timestamp: string, delta: number, symbol: string, mintKey: string): NormRow {
	const direction: 'in' | 'out' = delta > 0 ? 'in' : 'out';
	const amount = Math.abs(delta);
	const kind = direction === 'in' ? 'receive' : 'send';
	const rowHash = createHash('sha256')
		.update(JSON.stringify(['solana', signature, mintKey, direction, String(amount)]))
		.digest('hex');
	return {
		signature, timestamp, direction, amount, symbol, kind,
		description: `${kind} ${symbol} (Solana)`,
		rowHash,
	};
}

async function ensureSolanaAccount(tenantId: string, address: string): Promise<string> {
	const existing = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'solana' AND lower(name) = ? LIMIT 1`,
		args: [tenantId, address.toLowerCase()],
	});
	let accountId = String(existing.rows[0]?.id ?? '');
	if (accountId) return accountId;
	const fallback = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'solana' LIMIT 1`,
		args: [tenantId],
	});
	accountId = String(fallback.rows[0]?.id ?? '');
	if (accountId) return accountId;
	accountId = randomUUID();
	await db.execute({
		sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, 'solana', ?)`,
		args: [accountId, tenantId, `Solana Wallet (${address.slice(0, 8)}…)`],
	});
	return accountId;
}

/** Core: fetch + parse + persist. Returns insert counts. */
export async function syncSolanaAddress(
	tenantId: string,
	wallet: Wallet,
): Promise<{ inserted: number; skipped: number; txCount: number }> {
	const url = rpcUrl();
	if (url === PUBLIC_SOLANA_RPC) {
		console.warn('[solana-sync] SOLANA_RPC_URL not set — public RPC will likely rate-limit; sync may be incomplete.');
	}
	const address = wallet.address;
	const walletId = wallet.id;

	// Cursor: last-synced signature (stored in wallet_sync_state.last_timestamp, Sui pattern)
	const stateRes = await db.execute({
		sql: `SELECT last_timestamp FROM wallet_sync_state WHERE wallet_id = ? AND chain = ? AND tenant_id = ? LIMIT 1`,
		args: [walletId, SOLANA_CHAIN, tenantId],
	});
	const rawCursor = stateRes.rows[0]?.last_timestamp ? String(stateRes.rows[0].last_timestamp) : null;
	// Only treat as a signature cursor if it isn't an ISO date
	const untilSignature = rawCursor && !/^\d{4}-\d{2}-\d{2}/.test(rawCursor) ? rawCursor : null;

	const sigs = await fetchSignatures(address, url, untilSignature);
	const newestSignature = sigs[0]?.signature ?? untilSignature;

	const accountId = await ensureSolanaAccount(tenantId, address);
	const batchId = randomUUID();
	const normRows: NormRow[] = [];

	for (const sig of sigs) {
		if (sig.err) continue;
		const tx = await solanaRpc<ParsedTx>('getTransaction', [
			sig.signature,
			{ encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
		], url);
		if (!tx) continue;
		normRows.push(...rowsFromTx(tx, sig.signature, address));
	}

	// Persist (mirror syncBtcAddress import_transactions + import_raw_rows shape).
	const BATCH = 100;
	const rawStmts = normRows.map((r) => ({
		sql: `INSERT INTO import_raw_rows (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'solana', ?, ?)
ON CONFLICT DO NOTHING`,
		args: [randomUUID(), tenantId, accountId, batchId, JSON.stringify(r), r.rowHash],
	}));
	const normStmts = normRows.map((r) => ({
		sql: `INSERT INTO import_transactions
		      (id, tenant_id, source, account_id, wallet_id, import_batch_id, timestamp_utc,
		       description, currency, amount, to_currency, to_amount,
		       native_currency, native_amount, native_usd,
		       kind, tx_hash, direction, asset_symbol, row_hash, created_at)
		      VALUES (?, ?, 'solana', ?, ?, ?, ?,  ?, ?, ?,  NULL, NULL,  'USD', NULL, NULL,  ?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [
			randomUUID(), tenantId, accountId, walletId, batchId, r.timestamp,
			r.description, r.symbol,
			r.direction === 'out' ? -r.amount : r.amount,
			r.kind, r.signature, r.direction, r.symbol, r.rowHash,
		],
	}));

	let inserted = 0;
	for (let i = 0; i < rawStmts.length; i += BATCH) {
		await db.batch(rawStmts.slice(i, i + BATCH), 'write');
	}
	for (let i = 0; i < normStmts.length; i += BATCH) {
		const res = await db.batch(normStmts.slice(i, i + BATCH), 'write');
		inserted += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}

	// Save cursor (newest signature) + last_run_at — used for cron staleness.
	const now = new Date().toISOString();
	await db.execute({
		sql: `INSERT INTO wallet_sync_state (wallet_id, chain, tenant_id, last_block_number, last_timestamp, last_run_at)
		      VALUES (?, ?, ?, 0, ?, ?)
		      ON CONFLICT(tenant_id, wallet_id, chain) DO UPDATE SET
		        last_timestamp = excluded.last_timestamp,
		        last_run_at    = excluded.last_run_at`,
		args: [walletId, SOLANA_CHAIN, tenantId, newestSignature ?? now, now],
	});

	return { inserted, skipped: normStmts.length - inserted, txCount: sigs.length };
}

/** Endpoint/cron-facing wrapper. Runs matching + classify + lifecycle rebuild, returns WalletSyncStats. */
export async function syncSolanaWallet(tenantId: string, wallet: Wallet): Promise<WalletSyncStats> {
	const result = await syncSolanaAddress(tenantId, wallet);

	// Post-sync: pair exchange withdrawals with on-chain receives, classify, refresh cost basis.
	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void rebuildAssetLifecycles(tenantId);

	logActivity(
		tenantId,
		'import',
		`${result.inserted} imported, ${result.skipped} skipped`,
		{ walletId: wallet.id, inserted: result.inserted, skipped: result.skipped },
		{ source: 'solana_sync', chain: SOLANA_CHAIN },
	);

	return {
		walletId: wallet.id,
		totalInserted: result.inserted,
		totalSkipped: result.skipped,
		chains: [{
			walletId: wallet.id,
			chain: SOLANA_CHAIN,
			fetched: result.txCount,
			fetchedNative: result.txCount,
			fetchedToken: 0,
			inserted: result.inserted,
			skipped: result.skipped,
			highestBlock: 0,
			highestTimestamp: null,
			ok: true,
		}],
	};
}

/** Is this wallet a Solana wallet? */
export function isSolanaWallet(chains: string[]): boolean {
	return chains.includes(SOLANA_CHAIN);
}
