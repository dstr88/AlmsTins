/**
 * The 30-minute cache for a wallet's approvals report, shared by GET /api/wallets/[id]/approvals and
 * the monthly check-up (src/pages/api/cron/monthly-digest.ts). Two layers: a bounded in-memory Map,
 * and the existing `cache` table (src/lib/tursoCache.ts) so a restart doesn't start over. No new table:
 * the approvals are public and change, so a stored copy would go stale; this is a cache, not a record.
 *
 * Keyed by tenant and wallet, under the t:{tenantId}: prefix that clearing an account's cache removes.
 * A check already running for a wallet is shared, not started twice.
 */

import { getCache, setCache } from '@/lib/tursoCache';
import { checkWalletApprovals } from './index';
import type { ApprovalsReport } from './types';

export const APPROVALS_CACHE_TTL_SECONDS = 30 * 60;
const MEM_MAX = 500;

const mem = new Map<string, { expiresAt: number; report: ApprovalsReport }>();
const inflight = new Map<string, Promise<ApprovalsReport>>();

export function approvalsCacheKey(tenantId: string, walletId: string): string {
	return `t:${tenantId}:approvals:${walletId}:v1`;
}

/** The cached report, or null when there is none younger than 30 minutes. A cache read that fails is a miss. */
export async function readCachedApprovals(tenantId: string, walletId: string): Promise<ApprovalsReport | null> {
	const key = approvalsCacheKey(tenantId, walletId);
	const hit = mem.get(key);
	if (hit && hit.expiresAt > Date.now()) return hit.report;
	if (hit) mem.delete(key);
	try {
		const stored = await getCache<ApprovalsReport>(key);
		if (stored && stored.ok === true && stored.walletId === walletId) {
			remember(key, stored, Date.parse(stored.checkedAt) + APPROVALS_CACHE_TTL_SECONDS * 1000);
			return stored;
		}
	} catch (err) {
		console.warn('[approvals] cache read failed', err instanceof Error ? err.message.slice(0, 120) : 'unknown');
	}
	return null;
}

function remember(key: string, report: ApprovalsReport, expiresAt: number) {
	mem.delete(key);
	mem.set(key, { expiresAt, report });
	if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value as string);
}

/** Runs a fresh check and caches it. */
export async function runApprovalsCheck(tenantId: string, walletId: string, address: string): Promise<ApprovalsReport> {
	const key = approvalsCacheKey(tenantId, walletId);
	const running = inflight.get(key);
	if (running) return running;
	const p = (async () => {
		const report = await checkWalletApprovals(walletId, address);
		remember(key, report, Date.now() + APPROVALS_CACHE_TTL_SECONDS * 1000);
		await setCache(key, report, APPROVALS_CACHE_TTL_SECONDS).catch((err) =>
			console.warn('[approvals] cache write failed', err instanceof Error ? err.message.slice(0, 120) : 'unknown'),
		);
		return report;
	})();
	inflight.set(key, p);
	try {
		return await p;
	} finally {
		inflight.delete(key);
	}
}

/** For tests. */
export function _clearApprovalsCache() {
	mem.clear();
	inflight.clear();
}
