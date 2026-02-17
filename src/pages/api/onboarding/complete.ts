import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { ensureTenantForUser, markOnboardingComplete } from '@/lib/tenants';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
	const session = await getAuthSession(request);
	const userId = session?.user?.id ? String(session.user.id) : '';
	if (!userId) {
		return redirect('/login?error=missing', 303);
	}

	await ensureTenantForUser(userId, 'Primary');
	await markOnboardingComplete(userId);

	return redirect('/dashboard/vault', 303);
};
