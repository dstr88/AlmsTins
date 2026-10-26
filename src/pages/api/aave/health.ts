import type { APIRoute } from 'astro';
import { getCache, setCache } from '@/lib/tursoCache';
import { tryAcquireLock } from '@/lib/cacheLock';
import { computeAccountHealth } from '@/lib/aave/accountHealth';

export const prerender = false;

// Every Aave V3 market, not just the main three: see src/lib/aave/accountHealth.ts.
const computeHealth = (address: string) => computeAccountHealth(address);
const HEALTH_TTL_SECONDS = 120;
const HEALTH_STALE_MAX_SECONDS = 600;
const REFRESH_LOCK_SECONDS = 20;

export const GET: APIRoute = async ({ request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const logPerf = (status: number, meta?: { count?: number; cached?: boolean; stale?: boolean }) => {
		console.log('[perf] aave-health', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status,
			...(meta ?? {}),
		});
	};
	const url = new URL(request.url);
	const address = url.searchParams.get('address') ?? '';

	if (!address) {
		logPerf(400);
		return new Response(JSON.stringify({ ok: false, error: 'Missing address' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const normalized = address.toLowerCase();
		const cacheKey = `aave:health:${normalized}`;
		const lockKey = `lock:${cacheKey}`;
		const cached = await getCache<{ ok: boolean; address: string; chains: Record<string, any>; asOf?: string }>(
			cacheKey,
			{ allowStale: true, staleMaxAgeSeconds: HEALTH_STALE_MAX_SECONDS },
		);

		if (cached.value?.chains) {
			if (cached.isStale) {
				(async () => {
					const gotLock = await tryAcquireLock(lockKey, REFRESH_LOCK_SECONDS);
					if (!gotLock) {
						console.log('[cache] aave-health refresh skip (lock-busy)', { requestId });
						return;
					}
					try {
						const fresh = await computeHealth(normalized);
						const payload = { ...fresh, asOf: new Date().toISOString() };
						await setCache(cacheKey, payload, HEALTH_TTL_SECONDS);
						console.log('[cache] aave-health refreshed', { requestId });
					} catch (error) {
						console.warn('[cache] aave-health refresh failed', { requestId, error });
					}
				})();
			}

			logPerf(200, {
				count: Object.keys(cached.value.chains ?? {}).length,
				cached: true,
				stale: cached.isStale,
			});
			return new Response(
				JSON.stringify({
					...cached.value,
					cached: true,
					stale: cached.isStale,
					asOf:
						cached.value.asOf ??
						(cached.updatedAt ? new Date(cached.updatedAt).toISOString() : null),
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		const fresh = await computeHealth(normalized);
		const payload = { ...fresh, asOf: new Date().toISOString() };
		await setCache(cacheKey, payload, HEALTH_TTL_SECONDS);

		logPerf(200, { count: Object.keys(fresh.chains ?? {}).length, cached: false, stale: false });
		return new Response(
			JSON.stringify({ ...payload, cached: false, stale: false }),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err) {
		console.error('[api/aave/health] error', err);
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, error: 'Aave lookup failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
