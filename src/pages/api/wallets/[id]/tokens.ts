import type { APIRoute } from 'astro';
import { getWalletTokenBreakdown, insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import type { SupportedChain } from '@/lib/constants';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { repriceMissingWalletTokens } from '@/lib/repriceMissingWalletTokens';
import { db } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	const startedAt = Date.now();
	const url = new URL(request.url);
	const { tenantId } = await requireTenantSession(request);

	console.log('[tokens API] START', { walletId });
	console.log('[wallet.tokens] START', {
		walletId,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
	});

	if (!walletId) {
		return new Response(JSON.stringify({ error: 'Missing wallet id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const walletResult = await db.execute({
			sql: 'SELECT id FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		if (!walletResult.rows?.length) {
			return new Response(JSON.stringify({ error: 'Wallet not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		let result = await getWalletTokenBreakdown(tenantId, walletId);
		const refreshMissing = url.searchParams.get('refreshMissing') === '1';
		if (refreshMissing) {
			console.log('[tokens.refreshMissing] start', { tenantId, walletId }); // TEMP DEBUG
			const repriceStart = Date.now();
			const symbolsNeedingPrice = Array.from(
				new Set(
					result.tokens
						.map((token) => {
							const symbol = String(token.tokenSymbol ?? '').trim().toUpperCase();
							const amount = Number(token.amount ?? 0);
							const priceRaw = token.priceUsd ?? null;
							const valueRaw = token.usdValue ?? null;
							const price = priceRaw === null ? null : Number(priceRaw);
							const value = valueRaw === null ? null : Number(valueRaw);
							if (!symbol) return null;
							if (!Number.isFinite(amount) || amount <= 0) return null;
							if (price === null || !Number.isFinite(price) || price <= 0) return symbol;
							if (value === null || !Number.isFinite(value) || value <= 0) return symbol;
							return null;
						})
						.filter((symbol): symbol is string => Boolean(symbol)),
				),
			);
			console.log('[tokens.refreshMissing] symbolsNeedingPrice', { walletId, symbolsNeedingPrice }); // TEMP DEBUG
			const repriceResult = await repriceMissingWalletTokens({
				tenantId,
				walletId,
				symbols: symbolsNeedingPrice.length ? symbolsNeedingPrice : undefined,
				trigger: 'tokens.refreshMissing',
				lockTtlSeconds: 60,
			});
			console.log('[tokens.refreshMissing] repriced', { // TEMP DEBUG
				tenantId,
				walletId,
				updatedSnapshots: repriceResult.updatedRows ?? 0,
				updatedTokens: repriceResult.updatedTokens ?? 0,
				elapsedMs: Date.now() - repriceStart,
			});
			const desiredChains: SupportedChain[] = ['ethereum', 'polygon', 'avalanche'];
			const snapshotChains = new Set(result.snapshots.map((snapshot) => snapshot.chain.toLowerCase()));
			const missingChains = desiredChains.filter((chain) => !snapshotChains.has(chain));

			if (missingChains.length) {
				console.log('[wallet.tokens] refreshing missing chains', {
					walletId,
					address: result.address,
					missingChains,
				});

				const breakdowns = await computeWalletValue(tenantId, walletId, result.address, missingChains);

				for (const breakdown of breakdowns) {
					if (breakdown.totalUsd === 0 && breakdown.tokens.length === 0) {
						console.log('[wallet.tokens] skipping empty snapshot', {
							walletId,
							chain: breakdown.chain,
						});
						continue;
					}
					await insertWalletSnapshotFromValueBreakdown(breakdown);
				}
			}

			result = await getWalletTokenBreakdown(tenantId, walletId);
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
			const normalizedTokens = result.tokens.map(normalizeToken);
			const normalizedTotalsUsd = normalizedTokens.reduce(
				(sum, token) => sum + (Number(token.usdValue ?? 0) || 0),
				0,
			);
			const firstToken = result.tokens[0] ?? null;
			console.log('[tokens.refreshMissing] after fetch', { // TEMP DEBUG
				tenantId,
				walletId,
				totalsUsd: normalizedTotalsUsd,
				firstToken: firstToken
					? {
							symbol: firstToken.tokenSymbol,
							amount: firstToken.amount,
							priceUsd: firstToken.priceUsd,
							usdValue: firstToken.usdValue,
					  }
					: null,
			});
		}

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
		const status = typeof err?.status === 'number' ? err.status : 500;
		const code = err?.code ?? 'TOKEN_BREAKDOWN_ERROR';
		const message = err?.message ?? 'Failed to load tokens';

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
