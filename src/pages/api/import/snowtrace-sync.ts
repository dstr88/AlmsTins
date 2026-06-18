/**
 * POST /api/import/snowtrace-sync
 *
 * Fetches native AVAX transactions for a wallet directly from the
 * Routescan API (Etherscan-compatible, Avalanche C-Chain) and imports
 * any new rows into import_transactions.
 *
 * Uses SNOWTRACE_API_KEY from environment (already set in .env).
 * Pagination: fetches up to 10,000 rows per page (API max) until
 * a page returns fewer rows than requested (last page).
 */

import type { APIRoute } from 'astro';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';
import { snapshotCexAccount } from '@/lib/cexSnapshot';

const ROUTESCAN_BASE = 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';
const AVAX_DECIMALS  = 18n;
const PAGE_SIZE      = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function weiToAvax(weiStr: string): number {
	try {
		const wei = BigInt(weiStr || '0');
		if (wei === 0n) return 0;
		// Divide by 10^18 keeping up to 18 decimal places
		const divisor = 10n ** AVAX_DECIMALS;
		const whole   = wei / divisor;
		const frac    = wei % divisor;
		const fracStr = frac.toString().padStart(Number(AVAX_DECIMALS), '0');
		return Number(`${whole}.${fracStr}`);
	} catch {
		return 0;
	}
}

async function fetchTxPage(address: string, apiKey: string, page: number): Promise<any[]> {
	const params = new URLSearchParams({
		module:     'account',
		action:     'txlist',
		address:    address.toLowerCase(),
		startblock: '0',
		endblock:   '99999999',
		page:       String(page),
		offset:     String(PAGE_SIZE),
		sort:       'desc',
		apikey:     apiKey,
	});
	const url = `${ROUTESCAN_BASE}?${params}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Routescan HTTP ${res.status}`);
	const payload = await res.json();
	const status  = String(payload?.status ?? '');
	const msg     = String(payload?.message ?? '').toLowerCase();

	if (status === '0') {
		if (msg.includes('no transactions')) return [];
		throw new Error(`Routescan error: ${payload?.message} — ${payload?.result}`);
	}
	return Array.isArray(payload?.result) ? payload.result : [];
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const apiKey = import.meta.env.SNOWTRACE_API_KEY as string | undefined;
	if (!apiKey) {
		return new Response(JSON.stringify({ error: 'SNOWTRACE_API_KEY not configured.' }), { status: 500 });
	}

	// ── Resolve wallet address & account ────────────────────────────────────

	const body        = await request.json().catch(() => ({}));
	let walletAddress = (body?.address as string | undefined)?.trim().toLowerCase() ?? '';

	// Fall back: look up from address_labels (stored during CSV import)
	if (!walletAddress) {
		const res = await db.execute({
			sql: `SELECT address FROM address_labels
			      WHERE tenant_id = ? AND source IN ('user','system')
			        AND (label LIKE '%Avalanche%' OR label LIKE '%avalanche%')
			        AND address LIKE '0x%'
			      LIMIT 1`,
			args: [tenantId],
		});
		walletAddress = String(res.rows[0]?.address ?? '').toLowerCase();
	}

	if (!walletAddress) {
		return new Response(JSON.stringify({
			error: 'No Avalanche C-Chain wallet address found. Import a Snowtrace CSV first or pass { address: "0x…" } in the request body.',
		}), { status: 400 });
	}

	// Resolve or create the exchange account for this wallet
	const accRes = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'avalanche_cchain' LIMIT 1`,
		args: [tenantId],
	});
	let accountId = String(accRes.rows[0]?.id ?? '');
	if (!accountId) {
		accountId = randomUUID();
		await db.execute({
			sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, 'avalanche_cchain', ?)`,
			args: [accountId, tenantId, `Avalanche Wallet (${walletAddress.slice(0, 10)}…)`],
		});
	}

	// Look up wallet_id from wallets table so imported transactions are linked
	const walletRow = await db.execute({
		sql: `SELECT id FROM wallets WHERE tenant_id = ? AND lower(address) = ? LIMIT 1`,
		args: [tenantId, walletAddress.toLowerCase()],
	});
	const walletId = walletRow.rows.length ? String(walletRow.rows[0].id ?? '') : null;

	// ── Fetch all pages from Routescan ───────────────────────────────────────

	const allTxs: any[] = [];
	let page = 1;
	while (true) {
		const rows = await fetchTxPage(walletAddress, apiKey, page);
		allTxs.push(...rows);
		if (rows.length < PAGE_SIZE) break;   // last page
		page++;
	}

	if (!allTxs.length) {
		return new Response(JSON.stringify({ inserted: 0, skipped: 0, message: 'No transactions found for this wallet.' }), { status: 200 });
	}

	// ── Normalise ────────────────────────────────────────────────────────────

	const batchId = randomUUID();

	type NormRow = {
		txHash:    string;
		timestamp: string;
		direction: 'in' | 'out';
		amount:    number;
		nativeUsd: null;       // Routescan txlist doesn't return historical price
		kind:      string;
		description: string;
		rowHash:   string;
	};

	const normRows: NormRow[] = [];

	for (const tx of allTxs) {
		// Skip failed transactions
		if (tx.isError === '1' || tx.txreceipt_status === '0') continue;

		const valueAvax = weiToAvax(tx.value ?? '0');

		// Skip zero-value transactions (contract calls, Approve, etc.)
		if (valueAvax === 0) continue;

		const tsMs      = Number(tx.timeStamp ?? '0') * 1000;
		if (!tsMs) continue;
		const timestamp = new Date(tsMs).toISOString();

		const from      = String(tx.from ?? '').toLowerCase();
		const to        = String(tx.to   ?? '').toLowerCase();
		const direction: 'in' | 'out' = to === walletAddress ? 'in' : 'out';

		const method = tx.functionName?.split('(')?.[0]?.trim() || tx.methodId || '';
		const kind   = method || (direction === 'in' ? 'deposit' : 'withdrawal');
		const counterparty = direction === 'in'
			? `from ${from.slice(0, 10)}…`
			: `to ${to.slice(0, 10)}…`;
		const description = `${kind} ${counterparty}`;

		const txHash    = String(tx.hash ?? '');
		const rowHash   = createHash('sha256')
			.update(JSON.stringify(['avalanche_cchain', txHash, timestamp, direction, String(valueAvax)]))
			.digest('hex');

		normRows.push({ txHash, timestamp, direction, amount: valueAvax, nativeUsd: null, kind, description, rowHash });
	}

	// ── Insert ────────────────────────────────────────────────────────────────

	const rawStmts = normRows.map(r => ({
		sql: `INSERT INTO import_raw_rows
		      (id, tenant_id, account_id, batch_id, source, raw_json, row_hash)
		      VALUES (?, ?, ?, ?, 'avalanche_cchain', ?, ?)
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
		      VALUES (?, ?, 'avalanche_cchain', ?, ?, ?, ?,  ?, 'AVAX', ?,  NULL, NULL,  'USD', NULL, NULL,  ?, ?, ?, 'AVAX', ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT DO NOTHING`,
		args: [
			randomUUID(), tenantId, accountId, walletId, batchId, r.timestamp,
			r.description,
			r.direction === 'out' ? -r.amount : r.amount,
			r.kind, r.txHash, r.direction, r.rowHash,
		],
	}));

	const BATCH = 100;
	let insertedRaw = 0, insertedNorm = 0;
	for (let i = 0; i < rawStmts.length; i += BATCH) {
		const res = await db.batch(rawStmts.slice(i, i + BATCH), 'write');
		insertedRaw += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}
	for (let i = 0; i < normStmts.length; i += BATCH) {
		const res = await db.batch(normStmts.slice(i, i + BATCH), 'write');
		insertedNorm += res.reduce((s, r) => s + (r.rowsAffected ?? 0), 0);
	}

	// Run tenant-wide (no accountId filter) so Coinbase OUTs are scanned
	// against the newly imported Snowtrace INs, not just Snowtrace OUTs.
	// Snapshot the account so the Portfolio tin reflects the updated balance
	void snapshotCexAccount(tenantId, accountId, 'avalanche_cchain', `Avalanche Wallet (${walletAddress.slice(0, 10)}…)`);

	// Register the real on-chain address in the wallets table so the NFT
	// system and wallet-value sync can query it by actual address.
	if (walletAddress) {
		const existingWallet = await db.execute({
			sql: `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
			args: [tenantId, walletAddress],
		});
		if (!existingWallet.rows.length) {
			await db.execute({
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')
ON CONFLICT DO NOTHING`,
				args: [
					randomUUID(),
					tenantId,
					walletAddress,
					`Avalanche Wallet (${walletAddress.slice(0, 10)}…)`,
					JSON.stringify(['ethereum', 'polygon', 'avalanche']),
				],
			}).catch(() => { /* already exists — race condition or duplicate is fine */ });
		}
	}

	// Run tenant-wide (no accountId filter) so Coinbase OUTs are scanned
	// against the newly imported Snowtrace INs, not just Snowtrace OUTs.
	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(tenantId, 'import', `${insertedNorm} imported`, { inserted: insertedNorm }, { source: 'snowtrace', chain: 'avalanche' });

	return new Response(JSON.stringify({
		inserted:  insertedNorm,
		skipped:   normStmts.length - insertedNorm,
		fetched:   allTxs.length,
		wallet:    walletAddress,
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
