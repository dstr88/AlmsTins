import { getAuthSession } from './authSession';
import { requireActiveTenantId } from './tenants';

export type TenantSession = {
	userId: string;
	tenantId: string;
};

export async function requireTenantSession(request: Request): Promise<TenantSession | null> {
	const session = await getAuthSession(request);
	const userId = session?.user && 'id' in session.user ? String(session.user.id ?? '') : '';

	if (!session || !userId) {
		return null;
	}

	try {
		const tenantId = await requireActiveTenantId(userId);
		return { userId, tenantId };
	} catch {
		return null;
	}
}
