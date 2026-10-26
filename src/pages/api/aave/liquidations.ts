import type { APIRoute } from 'astro';
import { fetchAllLiquidationsForWallet } from '@/lib/aave/syncAaveLiquidations';
import { EVM_ADDRESS_ANY_PREFIX } from '@/lib/addressFormats';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const url = new URL(request.url);
	const address = url.searchParams.get('address') ?? '';

	if (!address || !EVM_ADDRESS_ANY_PREFIX.test(address)) {
		return json({ ok: false, error: 'Invalid address' }, 400);
	}

	try {
		const liquidations = await fetchAllLiquidationsForWallet(address);
		return json({ ok: true, liquidations });
	} catch (err) {
		console.error('[aave/liquidations] Error:', err instanceof Error ? err.message : String(err));
		return json({ ok: false, error: 'Unable to load liquidations.' }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
