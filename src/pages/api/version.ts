import type { APIRoute } from 'astro';

export const prerender = false;

// Public deploy probe: reports the commit Render actually has live. Render injects
// RENDER_GIT_COMMIT / RENDER_GIT_BRANCH into the runtime env on every deploy, so a
// single `curl /api/version` confirms exactly what shipped — no guessing whether a
// push built and switched over. No DB access, no secrets.
export const GET: APIRoute = async () => {
	return new Response(
		JSON.stringify({
			sha: process.env.RENDER_GIT_COMMIT ?? 'unknown',
			branch: process.env.RENDER_GIT_BRANCH ?? 'unknown',
			engine: process.env.DB_ENGINE ?? 'turso',
			ts: new Date().toISOString(),
		}),
		{ status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
	);
};
