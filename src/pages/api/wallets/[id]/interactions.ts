import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getContractCode } from '@/lib/etherscan';

const ETHERSCAN_KEY = import.meta.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_800_000;

const interactionsCache = new Map<string, { expiresAt: number; payload: { ok: boolean; items: any[] } }>();
const contractCache = new Map<string, { expiresAt: number; isContract: boolean }>();

type DbRow = Record<string, unknown>;
type InteractionRow = { chain: string | null; address: string | null };

function toInteractionRow(row: unknown): InteractionRow | null {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	const chain = typeof r.chain === 'string' ? r.chain : null;
	const address = typeof r.address === 'string' ? r.address : null;
	return { chain, address };
}

function toInteractionRows(rows: unknown): InteractionRow[] {
	if (!Array.isArray(rows)) return [];
	const out: InteractionRow[] = [];
	for (const row of rows) {
		const mapped = toInteractionRow(row);
		if (mapped) out.push(mapped);
	}
	return out;
}

const CHAIN_EXPLORERS: Record<string, string> = {
	ethereum: 'https://etherscan.io/address',
	polygon: 'https://polygonscan.com/address',
	avalanche: 'https://snowtrace.io/address',
};

const KNOWN_CONTRACTS: Record<string, { name: string; url: string }> = {
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave', url: 'https://aave.com' },
	'0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave', url: 'https://aave.com' },
};

const displayLabel = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
};

const fetchIsContract = async (chainId: number, address: string) => {
	const cacheKey = `${chainId}:${address}`;
	const cached = contractCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.isContract;

	// Etherscan call centralized in src/lib/etherscan.ts.
	const code = await getContractCode(chainId, address);
	const isContract = Boolean(code && code !== '0x');
	contractCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, isContract });
	return isContract;
};

export const GET: APIRoute = async ({ params, request }) => {
	if (!ETHERSCAN_KEY) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing ETHERSCAN_API_KEY' }), { status: 500 });
	}

	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing wallet id' }), { status: 400 });
	}

	const { tenantId } = await requireTenantSession(request);
	const cacheKey = `${tenantId}:${walletId}`;
	const cachedResponse = interactionsCache.get(cacheKey);
	if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
		return new Response(JSON.stringify(cachedResponse.payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
		});
	}

	const walletResult = await db.execute({
		sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const walletAddress = String(walletResult.rows?.[0]?.address ?? '').toLowerCase();
	if (!walletAddress) {
		return new Response(JSON.stringify({ ok: false, error: 'Wallet not found' }), { status: 404 });
	}

	const interactionsResult = await db.execute({
		sql: `WITH interactions AS (
				SELECT chain, LOWER(to_address) AS address, timestamp
				FROM transactions
				WHERE wallet_id = ? AND tenant_id = ? AND to_address IS NOT NULL AND LOWER(to_address) != ?
				UNION ALL
				SELECT chain, LOWER(from_address) AS address, timestamp
				FROM transactions
				WHERE wallet_id = ? AND tenant_id = ? AND from_address IS NOT NULL AND LOWER(from_address) != ?
			)
			SELECT chain, address, MAX(timestamp) AS last_seen
			FROM interactions
			GROUP BY chain, address
			ORDER BY last_seen DESC
			LIMIT 60`,
		args: [walletId, tenantId, walletAddress, walletId, tenantId, walletAddress],
	});

	const candidates = toInteractionRows(interactionsResult.rows);
	const items: Array<{ name: string; address: string; url: string }> = [];
	const seenLabels = new Set<string>();
	const seenExplorers = new Set<string>();

	for (const entry of candidates) {
		if (items.length >= 20) break;
		const chain = entry.chain || 'ethereum';
		const address = String(entry.address ?? '').toLowerCase();
		if (!address) continue;

		const known = KNOWN_CONTRACTS[address];
		if (known) {
			const label = displayLabel(known.url);
			if (seenLabels.has(label)) continue;
			items.push({ name: label, address, url: known.url });
			seenLabels.add(label);
			continue;
		}

		const chainId = chain === 'polygon' ? 137 : chain === 'avalanche' ? 43114 : 1;
		try {
			const isContract = await fetchIsContract(chainId, address);
			if (!isContract) continue;
		} catch (error) {
			console.warn('[interactions] contract check failed', chain, address, error);
			continue;
		}

		const explorer = CHAIN_EXPLORERS[chain] ?? CHAIN_EXPLORERS.ethereum;
		const explorerHome = explorer.replace(/\/address$/, '');
		if (seenExplorers.has(explorerHome)) continue;
		const label = displayLabel(explorerHome);
		if (seenLabels.has(label)) continue;
		items.push({ name: label, address, url: explorerHome });
		seenExplorers.add(explorerHome);
		seenLabels.add(label);
	}

	const payload = { ok: true, items };
	interactionsCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
	});
};
