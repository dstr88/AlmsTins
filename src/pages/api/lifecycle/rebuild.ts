import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { rebuildLifecycleAndCaches } from '@/lib/lifecycleRebuild';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const start = Date.now();

		// Always a whole rebuild. The Sync buttons on Year Summary and Annual Records still send a year;
		// it is ignored, because a year-scoped rebuild left only that year's history behind.
		// The weekly wallet sync runs the same rebuild (src/lib/lifecycleRebuild.ts).
		await rebuildLifecycleAndCaches(tenantId);

		return new Response(
			JSON.stringify({ ok: true, ms: Date.now() - start }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (error) {
		console.error('[lifecycle/rebuild]', error);
		return new Response(
			JSON.stringify({ ok: false, error: 'Rebuild failed.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
