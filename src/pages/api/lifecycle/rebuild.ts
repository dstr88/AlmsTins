import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { setCache, deleteCachePrefix } from '@/lib/tursoCache';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const start = Date.now();

		let year: number | undefined;
		try {
			const body = await request.json() as { year?: number };
			year = body.year;
		} catch {
			// No body or invalid JSON — full rebuild
		}

		await rebuildAssetLifecycles(tenantId, { year });

		// Mark lifecycle cache fresh
		const cacheKey = `lifecycle:${tenantId}`;
		await setCache(cacheKey, { refreshedAt: new Date().toISOString() }, 120);

		// Bust portfolio performance cache (all versions) so the next page load
		// reflects the freshly rebuilt lifecycle data rather than a stale snapshot.
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
