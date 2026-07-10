import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getCache, setCache } from '@/lib/tursoCache';
import { runNeedsAttentionQueries } from '@/lib/getNeedsAttention';

const CACHE_TTL      = 900;    // 15 min fresh window
const STALE_MAX_AGE  = 3600;   // serve stale up to 1 h while background-refreshing
const BG_TIMEOUT_MS  = 25_000; // background refresh timeout — Render's HTTP cutoff doesn't apply here
const SYNC_TIMEOUT_MS = 27_000; // cold-path timeout — must respond before Render's 30s HTTP cutoff

// Module-level in-memory cache — instant hits, no Turso round trip
const memCache = new Map<string, { data: object; expiresAt: number }>();
// Prevent duplicate concurrent background refreshes per tenant
const refreshing = new Set<string>();

const TURSO_KEY = (tenantId: string) => `t:${tenantId}:research:needs-attention:v2`;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`[needs-attention] ${label} timed out after ${ms}ms`)), ms)
		),
	]);
}

async function backgroundRefresh(tenantId: string, memKey: string): Promise<void> {
	if (refreshing.has(tenantId)) return;
	refreshing.add(tenantId);
	try {
		const payload = await withTimeout(runNeedsAttentionQueries(tenantId), BG_TIMEOUT_MS, 'bg queries');
		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
		void setCache(TURSO_KEY(tenantId), payload, CACHE_TTL);
		console.log(`[needs-attention] background refresh complete for ${tenantId}`);
	} catch (err) {
		console.error(`[needs-attention] background refresh failed:`, err);
	} finally {
		refreshing.delete(tenantId);
	}
}

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const t0 = Date.now();
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const memKey = `needs-attention:${tenantId}`;

	// ── In-memory cache: zero-latency hit ────────────────────────────────────
	const mem = memCache.get(memKey);
	if (mem && mem.expiresAt > Date.now()) {
		console.log(`[needs-attention] mem-cache hit (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify({ ...mem.data, cached: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// ── Turso cache: stale-while-revalidate ───────────────────────────────────
	try {
		const t1 = Date.now();
		const cacheRead = await withTimeout(
			getCache<object>(TURSO_KEY(tenantId), { allowStale: true, staleMaxAgeSeconds: STALE_MAX_AGE }),
			5_000,
			'turso-cache',
		);
		console.log(`[needs-attention] turso-cache lookup (${Date.now() - t1}ms) stale=${cacheRead?.isStale}`);

		if (cacheRead?.value !== null && cacheRead?.value !== undefined) {
			memCache.set(memKey, { data: cacheRead.value, expiresAt: Date.now() + CACHE_TTL * 1000 });
			if (cacheRead.isStale) {
				// Return stale immediately; refresh in background
				void backgroundRefresh(tenantId, memKey);
				console.log(`[needs-attention] serving stale + background refresh (${Date.now() - t0}ms)`);
			} else {
				console.log(`[needs-attention] turso-cache hit (${Date.now() - t0}ms)`);
			}
			return new Response(JSON.stringify({ ...cacheRead.value, cached: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch (err) {
		console.error(`[needs-attention] turso-cache error:`, err);
		// fall through to live queries
	}

	// ── No cache at all: run queries synchronously ────────────────────────────
	const t2 = Date.now();
	try {
		const payload = await withTimeout(runNeedsAttentionQueries(tenantId), SYNC_TIMEOUT_MS, 'sync queries');
		console.log(`[needs-attention] live queries (${Date.now() - t2}ms)`);
		memCache.set(memKey, { data: payload, expiresAt: Date.now() + CACHE_TTL * 1000 });
		void setCache(TURSO_KEY(tenantId), payload, CACHE_TTL);
		console.log(`[needs-attention] total (${Date.now() - t0}ms)`);
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error(`[needs-attention] db error after ${Date.now() - t2}ms:`, err);
		return new Response(
			JSON.stringify({ error: 'Server error', unmatched: [], suggested: [], resolved: [], symbols: [], total: 0, unmatchedCapped: false }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	}
};
