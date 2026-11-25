/**
 * The lifecycle rebuild the Bookkeeping page's Sync now button asks for (POST /api/lifecycle/rebuild),
 * written once so the weekly wallet sync (src/pages/api/cron/sync-wallets.ts) runs the same one for
 * each account that got new rows. Without it the cost basis caught up with a weekly sync only when
 * the customer pressed Sync now, ran a pricing pass or opened All Transactions.
 *
 * A whole rebuild of the account's history, then the caches the pages read are marked fresh or
 * cleared, so the next page load shows the rebuilt numbers.
 */

import { rebuildAssetLifecycles } from '@/lib/lifecycle';
import { setCache, deleteCachePrefix } from '@/lib/tursoCache';

export async function rebuildLifecycleAndCaches(tenantId: string): Promise<void> {
	await rebuildAssetLifecycles(tenantId);

	// Mark lifecycle cache fresh
	await setCache(`lifecycle:${tenantId}`, { refreshedAt: new Date().toISOString() }, 120);

	// Bust portfolio performance cache (all versions) so the next page load
	// reflects the freshly rebuilt lifecycle data rather than a stale snapshot.
	await deleteCachePrefix(`t:${tenantId}:portfolio:performance:`);
}
