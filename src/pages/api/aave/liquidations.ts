import type { APIRoute } from 'astro';
import { fetchAllLiquidationsForWallet } from '@/lib/aave/syncAaveLiquidations';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const address = url.searchParams.get('address') ?? '';

	if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
		return json({ ok: false, error: 'Invalid address' }, 400);
	}

	try {
		const liquidations = await fetchAllLiquidationsForWallet(address);
		return json({ ok: true, liquidations });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[aave/liquidations] Error:', message);
		return json({ ok: false, error: message }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
