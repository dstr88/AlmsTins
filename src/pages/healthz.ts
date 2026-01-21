import type { APIRoute } from 'astro';

export const GET: APIRoute = async () =>
	new Response('ok', {
		status: 200,
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
