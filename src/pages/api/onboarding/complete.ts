import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { ensureTenantForUser, getTenantStateDetails, markOnboardingComplete } from '@/lib/tenants';

export const prerender = false;

const tenantDebugEnabled = process.env.TENANT_DEBUG === '1';

async function readAuthUserDebugRow(userId: string) {
	try {
		const result = await db.execute({
			sql: 'SELECT id, active_tenant_id, is_onboarded, setup_completed_at FROM auth_users WHERE id = ? LIMIT 1',
			args: [userId],
		});
		const row = result.rows[0] as Record<string, unknown> | undefined;
		if (!row) return null;
		return {
			id: row.id ? String(row.id) : null,
			activeTenantId: row.active_tenant_id ? String(row.active_tenant_id) : null,
			isOnboarded: row.is_onboarded ?? null,
			setupCompletedAt: row.setup_completed_at ?? null,
		};
	} catch (error) {
		if (tenantDebugEnabled) {
			console.warn('[onboarding.complete] debug row read failed', {
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return null;
	}
}

export const GET: APIRoute = async ({ redirect }) => {
	return redirect('/onboarding/tenant-setup?error=use-post', 303);
};

export const POST: APIRoute = async ({ request, redirect }) => {
	if (tenantDebugEnabled) {
		console.log('[onboarding.complete] request', {
			method: request.method,
			referer: request.headers.get('referer') ?? null,
		});
	}
	const session = await getAuthSession(request);
	const userId = session?.user?.id ? String(session.user.id) : '';
	if (!userId) {
		const loginRedirect = '/login?error=missing&next=/onboarding/tenant-setup';
		if (tenantDebugEnabled) {
			console.log('[onboarding.complete] redirect unauthenticated', { to: loginRedirect });
		}
		return redirect(loginRedirect, 303);
	}

	if (tenantDebugEnabled) {
		console.log('[onboarding.complete] start', { userId });
		console.log('[onboarding.complete] before', await readAuthUserDebugRow(userId));
	}

	const tenantId = await ensureTenantForUser(userId, 'Primary');
	const didMark = await markOnboardingComplete(userId);
	const tenantState = await getTenantStateDetails(userId);

	if (tenantDebugEnabled) {
		const membershipCheck = await db.execute({
			sql: 'SELECT COUNT(*) AS count FROM tenant_memberships WHERE user_id = ? AND tenant_id = ?',
			args: [userId, tenantId],
		});
		console.log('[onboarding.complete] after', await readAuthUserDebugRow(userId));
		console.log('[onboarding.complete] result', {
			userId,
			tenantId,
			didMark,
			membershipCount: Number((membershipCheck.rows[0] as Record<string, unknown> | undefined)?.count ?? 0),
			onboardingComplete: tenantState.onboardingComplete,
			hasTenant: tenantState.hasTenant,
			activeTenantId: tenantState.activeTenantId,
		});
	}

	if (!tenantState.onboardingComplete) {
		console.warn('[onboarding.complete] onboarding state not persisted', {
			userId,
			tenantId,
			didMark,
			activeTenantId: tenantState.activeTenantId,
			hasTenant: tenantState.hasTenant,
			onboardingComplete: tenantState.onboardingComplete,
		});
		return redirect('/onboarding/tenant-setup?error=setup-incomplete', 303);
	}

	return redirect('/dashboard/vault', 303);
};
