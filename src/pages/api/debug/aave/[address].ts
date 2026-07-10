import type { APIRoute } from 'astro';
import { getAavePositionsForWallet } from '@/lib/aave/client';
import { requireAdminSession } from '@/lib/adminGuard';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	try { await requireAdminSession(request); }
	catch (e) { return e instanceof Response ? e : new Response('Unauthorized', { status: 401 }); }

	const address = params.address ?? '';
	console.log('[debug.aave] Request for address', address);

	if (!address) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing address' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const result = await getAavePositionsForWallet(address);
		const chains = Array.isArray(result?.chains) ? result.chains : [];
		const suppliedUsdTotal = chains.reduce((sum, chain) => sum + Number(chain.suppliedUsd ?? 0), 0);
		const debtUsdTotal = chains.reduce((sum, chain) => sum + Number(chain.debtUsd ?? 0), 0);

		console.log('[debug.aave] Result tokenCount=', chains.reduce((sum, chain) => sum + chain.positions.length, 0), {
			suppliedUsdTotal,
			debtUsdTotal,
		});

		return new Response(
			JSON.stringify({
				ok: true,
				address,
				positions: chains,
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
