/**
 * GET /api/cron/refresh-threat-lists
 *
 * Refreshes the local phishing-blocklist mirror (MetaMask, ScamSniffer) in
 * Postgres. Hash-gated: a source is only reloaded when its published content
 * actually changed, so most runs are cheap. Run every few hours.
 *
 * Protected by CRON_SECRET header (same pattern as the other crons).
 * Pass ?force=1 to reload even when unchanged.
 */
import type { APIRoute } from 'astro';
import { refreshThreatLists } from '@/lib/threatLists';
import { refreshGsb } from '@/lib/gsb';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/refresh-threat-lists] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const force = new URL(request.url).searchParams.get('force') === '1';
	const gsbKey = (process.env as any).GOOGLE_SAFE_BROWSING_KEY ?? import.meta.env.GOOGLE_SAFE_BROWSING_KEY ?? '';
	const startedAt = Date.now();
	try {
		const [lists, gsb] = await Promise.all([
			refreshThreatLists({ force }),
			gsbKey ? refreshGsb(gsbKey) : Promise.resolve({ error: 'no_key' } as const),
		]);
		console.log('[cron/refresh-threat-lists] done', { lists, gsb });
		return json({ ok: true, elapsed_ms: Date.now() - startedAt, result: { ...lists, gsb } });
	} catch (e) {
		console.error('[cron/refresh-threat-lists] failed', e instanceof Error ? e.message : e);
		return json({ ok: false, error: 'refresh failed' }, 500);
	}
};
