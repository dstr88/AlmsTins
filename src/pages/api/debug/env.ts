import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
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
