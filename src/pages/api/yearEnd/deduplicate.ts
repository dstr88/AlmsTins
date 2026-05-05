// POST /api/yearEnd/deduplicate
// Runs the duplicate sweep for the logged-in tenant and returns stats.
// Safe to call multiple times — auto-flags are cleared and recomputed each run.

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runDuplicateSweep, setDuplicateOverride } from '@/lib/yearEnd/deduplication';

export const prerender = false;

// Run the sweep
export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const stats = await runDuplicateSweep(tenantId);
		return respond({ ok: true, stats }, 200);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[tax/deduplicate] sweep failed', error);
		return respond({ ok: false, error: error instanceof Error ? error.message : 'Sweep failed.' }, 500);
	}
};

// Override a specific row
export const PATCH: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const body = await request.json() as {
			sourceType: 'import' | 'onchain';
			sourceId: string;
			override: 'duplicate' | 'not-duplicate' | 'clear';
		};
		if (!body.sourceType || !body.sourceId || !body.override) {
			return respond({ ok: false, error: 'Missing fields.' }, 400);
		}
		await setDuplicateOverride(tenantId, body.sourceType, body.sourceId, body.override);
		return respond({ ok: true }, 200);
	} catch (error) {
		if (error instanceof Response) return error;
		return respond({ ok: false, error: 'Failed to update.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
