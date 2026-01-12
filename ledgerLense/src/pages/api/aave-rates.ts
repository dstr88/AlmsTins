import type { APIRoute } from 'astro';

const API_BASE_URL = 'https://aave-api-v2.aave.com/data/rates-history';
const DEFAULT_POOL_ID = 'mainnet_v2';
const DEFAULT_RESERVE_ID = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const REQUEST_TIMEOUT_MS = 15000;

export const GET: APIRoute = async ({ url }) => {
	const poolId = url.searchParams.get('poolId') ?? DEFAULT_POOL_ID;
	const reserveId = url.searchParams.get('reserveId') ?? DEFAULT_RESERVE_ID;

	if (!poolId || !reserveId) {
		return new Response(JSON.stringify({ error: true, message: 'poolId and reserveId are required' }), {
			status: 400,
			headers: corsHeaders(),
		});
	}

	try {
		const upstreamUrl = new URL(API_BASE_URL);
		upstreamUrl.searchParams.set('poolId', poolId);
		upstreamUrl.searchParams.set('reserveId', reserveId);

		const response = await fetchWithTimeout(
			upstreamUrl.toString(),
			REQUEST_TIMEOUT_MS,
		);

		if (!response.ok) {
			return new Response(
				JSON.stringify({
					error: true,
					message: `Upstream Aave API responded with ${response.status}`,
				}),
				{ status: response.status, headers: corsHeaders() },
			);
		}

		const payload = await response.text();
		return new Response(payload, {
			status: 200,
			headers: {
				...corsHeaders(),
				'Content-Type': 'application/json',
			},
		});
	} catch (error) {
		console.error('Aave proxy error:', error);
		const message = error instanceof Error ? error.message : 'Unable to reach Aave API';
		const status = message.includes('aborted') ? 504 : 500;
		return new Response(JSON.stringify({ error: true, message }), {
			status,
			headers: corsHeaders(),
		});
	}
};

function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
	};
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}
