import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getNftTransfers } from '@/lib/etherscan';

const ETHERSCAN_KEY = import.meta.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_000;
const cache = new Map<string, { expiresAt: number; payload: { ok: boolean; items: any[] } }>();
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_STALE_MAX_MS = 60 * 60 * 1000;
const SNAPSHOT_LOCK_SECONDS = 20;

const CHAINS = [
	{ chainId: 137, name: 'polygon', opensea: 'https://opensea.io/assets/matic', explorer: 'https://polygonscan.com' },
	{ chainId: 1, name: 'ethereum', opensea: 'https://opensea.io/assets/ethereum', explorer: 'https://etherscan.io' },
	{ chainId: 43114, name: 'avalanche', opensea: null, explorer: 'https://snowtrace.io' },
];

const FUNGIBLE_SYMBOLS = new Set(['CRO']);

const isFungibleToken = (tx: any) => {
	const symbol = String(tx.tokenSymbol ?? '').trim().toUpperCase();
	const name = String(tx.tokenName ?? '').trim().toLowerCase();
	return FUNGIBLE_SYMBOLS.has(symbol) || name.includes('crypto.com');
};

export const GET: APIRoute = async ({ params, request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const logPerf = (status: number, meta?: { cached?: boolean; stale?: boolean; count?: number }) => {
		console.log('[perf] wallet-nfts', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status,
			...(meta ?? {}),
		});
	};
	if (!ETHERSCAN_KEY) {
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, error: 'Missing ETHERSCAN_API_KEY' }), { status: 500 });
	}

	const walletId = params.id;
	if (!walletId) {
		logPerf(400);
		return new Response(JSON.stringify({ ok: false, error: 'Missing wallet id' }), { status: 400 });
	}

	const { tenantId } = await requireTenantSession(request);
	const cacheKey = `${tenantId}:${walletId}`;
	const lockKey = `nfts:${tenantId}:${walletId}`;
	const cachedResponse = cache.get(cacheKey);
	if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
		logPerf(200, { cached: true, stale: false, count: cachedResponse.payload.items.length });
		return new Response(JSON.stringify({ ...cachedResponse.payload, cached: true, stale: false, asOf: null }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
		});
	}

	const snapshotResult = await db.execute({
		sql: `SELECT payload_json, as_of, updated_at
			FROM wallet_nft_snapshot
			WHERE tenant_id = ? AND wallet_id = ? AND chain_id = ?
			LIMIT 1`,
		args: [tenantId, walletId, 0],
	});
	const snapshotRow = snapshotResult.rows?.[0] as
		| { payload_json?: string; as_of?: string; updated_at?: string }
		| undefined;
	if (snapshotRow?.payload_json) {
		let snapshotPayload: any = null;
		try {
			snapshotPayload = JSON.parse(String(snapshotRow.payload_json));
		} catch {
			snapshotPayload = null;
		}
		if (snapshotPayload) {
			const updatedAtMs = snapshotRow.updated_at ? Date.parse(snapshotRow.updated_at) : 0;
			const now = Date.now();
			const stale = Number.isFinite(updatedAtMs) ? now - updatedAtMs > SNAPSHOT_TTL_MS : true;
			const overStaleMax = Number.isFinite(updatedAtMs) ? now - updatedAtMs > SNAPSHOT_STALE_MAX_MS : false;

			if (stale && !overStaleMax) {
				(async () => {
					const gotLock = await tryAcquireLock(lockKey, SNAPSHOT_LOCK_SECONDS);
					if (!gotLock) {
						console.log('[cache] nfts refresh skip (lock-busy)', { requestId, walletId });
						return;
					}
					try {
						const refreshed = await buildNftPayload(tenantId, walletId);
						await upsertNftSnapshot(tenantId, walletId, refreshed);
						cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload: refreshed });
						console.log('[cache] nfts refreshed', { requestId, walletId });
					} catch (error) {
						console.warn('[cache] nfts refresh failed', { requestId, walletId, error });
					}
				})();
			}

			logPerf(200, { cached: true, stale, count: Array.isArray(snapshotPayload?.items) ? snapshotPayload.items.length : 0 });
			return new Response(
				JSON.stringify({
					...snapshotPayload,
					cached: true,
					stale,
					asOf: snapshotRow.as_of ?? snapshotPayload.asOf,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
				},
			);
		}
	}

	try {
		const payload = await buildNftPayload(tenantId, walletId);
		await upsertNftSnapshot(tenantId, walletId, payload);
		cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
		logPerf(200, { cached: false, stale: false, count: payload.items.length });

		return new Response(JSON.stringify({ ...payload, cached: false, stale: false, asOf: payload.asOf }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to load NFTs.';
		if (message === 'Wallet not found') {
			logPerf(404);
			return new Response(JSON.stringify({ ok: false, error: message }), { status: 404 });
		}
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
	}
};

async function upsertNftSnapshot(tenantId: string, walletId: string, payload: { ok: boolean; items: any[]; asOf?: string }) {
	const nowIso = new Date().toISOString();
	const asOf = payload.asOf ?? nowIso;
	await db.execute({
		sql: `INSERT INTO wallet_nft_snapshot (tenant_id, wallet_id, chain_id, payload_json, as_of, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id, wallet_id, chain_id) DO UPDATE SET
				payload_json = excluded.payload_json,
				as_of = excluded.as_of,
				updated_at = excluded.updated_at`,
		args: [tenantId, walletId, 0, JSON.stringify(payload), asOf, nowIso],
	});
}

async function buildNftPayload(tenantId: string, walletId: string) {
	const walletResult = await db.execute({
		sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const address = String(walletResult.rows?.[0]?.address ?? '').toLowerCase();
	if (!address) {
		throw new Error('Wallet not found');
	}

	const allTransfers: Array<any> = [];

	for (const chain of CHAINS) {
		const actions = ['tokennfttx', 'token1155tx'];
		for (const action of actions) {
			try {
				// Etherscan calls centralized in src/lib/etherscan.ts.
				const items = await getNftTransfers(address, chain.chainId, action as 'tokennfttx' | 'token1155tx');
				items.forEach((item: any) => {
					if (isFungibleToken(item)) return;
					allTransfers.push({ ...item, chainId: chain.chainId, chain: chain.name });
				});
			} catch (error) {
				console.warn('[nfts] fetch failed', chain.name, action, error);
			}
		}
	}

	allTransfers.sort((a, b) => Number(b.timeStamp ?? 0) - Number(a.timeStamp ?? 0));
	const owned = new Map<string, any>();

	for (const tx of allTransfers) {
		const contract = String(tx.contractAddress ?? '').toLowerCase();
		const tokenId = String(tx.tokenID ?? tx.tokenId ?? '');
		if (!contract || !tokenId) continue;
		const key = `${tx.chainId}:${contract}:${tokenId}`;
		if (owned.has(key)) continue;
		const to = String(tx.to ?? '').toLowerCase();
		if (to === address) {
			owned.set(key, tx);
		}
	}

	const hiddenResult = await db.execute({
		sql: `SELECT chain_id, contract_address, token_id
			FROM nft_hidden
			WHERE tenant_id = ? AND wallet_id = ?`,
		args: [tenantId, walletId],
	});
	const hiddenSet = new Set(
		(hiddenResult.rows ?? []).map((row: any) => {
			const chainId = Number(row.chain_id ?? 0);
			const contract = String(row.contract_address ?? '').toLowerCase();
			const tokenId = String(row.token_id ?? '');
			return `${chainId}:${contract}:${tokenId}`;
		}),
	);

	const items = Array.from(owned.values())
		.filter((tx) => {
			const contract = String(tx.contractAddress ?? '').toLowerCase();
			const tokenId = String(tx.tokenID ?? tx.tokenId ?? '');
			if (!contract || !tokenId) return false;
			const key = `${tx.chainId}:${contract}:${tokenId}`;
			return !hiddenSet.has(key);
		})
		.slice(0, 12)
		.map((tx) => {
			const chain = CHAINS.find((c) => c.chainId === tx.chainId);
			const contract = String(tx.contractAddress ?? '').toLowerCase();
			const tokenId = String(tx.tokenID ?? tx.tokenId ?? '');
			const name = tx.tokenName ? String(tx.tokenName) : null;
			const symbol = tx.tokenSymbol ? String(tx.tokenSymbol) : null;
			const url = chain?.opensea
				? `${chain.opensea}/${contract}/${tokenId}`
				: `${chain?.explorer ?? ''}/token/${contract}?a=${tokenId}`;
			return {
				chainId: tx.chainId,
				chain: chain?.name ?? 'unknown',
				contract,
				tokenId,
				name,
				symbol,
				url,
			};
		});

	return { ok: true, items, asOf: new Date().toISOString() };
}
