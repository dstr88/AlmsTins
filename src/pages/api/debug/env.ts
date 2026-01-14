import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request }) => {
	await requireTenantSession(request);
	// Simple, auth-free debug in dev and prod
	const visible = {
		ETHERSCAN_API_KEY: !!process.env.ETHERSCAN_API_KEY,
		SNOWTRACE_API_KEY: !!process.env.SNOWTRACE_API_KEY,
	};

	console.log('[debug/env]', visible);

	return new Response(JSON.stringify(visible), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
