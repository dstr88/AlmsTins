import type { APIRoute } from 'astro';
import { getWalletTokenBreakdown, insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import type { SupportedChain } from '@/lib/constants';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getTokenBalances, getTokenMetadata } from '@/lib/alchemy';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { classifyContract, isSpamToken } from '@/lib/knownContracts';
import { extractSpamDomains, savePhishingDomains } from '@/lib/phishingDomains';
import { DEMO_TENANT_ID, DEMO_WALLET_CONFIGS, isDemoWalletAddress } from '@/lib/demo';

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

	const chainName = chainId === ETHEREUM_CHAIN_ID ? 'ethereum' : 'polygon';

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
			const symbol = String(metadata?.symbol ?? '').trim().toUpperCase();
			// Drop tokens whose contract address doesn't match the known-good address for
			// their symbol on this chain (catches fake AAVE, fake USDC airdrops, etc.)
			if (classifyContract(chainName, symbol, contract) === 'scam') return null;
			// Name-spam / phishing airdrops: STORE (don't drop) so the Junk drawer can
			// surface them and the user can override/reclassify. Every read path filters
			// spam and it's left unpriced (valueUsd null → 0), so it never affects totals,
			// net worth, reconciliation ($50 threshold), or repricing (symbol unpriceable).
			// Still harvest any embedded phishing domains for the safety layer.
			const tokenName = metadata?.name ?? null;
			const tokenNameStr = typeof tokenName === 'string' ? tokenName : null;
			if (isSpamToken(symbol, tokenNameStr)) {
				const domains = extractSpamDomains(symbol, tokenNameStr);
				if (domains.length) void savePhishingDomains(domains);
			}
			return { symbol, amount, priceUsd: null, valueUsd: null, tokenAddress: contract };
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

// ── Solana PDA derivation (no external library required) ─────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToBytes(input: string): Uint8Array {
	let n = 0n;
	for (const ch of input) {
		const idx = BASE58_ALPHABET.indexOf(ch);
		if (idx < 0) throw new Error(`Invalid base58 char: ${ch}`);
		n = n * 58n + BigInt(idx);
	}
	const bytes: number[] = [];
	while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
	let leading = 0;
	for (const ch of input) { if (ch === '1') leading++; else break; }
	return new Uint8Array([...Array(leading).fill(0), ...bytes]);
}

// ed25519 constants for curve membership check
const ED_P  = (1n << 255n) - 19n;
// d = -121665/121666 mod p  (standard ed25519 constant)
const ED_D  = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
	let result = 1n; base %= mod;
	while (exp > 0n) {
		if (exp & 1n) result = result * base % mod;
		exp >>= 1n; base = base * base % mod;
	}
	return result;
}

function isOnEd25519Curve(point: Uint8Array): boolean {
	// Decode y from 32-byte little-endian, clear sign bit
	let y = 0n;
	for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(point[i]);
	y &= (1n << 255n) - 1n;
	if (y >= ED_P) return false;
	const y2 = y * y % ED_P;
	const u  = (y2 - 1n + ED_P) % ED_P;
	const v  = (ED_D * y2 % ED_P + 1n) % ED_P;
	const v3 = v * v % ED_P * v % ED_P;
	const v7 = v3 * v3 % ED_P * v % ED_P;
	const x  = u * v3 % ED_P * modPow(u * v7 % ED_P, (ED_P - 5n) / 8n, ED_P) % ED_P;
	const vx2 = v * x * x % ED_P;
	return vx2 === u % ED_P || vx2 === (ED_P - u) % ED_P;
}

async function findPda(seeds: (Uint8Array | string)[], programId: Uint8Array): Promise<Uint8Array | null> {
	const enc = new TextEncoder();
	const marker = enc.encode('ProgramDerivedAddress');
	for (let bump = 255; bump >= 0; bump--) {
		const parts: Uint8Array[] = [
			...seeds.map((s) => (typeof s === 'string' ? enc.encode(s) : s)),
			new Uint8Array([bump]),
			programId,
			marker,
		];
		const totalLen = parts.reduce((n, p) => n + p.length, 0);
		const buf = new Uint8Array(totalLen);
		let off = 0;
		for (const p of parts) { buf.set(p, off); off += p.length; }
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
		if (!isOnEd25519Curve(hash)) return hash;
	}
	return null;
}

const PYTH_STAKING_PROGRAM = base58ToBytes('pytS9TFNez6VM5kMon3apkp9zsEFXDfNnGFZ2aSbKbE');

async function fetchPythStakedBalance(walletAddress: string): Promise<number | null> {
	try {
		const walletBytes = base58ToBytes(walletAddress);
		// Derive stake_metadata PDA
		const metadataPda = await findPda(['stake_metadata', walletBytes], PYTH_STAKING_PROGRAM);
		if (!metadataPda) return null;
		// Derive custody token account PDA
		const custodyPda = await findPda(['stake_account_custody', metadataPda], PYTH_STAKING_PROGRAM);
		if (!custodyPda) return null;
		// Encode custody PDA back to base58 for the RPC call
		const custodyAddress = bytesToBase58(custodyPda);
		const result = await solanaRpc<{ value?: { amount?: string; decimals?: number } }>(
			'getTokenAccountBalance',
			[custodyAddress],
		);
		const amount = result?.value?.amount;
		const decimals = result?.value?.decimals ?? 6;
		if (!amount) return null;
		return Number(amount) / 10 ** decimals;
	} catch {
		return null;
	}
}

function bytesToBase58(bytes: Uint8Array): string {
	let n = 0n;
	for (const b of bytes) n = n * 256n + BigInt(b);
	let out = '';
	while (n > 0n) { out = BASE58_ALPHABET[Number(n % 58n)] + out; n = n / 58n; }
	for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
	return out;
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

	// 4. Pyth staking contract — staked PYTH locked in the governance program
	const pythStaked = await fetchPythStakedBalance(address);
	if (pythStaked !== null && pythStaked > 0) {
		const existing = tokens.find((t) => t.symbol === 'PYTH');
		if (existing) {
			existing.amount += pythStaked;
		} else {
			tokens.push({
				symbol: 'PYTH',
				amount: pythStaked,
				tokenAddress: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
				llamaId: 'coingecko:pyth-network',
			});
		}
		console.log('[tokens.solana] pyth staked balance', { address, pythStaked });
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

// ── Rootstock (RSK) ──────────────────────────────────────────────────────────

const RSK_RPC = 'https://public-node.rsk.co';

async function rskRpc<T = unknown>(method: string, params: unknown[]): Promise<T | null> {
	try {
		const res = await fetch(RSK_RPC, {
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

type RskTokenDef = { symbol: string; address: string; decimals: number; llamaId: string };

// All significant Rootstock / Sovryn ecosystem tokens
const RSK_TOKENS: RskTokenDef[] = [
	{ symbol: 'SOV',   address: '0xEFc78fc7D48b64958315949279bA181C2114ABBd', decimals: 18, llamaId: 'coingecko:sovryn' },
	{ symbol: 'XUSD',  address: '0xb5999795BE0EbB5bAb23144AA5FD6A02D080299E', decimals: 18, llamaId: 'coingecko:xusd' },
	{ symbol: 'BPRO',  address: '0x440cd83c160de5c96ddb20246815ea44c7abbca8', decimals: 18, llamaId: 'coingecko:bpro' },
	{ symbol: 'RIF',   address: '0x2aCC95758f8b5F583470bA265Eb685a8F45fC9D5', decimals: 18, llamaId: 'coingecko:rif-token' },
	{ symbol: 'RUSDT', address: '0xEf213441a85DF4d7acBdAe0Cf78004E1e486BB96', decimals: 18, llamaId: 'coingecko:tether' },
	{ symbol: 'DLLR',  address: '0xc1411567d2670e24d9bdA715A9B74B40E20e3Ee2', decimals: 18, llamaId: 'coingecko:sovryn-dollar' },
	{ symbol: 'ZUSD',  address: '0xdB107FA69E33f05180a4C2cE9c2E7CB481645C2d', decimals: 18, llamaId: 'coingecko:zusd' },
	{ symbol: 'WRBTC', address: '0x542FDA317318eBF1d3DEAf76E0b632741A7e677d', decimals: 18, llamaId: 'coingecko:rootstock' },
	{ symbol: 'MOC',   address: '0x9aC7Fe28967b30e3a4E6E03286D715B42B453d10', decimals: 18, llamaId: 'coingecko:moc' },
	{ symbol: 'FISH',  address: '0x055A902303746382FBB7D18f6aE0df56eFDc5213', decimals: 18, llamaId: 'coingecko:babelfish-usd' },
];

// ERC20 balanceOf(address) selector — standard across all ERC20-compatible tokens on RSK
const BALANCE_OF_SELECTOR = '0x70a08231';

async function fetchRootstockTokens(address: string): Promise<Array<{ symbol: string; amount: number; tokenAddress: string; llamaId: string }>> {
	const tokens: Array<{ symbol: string; amount: number; tokenAddress: string; llamaId: string }> = [];

	// 1. Native RBTC balance (1:1 peg with BTC, 18 decimals)
	const balanceHex = await rskRpc<string>('eth_getBalance', [address, 'latest']);
	if (balanceHex && typeof balanceHex === 'string') {
		try {
			const wei = BigInt(balanceHex);
			if (wei > 0n) {
				tokens.push({ symbol: 'RBTC', amount: toDecimal(wei, 18), tokenAddress: 'native', llamaId: 'coingecko:rootstock' });
			}
		} catch { /* ignore parse errors */ }
	}

	// 2. ERC20-style token balances via eth_call → balanceOf(address)
	const paddedAddr = '000000000000000000000000' + address.slice(2).toLowerCase();
	const callData   = BALANCE_OF_SELECTOR + paddedAddr;

	for (const token of RSK_TOKENS) {
		try {
			const result = await rskRpc<string>('eth_call', [
				{ to: token.address, data: callData },
				'latest',
			]);
			if (!result || result === '0x' || result === '0x0000000000000000000000000000000000000000000000000000000000000000') continue;
			const raw = BigInt(result);
			if (raw <= 0n) continue;
			const amount = toDecimal(raw, token.decimals);
			if (!Number.isFinite(amount) || amount <= 0) continue;
			tokens.push({ symbol: token.symbol, amount, tokenAddress: token.address.toLowerCase(), llamaId: token.llamaId });
		} catch { /* soft-fail per token */ }
	}

	return tokens;
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
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
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
			sql: 'SELECT id, address, chains, label FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		if (!walletResult.rows?.length) {
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const refreshMissing = url.searchParams.get('refreshMissing') === '1';
		const walletRow = walletResult.rows?.[0] as { address?: string | null; chains?: string | null; label?: string | null } | undefined;
		const walletAddress = String(walletRow?.address ?? '').trim();
		const walletLabel = String(walletRow?.label ?? '').trim() || null;
		let walletChains: string[] = [];
		try { walletChains = JSON.parse(String(walletRow?.chains ?? '[]')); } catch { /* ignore */ }

		// Demo shortcut: return mock tokens directly for pre-configured demo wallets.
		// This avoids all Alchemy/DB snapshot logic that would fail or be meaningless.
		if (tenantId === DEMO_TENANT_ID) {
			const demoKey = isDemoWalletAddress(walletAddress) ? walletAddress : (walletAddress.match(/^([123])/)?.[1] ?? null);
			const demoConfig = demoKey ? DEMO_WALLET_CONFIGS[demoKey] : null;
			if (demoConfig) {
				const demoTokens = demoConfig.tokens.map((t) => ({
					tokenSymbol: t.symbol,
					chain: demoConfig.chain,
					amount: t.amount,
					priceUsd: t.priceUsd,
					usdValue: t.valueUsd,
					capturedAt: new Date().toISOString(),
					unpricedReason: null,
					purchaseAt: null,
					purchasePriceUsd: null,
				}));
				const payload = {
					ok: true,
					walletId,
					address: walletAddress,
					label: walletLabel ?? demoConfig.label,
					snapshots: [{
						id: `demo-${walletId}`,
						chain: demoConfig.chain,
						capturedAt: new Date().toISOString(),
						tokenCount: demoConfig.tokens.length,
					}],
					tokens: demoTokens,
				};
				return new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		if (refreshMissing && tenantId !== DEMO_TENANT_ID) {
			const refreshStart = Date.now();
			console.log('[tokens.refreshMissing] START', { requestId, walletId, tenantId });
			// Refresh is best-effort: an external-fetch or snapshot-build failure must
			// never 500 the endpoint. On failure we swallow it and fall through to serve
			// the wallet's existing (stale) snapshots below. This is what stops the
			// "Refresh failed (500)" owner-alert emails when a single chain hiccups.
			try {
			if (walletAddress) {
				const isSolana    = walletChains.includes('solana');
				const isSui       = walletChains.includes('sui');
				const isRootstock = walletChains.includes('rootstock');
				const isBitcoin   = walletChains.includes('bitcoin') || walletChains.includes('litecoin')
				                    || /^bc1/i.test(walletAddress) || /^[13][a-zA-Z0-9]{25,34}$/.test(walletAddress)
				                    || /^ltc1/i.test(walletAddress);
				const isEvm       = !isSolana && !isSui && !isRootstock && !isBitcoin;

				if (isEvm) {
					// Alchemy supports eth-mainnet and polygon-mainnet only.
					// Avalanche balances come from the on-chain sync (not Alchemy snapshots).
					const snapshotChains: Array<{ chainId: number }> = [
						{ chainId: ETHEREUM_CHAIN_ID },
						{ chainId: POLYGON_CHAIN_ID },
					];
					for (const { chainId } of snapshotChains) {
						// Per-chain guard: one chain failing (e.g. an Alchemy error on
						// Ethereum) must not skip the others; Polygon still refreshes.
						try {
						const breakdown = await buildAlchemySnapshot(chainId, walletId, tenantId, walletAddress);
						await insertWalletSnapshotFromValueBreakdown(breakdown);
						console.log('[tokens.refreshMissing] EVM SNAPSHOT', {
							chainId,
							tokenCount: breakdown.tokens.length,
							totalsUsd: breakdown.totalUsd ?? 0,
						});
						await sleep(100);
						} catch (chainErr: any) {
							console.error('[tokens.refreshMissing] EVM chain FAILED (non-fatal)', {
								walletId,
								chainId,
								message: chainErr?.message,
							});
						}
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

				if (isRootstock) {
					const rskTokens = await fetchRootstockTokens(walletAddress);
					if (rskTokens.length > 0) {
						const llamaIds = [...new Set(rskTokens.map((t) => t.llamaId))];
						const prices   = await fetchDefiLlamaPrices(llamaIds);
						const pricedTokens = rskTokens.map((t) => {
							const priceUsd = prices[t.llamaId] ?? null;
							return {
								symbol:       t.symbol,
								amount:       t.amount,
								priceUsd,
								valueUsd:     priceUsd !== null ? t.amount * priceUsd : null,
								tokenAddress: t.tokenAddress,
							};
						});
						const totalUsd = pricedTokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
						await insertWalletSnapshotFromValueBreakdown({
							tenantId,
							walletId,
							chain: 'rootstock',
							tokens: pricedTokens,
							totalUsd,
						});
						console.log('[tokens.refreshMissing] RSK SNAPSHOT', {
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
			} catch (refreshErr: any) {
				console.error('[tokens.refreshMissing] FAILED (non-fatal, serving stored snapshots)', {
					requestId,
					walletId,
					message: refreshErr?.message,
					stack: refreshErr?.stack,
				});
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
