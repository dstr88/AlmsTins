/**
 * GET /api/cron/sync-aave
 *
 * Called weekly by Render Cron (staggered 1 hour after sync-wallets).
 * Refreshes Aave/DeFi positions for every active onchain wallet
 * across all tenants.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncLiquidationsToImportTransactions } from '@/lib/aave/syncAaveLiquidations';

export const prerender = false;

const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';
const CHAIN_IDS = [1, 137, 43114];
const CHAIN_KEYS: Record<number, string> = { 1: 'ethereum', 137: 'polygon', 43114: 'avalanche' };
const MARKET_ADDRESSES: Record<number, string> = {
	1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
	137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
	43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const USER_MARKET_STATE_QUERY = `
  query UserMarketState($request: UserMarketStateRequest!) {
    userMarketState(request: $request) {
      healthFactor
      totalCollateralBase
      totalDebtBase
    }
  }
`;

const USER_POSITIONS_QUERY = `
  query UserPositions($user: EvmAddress!, $chainId: ChainId!, $market: EvmAddress!) {
    userSupplies(request: { markets: [{ address: $market, chainId: $chainId }], user: $user, collateralsOnly: false, orderBy: { name: ASC } }) {
      market { name }
      currency { symbol }
      balance { amount { value } }
      apy { value }
    }
    userBorrows(request: { markets: [{ address: $market, chainId: $chainId }], user: $user, orderBy: { name: ASC } }) {
      market { name }
      currency { symbol }
      debt { amount { value } }
      apy { value }
    }
  }
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toNumber(value: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value === 'string') { const n = Number(value); return Number.isFinite(n) ? n : 0; }
	return 0;
}

async function postGraphQL(query: string, variables: Record<string, any>) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await fetch(AAVE_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: controller.signal,
		});
		const json = await res.json().catch(() => ({}));
		return { ok: res.ok, json };
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchChainHealth(address: string, chainId: number) {
	const market = MARKET_ADDRESSES[chainId];
	const chainKey = CHAIN_KEYS[chainId] ?? String(chainId);
	if (!market) return { chain: chainKey, chainId, market: null, healthFactor: null, totalCollateralBase: null, totalDebtBase: null };

	const { ok, json } = await postGraphQL(USER_MARKET_STATE_QUERY, { request: { chainId, market, user: address.toLowerCase() } });
	if (!ok || json.errors) return { chain: chainKey, chainId, market, healthFactor: null, totalCollateralBase: null, totalDebtBase: null };

	const state = json.data?.userMarketState ?? {};
	return { chain: chainKey, chainId, market, healthFactor: state.healthFactor ?? null, totalCollateralBase: state.totalCollateralBase ?? null, totalDebtBase: state.totalDebtBase ?? null };
}

async function fetchChainPositions(address: string, chainId: number) {
	const market = MARKET_ADDRESSES[chainId];
	const chainKey = CHAIN_KEYS[chainId] ?? String(chainId);
	if (!market) return { chain: chainKey, chainId, market: null, positions: [] };

	const { ok, json } = await postGraphQL(USER_POSITIONS_QUERY, { user: address.toLowerCase(), chainId, market });
	if (!ok || json.errors) return { chain: chainKey, chainId, market, positions: [] };

	const supplies = Array.isArray(json.data?.userSupplies) ? json.data.userSupplies : [];
	const borrows = Array.isArray(json.data?.userBorrows) ? json.data.userBorrows : [];

	const positions = [
		...supplies.map((s: any) => ({ side: 'supply', marketName: s.market?.name ?? 'Unknown', assetSymbol: s.currency?.symbol ?? 'UNKNOWN', amount: toNumber(s.balance?.amount?.value), apy: toNumber(s.apy?.value) })),
		...borrows.map((b: any) => ({ side: 'borrow', marketName: b.market?.name ?? 'Unknown', assetSymbol: b.currency?.symbol ?? 'UNKNOWN', amount: toNumber(b.debt?.amount?.value), apy: toNumber(b.apy?.value) })),
	];

	return { chain: chainKey, chainId, market, positions };
}

async function syncWalletAave(tenantId: string, walletId: string, address: string) {
	const healthByChain: Record<string, any> = {};
	const positionsByChain: Record<string, any> = {};

	for (let i = 0; i < CHAIN_IDS.length; i++) {
		const chainId = CHAIN_IDS[i];
		const chainKey = CHAIN_KEYS[chainId];
		healthByChain[chainKey] = await fetchChainHealth(address, chainId);
		positionsByChain[chainKey] = await fetchChainPositions(address, chainId);
		if (i < CHAIN_IDS.length - 1) await sleep(3_000);
	}

	const syncAt = new Date().toISOString();
	await db.execute({
		sql: `INSERT INTO wallet_defi_sync (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total, interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
		      VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?)
		      ON CONFLICT(tenant_id, wallet_id) DO UPDATE SET
		        last_defi_sync_at = excluded.last_defi_sync_at,
		        health_payload = excluded.health_payload,
		        positions_payload = excluded.positions_payload,
		        updated_at = excluded.updated_at`,
		args: [
			tenantId, walletId, syncAt,
			JSON.stringify({ ok: true, address: address.toLowerCase(), chains: healthByChain }),
			JSON.stringify({ ok: true, address: address.toLowerCase(), chains: positionsByChain }),
			syncAt,
		],
	});

	return syncAt;
}

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/sync-aave] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/sync-aave] Starting weekly Aave sync');

	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label
		 FROM wallets
		 WHERE wallet_type = 'onchain' OR wallet_type IS NULL
		 ORDER BY tenant_id, created_at ASC`,
	);
	const wallets = walletsResult.rows as Array<Record<string, unknown>>;
	console.log(`[cron/sync-aave] Found ${wallets.length} onchain wallets`);

	const staleThreshold = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

	const results: Array<{ walletId: string; label: string; status: 'synced' | 'skipped' | 'failed'; error?: string }> = [];

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const address = String(row.address ?? '');
		const label = String(row.label ?? address.slice(-5));

		// Skip non-EVM wallets (Bitcoin, Solana, Litecoin don't have Aave positions)
		const chainsRaw = row.chains;
		const chains: string[] = Array.isArray(chainsRaw) ? chainsRaw : typeof chainsRaw === 'string' ? JSON.parse(chainsRaw as string) : [];
		const hasEvm = chains.some((c) => ['ethereum', 'polygon', 'avalanche'].includes(c));
		if (!hasEvm) {
			console.log(`[cron/sync-aave] Skipping ${label} — no EVM chains`);
			results.push({ walletId, label, status: 'skipped' });
			continue;
		}

		// Skip if synced within last 6 days
		const lastSyncResult = await db.execute({
			sql: `SELECT last_defi_sync_at FROM wallet_defi_sync WHERE wallet_id = ? AND tenant_id = ?`,
			args: [walletId, tenantId],
		});
		const lastSync = (lastSyncResult.rows[0] as Record<string, unknown>)?.last_defi_sync_at as string | null;
		if (lastSync && lastSync > staleThreshold) {
			console.log(`[cron/sync-aave] Skipping ${label} — synced ${lastSync}`);
			results.push({ walletId, label, status: 'skipped' });
			continue;
		}

		try {
			console.log(`[cron/sync-aave] Syncing ${label} (tenant: ${tenantId})`);
			await syncWalletAave(tenantId, walletId, address);
			console.log(`[cron/sync-aave] ${label} done`);
			results.push({ walletId, label, status: 'synced' });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[cron/sync-aave] Failed ${label}:`, message);
			results.push({ walletId, label, status: 'failed', error: message });
		}

		try {
			const liquidationCount = await syncLiquidationsToImportTransactions(tenantId, address);
			if (liquidationCount > 0) {
				console.log(`[cron/sync-aave] ${label}: wrote ${liquidationCount} liquidation(s) to bookkeeping`);
			}
		} catch (err) {
			console.error(
				`[cron/sync-aave] Liquidation sync failed for ${label}:`,
				err instanceof Error ? err.message : String(err),
			);
		}

		await sleep(2_000);
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => r.status === 'synced').length;
	const skipped = results.filter((r) => r.status === 'skipped').length;
	const failed = results.filter((r) => r.status === 'failed').length;

	console.log(`[cron/sync-aave] Done in ${elapsed}ms — synced: ${synced}, skipped: ${skipped}, failed: ${failed}`);

	return json({ ok: true, elapsed_ms: elapsed, total: wallets.length, synced, skipped, failed, results }, 200);
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
