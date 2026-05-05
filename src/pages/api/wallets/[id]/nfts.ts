import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getNftTransfers, buildEtherscanV2Url, requestEtherscan } from '@/lib/etherscan';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { fetchNftImageUrls } from '@/lib/nftImageUrl';

const ETHERSCAN_KEY = import.meta.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_000;
const cache = new Map<string, { expiresAt: number; payload: NftPayload }>();
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_STALE_MAX_MS = 60 * 60 * 1000;
const SNAPSHOT_LOCK_SECONDS = 20;

// Request-scoped cache for tx value lookups to avoid duplicate Etherscan calls
const txValueCache = new Map<string, bigint>();

const CHAINS = [
	{ chainId: 137, name: 'polygon', opensea: 'https://opensea.io/assets/matic', explorer: 'https://polygonscan.com' },
	{ chainId: 1, name: 'ethereum', opensea: 'https://opensea.io/assets/ethereum', explorer: 'https://etherscan.io' },
	{ chainId: 43114, name: 'avalanche', opensea: null, explorer: 'https://snowtrace.io' },
];

const FUNGIBLE_SYMBOLS = new Set(['CRO']);

export type NftStatus = 'purchased' | 'whitelisted' | 'blacklisted' | 'airdrop';

export type NftItem = {
	chainId: number;
	chain: string;
	contract: string;
	tokenId: string;
	name: string | null;
	symbol: string | null;
	url: string | null;
	imageUrl: string | null;
	status: NftStatus;
};

type NftPayload = {
	ok: boolean;
	items: NftItem[];
	allItems: NftItem[];
	asOf?: string;
};

const isFungibleToken = (tx: any) => {
	const symbol = String(tx.tokenSymbol ?? '').trim().toUpperCase();
	const name = String(tx.tokenName ?? '').trim().toLowerCase();
	return FUNGIBLE_SYMBOLS.has(symbol) || name.includes('crypto.com');
};

/** Look up the ETH value of a transaction by hash. Returns 0n if unavailable. */
async function getTxValue(chainId: number, hash: string): Promise<bigint> {
	const cacheKey = `${chainId}:${hash}`;
	if (txValueCache.has(cacheKey)) return txValueCache.get(cacheKey)!;

	try {
		const url = buildEtherscanV2Url(chainId, {
			module: 'proxy',
			action: 'eth_getTransactionByHash',
			txhash: hash,
		});
		const data = await requestEtherscan(url, { cacheTtlMs: 60_000 });
		const hexValue = String((data as any)?.result?.value ?? '0x0');
		const value = hexValue && hexValue !== '0x' ? BigInt(hexValue) : 0n;
		txValueCache.set(cacheKey, value);
		return value;
	} catch {
		txValueCache.set(cacheKey, 0n);
		return 0n;
	}
}

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
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	try {
		await requireWalletOwnedByTenant(walletId, tenantId);
	} catch (err) {
		if (err instanceof Response) return err;
		throw err;
	}

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

	let snapshotResult: { rows?: any[] } | null = null;
	try {
		snapshotResult = await db.execute({
			sql: `SELECT payload_json, as_of, updated_at
				FROM wallet_nft_snapshot
				WHERE tenant_id = ? AND wallet_id = ? AND chain_id = ?
				LIMIT 1`,
			args: [tenantId, walletId, 0],
		});
	} catch (error) {
		const message = String((error as any)?.message ?? error);
		if (message.includes('wallet_nft_snapshot') && message.includes('no such table')) {
			console.warn('[nfts] missing wallet_nft_snapshot table', { requestId, walletId });
			logPerf(200, { cached: false, stale: false, count: 0 });
			return new Response(JSON.stringify({ ok: true, items: [], allItems: [], cached: false, stale: false, asOf: null }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
			});
		}
		throw error;
	}

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
				JSON.stringify({ ...snapshotPayload, cached: true, stale, asOf: snapshotRow.as_of ?? snapshotPayload.asOf }),
				{ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' } },
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
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
	}
};

async function upsertNftSnapshot(tenantId: string, walletId: string, payload: NftPayload) {
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

async function buildNftPayload(tenantId: string, walletId: string): Promise<NftPayload> {
	const walletResult = await db.execute({
		sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const address = String(walletResult.rows?.[0]?.address ?? '').toLowerCase();
	if (!address) throw new Error('Wallet not found');

	// Fetch all NFT transfers across supported chains
	const allTransfers: Array<any> = [];
	for (const chain of CHAINS) {
		for (const action of ['tokennfttx', 'token1155tx'] as const) {
			try {
				const items = await getNftTransfers({ chainId: chain.chainId, address, action });
				items.forEach((item: any) => {
					if (isFungibleToken(item)) return;
					allTransfers.push({ ...item, chainId: chain.chainId, chain: chain.name });
				});
			} catch (error) {
				console.warn('[nfts] fetch failed', chain.name, action, error);
			}
		}
	}

	// Build owned map — most recent transfer first, only "to" = wallet
	allTransfers.sort((a, b) => Number(b.timeStamp ?? 0) - Number(a.timeStamp ?? 0));
	const owned = new Map<string, any>();
	for (const tx of allTransfers) {
		const contract = String(tx.contractAddress ?? '').toLowerCase();
		const tokenId = String(tx.tokenID ?? tx.tokenId ?? '');
		if (!contract || !tokenId) continue;
		const key = `${tx.chainId}:${contract}:${tokenId}`;
		if (owned.has(key)) continue;
		if (String(tx.to ?? '').toLowerCase() === address) {
			owned.set(key, tx);
		}
	}

	// Load blacklist (nft_hidden) and whitelist in parallel
	const [blacklistResult, whitelistResult] = await Promise.all([
		db.execute({
			sql: 'SELECT chain_id, contract_address, token_id FROM nft_hidden WHERE tenant_id = ? AND wallet_id = ?',
			args: [tenantId, walletId],
		}),
		db.execute({
			sql: 'SELECT chain_id, contract_address, token_id FROM nft_whitelist WHERE tenant_id = ? AND wallet_id = ?',
			args: [tenantId, walletId],
		}).catch(() => ({ rows: [] })), // graceful fallback if table doesn't exist yet
	]);

	const makeSet = (rows: any[]) =>
		new Set(
			rows.map((row: any) =>
				`${Number(row.chain_id ?? 0)}:${String(row.contract_address ?? '').toLowerCase()}:${String(row.token_id ?? '')}`,
			),
		);

	const blacklistSet = makeSet(blacklistResult.rows ?? []);
	const whitelistSet = makeSet(whitelistResult.rows ?? []);

	// Assign status + build items
	const allItems: NftItem[] = [];
	const visibleItems: NftItem[] = [];

	for (const tx of owned.values()) {
		const chain = CHAINS.find((c) => c.chainId === tx.chainId);
		const contract = String(tx.contractAddress ?? '').toLowerCase();
		const tokenId = String(tx.tokenID ?? tx.tokenId ?? '');
		if (!contract || !tokenId) continue;

		const key = `${tx.chainId}:${contract}:${tokenId}`;
		const name = tx.tokenName ? String(tx.tokenName) : null;
		const symbol = tx.tokenSymbol ? String(tx.tokenSymbol) : null;
		const url = chain?.opensea
			? `${chain.opensea}/${contract}/${tokenId}`
			: `${chain?.explorer ?? ''}/token/${contract}?a=${tokenId}`;

		let status: NftStatus;
		if (blacklistSet.has(key)) {
			status = 'blacklisted';
		} else if (whitelistSet.has(key)) {
			status = 'whitelisted';
		} else {
			// Purchase detection: check parent tx value
			const txHash = String(tx.hash ?? '');
			const txValue = txHash ? await getTxValue(tx.chainId, txHash) : 0n;
			status = txValue > 0n ? 'purchased' : 'airdrop';
		}

		const item: NftItem = {
			chainId: tx.chainId,
			chain: chain?.name ?? 'unknown',
			contract,
			tokenId,
			name,
			symbol,
			url,
			imageUrl: null,
			status,
		};

		allItems.push(item);
		if (status === 'purchased' || status === 'whitelisted') {
			visibleItems.push(item);
		}
	}

	// Fetch image URLs for the visible items only (max 12), in parallel.
	// Failures are silently null — never blocks the response beyond the per-call timeouts.
	const sliced = visibleItems.slice(0, 12);
	try {
		const imageUrls = await fetchNftImageUrls(
			sliced.map((item) => ({ chainId: item.chainId, contract: item.contract, tokenId: item.tokenId })),
		);
		imageUrls.forEach((url, i) => { sliced[i].imageUrl = url; });
	} catch {
		// Image fetching is best-effort
	}

	return {
		ok: true,
		items: sliced,
		allItems,
		asOf: new Date().toISOString(),
	};
}
