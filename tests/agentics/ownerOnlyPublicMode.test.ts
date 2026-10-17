import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AGENTICS_VAULT_PUBLIC = true opens the Vault to every signed-in, non-demo account. It never makes
 * the Vault a signed-out surface: the paths stay out of isPublicPath, so a signed-out request still
 * goes to app.ts (which answers an API call 401 and a page with a sign-in redirect), and the
 * endpoints still refuse a demo session. The flag is pinned open here; ownerOnlyGate.test.ts pins
 * it closed.
 */
const state = vi.hoisted(() => ({
  session: null as null | { tenantId: string; isDemo?: boolean },
  appCalls: 0,
  gateSessionCalls: 0,
}));

vi.mock('../../src/lib/agenticsFlag.mjs', () => ({ AGENTICS_VAULT_PUBLIC: true }));
vi.mock('../../src/middleware/geoblock', () => ({ getGeoblockResponse: async () => null }));
vi.mock('../../src/middleware/app', async () => {
  const { applySecurityHeaders } = await import('../../src/middleware/securityHeaders');
  return {
    onRequest: async (_context: unknown, next: () => Promise<Response>) => {
      state.appCalls += 1;
      // Like app.ts for a visitor with no session: an API call is a 401.
      if (!state.session) return applySecurityHeaders(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
      return applySecurityHeaders(await next());
    },
  };
});
vi.mock('../../src/lib/requireTenantSession', () => ({
  requireTenantSession: async () => {
    state.gateSessionCalls += 1;
    return state.session;
  },
}));

import { onRequest } from '../../src/middleware';
import { isPublicPath } from '../../src/middleware/auth';
import { agenticsGate, canAccessAgenticsVault } from '../../src/lib/agenticsAccess';
import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

const run = async (path: string) => {
  const request = new Request(`https://almstins.com${path}`);
  const next = vi.fn(async () => new Response('handler', { status: 200 }));
  const res = (await (onRequest as any)({ request, url: new URL(request.url), routePattern: 'route' }, next)) as Response;
  return { res, next };
};

beforeEach(() => {
  state.session = null;
  state.appCalls = 0;
  state.gateSessionCalls = 0;
});

describe('the Vault opened to every account', () => {
  it('the gate steps aside and never resolves a session', async () => {
    expect(await agenticsGate(new Request('https://almstins.com/api/agentics/tins'), '/api/agentics/tins')).toEqual({ kind: 'open' });
    expect(state.gateSessionCalls).toBe(0);
  });

  it('another signed-in account reaches the endpoint through app.ts, with no private headers added by the gate', async () => {
    state.session = { tenantId: OTHER_TENANT_ID };
    const { res, next } = await run('/api/agentics/tins');
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(state.appCalls).toBe(1);
  });

  it('a signed-out request still stops at app.ts: the Vault is never a public path', async () => {
    for (const path of ['/api/agentics/tins', '/api/agentics/destinations/trust', '/dashboard/agentics']) {
      expect(isPublicPath(path), path).toBe(false);
    }
    state.appCalls = 0;
    const { res, next } = await run('/api/agentics/tins');
    expect(res.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(state.appCalls).toBe(1);
  });

  it('the endpoints let in a real account with a tenant, and still refuse a demo session and a signed-out viewer', () => {
    expect(canAccessAgenticsVault({ tenantId: OTHER_TENANT_ID })).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: OWNER_TENANT_ID })).toBe(true);
    expect(canAccessAgenticsVault({ tenantId: DEMO_TENANT_ID, isDemo: true })).toBe(false);
    expect(canAccessAgenticsVault({ tenantId: null })).toBe(false);
    expect(canAccessAgenticsVault(null)).toBe(false);
  });
});
