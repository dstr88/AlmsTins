// POST /api/yearEnd/classify
// Runs the full tax classification pipeline for the logged-in tenant.

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runTaxPipeline } from '@/lib/yearEnd/classify';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const stats = await runTaxPipeline(tenantId);
		return new Response(JSON.stringify({ ok: true, stats }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[tax/classify] pipeline failed', error);
		return new Response(
			JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Pipeline failed.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
