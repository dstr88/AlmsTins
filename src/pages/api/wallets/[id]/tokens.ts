import type { APIRoute } from 'astro';
import { getWalletTokenBreakdown, insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import type { SupportedChain } from '@/lib/constants';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getTokenBalances, getTokenMetadata } from '@/lib/alchemy';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

const ETHEREUM_CHAIN_ID = 1;
const POLYGON_CHAIN_ID = 137;
const AVALANCHE_CHAIN_ID = 43114;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let index = 0;
	while (index < items.length) {
		const batch = items.slice(index, index + limit);
		const batchResults = await Promise.all(batch.map(mapper));
		results.push(...batchResults);
		index += limit;
	}
	return results;
}

function toDecimal(value: bigint, decimals: number) {
	if (decimals <= 0) return Number(value);
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const fraction = abs % base;
	let fracStr = fraction.toString().padStart(decimals, '0');
	fracStr = fracStr.replace(/0+$/, '');
	const numStr = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
	const num = Number(numStr);
	if (!Number.isFinite(num)) return 0;
	return negative ? -num : num;
}

async function buildAlchemySnapshot(
	chainId: number,
	walletId: string,
	tenantId: string,
	address: string,
) {
	const alchemyChain = chainId === ETHEREUM_CHAIN_ID ? 'eth-mainnet' : 'polygon-mainnet';
	const chain = chainId === ETHEREUM_CHAIN_ID ? 'ethereum' : 'polygon';
	const balancesResult = await getTokenBalances(alchemyChain, address);
	const rawBalances = Array.isArray(balancesResult?.tokenBalances) ? balancesResult.tokenBalances : [];
	const nonZeroBalances = rawBalances.filter((entry) => {
		try {
			return BigInt(entry.tokenBalance ?? '0') > 0n;
		} catch {
			return false;
		}
	});

	const contracts = nonZeroBalances
		.map((entry) => String(entry.contractAddress ?? '').toLowerCase())
		.filter(Boolean);

	const metadataList = await mapWithConcurrency(contracts, 5, async (contract) => {
		try {
			const metadata = await getTokenMetadata(alchemyChain, contract);
			return { contract, metadata };
		} catch {
			return { contract, metadata: { decimals: 18, name: null, symbol: null } };
		}
	});

	const metadataByContract = new Map<string, Awaited<ReturnType<typeof getTokenMetadata>>>();
	for (const entry of metadataList) {
		metadataByContract.set(entry.contract, entry.metadata);
	}

	const tokens = nonZeroBalances
		.map((entry) => {
			const contract = String(entry.contractAddress ?? '').toLowerCase();
			if (!contract) return null;
			const metadata = metadataByContract.get(contract);
			const decimals = typeof metadata?.decimals === 'number' ? metadata.decimals : 18;
			if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) return null;
			let balance = 0n;
			try {
				balance = BigInt(entry.tokenBalance ?? '0');
			} catch {
				return null;
			}
			if (balance <= 0n) return null;
			const amount = toDecimal(balance, decimals);
			if (!Number.isFinite(amount) || amount <= 0) return null;
			return {
				symbol: String(metadata?.symbol ?? '').trim().toUpperCase(),
				amount,
				priceUsd: null,
				valueUsd: null,
				tokenAddress: contract,
			};
		})
		.filter((token): token is { symbol: string; amount: number; priceUsd: null; valueUsd: null; tokenAddress: string } =>
			Boolean(token),
		);

	return {
		tenantId,
		walletId,
		chain: chain as SupportedChain,
		tokens,
		totalUsd: 0,
	};
}

// Known SPL token mints → symbol + DefiLlama price ID
const SPL_TOKEN_MINTS: Record<string, { symbol: string; llamaId: string }> = {
	'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': { symbol: 'PYTH',  llamaId: 'coingecko:pyth-network' },
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC',  llamaId: 'coingecko:usd-coin' },
	'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT',  llamaId: 'coingecko:tether' },
	'So11111111111111111111111111111111111111112':    { symbol: 'WSOL',  llamaId: 'coingecko:solana' },
	'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK',  llamaId: 'coingecko:bonk' },
	'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL':  { symbol: 'JTO',   llamaId: 'coingecko:jito-governance-token' },
	'7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH',   llamaId: 'coingecko:ethereum' },
	'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So':  { symbol: 'MSOL',  llamaId: 'coingecko:msol' },
	'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1':  { symbol: 'BSOL',  llamaId: 'coingecko:blazestake-staked-sol' },
};

const SOLANA_TOKEN_PROGRAM  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_STAKE_PROGRAM  = 'Stake11111111111111111111111111111111111111112';
const SOLANA_RPC             = 'https://api.mainnet-beta.solana.com';

async function solanaRpc<T = unknown>(method: string, params: unknown[]): Promise<T | null> {
	try {
		const res = await fetch(SOLANA_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		if (!res.ok) return null;
		const json = await res.json() as { result?: T; error?: unknown };
		if (json?.error) return null;
		return json?.result ?? null;
	} catch {
		return null;
	}
}

type SolanaTokenEntry = {
	symbol: string;
	amount: number;
	tokenAddress: string;
	llamaId: string;
};

async function fetchSolanaTokens(address: string): Promise<SolanaTokenEntry[]> {
	const tokens: SolanaTokenEntry[] = [];

	// 1. Native SOL
	const nativeResult = await solanaRpc<{ value?: number }>('getBalance', [address]);
	const lamports = nativeResult?.value;
	if (typeof lamports === 'number' && lamports > 0) {
		tokens.push({ symbol: 'SOL', amount: lamports / 1_000_000_000, tokenAddress: 'native', llamaId: 'coingecko:solana' });
	}

	// 2. SPL token balances (PYTH, USDC, etc.)
	type TokenAccountsResult = { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }> };
	const splResult = await solanaRpc<TokenAccountsResult>('getTokenAccountsByOwner', [
		address,
		{ programId: SOLANA_TOKEN_PROGRAM },
		{ encoding: 'jsonParsed' },
	]);
	for (const acc of (splResult as any)?.value ?? []) {
		const info = acc?.account?.data?.parsed?.info;
		if (!info) continue;
		const mint: string = info.mint ?? '';
		const uiAmount: number = info.tokenAmount?.uiAmount ?? 0;
		if (!mint || uiAmount <= 0) continue;
		const known = SPL_TOKEN_MINTS[mint];
		if (!known) continue;
		// Merge with existing entry if same symbol (e.g. multiple USDC accounts)
		const existing = tokens.find((t) => t.symbol === known.symbol);
		if (existing) {
			existing.amount += uiAmount;
		} else {
			tokens.push({ symbol: known.symbol, amount: uiAmount, tokenAddress: mint, llamaId: known.llamaId });
		}
	}

	// 3. Staked SOL — find stake accounts where wallet is the withdrawer (offset 44)
	// Base58-encode the pubkey bytes for the memcmp filter — the RPC accepts base58 string directly
	type StakeAccountsResult = Array<{ account?: { lamports?: number } }>;
	const stakeResult = await solanaRpc<StakeAccountsResult>('getProgramAccounts', [
		SOLANA_STAKE_PROGRAM,
		{
			encoding: 'base64',
			filters: [{ memcmp: { offset: 44, bytes: address } }],
		},
	]);
	let stakedLamports = 0;
	for (const acc of stakeResult ?? []) {
		const l = acc?.account?.lamports;
		if (typeof l === 'number' && l > 0) stakedLamports += l;
	}
	if (stakedLamports > 0) {
		const stakedSol = stakedLamports / 1_000_000_000;
		const existing = tokens.find((t) => t.symbol === 'SOL');
		if (existing) {
			existing.amount += stakedSol;
		} else {
			tokens.push({ symbol: 'SOL', amount: stakedSol, tokenAddress: 'native', llamaId: 'coingecko:solana' });
		}
	}

	return tokens;
}

async function fetchSolanaBalance(address: string): Promise<number | null> {
	const result = await solanaRpc<{ value?: number }>('getBalance', [address]);
	const lamports = result?.value;
	if (typeof lamports !== 'number') return null;
	return lamports / 1_000_000_000;
}

async function fetchSuiBalance(address: string): Promise<number | null> {
	try {
		const res = await fetch('https://fullnode.mainnet.sui.io/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getBalance', params: [address, '0x2::sui::SUI'] }),
		});
		const json = await res.json() as { result?: { totalBalance?: string | number } };
		const mist = json?.result?.totalBalance;
		if (mist === undefined || mist === null) return null;
		return Number(mist) / 1_000_000_000;
	} catch {
		return null;
	}
}

async function fetchDefiLlamaPrices(llamaIds: string[]): Promise<Record<string, number>> {
	if (!llamaIds.length) return {};
	try {
		const ids = [...new Set(llamaIds)].join(',');
		const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`, {
			headers: { 'Accept': 'application/json' },
		});
		if (!res.ok) return {};
		const json = await res.json() as { coins?: Record<string, { price?: number }> };
		const prices: Record<string, number> = {};
		for (const [id, data] of Object.entries(json?.coins ?? {})) {
			if (typeof data?.price === 'number' && data.price > 0) prices[id] = data.price;
		}
		return prices;
	} catch {
		return {};
	}
}

async function fetchNativePrice(coinId: 'solana' | 'sui'): Promise<number | null> {
	const llamaId = coinId === 'solana' ? 'coingecko:solana' : 'coingecko:sui';
	const prices = await fetchDefiLlamaPrices([llamaId]);
	return prices[llamaId] ?? null;
}

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	const startedAt = Date.now();
	const url = new URL(request.url);
	const { tenantId } = await requireTenantSession(request);
	const requestId = request.headers.get('x-request-id') ?? undefined;

	console.log('[tokens API] START', { walletId });
	console.log('[wallet.tokens] START', {
		walletId,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
	});

	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		await requireWalletOwnedByTenant(walletId, tenantId);
		const walletResult = await db.execute({
			sql: 'SELECT id, address, chains FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		if (!walletResult.rows?.length) {
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const refreshMissing = url.searchParams.get('refreshMissing') === '1';
		const walletRow = walletResult.rows?.[0] as { address?: string | null; chains?: string | null } | undefined;
		const walletAddress = String(walletRow?.address ?? '').trim();
		let walletChains: string[] = [];
		try { walletChains = JSON.parse(String(walletRow?.chains ?? '[]')); } catch { /* ignore */ }

		if (refreshMissing) {
			const refreshStart = Date.now();
			console.log('[tokens.refreshMissing] START', { requestId, walletId, tenantId });
			if (walletAddress) {
				const isSolana = walletChains.includes('solana');
				const isSui    = walletChains.includes('sui');
				const isEvm    = !isSolana && !isSui;

				if (isEvm) {
					// Alchemy supports eth-mainnet and polygon-mainnet only.
					// Avalanche balances come from the on-chain sync (not Alchemy snapshots).
					const snapshotChains: Array<{ chainId: number }> = [
						{ chainId: ETHEREUM_CHAIN_ID },
						{ chainId: POLYGON_CHAIN_ID },
					];
					for (const { chainId } of snapshotChains) {
						const breakdown = await buildAlchemySnapshot(chainId, walletId, tenantId, walletAddress);
						await insertWalletSnapshotFromValueBreakdown(breakdown);
						console.log('[tokens.refreshMissing] EVM SNAPSHOT', {
							chainId,
							tokenCount: breakdown.tokens.length,
							totalsUsd: breakdown.totalUsd ?? 0,
						});
						await sleep(100);
					}
				}

				if (isSolana) {
					const solTokens = await fetchSolanaTokens(walletAddress);
					if (solTokens.length > 0) {
						// Batch-fetch prices for all discovered tokens in one DefiLlama call
						const llamaIds = [...new Set(solTokens.map((t) => t.llamaId))];
						const prices = await fetchDefiLlamaPrices(llamaIds);
						const pricedTokens = solTokens.map((t) => {
							const priceUsd = prices[t.llamaId] ?? null;
							return {
								symbol: t.symbol,
								amount: t.amount,
								priceUsd,
								valueUsd: priceUsd !== null ? t.amount * priceUsd : null,
								tokenAddress: t.tokenAddress,
							};
						});
						const totalUsd = pricedTokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
						await insertWalletSnapshotFromValueBreakdown({
							tenantId,
							walletId,
							chain: 'solana',
							tokens: pricedTokens,
							totalUsd,
						});
						console.log('[tokens.refreshMissing] SOLANA SNAPSHOT', {
							tokenCount: pricedTokens.length,
							symbols: pricedTokens.map((t) => t.symbol),
							totalUsd,
						});
					}
				}

				if (isSui) {
					const suiBalance = await fetchSuiBalance(walletAddress);
					if (suiBalance !== null) {
						const suiPrice = await fetchNativePrice('sui');
						await insertWalletSnapshotFromValueBreakdown({
							tenantId,
							walletId,
							chain: 'sui',
							tokens: [{
								symbol: 'SUI',
								amount: suiBalance,
								priceUsd: suiPrice,
								valueUsd: suiPrice !== null ? suiBalance * suiPrice : null,
								tokenAddress: 'native',
							}],
							totalUsd: suiPrice !== null ? suiBalance * suiPrice : 0,
						});
						console.log('[tokens.refreshMissing] SUI SNAPSHOT', { suiBalance, suiPrice });
					}
				}
			}
			console.log('[tokens.refreshMissing] END', {
				requestId,
				walletId,
				elapsedMs: Date.now() - refreshStart,
			});
		}

		let result = await getWalletTokenBreakdown(tenantId, walletId);

		console.log('[wallet.tokens] SUCCESS', {
			walletId,
			address: result.address,
			snapshots: result.snapshots.map((s) => ({ id: s.id, chain: s.chain, capturedAt: s.capturedAt, tokenCount: s.tokenCount })),
			count: result.tokens.length,
			sample: result.tokens[0],
			elapsedMs: Date.now() - startedAt,
		});

		console.log('[wallet.tokens] snapshot ids', {
			walletId,
			snapshots: result.snapshots.map((s) => ({ id: s.id, chain: s.chain, capturedAt: s.capturedAt })),
			cache: 'none',
		});

		console.log('[wallet.tokens] first token summary', {
			walletId,
			token: result.tokens[0]
				? {
						symbol: result.tokens[0].tokenSymbol,
						amount: result.tokens[0].amount,
						priceUsd: result.tokens[0].priceUsd,
						usdValue: result.tokens[0].usdValue,
				  }
				: null,
		});

		const normalizeToken = (token: typeof result.tokens[number]) => {
			const amount = Number(token.amount ?? 0);
			const priceUsd = token.priceUsd === 0 ? null : token.priceUsd ?? null;
			let usdValue = token.usdValue === 0 ? null : token.usdValue ?? null;
			if (priceUsd === null) {
				usdValue = null;
			} else if (Number.isFinite(amount) && amount > 0) {
				usdValue = amount * priceUsd;
			}
			return {
				...token,
				priceUsd,
				usdValue,
			};
		};

		const payload = {
			ok: true,
			walletId: result.walletId,
			address: result.address,
			label: result.label,
			snapshots: result.snapshots,
			tokens: result.tokens.map(normalizeToken),
		};

		console.log('[tokens API] FINAL tokens response meta', {
			ok: payload.ok,
			walletId: payload.walletId,
			snapshotCount: payload.snapshots.length,
			tokenCount: payload.tokens.length,
		});

		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err: any) {
		if (err instanceof Response) return err;
		const status = typeof err?.status === 'number' ? err.status : 500;
		const code = err?.code ?? 'TOKEN_BREAKDOWN_ERROR';
		const message = err?.message ?? 'Failed to load tokens';

		// Wallets with no snapshots yet, or snapshots with empty payloads — return
		// empty data instead of 404 so the UI shows "No balance data" rather than "Refresh failed".
		if (code === 'NO_SNAPSHOTS' || code === 'EMPTY_SNAPSHOTS') {
			console.log('[wallet.tokens] NO_SNAPSHOTS — returning empty payload', { walletId });
			return new Response(
				JSON.stringify({
					ok: true,
					walletId,
					address: null,
					label: null,
					snapshots: [],
					tokens: [],
					noData: true,
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}

		console.error('[wallet.tokens] ERROR', {
			walletId,
			status,
			code,
			message,
			details: err?.details,
			elapsedMs: Date.now() - startedAt,
		});

		return new Response(
			JSON.stringify({
				ok: false,
				walletId,
				error: message,
				code,
			}),
			{
				status,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} finally {
		console.log('[wallet.tokens] END', {
			walletId,
			elapsedMs: Date.now() - startedAt,
		});
	}
};
