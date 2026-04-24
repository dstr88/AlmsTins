import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { setCache, deleteCachePrefix } from '@/lib/tursoCache';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const start = Date.now();

		await rebuildAssetLifecycles(tenantId);

		// Mark lifecycle cache fresh
		const cacheKey = `lifecycle:${tenantId}`;
		await setCache(cacheKey, { refreshedAt: new Date().toISOString() }, 120);

		// Bust portfolio performance cache so the next page load reflects
		// the freshly rebuilt holdings rather than serving a stale snapshot.
		await deleteCachePrefix(`t:${tenantId}:portfolio:performance:`);

		return new Response(
			JSON.stringify({ ok: true, ms: Date.now() - start }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (error) {
		console.error('[lifecycle/rebuild]', error);
		return new Response(
			JSON.stringify({ ok: false, error: String(error) }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
