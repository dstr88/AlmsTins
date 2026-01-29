import type { APIRoute } from 'astro';
import { getSimplePricesById } from '@/lib/prices/coingecko';

export const prerender = false;

function withTimeout<T>(promise: Promise<T>, ms: number) {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch((error) => {
				clearTimeout(timer);
				reject(error);
			});
	});
}

export const GET: APIRoute = async ({ request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const startedAt = Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	try {
		const url = new URL(request.url);
		const rawIds = url.searchParams.get('ids') ?? '';
		const normalizedIds = rawIds
			.split(',')
			.map((id) => id.normalize('NFKC').trim().toLowerCase())
			.filter((id) => id && /^[a-z0-9-]+$/.test(id));
		const capApplied = normalizedIds.length > 50;
		const ids = capApplied ? normalizedIds.slice(0, 50) : normalizedIds;

		console.log('[coingecko] ids', {
			rawCount: rawIds.split(',').filter(Boolean).length,
			sanitizedCount: ids.length,
			capApplied,
		});

		if (!ids.length) {
			console.log('[perf] coingecko-prices-by-id', {
				requestId,
				durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
				status: 200,
				count: 0,
			});
			return new Response(JSON.stringify({}), {
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
			});
		}
		const payload = await withTimeout(getSimplePricesById(ids), 2000);
		console.log('[coingecko] ids done', {
			durationMs: Date.now() - startedAt,
			returnedCount: Object.keys(payload ?? {}).length,
		});
		console.log('[perf] coingecko-prices-by-id', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			count: Object.keys(payload ?? {}).length,
		});
		return new Response(JSON.stringify(payload ?? {}), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	} catch (error) {
		console.warn('[api/coingecko-prices-by-id] failed');
		console.log('[perf] coingecko-prices-by-id', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
		});
		return new Response(JSON.stringify({}), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	}
};
