import type { APIRoute } from 'astro';
import { getWalletTokenBreakdown, insertWalletSnapshotFromValueBreakdown } from '@/lib/networth';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import type { SupportedChain } from '@/lib/constants';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	const startedAt = Date.now();
	const url = new URL(request.url);

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
		let result = await getWalletTokenBreakdown(walletId);
		const refreshMissing = url.searchParams.get('refreshMissing') === '1';
		if (refreshMissing) {
			const desiredChains: SupportedChain[] = ['ethereum', 'polygon', 'avalanche'];
			const snapshotChains = new Set(result.snapshots.map((snapshot) => snapshot.chain.toLowerCase()));
			const missingChains = desiredChains.filter((chain) => !snapshotChains.has(chain));

			if (missingChains.length) {
				console.log('[wallet.tokens] refreshing missing chains', {
					walletId,
					address: result.address,
					missingChains,
				});

				const breakdowns = await computeWalletValue(walletId, result.address, missingChains);

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

				result = await getWalletTokenBreakdown(walletId);
			}
		}

		console.log('[wallet.tokens] SUCCESS', {
			walletId,
			address: result.address,
			snapshots: result.snapshots.map((s) => ({ id: s.id, chain: s.chain, capturedAt: s.capturedAt, tokenCount: s.tokenCount })),
			count: result.tokens.length,
			sample: result.tokens[0],
			elapsedMs: Date.now() - startedAt,
		});

		const payload = {
			ok: true,
			walletId: result.walletId,
			address: result.address,
			label: result.label,
			snapshots: result.snapshots,
			tokens: result.tokens,
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
