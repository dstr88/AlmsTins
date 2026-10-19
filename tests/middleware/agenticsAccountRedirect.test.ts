import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What the app middleware does for a visitor with no sign-in who asks for the Agentics account page
 * (/agentics/account): the Agentics sign-in, back to that page, not the general /login. Driven through the real
 * middleware (src/middleware/app.ts) with the session lookup replaced, so the branch is exercised and not only
 * read: a branch that is dead code, or that matches the wrong spellings, fails here. A signed-in visitor is not
 * this middleware's business for this page (the page decides, see agenticsAccountEntry.ts).
 */
const auth = vi.hoisted(() => ({ state: { session: null as any, cutReason: null as any, cutUserId: null as any } }));
vi.mock('../../src/lib/authSession', () => ({ getAuthSessionState: async () => auth.state, getAuthSession: async () => auth.state.session }));
vi.mock('../../src/lib/db', () => ({ db: { execute: async () => ({ rows: [] }), batch: async () => [] } }));
vi.mock('../../src/lib/analytics/geoip', () => ({ getCountryForIpHash: async () => null }));
vi.mock('../../src/lib/tenants', () => ({ getTenantStateDetails: async () => ({ tenantId: 't', onboardingComplete: true }) }));

let onRequest: (ctx: any, next: () => Promise<Response>) => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  auth.state = { session: null, cutReason: null, cutUserId: null };
  process.env.AUTH_URL = 'https://almstins.com';
  ({ onRequest } = (await import('../../src/middleware/app')) as never);
});

const visit = async (path: string, method = 'GET') => {
  const request = new Request(`https://almstins.com${path}`, { method });
  const reached = vi.fn(async () => new Response('the page'));
  const res = await onRequest({ request, locals: {}, clientAddress: '203.0.113.9', url: new URL(request.url) }, reached);
  return { res, reached };
};

describe('a visitor with no sign-in asking for the account page', () => {
  it.each([
    ['/agentics/account', '/agentics/account'],
    ['/agentics/account/', '/agentics/account'],
    ['/agentics/account///', '/agentics/account'],
    ['//agentics/account', '/agentics/account'],
    ['//agentics//account/', '/agentics/account'],
  ])('is sent from %s to the Agentics sign-in, back to the page', async (path, next) => {
    const { res, reached } = await visit(path);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://almstins.com/agentics/login?next=${encodeURIComponent(next)}`);
    expect(reached).not.toHaveBeenCalled();
  });

  it('is not sent to the Agentics sign-in for another page: /agentics/accounts and /agentics/account/x go the general way', async () => {
    for (const path of ['/agentics/accounts', '/agentics/account/x']) {
      const { res } = await visit(path);
      expect(res.status, path).toBe(303);
      expect(res.headers.get('location'), path).not.toContain('/agentics/login');
    }
  });

  it('keeps the dashboard\'s own sign-in redirect as it was', async () => {
    const { res } = await visit('/dashboard/agentics');
    expect(res.headers.get('location')).toBe('https://almstins.com/agentics/login?next=%2Fdashboard%2Fagentics');
  });
});
