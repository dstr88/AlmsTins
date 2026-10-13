import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ redirect }) => {
	// Legacy passphrase login endpoint is disabled in favor of Auth.js providers.
	return redirect('/login?error=missing');
};
