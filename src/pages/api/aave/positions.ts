import type { APIRoute } from 'astro';
import { getAavePositionsForWallet } from '@/lib/aave/client';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const address = url.searchParams.get('address') ?? '';

	console.log('[api/aave/positions] address', address);

	if (!address) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing address' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const summary = await getAavePositionsForWallet(address);
		console.log('[api/aave/positions] summary', JSON.stringify(summary).slice(0, 500));

		return new Response(
			JSON.stringify({
				ok: true,
				address,
				chains: summary,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err) {
		console.error('[api/aave/positions] error', err);
		return new Response(JSON.stringify({ ok: false, error: 'Aave lookup failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
