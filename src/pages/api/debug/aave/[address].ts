import type { APIRoute } from 'astro';
import { getAavePositionsForWallet } from '@/lib/aave/client';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const address = params.address ?? '';
	console.log('[debug.aave] Request for address', address);

	if (!address) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing address' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const positions = await getAavePositionsForWallet(address, ['ethereum', 'polygon', 'avalanche']);
		const suppliedUsdTotal = positions.reduce((sum, chain) => sum + Number(chain.suppliedUsd ?? 0), 0);
		const debtUsdTotal = positions.reduce((sum, chain) => sum + Number(chain.debtUsd ?? 0), 0);

		console.log('[debug.aave] Result tokenCount=', positions.reduce((sum, chain) => sum + chain.positions.length, 0), {
			suppliedUsdTotal,
			debtUsdTotal,
		});

		return new Response(
			JSON.stringify({
				ok: true,
				address,
				positions,
				totals: { suppliedUsdTotal, debtUsdTotal },
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err) {
		console.error('[debug.aave] Error for address', address, err);
		return new Response(JSON.stringify({ ok: false, error: 'Failed to load Aave data' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
