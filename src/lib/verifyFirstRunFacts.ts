/**
 * Almstins Verify: the facts the first-run rule needs, read for one session (server side).
 *
 * The rule itself is pure and lives in ./verifyFirstRun.ts; this file only reads what it asks
 * for: how many destinations the account holds, and whether it is a platform account. The demo is
 * not read at all (the rule answers it without a count).
 *
 * A read that fails answers "unknown" (destinationCount null), which the rule treats as not
 * first-run: the account gets the dashboard, and the dashboard reports the load error itself.
 */
import type { TenantSession } from './requireTenantSession';
import { listDestinations } from './verifyRegistry';
import { listEntities } from './verifyEntities';
import { canPublishEntities } from './verifyEntityAccess';
import { isPlatformAccount, type VerifyFirstRunFacts } from './verifyFirstRun';

export async function loadVerifyFirstRunFacts(session: TenantSession): Promise<VerifyFirstRunFacts> {
	const isDemo = session.isDemo ?? false;
	if (isDemo) return { isDemo: true, destinationCount: null, platformAccount: false };
	const approved = canPublishEntities(session.tenantId);
	try {
		const [destinations, lists] = await Promise.all([
			listDestinations(session.tenantId),
			listEntities(session.tenantId),
		]);
		return {
			isDemo: false,
			destinationCount: destinations.length,
			platformAccount: isPlatformAccount({ approved, listCount: lists.length }),
		};
	} catch (err) {
		console.error('[verify] first-run facts not read:', err instanceof Error ? err.message : err);
		return { isDemo: false, destinationCount: null, platformAccount: approved };
	}
}
