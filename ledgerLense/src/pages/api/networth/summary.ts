import type { APIRoute } from 'astro';
import { getLatestNetWorthSummary } from '@/lib/networth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const DEV = import.meta.env.DEV;
	const LOCAL_BYPASS = import.meta.env.PUBLIC_LOCAL_DEV_NO_AUTH === 'true';

	try {
		if (!DEV && !LOCAL_BYPASS) {
			const authHeader = request.headers.get('authorization');
			const expected = import.meta.env.NETWORTH_API_TOKEN;
			if (!expected || authHeader !== `Bearer ${expected}`) {
				return new Response('Unauthorized', { status: 401 });
			}
		}

		const summary = await getLatestNetWorthSummary();
		return new Response(JSON.stringify({ ok: true, summary }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('GET /api/networth/summary error', error);
		return new Response(JSON.stringify({ ok: false, message: 'Unable to load net worth summary.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
