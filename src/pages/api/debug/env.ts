import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/adminGuard';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try { await requireAdminSession(request); }
	catch (e) { return e instanceof Response ? e : new Response('Unauthorized', { status: 401 }); }

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
