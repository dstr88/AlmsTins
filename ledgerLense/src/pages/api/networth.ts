import type { APIRoute } from 'astro';
import { getNetWorthSummary } from '@/lib/networth';

export const GET: APIRoute = async () => {
	try {
		const summary = await getNetWorthSummary();

		return new Response(
			JSON.stringify({
				ok: true,
				...summary,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: unknown) {
		console.error('GET /api/networth error', err);
		const message = err instanceof Error ? err.message : 'Unable to load net worth.';

		return new Response(
			JSON.stringify({
				ok: false,
				error: message,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
