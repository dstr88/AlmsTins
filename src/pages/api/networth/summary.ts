import type { APIRoute } from 'astro';
import { getLatestNetWorthSummary, getLatestSnapshotCapturedAtByChain } from '@/lib/networth';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getCache, setCache } from '@/lib/tursoCache';
import { tryAcquireLock } from '@/lib/cacheLock';
import { normalizeNetWorthSummary } from '@/lib/networth/summaryContract';
import { DEMO_TENANT_ID } from '@/lib/demo';

export const prerender = false;

const SUMMARY_TTL_SECONDS = 90;
const SUMMARY_STALE_MAX_SECONDS = 30 * 60;
const REFRESH_LOCK_SECONDS = 20;

const memCache = new Map<string, { data: object; expiresAt: number }>();

export const GET: APIRoute = async ({ request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const logPerf = (
		status: number,
		meta?: {
			cached?: boolean;
			stale?: boolean;
			refreshed?: boolean;
			count?: number;
		},
	) => {
		console.log('[perf] networth-summary', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status,
			...(meta ?? {}),
		});
	};
	const DEV = import.meta.env.DEV;
	const LOCAL_BYPASS = import.meta.env.PUBLIC_LOCAL_DEV_NO_AUTH === 'true';

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		if (!DEV && !LOCAL_BYPASS) {
			const authHeader = request.headers.get('authorization');
			const expected = import.meta.env.NETWORTH_API_TOKEN;
			if (expected && authHeader && authHeader !== `Bearer ${expected}`) {
				logPerf(401);
				return new Response('Unauthorized', { status: 401 });
			}
		}

		// Demo sessions reset on every visit — skip all caching so stale $0 data
		// from a previous demo visit never bleeds into the next one.
		if (tenantId === DEMO_TENANT_ID) {
			const summary = await getLatestNetWorthSummary(tenantId);
			const normalized = normalizeNetWorthSummary({ summary });
			const capturedAtByChain = await getLatestSnapshotCapturedAtByChain(tenantId);
			const preCaptured = normalized.byChain.map((row) => ({
				...row,
				capturedAt: row.capturedAt ?? capturedAtByChain.get(row.chain) ?? null,
			}));
			const overallCapturedAt =
				preCaptured.map((r) => r.capturedAt).filter(Boolean).sort().at(-1) ?? new Date().toISOString();
			const summaryPayload = {
				totalUsd: normalized.totalUsd,
				totalAssetsUsd: normalized.totalAssetsUsd,
				totalFreeAssetsUsd: normalized.totalFreeAssetsUsd,
				totalDebtUsd: normalized.totalDebtUsd,
				byChain: preCaptured.map((r) => ({ ...r, capturedAt: r.capturedAt ?? overallCapturedAt })),
				tins: normalized.tins,
				capturedAt: overallCapturedAt,
			};
			return new Response(JSON.stringify({ ok: true, summary: summaryPayload, cached: false }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const cacheKey = `t:${tenantId}:networth:summary:v3`;
		const lockKey = `lock:${cacheKey}`;
		const memKey  = `networth:${tenantId}`;

		// L1 — in-memory, zero-latency
		const mem = memCache.get(memKey);
		if (mem && mem.expiresAt > Date.now()) {
			logPerf(200, { cached: true });
			return new Response(JSON.stringify({ ...mem.data, cached: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=0, must-revalidate' },
			});
		}

		const cached = await getCache<{ ok: true; summary: any }>(cacheKey, {
			allowStale: true,
			staleMaxAgeSeconds: SUMMARY_STALE_MAX_SECONDS,
		});

		if (cached.value?.summary) {
			if (cached.isStale) {
				(async () => {
					const gotLock = await tryAcquireLock(lockKey, REFRESH_LOCK_SECONDS);
					if (!gotLock) {
						console.log('[cache] networth-summary refresh skipped (lock busy)', { requestId, tenantId });
						return;
					}

					try {
						const freshSummary = await getLatestNetWorthSummary(tenantId);
						const normalized = normalizeNetWorthSummary({ summary: freshSummary });
						const capturedAtByChain = await getLatestSnapshotCapturedAtByChain(tenantId);
						const preCaptured = normalized.byChain.map((row) => ({
							...row,
							capturedAt: row.capturedAt ?? capturedAtByChain.get(row.chain) ?? null,
						}));
						const overallCapturedAt =
							preCaptured
								.map((row) => row.capturedAt)
								.filter(Boolean)
								.sort()
								.at(-1) ?? new Date().toISOString();
						const byChainWithCapturedAt = preCaptured.map((row) => ({
							...row,
							capturedAt: row.capturedAt ?? overallCapturedAt,
						}));
						if (import.meta.env.WALLET_DEBUG === '1') {
							console.log('[networth.summary] capturedAtByChain', {
								tenantId,
								capturedAt: Object.fromEntries(capturedAtByChain),
							});
						}
						const summaryPayload = {
							totalUsd: normalized.totalUsd,
							totalAssetsUsd: normalized.totalAssetsUsd,
							totalFreeAssetsUsd: normalized.totalFreeAssetsUsd,
							totalDebtUsd: normalized.totalDebtUsd,
							byChain: byChainWithCapturedAt,
							tins: normalized.tins,
							capturedAt: overallCapturedAt,
						};
						await setCache(cacheKey, { ok: true, summary: summaryPayload }, SUMMARY_TTL_SECONDS);
						console.log('[cache] networth-summary refreshed', { requestId, tenantId });
					} catch (err) {
						console.warn('[cache] networth-summary refresh failed', { requestId, tenantId, err });
					}
				})();
			}

			memCache.set(memKey, { data: { ok: true, summary: cached.value.summary }, expiresAt: Date.now() + SUMMARY_TTL_SECONDS * 1000 });
			logPerf(200, { cached: true, stale: cached.isStale });
			return new Response(
				JSON.stringify({ ok: true, summary: cached.value.summary, cached: true, stale: cached.isStale }),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'private, max-age=0, must-revalidate',
					},
				},
			);
		}

		const summary = await getLatestNetWorthSummary(tenantId);
		const normalized = normalizeNetWorthSummary({ summary });
		const capturedAtByChain = await getLatestSnapshotCapturedAtByChain(tenantId);
		const preCaptured = normalized.byChain.map((row) => ({
			...row,
			capturedAt: row.capturedAt ?? capturedAtByChain.get(row.chain) ?? null,
		}));
		const overallCapturedAt =
			preCaptured
				.map((row) => row.capturedAt)
				.filter(Boolean)
				.sort()
				.at(-1) ?? new Date().toISOString();
		const byChainWithCapturedAt = preCaptured.map((row) => ({
			...row,
			capturedAt: row.capturedAt ?? overallCapturedAt,
		}));
		if (import.meta.env.WALLET_DEBUG === '1') {
			console.log('[networth.summary] capturedAtByChain', {
				tenantId,
				capturedAt: Object.fromEntries(capturedAtByChain),
			});
		}
		const summaryPayload = {
			totalUsd: normalized.totalUsd,
			totalAssetsUsd: normalized.totalAssetsUsd,
			totalFreeAssetsUsd: normalized.totalFreeAssetsUsd,
			totalDebtUsd: normalized.totalDebtUsd,
			byChain: byChainWithCapturedAt,
			tins: normalized.tins,
			capturedAt: overallCapturedAt,
		};
		await setCache(cacheKey, { ok: true, summary: summaryPayload }, SUMMARY_TTL_SECONDS);
		memCache.set(memKey, { data: { ok: true, summary: summaryPayload }, expiresAt: Date.now() + SUMMARY_TTL_SECONDS * 1000 });

		logPerf(200, { cached: false, stale: false });
		return new Response(JSON.stringify({ ok: true, summary: summaryPayload, cached: false, stale: false }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('GET /api/networth/summary error', error);
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, message: 'Unable to load net worth summary.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
