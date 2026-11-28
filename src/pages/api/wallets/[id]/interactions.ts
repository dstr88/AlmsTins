import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { CHAIN_IDS, isContract as checkIsContract } from '@/lib/etherscan';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { explorerAddressUrl } from '@/lib/explorerLinks';
import { shortenAddress } from '@/lib/addressDisplay';
import { knownContract } from '@/lib/knownProtocolContracts';
import { verifiedContractName } from '@/lib/approvals/spenders';

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_800_000; // 30 min

const interactionsCache = new Map<string, { expiresAt: number; payload: { ok: boolean; items: any[] } }>();
const contractCache = new Map<string, { expiresAt: number; isContract: boolean }>();

type DbRow = Record<string, unknown>;

// Polygon and Avalanche by name; anything else reads Ethereum.
const chainId = (chain: string) =>
	chain === 'polygon' || chain === 'avalanche' ? CHAIN_IDS[chain] : CHAIN_IDS.ethereum;

const fetchIsContract = async (cId: number, address: string) => {
	const key = `${cId}:${address}`;
	const cached = contractCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.isContract;
	const isContract = await checkIsContract({ chainId: cId, address });
	contractCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, isContract });
	return isContract;
};

export const GET: APIRoute = async ({ params, request }) => {
	if (!ETHERSCAN_KEY) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing ETHERSCAN_API_KEY' }), { status: 500 });
	}

	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(walletId, tenantId);

		const cacheKey = `${tenantId}:${walletId}`;
		const hit = interactionsCache.get(cacheKey);
		if (hit && hit.expiresAt > Date.now()) {
			return new Response(JSON.stringify(hit.payload), {
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
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Only look at to_address (contracts the user SENT to — potential locked funds)
		// Include tx count, total value sent, and last interaction date per contract.
		// value is cast to double precision, not REAL: REAL is 4-byte on Postgres, and a
		// raw base-unit token amount above ~3.4e38 overflows it and fails the query.
		const result = await db.execute({
			sql: `SELECT
					chain,
					LOWER(to_address) AS address,
					COUNT(DISTINCT hash) AS tx_count, -- transactions, not rows: one can hold several movements
					MAX(timestamp) AS last_seen,
					SUM(CASE WHEN CAST(value AS double precision) > 0 THEN CAST(value AS double precision) ELSE 0 END) AS total_value
				FROM transactions
				WHERE wallet_id = ?
				  AND tenant_id = ?
				  AND to_address IS NOT NULL
				  AND LOWER(to_address) != ?
				  AND LOWER(to_address) != '0x0000000000000000000000000000000000000000'
				GROUP BY chain, LOWER(to_address)
				ORDER BY last_seen DESC
				LIMIT 80`,
			args: [walletId, tenantId, walletAddress],
		});

		const rows = (result.rows ?? []) as DbRow[];

		const items: Array<{
			name: string;
			address: string;
			url: string;
			chain: string;
			txCount: number;
			lastSeen: string | null;
			totalValue: number;
			isKnown: boolean;
		}> = [];

		// Track seen addresses to avoid duplicates across chains
		const seenAddresses = new Set<string>();

		for (const row of rows) {
			if (items.length >= 25) break;

			const address = String(row.address ?? '').toLowerCase();
			const chain = String(row.chain ?? 'ethereum');
			const txCount = Number(row.tx_count ?? 1);
			const lastSeen = row.last_seen ? String(row.last_seen) : null;
			const totalValue = Number(row.total_value ?? 0);

			if (!address || seenAddresses.has(address)) continue;

			const known = knownContract(address);
			if (known) {
				seenAddresses.add(address);
				items.push({
					name: known.name,
					address,
					url: known.url,
					chain,
					txCount,
					lastSeen,
					totalValue,
					isKnown: true,
				});
				continue;
			}

			// Verify it's actually a contract (not just another wallet)
			const cId = chainId(chain);
			try {
				const contract = await fetchIsContract(cId, address);
				if (!contract) continue;
			} catch {
				continue;
			}

			seenAddresses.add(address);
			// An unknown chain was checked on Ethereum (chainId above), so it links there too.
			const url = explorerAddressUrl(chain, address) ?? explorerAddressUrl('ethereum', address) ?? '';
			const verifiedName = await verifiedContractName(cId, address).catch(() => null);
			items.push({
				name: verifiedName || shortenAddress(address),
				address,
				url,
				chain,
				txCount,
				lastSeen,
				totalValue,
				isKnown: Boolean(verifiedName),
			});
		}

		const payload = { ok: true, items };
		interactionsCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
		});
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[interactions] error', err);
		return new Response(JSON.stringify({ error: true, message: 'Internal error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
