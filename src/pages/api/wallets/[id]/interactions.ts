import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { isContract as checkIsContract, buildEtherscanV2Url, requestEtherscan } from '@/lib/etherscan';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

const ETHERSCAN_KEY = import.meta.env.ETHERSCAN_API_KEY;
const CACHE_TTL_MS = 1_800_000; // 30 min

const interactionsCache = new Map<string, { expiresAt: number; payload: { ok: boolean; items: any[] } }>();
const contractCache = new Map<string, { expiresAt: number; isContract: boolean }>();

type DbRow = Record<string, unknown>;

const CHAIN_EXPLORERS: Record<string, string> = {
	ethereum: 'https://etherscan.io/address',
	polygon:  'https://polygonscan.com/address',
	avalanche: 'https://snowtrace.io/address',
};

const chainId = (chain: string) =>
	chain === 'polygon' ? 137 : chain === 'avalanche' ? 43114 : 1;

// ─────────────────────────────────────────────────────────────────────────────
// Known DeFi / protocol contracts → { name, url }
// Covers the most common protocols users interact with across ETH, Polygon, Avalanche
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_CONTRACTS: Record<string, { name: string; url: string }> = {
	// Aave V3
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave V3 (Ethereum)', url: 'https://app.aave.com' },
	'0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave V3 (Avalanche/Polygon)', url: 'https://app.aave.com' },
	'0xa434d495249abe33e031fe71a969b81f3c07950d': { name: 'Aave V3 Pool Provider', url: 'https://app.aave.com' },
	// Aave V2
	'0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9': { name: 'Aave V2 (Ethereum)', url: 'https://app.aave.com' },
	'0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf': { name: 'Aave V2 (Polygon)', url: 'https://app.aave.com' },
	// Uniswap
	'0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', url: 'https://app.uniswap.org' },
	'0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 Router', url: 'https://app.uniswap.org' },
	'0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap V3 Router 2', url: 'https://app.uniswap.org' },
	'0x000000000004444c5dc75cb358380819da4efcee': { name: 'Uniswap V4 Router', url: 'https://app.uniswap.org' },
	// Compound
	'0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b': { name: 'Compound V2 Comptroller', url: 'https://compound.finance' },
	'0xc3d688b66703497daa19211eedff47f25384cdc3': { name: 'Compound V3 (USDC)', url: 'https://app.compound.finance' },
	// Curve
	'0x8301ae4fc9c624d1d396cbdaa1ed877821d7c511': { name: 'Curve (ETH/CRV)', url: 'https://curve.fi' },
	'0xd51a44d3fae010294c616388b506acda1bfaae46': { name: 'Curve Tricrypto', url: 'https://curve.fi' },
	'0xbeefc012406bc99d10e2812b13b8b63ffb698d45': { name: 'Curve (Polygon)', url: 'https://curve.fi' },
	// Lido
	'0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'Lido stETH', url: 'https://lido.fi' },
	'0x889edc2edab5f40e902b864ad4d7ade8e412f9b1': { name: 'Lido Withdrawals', url: 'https://lido.fi' },
	// MakerDAO / DAI
	'0x9759a6ac90977b93b58547b4a71c78317f391a28': { name: 'MakerDAO DSProxy', url: 'https://makerdao.com' },
	'0x5ef30b9986345249bc32d8928b7ee64de9435e39': { name: 'MakerDAO CDP Manager', url: 'https://makerdao.com' },
	// 1inch
	'0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch V5', url: 'https://app.1inch.io' },
	'0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inch V6', url: 'https://app.1inch.io' },
	// OpenSea
	'0x00000000000000adc04c56bf30ac9d3c0aaf14dc': { name: 'OpenSea Seaport 1.5', url: 'https://opensea.io' },
	'0x0000000000000068f116a894984e2db1123eb395': { name: 'OpenSea Seaport 1.6', url: 'https://opensea.io' },
	'0x7be8076f4ea4a4ad08075c2508e481d6c946d12b': { name: 'OpenSea V1', url: 'https://opensea.io' },
	// Blur
	'0x000000000000ad05ccc4f10045630fb830b95127': { name: 'Blur Marketplace', url: 'https://blur.io' },
	'0xb2ecfe4e4d61f8790bbb9de2d1259b9e2410cea5': { name: 'Blur Lending', url: 'https://blur.io' },
	// LooksRare
	'0x59728544b08ab483533076417fbbb2fd0b17ce3a': { name: 'LooksRare', url: 'https://looksrare.org' },
	// Rarible
	'0x9757f2d2b135150bbeb65308d4a91804107cd8d6': { name: 'Rarible', url: 'https://rarible.com' },
	// ENS
	'0x283af0b28c62c092c9727f1ee09c02ca627eb7f5': { name: 'ENS Registrar', url: 'https://ens.domains' },
	'0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85': { name: 'ENS BaseRegistrar', url: 'https://ens.domains' },
	// Gnosis Safe / Multisig
	'0x3e5c63644e683549055b9be8653de26e0b4cd36e': { name: 'Safe (Polygon)', url: 'https://safe.global' },
	'0x69f4d1788e39c87893c980c06edf4b7f686e2938': { name: 'Safe (Polygon Factory)', url: 'https://safe.global' },
	// Stargate (bridging)
	'0x8731d54e9d02c286767d56ac03e8037c07e01e98': { name: 'Stargate Router', url: 'https://stargate.finance' },
	// Polygon Bridge
	'0xa0c68c638235ee32657e8f720a23cec1bfc77c77': { name: 'Polygon Bridge', url: 'https://portal.polygon.technology' },
	'0x28e4f3a7f651294b9564800b2d01f35189a5bf8b': { name: 'Polygon Bridge V2', url: 'https://portal.polygon.technology' },
	// Avalanche Bridge
	'0x8eb8a3b98659cce290402893d0123abb75e3ab28': { name: 'Avalanche Bridge', url: 'https://core.app/bridge' },
	// Benqi (Avalanche lending)
	'0x486af39519b4dc9a7fccd318217352830e8ad9b4': { name: 'Benqi Comptroller', url: 'https://benqi.fi' },
	// Trader Joe (Avalanche DEX)
	'0x60ae616a2155ee3d9a68541ba4544862310933d4': { name: 'Trader Joe Router', url: 'https://traderjoexyz.com' },
	// WAVAX
	'0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7': { name: 'WAVAX', url: 'https://snowtrace.io/address/0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7' },
	// Wormhole
	'0x98f3c9e6e3face36baad05fe09d375ef1464288b': { name: 'Wormhole Bridge', url: 'https://wormhole.com' },
};

const contractNameCache = new Map<string, { expiresAt: number; name: string | null }>();

const fetchContractName = async (cId: number, address: string): Promise<string | null> => {
	const key = `${cId}:${address}`;
	const cached = contractNameCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.name;

	try {
		const url = buildEtherscanV2Url(cId, {
			module: 'contract',
			action: 'getsourcecode',
			address,
		});
		const data = await requestEtherscan(url, { cacheTtlMs: 60_000 });
		const result = (data as any)?.result?.[0];
		const name = result?.ContractName?.trim() || null;
		contractNameCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, name });
		return name;
	} catch {
		contractNameCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, name: null });
		return null;
	}
};

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
		// Include tx count, total value sent, and last interaction date per contract
		const result = await db.execute({
			sql: `SELECT
					chain,
					LOWER(to_address) AS address,
					COUNT(*) AS tx_count,
					MAX(timestamp) AS last_seen,
					SUM(CASE WHEN CAST(value AS REAL) > 0 THEN CAST(value AS REAL) ELSE 0 END) AS total_value
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

			const known = KNOWN_CONTRACTS[address];
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
			const explorer = CHAIN_EXPLORERS[chain] ?? CHAIN_EXPLORERS.ethereum;
			const verifiedName = await fetchContractName(cId, address).catch(() => null);
			items.push({
				name: verifiedName || `${address.slice(0, 6)}…${address.slice(-4)}`,
				address,
				url: `${explorer}/${address}`,
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
