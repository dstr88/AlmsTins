import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Making PetroTins public again is one line (PETRO_TINS_PUBLIC in src/lib/petroTinsFlag.mjs).
 * With the switch on, everything the owner-only mode hides comes back: no gate, the public
 * pages skip app.ts again, the sitemap lists them, and sign-in errors return to /petro-tins.
 */
const state = vi.hoisted(() => ({ sessionCalls: 0, appCalls: 0 }));

vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: true }));
vi.mock('../../src/middleware/geoblock', () => ({ getGeoblockResponse: async () => null }));
vi.mock('../../src/middleware/app', () => ({
	onRequest: async (_context: unknown, next: () => Promise<Response>) => {
		state.appCalls += 1;
		return next();
	},
}));
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => {
		state.sessionCalls += 1;
		return null;
	},
}));

import { onRequest } from '../../src/middleware';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { routeSignInError } from '../../src/lib/authErrorRedirect';
import { canAccessPetroTins, petroTinsVisibility } from '../../src/lib/petroTinsAccess';
import { GET as petroDemo } from '../../src/pages/api/petro-tins/demo';

const run = async (path: string) => {
	const request = new Request(`https://almstins.com${path}`);
	const next = vi.fn(async () => new Response('handler', { status: 200 }));
	const res = (await (onRequest as any)({ request, url: new URL(request.url) }, next)) as Response;
	return { res, next };
};

beforeEach(() => {
	state.sessionCalls = 0;
	state.appCalls = 0;
});

describe('PetroTins with the public switch on', () => {
	it('the gate lets everyone through and never resolves a session', async () => {
		for (const path of ['/petro-tins', '/petro-tins/docs', '/api/petro-tins/demo', '/dashboard/petro-tins', '/api/petro-tins']) {
			const { res } = await run(path);
			expect(res.status, path).toBe(200);
			// No owner-only private headers: the public pages are cacheable and indexable again.
			expect(res.headers.get('Cache-Control'), path).toBeNull();
			expect(res.headers.get('X-Robots-Tag'), path).toBeNull();
		}
		expect(state.sessionCalls).toBe(0);
		expect(canAccessPetroTins(null)).toBe(true);
	});

	it('the public pages skip app.ts again; the dashboard and API still go through it', async () => {
		for (const path of ['/petro-tins', '/petro-tins/docs', '/petro-tins/terms', '/petro-tins/privacy', '/api/petro-tins/demo']) {
			expect(isPublicPath(path), path).toBe(true);
		}
		await run('/petro-tins');
		expect(state.appCalls).toBe(0);
		await run('/dashboard/petro-tins');
		expect(state.appCalls).toBe(1);
	});

	it('the sitemap lists the public pages and sign-in errors return to /petro-tins', () => {
		expect(sitemapFilter('https://almstins.com/petro-tins/')).toBe(true);
		expect(sitemapFilter('https://almstins.com/petro-tins/docs/')).toBe(true);
		expect(sitemapFilter('https://almstins.com/dashboard/petro-tins/')).toBe(false);

		const res = routeSignInError(
			new Request('https://almstins.com/api/auth/callback/credentials', { method: 'POST', headers: { referer: 'https://almstins.com/petro-tins' } }),
			Response.redirect('https://almstins.com/login?error=CredentialsSignin&code=credentials', 302),
		);
		expect(new URL(res.headers.get('Location')!).pathname).toBe('/petro-tins');
	});

	it('the PetroTins demo link starts the demo again, and the links come back', async () => {
		const res = (await petroDemo({} as never)) as Response;
		expect(res.headers.get('Location')).toBe('/api/demo/start?next=/dashboard/petro-tins');
		expect(res.headers.get('Set-Cookie')).toContain('authjs.session-token=');

		const anyone = petroTinsVisibility({ isOwner: false, isAdmin: true });
		expect(anyone).toEqual({ tradfiNav: false, navLink: true, adminStats: true, changelog: true });
		expect(petroTinsVisibility({ isOwner: false, isTradfiDomain: true }).tradfiNav).toBe(true);
	});
});
