import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = import.meta.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_000;
const cache = new Map<string, { expiresAt: number; payload: { ok: boolean; items: any[] } }>();

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

const buildUrl = (chainId: number, action: string, address: string) => {
	const params = new URLSearchParams({
		chainid: String(chainId),
		module: 'account',
		action,
		address,
		page: '1',
		offset: '200',
		sort: 'desc',
		apikey: ETHERSCAN_KEY ?? '',
	});
	return `${ETHERSCAN_V2}?${params.toString()}`;
};

export const GET: APIRoute = async ({ params, request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const logPerf = (status: number, meta?: { cached?: boolean; count?: number }) => {
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
	const cachedResponse = cache.get(cacheKey);
	if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
		logPerf(200, { cached: true, count: cachedResponse.payload.items.length });
		return new Response(JSON.stringify(cachedResponse.payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
		});
	}

	const walletResult = await db.execute({
		sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const address = String(walletResult.rows?.[0]?.address ?? '').toLowerCase();
	if (!address) {
		logPerf(404);
		return new Response(JSON.stringify({ ok: false, error: 'Wallet not found' }), { status: 404 });
	}

	const allTransfers: Array<any> = [];

	for (const chain of CHAINS) {
		const actions = ['tokennfttx', 'token1155tx'];
		for (const action of actions) {
			const url = buildUrl(chain.chainId, action, address);
			try {
				const response = await fetch(url);
				const payload = await response.json();
				const items = Array.isArray(payload.result) ? payload.result : [];
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

	const payload = { ok: true, items };
	cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
	logPerf(200, { cached: false, count: items.length });

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
	});
};
