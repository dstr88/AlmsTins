import { getAuthSession } from './authSession';
import { resolveActiveTenantId } from './tenants';

export type TenantSession = {
	userId: string;
	tenantId: string;
};

export async function requireTenantSession(request: Request): Promise<TenantSession> {
	const session = await getAuthSession(request);
	const userId = session?.user && 'id' in session.user ? String(session.user.id ?? '') : '';

	if (!session || !userId) {
		throw new Response('Unauthorized', { status: 401 });
	}

	const sessionTenant = (session as any).tenantId as string | undefined;
	const tenantId = sessionTenant ?? (await resolveActiveTenantId(userId));

	if (!tenantId) {
		throw new Response('Tenant not configured', { status: 400 });
	}

	return { userId, tenantId };
}
