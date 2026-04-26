import { getAuthSession } from './authSession';
import { requireActiveTenantId } from './tenants';
import { isDemoRequest, DEMO_TENANT_ID } from './demo';

export type TenantSession = {
	tenantId: string;
	isDemo?: boolean;
};

export async function requireTenantSession(request: Request): Promise<TenantSession | null> {
	// Demo mode: bypass auth entirely and return the pre-seeded demo tenant.
	if (isDemoRequest(request)) {
		return { tenantId: DEMO_TENANT_ID, isDemo: true };
	}

	try {
		const session = await getAuthSession(request);
		if (!session?.user?.id) return null;

		// Fast path: the JWT already contains tenantId (set at sign-in).
		// Trusting the signed JWT avoids 2 sequential DB round trips on every
		// API request. The JWT is RS256/HS256 signed — cannot be forged.
		if (session.tenantId) {
			return { tenantId: session.tenantId };
		}

		// Slow path: older sessions without tenantId in JWT — resolve from DB.
		const tenantId = await requireActiveTenantId(session.user.id);
		return { tenantId };
	} catch {
		return null;
	}
}
