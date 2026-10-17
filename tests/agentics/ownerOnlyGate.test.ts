import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Agent Vault is owner-only while AGENTICS_VAULT_PUBLIC is false. Every Vault page and endpoint
 * must answer anyone but the owner (signed out, demo, another account) with what a path that does
 * not exist gets: the 404 page, no redirect to a sign-in page, nothing that says it exists, and
 * the Vault page or endpoint never runs. That holds for every spelling of the path that Astro
 * routes to the Vault, and the gate must not touch any other path, above all the live public ones:
 * the docs page /agentics and the pre-send check /api/verify/check. The owner's Vault responses
 * must never be cached or indexed.
 *
 * This runs the real src/middleware.ts, the way tests/middleware/petroTinsGate.test.ts does for
 * PetroTins. The flag is pinned to owner-only so these cases hold whatever the committed switch
 * says. The session resolver is replaced by `state.session`, and app.ts by a stub that counts
 * calls and hands the request to the route. `run` stands in for Astro's App.render: a known path
 * renders its route, an unknown path renders the 404 page, and a bodiless 404 from the middleware
 * makes it render the 404 page for the same request, middleware included, and merge the two.
 */
const state = vi.hoisted(() => ({
  session: null as null | { tenantId: string; isDemo?: boolean },
  sessionCalls: 0,
  throwOnSession: false,
  appCalls: 0,
}));

vi.mock('../../src/lib/agenticsFlag.mjs', () => ({ AGENTICS_VAULT_PUBLIC: false }));
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
import {
  agenticsGate,
  agenticsRefusal,
  canAccessAgenticsVault,
  isAgenticsVaultPath,
  withAgenticsOwnerHeaders,
} from '../../src/lib/agenticsAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const UNKNOWN_PATHS = new Set(['/nope', '/dashboard/nope', '/api/nope']);

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

const run = async (path: string, init: RequestInit = {}) => {
  const request = new Request(`https://almstins.com${path}`, init);
  const url = new URL(request.url);
  /** Every route a real `next` rendered: 'route' (the matched page or endpoint) or '/404'. */
  const rendered: string[] = [];
  const pass = (routePattern: string) =>
    (onRequest as any)(
      { request, url, routePattern },
      vi.fn(async () => {
        rendered.push(routePattern);
        return routePattern === '/404' ? notFoundPage(url.pathname) : new Response('handler', { status: 200 });
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

/** Every Vault page and endpoint, as the slices will have them. */
const VAULT_PATHS: Array<[string, RequestInit?]> = [
  ['/dashboard/agentics'],
  ['/dashboard/agentics/reports'],
  ['/api/agentics/tins'],
  ['/api/agentics/tins?id=abc'],
  ['/api/agentics/tins', { method: 'POST' }],
  ['/api/agentics/tins', { method: 'PATCH' }],
  ['/api/agentics/tins?id=abc', { method: 'DELETE' }],
  ['/api/agentics/wallets', { method: 'POST' }],
  ['/api/agentics/wallets?id=abc', { method: 'DELETE' }],
  ['/api/agentics/destinations?tinId=abc'],
  ['/api/agentics/destinations', { method: 'POST' }],
  ['/api/agentics/destinations?id=abc', { method: 'DELETE' }],
  ['/api/agentics/destinations/trust', { method: 'POST' }],
];

// Spellings that reach the Vault in Astro (trailing slash, a doubled leading slash, one level of
// percent-encoding) plus ones that route nowhere but are refused anyway.
const VARIANTS = [
  '/dashboard/agentics/',
  '/dashboard//agentics',
  '//dashboard/agentics',
  '/dashboard/agentics?next=/x',
  '/dashboard/Agentics',
  '/DASHBOARD/AGENTICS',
  '/dashboard/%61gentics',
  '/dashboard/agentic%73',
  '/dashboard%2Fagentics',
  '/dashboard/agentics%252Freports',
  '/api/agentics/',
  '//api/agentics/tins',
  '///api///agentics//tins',
  '/API/Agentics/Tins',
  '/api%2Fagentics/tins',
  '/api/agentics%2Ftins',
  '/api/%61gentics/tins',
  '/api/agentics/tins/',
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

describe('Agent Vault gate: everyone but the owner gets what an unknown path gets', () => {
  const viewers: Array<[string, null | { tenantId: string; isDemo?: boolean }]> = [
    ['signed out', null],
    ['a demo session', { tenantId: DEMO_TENANT_ID, isDemo: true }],
    ['another account', { tenantId: OTHER_TENANT_ID }],
    ['the owner tenant flagged as demo', { tenantId: OWNER_TENANT_ID, isDemo: true }],
  ];

  for (const [who, session] of viewers) {
    it(`${who}: every Vault page and endpoint is the 404 page, and the route never runs`, async () => {
      state.session = session;
      let hidden = 0;
      for (const [path, init] of VAULT_PATHS) {
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
      // A viewer with a session goes through app.ts like an unknown path, on the refusal and on the
      // 404 page; signed out skips it (app.ts would send them to sign in).
      const writes = VAULT_PATHS.length - hidden;
      expect(state.appCalls).toBe(session ? hidden * 2 + writes : 0);
    });
  }

  for (const [who, session] of viewers.slice(1, 3)) {
    it(`${who}: a Vault path is indistinguishable from a path that does not exist`, async () => {
      state.session = session;
      for (const [method, vaultPath, unknown] of [
        ['GET', '/dashboard/agentics', '/dashboard/nope'],
        ['GET', '/api/agentics/tins', '/api/nope'],
        ['POST', '/api/agentics/destinations', '/api/nope'],
        ['DELETE', '/api/agentics/wallets', '/api/nope'],
      ]) {
        const a = await observed((await run(vaultPath, { method })).res);
        const b = await observed((await run(unknown, { method })).res);
        expect(a, `${method} ${vaultPath} vs ${unknown}`).toEqual(b);
        expect(a.status).toBe(session?.isDemo && method !== 'GET' ? 403 : 404);
      }
    });
  }

  it('signed out: every path variant Astro could route to the Vault is hidden', async () => {
    for (const path of VARIANTS) await expectHidden(path);
    // A backslash is a slash to the URL parser.
    await expectHidden('/\\dashboard\\agentics');
    expect(state.appCalls).toBe(0);
  });

  it('a demo session and another account: the path variants are hidden too', async () => {
    for (const session of [{ tenantId: DEMO_TENANT_ID, isDemo: true }, { tenantId: OTHER_TENANT_ID }]) {
      state.session = session;
      for (const path of VARIANTS) await expectHidden(path);
    }
  });

  it('fails closed: if the session cannot be resolved, the answer is the 404 page', async () => {
    state.throwOnSession = true;
    await expectHidden('/dashboard/agentics');
    await expectHidden('/api/agentics/tins');
  });

  it('the 404 does not redirect a signed-out visitor to sign in', async () => {
    const { res } = await run('/dashboard/agentics');
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
  });
});

describe('Agent Vault gate: the owner keeps full access', () => {
  for (const tenantId of [OWNER_TENANT_ID, OWNER_TENANT_ID.toUpperCase()]) {
    it(`owner (${tenantId === OWNER_TENANT_ID ? 'lowercase' : 'uppercase'} tenant id) reaches every page and endpoint through app.ts`, async () => {
      state.session = { tenantId };
      for (const [path, init] of VAULT_PATHS) {
        const { res, rendered } = await run(path, init);
        expect(res.status, path).toBe(200);
        expect(await res.text(), path).toBe('handler');
        expect(rendered, path).toEqual(['route']);
      }
      expect(state.appCalls).toBe(VAULT_PATHS.length);
    });
  }

  it('owner: the responses are private, never stored, keyed on the cookie and never indexed', async () => {
    state.session = { tenantId: OWNER_TENANT_ID };
    for (const [path, init] of VAULT_PATHS) {
      const { res } = await run(path, init);
      expect(res.headers.get('Cache-Control'), path).toBe('private, no-store');
      expect(res.headers.get('Vary'), path).toMatch(/(^|,\s*)Cookie$/);
      expect(res.headers.get('X-Robots-Tag'), path).toBe('noindex, nofollow');
      expect(res.headers.get('X-Frame-Options'), path).toBe('DENY');
    }
  });

  it('owner: the routable variants go through as well', async () => {
    state.session = { tenantId: OWNER_TENANT_ID };
    for (const path of ['/dashboard/agentics/', '//api/agentics/tins', '/api/agentics/tins/', '/dashboard/%61gentics']) {
      const { res } = await run(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Cache-Control'), path).toBe('private, no-store');
    }
  });
});

describe('Agent Vault gate: other paths are untouched, above all the live public ones', () => {
  it('never resolves a session for, never hides and never adds cache headers to, a path that is not the Vault', async () => {
    for (const path of [
      '/agentics',
      '/agentics/',
      '/agentic',
      '/agenticsx',
      '/api/agentic',
      '/api/agenticsx',
      '/dashboard/agentic',
      '/dashboard/agenticsx',
      '/api/verify/check?value=x',
      '/api/verify/agent-keys',
      '/api/verify/agents',
      '/verify',
      '/dashboard/vault',
      '/api/cron/refresh-threat-lists',
      '/login?next=/dashboard/agentics',
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

  it('/agentics (the docs) and /api/verify/check stay public and skip app.ts', async () => {
    for (const path of ['/agentics', '/agentics/', '/api/verify/check']) {
      expect(isPublicPath(path), path).toBe(true);
      const { res, rendered } = await run(path);
      expect(res.status, path).toBe(200);
      expect(rendered, path).toEqual(['route']);
    }
    expect(state.appCalls).toBe(0);
  });

  it('the old docs URL still sends people to /agentics, as before', async () => {
    const { res } = await run('/verify/agents');
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get('Location') ?? '', 'https://almstins.com').pathname).toBe('/agentics');
    expect(state.sessionCalls).toBe(0);
  });

  it('a path that does not exist keeps its 404 page', async () => {
    state.session = { tenantId: OTHER_TENANT_ID };
    const { res } = await run('/dashboard/nope');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('<pre>Path: /dashboard/nope</pre>');
    expect(state.sessionCalls).toBe(0);
  });
});

describe('Agent Vault gate next to PetroTins', () => {
  it('each gate hides only its own paths, and the owner reaches both', async () => {
    state.session = { tenantId: OTHER_TENANT_ID };
    await expectHidden('/dashboard/petro-tins');
    await expectHidden('/api/petro-tins');
    await expectHidden('/dashboard/agentics');
    await expectHidden('/api/agentics/tins');

    state.session = { tenantId: OWNER_TENANT_ID };
    for (const path of ['/dashboard/petro-tins', '/api/petro-tins', '/dashboard/agentics', '/api/agentics/tins']) {
      const { res, rendered } = await run(path);
      expect(res.status, path).toBe(200);
      expect(rendered, path).toEqual(['route']);
      expect(res.headers.get('Cache-Control'), path).toBe('private, no-store');
    }
  });

  it('a PetroTins path is not a Vault path, and the other way round', () => {
    expect(isAgenticsVaultPath('/dashboard/petro-tins')).toBe(false);
    expect(isAgenticsVaultPath('/api/petro-tins')).toBe(false);
  });
});

describe('the Vault is never a public path', () => {
  it('no Vault path or spelling of one is in isPublicPath', () => {
    for (const [path] of VAULT_PATHS) expect(isPublicPath(path.split('?')[0]), path).toBe(false);
    for (const path of VARIANTS) expect(isPublicPath(path.split('?')[0]), path).toBe(false);
  });

  it('a signed-out request to a Vault endpoint would stop at app.ts if the gate were ever opened', () => {
    // The endpoints are tenant APIs: only isPublicPath lets a request skip app.ts, and it never lists them.
    for (const path of ['/api/agentics/tins', '/api/agentics/wallets', '/api/agentics/destinations', '/api/agentics/destinations/trust']) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe('isAgenticsVaultPath', () => {
  it('matches both Vault prefixes in every spelling', () => {
    for (const [path] of VAULT_PATHS) expect(isAgenticsVaultPath(path), path).toBe(true);
    for (const path of VARIANTS) expect(isAgenticsVaultPath(path), path).toBe(true);
    expect(isAgenticsVaultPath('/dashboard/agentics#x')).toBe(true);
    expect(isAgenticsVaultPath('\\dashboard\\agentics')).toBe(true);
    expect(isAgenticsVaultPath('/api/agentics/%')).toBe(true);
  });

  it('does not match look-alikes, the docs page, or unrelated paths', () => {
    for (const path of [
      '/agentics', '/agentics/', '/agentics/anything', '/agentic', '/dashboard/agentic', '/dashboard/agenticsx', '/api/agenticsx',
      '/api/agentic', '/xapi/agentics', '/x/dashboard/agentics', '/api/verify/check', '/api/verify/agent-keys', '/dashboard/vault',
      '/verify/agents', '/', '', '/api', '/dashboard',
    ]) {
      expect(isAgenticsVaultPath(path), path).toBe(false);
    }
  });
});

describe('canAccessAgenticsVault', () => {
  it('allows only a real owner session while owner-only', () => {
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID })).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID.toUpperCase() })).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID, isDemo: true })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: DEMO_TENANT_ID, isDemo: true })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: OTHER_TENANT_ID })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: null })).toBe(false);
    expect(canAccessAgenticsVault({})).toBe(false);
    expect(canAccessAgenticsVault(null)).toBe(false);
    expect(canAccessAgenticsVault(undefined)).toBe(false);
  });

  it('when opened to all accounts, allows a real session with a tenant, and still never a signed-out or demo viewer', () => {
    expect(canAccessAgenticsVault({ tenantId: OTHER_TENANT_ID }, true)).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: DEMO_TENANT_ID, isDemo: true }, true)).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: null }, true)).toBe(false);
    expect(canAccessAgenticsVault(null, true)).toBe(false);
  });
});

describe("the 404 page pass is only ever Astro's 404 route for a request the gate refused", () => {
  const path = '/dashboard/agentics';
  const HIDDEN_SIGNED_OUT = { kind: 'hidden', hasSession: false };

  it('a refused request, rendered as the 404 route, is the 404 page pass; any other render is refused again', async () => {
    const request = new Request(`https://almstins.com${path}`);
    expect(await agenticsGate(request, path, path)).toEqual(HIDDEN_SIGNED_OUT);
    const refusal = agenticsRefusal(request, false);
    expect(refusal.status).toBe(404);
    expect(refusal.body).toBeNull(); // Astro renders its 404 page for a bodiless 404
    expect(await agenticsGate(request, path, '/404')).toEqual({ kind: 'not-found-page', hasSession: false });
    expect(await agenticsGate(request, path, path)).toEqual(HIDDEN_SIGNED_OUT);
  });

  it('a request that was never refused gets no 404 page pass, even on the 404 route', async () => {
    expect(await agenticsGate(new Request('https://almstins.com/api/agentics/nope'), '/api/agentics/nope', '/404')).toEqual(HIDDEN_SIGNED_OUT);
    // Another request object for the same URL as a refused one is judged on its own.
    agenticsRefusal(new Request(`https://almstins.com${path}`), true);
    expect(await agenticsGate(new Request(`https://almstins.com${path}`), path, '/404')).toEqual(HIDDEN_SIGNED_OUT);
  });

  it('the owner is let through, even on a path that was refused for someone else', async () => {
    state.session = { tenantId: OWNER_TENANT_ID };
    expect(await agenticsGate(new Request(`https://almstins.com${path}`), path)).toEqual({ kind: 'owner' });
  });
});

describe('withAgenticsOwnerHeaders', () => {
  it('adds Cookie to Vary once, and works on an immutable redirect', () => {
    expect(withAgenticsOwnerHeaders(new Response('x', { headers: { Vary: 'cookie' } })).headers.get('Vary')).toBe('cookie');
    expect(withAgenticsOwnerHeaders(new Response('x', { headers: { Vary: 'Accept-Encoding' } })).headers.get('Vary')).toBe('Accept-Encoding, Cookie');
    const redirect = withAgenticsOwnerHeaders(Response.redirect('https://almstins.com/dashboard/agentics', 302));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('Location')).toBe('https://almstins.com/dashboard/agentics');
    expect(redirect.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
