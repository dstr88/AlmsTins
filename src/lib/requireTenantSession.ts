import { getAuthSession } from './authSession';
import { requireActiveTenantId } from './tenants';

export type TenantSession = {
	tenantId: string;
};

export async function requireTenantSession(request: Request): Promise<TenantSession | null> {
	try {
		const session = await getAuthSession(request);
		const userId = session?.user?.id ? String(session.user.id) : '';
		if (!userId) {
			return null;
		}

		const tenantId = await requireActiveTenantId(userId);
		return { tenantId };
	} catch {
		return null;
	}
}
