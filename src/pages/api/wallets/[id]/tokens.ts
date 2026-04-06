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
			sql: 'SELECT id, address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		if (!walletResult.rows?.length) {
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const refreshMissing = url.searchParams.get('refreshMissing') === '1';
		const walletRow = walletResult.rows?.[0] as { address?: string | null } | undefined;
		const walletAddress = String(walletRow?.address ?? '').trim();
		if (refreshMissing) {
			const refreshStart = Date.now();
			console.log('[tokens.refreshMissing] START', { requestId, walletId, tenantId });
			if (walletAddress) {
				const snapshotChains: Array<{ chainId: number }> = [
					{ chainId: ETHEREUM_CHAIN_ID },
					{ chainId: POLYGON_CHAIN_ID },
				];
				for (const { chainId } of snapshotChains) {
					const breakdown = await buildAlchemySnapshot(chainId, walletId, tenantId, walletAddress);
					await insertWalletSnapshotFromValueBreakdown(breakdown);
					console.log('[tokens.refreshMissing] SNAPSHOT', {
						chainId,
						tokenCount: breakdown.tokens.length,
						totalsUsd: breakdown.totalUsd ?? 0,
					});
					await sleep(100);
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
