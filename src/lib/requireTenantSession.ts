import { getAuthSession } from './authSession';
import { requireActiveTenantId } from './tenants';

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

	try {
		const tenantId = await requireActiveTenantId(userId);
		return { userId, tenantId };
	} catch (err) {
		if (err instanceof Response) {
			throw err;
		}
		const status = (err as any)?.status ?? 403;
		const message = (err as any)?.message ?? 'Forbidden';
		throw new Response(message, { status });
	}

}
