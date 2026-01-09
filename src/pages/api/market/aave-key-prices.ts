import type { APIRoute } from 'astro';
import { getAaveKeyPrices } from '../../../lib/aavePrices';

const symbols = ['BTC', 'ETH', 'POL', 'AVAX'] as const;

export const GET: APIRoute = async ({ url }) => {
	console.log('[aave-key-prices] Endpoint hit');

	if (import.meta.env.DEV && url.pathname === '/api/market/aave-key-prices') {
		// Match middleware DEV bypass pattern
		return await handleRequest();
	}

	return await handleRequest();
};

async function handleRequest() {
	try {
		const prices = await getAaveKeyPrices([...symbols]);
		return new Response(JSON.stringify({ prices }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[aave-key-prices] Failed to load Aave key prices', error);
		return new Response(JSON.stringify({ error: 'Failed to load Aave key prices' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
