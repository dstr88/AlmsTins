import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PetroTins is owner-only while PETRO_TINS_PUBLIC is false. Every PetroTins page and endpoint
 * must answer anyone but the owner (signed out, demo, another account) with what a path that
 * does not exist gets: the 404 page, no redirect to a sign-in page, nothing that says the page
 * exists, and the PetroTins page or endpoint never runs. That holds for every spelling of the
 * path that Astro routes to PetroTins, and the gate must not touch any other path. The owner's
 * PetroTins responses must never be cached or indexed.
 *
 * This runs the real src/middleware.ts. The flag is pinned to owner-only so these cases hold
 * whatever the committed switch says. The session resolver is replaced by `state.session`, and
 * app.ts by a stub that counts calls, hands the request to the route and adds the security
 * headers the real one adds. `run` stands in for Astro's App.render: a known path renders its
 * route, an unknown path renders the 404 page (which shows the requested path), and a bodiless
 * 404 from the middleware makes it render the 404 page for the same request, middleware
 * included, and merge the two responses, as Astro does.
 */
const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	sessionCalls: 0,
	throwOnSession: false,
	appCalls: 0,
}));

vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));
vi.mock('../../src/middleware/geoblock', () => ({ getGeoblockResponse: async () => null }));
vi.mock('../../src/middleware/app', async () => {
	const { applySecurityHeaders } = await import('../../src/middleware/securityHeaders');
	return {
		onRequest: async (context: { request: Request }, next: () => Promise<Response>) => {
			state.appCalls += 1;
			// Like app.ts: a demo visitor may not write through the API; nothing is rendered.
			const { method, url } = context.request;
			if (state.session?.isDemo && method !== 'GET' && new URL(url).pathname.startsWith('/api/')) {
				return applySecurityHeaders(
					new Response(JSON.stringify({ error: 'Sign up free to unlock all features.', demo: true }), {
						status: 403,
						headers: { 'Content-Type': 'application/json' },
					}),
				);
			}
			return applySecurityHeaders(await next());
		},
	};
});
vi.mock('../../src/lib/requireTenantSession', () => ({
	requireTenantSession: async () => {
		state.sessionCalls += 1;
		if (state.throwOnSession) throw new Error('session store unavailable');
		return state.session;
	},
}));

import { onRequest } from '../../src/middleware';
import { isPublicPath } from '../../src/middleware/auth';
import { canAccessPetroTins, isPetroTinsPath, withPetroTinsOwnerHeaders } from '../../src/lib/petroTinsAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const UNKNOWN_PATHS = new Set(['/nope', '/dashboard/nope', '/api/nope', '/petro-tins/nope']);

/** Astro's 404 page: it shows the requested path and marks itself for App.render. */
const notFoundPage = (pathname: string) =>
	new Response(`<!doctype html><title>404: Not found</title><pre>Path: ${pathname}</pre>`, {
		status: 404,
		headers: { 'Content-Type': 'text/html', 'X-Astro-Reroute': 'no' },
	});

/** App.render's merge of the 404 page into the bodiless 404 it replaces. */
const mergeResponses = (page: Response, original: Response) => {
	const status = original.status === 200 ? page.status : original.status;
	const originalHeaders = new Headers(original.headers);
	originalHeaders.delete('Content-Type');
	const headers = new Headers();
	for (const [k, v] of new Map([...page.headers, ...originalHeaders])) headers.set(k, v);
	return new Response(page.body, { status, statusText: original.statusText, headers });
};

type Handler = (path: string) => Response;
const run = async (path: string, init: RequestInit = {}, handler?: Handler) => {
	const request = new Request(`https://almstins.com${path}`, init);
	const url = new URL(request.url);
	/** Every route a real `next` rendered: 'route' (the matched page or endpoint) or '/404'. */
	const rendered: string[] = [];
	const pass = (routePattern: string) =>
		(onRequest as any)(
			{ request, url, routePattern },
			vi.fn(async () => {
				rendered.push(routePattern);
				if (routePattern === '/404') return notFoundPage(url.pathname);
				return handler ? handler(url.pathname) : new Response('handler', { status: 200 });
			}),
		) as Promise<Response>;

	let res = await pass(UNKNOWN_PATHS.has(url.pathname) ? '/404' : 'route');
	if (res.status === 404 && res.body === null && res.headers.get('X-Astro-Reroute') !== 'no') {
		res = mergeResponses(await pass('/404'), res);
	} else if (res.headers.has('X-Astro-Reroute')) {
		res.headers.delete('X-Astro-Reroute');
	}
	return { res, rendered };
};

const PETRO_PATHS: Array<[string, RequestInit?]> = [
	['/petro-tins'],
	['/petro-tins/docs'],
	['/petro-tins/privacy'],
	['/petro-tins/terms'],
	['/dashboard/petro-tins'],
	['/dashboard/petro-tins/upgrade'],
	['/api/petro-tins'],
	['/api/petro-tins', { method: 'POST' }],
	['/api/petro-tins/demo'],
	['/api/petro-tins/seed', { method: 'POST' }],
	['/api/petro-tins/visit', { method: 'POST' }],
	['/api/petro-tins/subscription'],
	['/api/petro-tins/receipts'],
	['/api/petro-tins/receipts/export'],
	['/api/petro-tins/receipts/x/photo'],
	['/api/petro-tins/abc', { method: 'PATCH' }],
	['/api/petro-tins/entries?id=1', { method: 'DELETE' }],
];

// Spellings that reach PetroTins in Astro (trailing slash, a doubled leading slash, one level of
// percent-encoding) plus ones that route nowhere but are refused anyway.
const VARIANTS = [
	'/petro-tins/',
	'//petro-tins',
	'/petro%2Dtins',
	'/%70etro-tins',
	'/dashboard/petro%2Dtins',
	'/PETRO-TINS',
	'/Petro-Tins/Docs',
	'/dashboard//petro-tins',
	'///petro-tins',
	'/dashboard/petro-tins/upgrade/',
	'/petro%252Dtins',
	'/api%2Fpetro-tins',
	'/petro-tins?next=/x',
];

/** Hidden: the 404 page, the route never ran, no sign-in redirect, never cached or indexed. */
const expectHidden = async (path: string, init?: RequestInit) => {
	const { res, rendered } = await run(path, init);
	expect(res.status, path).toBe(404);
	expect(await res.text(), path).toMatch(/^<!doctype html><title>404: Not found<\/title><pre>Path: \//);
	expect(res.headers.get('Content-Type'), path).toBe('text/html');
	expect(res.headers.get('Cache-Control'), path).toBe('no-store');
	expect(res.headers.get('X-Robots-Tag'), path).toMatch(/noindex/);
	expect(res.headers.get('Location'), path).toBeNull();
	expect(res.headers.get('X-Frame-Options'), path).toBe('DENY');
	expect(res.headers.get('X-Astro-Reroute'), path).toBeNull();
	expect(rendered, path).toEqual(['/404']);
};

/** Everything an outside observer sees (status, body, every header), with the path shown on the page lined up. */
const observed = async (res: Response) => ({
	status: res.status,
	body: (await res.text()).replace(/<pre>Path: [^<]*<\/pre>/, '<pre>Path: X</pre>'),
	headers: [...res.headers.entries()].sort(),
});

beforeEach(() => {
	state.session = null;
	state.sessionCalls = 0;
	state.throwOnSession = false;
	state.appCalls = 0;
});

describe('PetroTins gate: everyone but the owner gets what an unknown path gets', () => {
	const viewers: Array<[string, null | { tenantId: string; isDemo?: boolean }]> = [
		['signed out', null],
		['a demo session', { tenantId: DEMO_TENANT_ID, isDemo: true }],
		['another account', { tenantId: OTHER_TENANT_ID }],
		['the owner tenant flagged as demo', { tenantId: OWNER_TENANT_ID, isDemo: true }],
	];

	for (const [who, session] of viewers) {
		it(`${who}: every PetroTins page and endpoint is the 404 page, and the route never runs`, async () => {
			state.session = session;
			let hidden = 0;
			for (const [path, init] of PETRO_PATHS) {
				if (session?.isDemo && init?.method) {
					// A demo write is refused by app.ts before anything renders, as on any /api path.
					const { res, rendered } = await run(path, init);
					expect(res.status, path).toBe(403);
					expect(rendered, path).toEqual([]);
					continue;
				}
				await expectHidden(path, init);
				hidden += 1;
			}
			// A viewer with a session goes through app.ts like an unknown path, on the refusal and on
			// the 404 page; signed out skips it (app.ts would send them to sign in).
			const writes = PETRO_PATHS.length - hidden;
			expect(state.appCalls).toBe(session ? hidden * 2 + writes : 0);
		});
	}

	for (const [who, session] of viewers.slice(1, 3)) {
		it(`${who}: a PetroTins path is indistinguishable from a path that does not exist`, async () => {
			state.session = session;
			for (const [method, petro, unknown] of [
				['GET', '/dashboard/petro-tins', '/dashboard/nope'],
				['GET', '/api/petro-tins', '/api/nope'],
				['GET', '/petro-tins', '/nope'],
				['POST', '/api/petro-tins', '/api/nope'],
				['DELETE', '/api/petro-tins', '/api/nope'],
			]) {
				const a = await observed((await run(petro, { method })).res);
				const b = await observed((await run(unknown, { method })).res);
				expect(a, `${method} ${petro} vs ${unknown}`).toEqual(b);
				expect(a.status).toBe(session?.isDemo && method !== 'GET' ? 403 : 404);
			}
		});
	}

	it('signed out: the PetroTins 404 is the same response a demo visitor gets for an unknown path', async () => {
		const hidden = await observed((await run('/api/petro-tins/receipts')).res);
		state.session = { tenantId: DEMO_TENANT_ID, isDemo: true };
		const unknown = await observed((await run('/dashboard/nope')).res);
		expect(hidden).toEqual(unknown);
	});

	it('signed out: every path variant Astro could route to PetroTins is hidden', async () => {
		for (const path of VARIANTS) await expectHidden(path);
		// A backslash is a slash to the URL parser.
		await expectHidden('/\\petro-tins');
		expect(state.appCalls).toBe(0);
	});

	it('a demo session: the path variants are hidden too', async () => {
		state.session = { tenantId: DEMO_TENANT_ID, isDemo: true };
		for (const path of VARIANTS) await expectHidden(path);
	});

	it('fails closed: if the session cannot be resolved, the answer is the 404 page', async () => {
		state.throwOnSession = true;
		await expectHidden('/dashboard/petro-tins');
		await expectHidden('/api/petro-tins/receipts');
	});

	it('the 404 does not redirect a signed-out visitor to sign in', async () => {
		const { res } = await run('/petro-tins');
		expect(res.status).toBe(404);
		expect(res.headers.get('Location')).toBeNull();
	});
});

describe('PetroTins gate: the owner keeps full access', () => {
	for (const tenantId of [OWNER_TENANT_ID, OWNER_TENANT_ID.toUpperCase()]) {
		it(`owner (${tenantId === OWNER_TENANT_ID ? 'lowercase' : 'uppercase'} tenant id) reaches every page and endpoint through app.ts`, async () => {
			state.session = { tenantId };
			for (const [path, init] of PETRO_PATHS) {
				const { res, rendered } = await run(path, init);
				expect(res.status, path).toBe(200);
				expect(await res.text(), path).toBe('handler');
				expect(rendered, path).toEqual(['route']);
			}
			expect(state.appCalls).toBe(PETRO_PATHS.length);
		});
	}

	it("owner: the responses are private, never stored, keyed on the cookie and never indexed", async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		for (const [path, init] of PETRO_PATHS) {
			const { res } = await run(path, init);
			expect(res.headers.get('Cache-Control'), path).toBe('private, no-store');
			expect(res.headers.get('Vary'), path).toMatch(/(^|,\s*)Cookie$/);
			expect(res.headers.get('X-Robots-Tag'), path).toBe('noindex, nofollow');
			expect(res.headers.get('X-Frame-Options'), path).toBe('DENY');
		}
	});

	it("owner: a route's own caching is overridden (the receipt photo's max-age), and a 404 stays private", async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		const photo = await run('/api/petro-tins/receipts/x/photo', {}, () =>
			new Response('bytes', { status: 200, headers: { 'Cache-Control': 'private, max-age=300', 'Vary': 'Accept-Encoding' } }),
		);
		expect(photo.res.headers.get('Cache-Control')).toBe('private, no-store');
		expect(photo.res.headers.get('Vary')).toBe('Accept-Encoding, Cookie');

		const missing = await run('/api/petro-tins/receipts/gone/photo', {}, () => new Response('Not found', { status: 404 }));
		expect(missing.res.status).toBe(404);
		expect(missing.res.headers.get('Cache-Control')).toBe('private, no-store');
		expect(missing.res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
	});

	it('a PetroTins subpath with no page: the 404 page for everyone, private for the owner', async () => {
		await expectHidden('/petro-tins/nope');
		state.session = { tenantId: OWNER_TENANT_ID };
		const { res, rendered } = await run('/petro-tins/nope');
		expect(res.status).toBe(404);
		expect(rendered).toEqual(['/404']);
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
	});

	it('owner: the routable variants go through as well', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		for (const path of ['/petro-tins/', '//petro-tins', '/petro%2Dtins', '/dashboard/petro-tins/upgrade/']) {
			const { res } = await run(path);
			expect(res.status, path).toBe(200);
			expect(res.headers.get('Cache-Control'), path).toBe('private, no-store');
		}
	});
});

describe('PetroTins gate: other paths are untouched', () => {
	it('never resolves a session for, never hides and never adds cache headers to, a path that is not PetroTins', async () => {
		for (const path of [
			'/petro',
			'/petro-tinsx',
			'/petro-tins-old',
			'/dashboard/petro',
			'/api/petro-tinsx',
			'/verify',
			'/verify/login',
			'/receivables',
			'/receivables/',
			'/login?next=/dashboard/petro-tins',
			'/api/demo/start?next=/dashboard/petro-tins',
			'/dashboard/vault',
			'/api/cron/petro-tins-reminder',
			'/',
		]) {
			const { res, rendered } = await run(path);
			expect(res.status, path).toBe(200);
			expect(rendered, path).toEqual(['route']);
			expect(res.headers.get('Cache-Control'), path).toBeNull();
			expect(res.headers.get('X-Robots-Tag'), path).toBeNull();
		}
		expect(state.sessionCalls).toBe(0);
	});

	it('a path that does not exist keeps its 404 page, now never stored and never indexed', async () => {
		state.session = { tenantId: OTHER_TENANT_ID };
		const { res } = await run('/dashboard/nope');
		expect(res.status).toBe(404);
		expect(await res.text()).toContain('<pre>Path: /dashboard/nope</pre>');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
		expect(state.sessionCalls).toBe(0);
	});

	it('the reminder cron stays a public, secret-gated machine path', async () => {
		expect(isPublicPath('/api/cron/petro-tins-reminder')).toBe(true);
		const { res, rendered } = await run('/api/cron/petro-tins-reminder');
		expect(res.status).toBe(200);
		expect(rendered).toEqual(['route']);
		expect(state.appCalls).toBe(0);
	});
});

describe('isPetroTinsPath', () => {
	it('matches every PetroTins prefix and spelling', () => {
		for (const [path] of PETRO_PATHS) expect(isPetroTinsPath(path), path).toBe(true);
		for (const path of VARIANTS) expect(isPetroTinsPath(path), path).toBe(true);
		expect(isPetroTinsPath('/petro-tins#x')).toBe(true);
		expect(isPetroTinsPath('\\petro-tins')).toBe(true);
		expect(isPetroTinsPath('/petro-tins/%')).toBe(true);
	});

	it('does not match look-alikes or unrelated paths', () => {
		for (const path of ['/petro', '/petro-tinsx', '/api/petro-tinsx', '/dashboard/petro', '/api/cron/petro-tins-reminder',
			'/verify', '/receivables', '/login', '/', '', '/xpetro-tins', '/api/petro']) {
			expect(isPetroTinsPath(path), path).toBe(false);
		}
	});
});

describe('canAccessPetroTins', () => {
	it('allows only a real owner session while owner-only', () => {
		expect(canAccessPetroTins({ tenantId: OWNER_TENANT_ID })).toBe(true);
		expect(canAccessPetroTins({ tenantId: OWNER_TENANT_ID.toUpperCase() })).toBe(true);
		expect(canAccessPetroTins({ tenantId: OWNER_TENANT_ID, isDemo: true })).toBe(false);
		expect(canAccessPetroTins({ tenantId: DEMO_TENANT_ID, isDemo: true })).toBe(false);
		expect(canAccessPetroTins({ tenantId: OTHER_TENANT_ID })).toBe(false);
		expect(canAccessPetroTins({ tenantId: null })).toBe(false);
		expect(canAccessPetroTins(null)).toBe(false);
		expect(canAccessPetroTins(undefined)).toBe(false);
	});

	it('allows everyone when public', () => {
		expect(canAccessPetroTins(null, true)).toBe(true);
		expect(canAccessPetroTins({ tenantId: DEMO_TENANT_ID, isDemo: true }, true)).toBe(true);
	});
});

describe('withPetroTinsOwnerHeaders', () => {
	it('adds Cookie to Vary once, and works on an immutable redirect', () => {
		expect(withPetroTinsOwnerHeaders(new Response('x', { headers: { Vary: 'cookie' } })).headers.get('Vary')).toBe('cookie');
		const redirect = withPetroTinsOwnerHeaders(Response.redirect('https://almstins.com/dashboard/petro-tins', 302));
		expect(redirect.status).toBe(302);
		expect(redirect.headers.get('Location')).toBe('https://almstins.com/dashboard/petro-tins');
		expect(redirect.headers.get('Cache-Control')).toBe('private, no-store');
	});
});

describe('public path list', () => {
	it('no PetroTins path is public while owner-only', () => {
		for (const path of ['/petro-tins', '/petro-tins/docs', '/petro-tins/terms', '/petro-tins/privacy', '/api/petro-tins/demo']) {
			expect(isPublicPath(path), path).toBe(false);
		}
	});
});
