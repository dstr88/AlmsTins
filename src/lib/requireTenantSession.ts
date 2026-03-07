import { getAuthSession } from './authSession';
import { requireActiveTenantId } from './tenants';

export type TenantSession = {
	tenantId: string;
};

export async function requireTenantSession(request: Request): Promise<TenantSession | null> {
	try {
		console.log('[requireTenantSession] cookies:', request.headers.get('cookie'));
		const session = await getAuthSession(request);
		console.log('[requireTenantSession] session:', session);
		const userId = session?.user?.id ? String(session.user.id) : '';
		console.log('[requireTenantSession] userId:', userId || null);
		if (!userId) {
			console.log('[requireTenantSession] return:', null);
			return null;
		}

		const tenantId = await requireActiveTenantId(userId);
		console.log('[requireTenantSession] tenantId:', tenantId);
		const result = { tenantId };
		console.log('[requireTenantSession] return:', result);
		return result;
	} catch (error) {
		console.log('[requireTenantSession] error:', error instanceof Error ? error.message : String(error));
		console.log('[requireTenantSession] return:', null);
		return null;
	}
}
