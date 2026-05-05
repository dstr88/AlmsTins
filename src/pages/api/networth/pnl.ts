import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { buildAnnualBreakdown } from '@/lib/annualBreakdown';
import { getCache, setCache } from '@/lib/tursoCache';

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes — cost basis changes less often than prices

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;

		const cacheKey = `t:${tenantId}:networth:pnl:v1`;
		const cached = await getCache<{ heldCostBasisUsd: number }>(cacheKey, {
			allowStale: true,
			staleMaxAgeSeconds: 30 * 60,
		});
		if (cached.value) {
			return new Response(
				JSON.stringify({ ok: true, ...cached.value, cached: true, stale: cached.isStale }),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const year = new Date().getFullYear();
		const bd = await buildAnnualBreakdown(tenantId, year);
		const payload = { heldCostBasisUsd: bd.totals.heldCostBasis };

		await setCache(cacheKey, payload, CACHE_TTL_SECONDS);

		return new Response(
			JSON.stringify({ ok: true, ...payload, cached: false, stale: false }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (error) {
		console.error('[pnl] error', error);
		return new Response(JSON.stringify({ ok: false }), { status: 500 });
	}
};
