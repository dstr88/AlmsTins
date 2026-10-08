import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The route-level approval guard, on its own. entityApproval.test.ts runs the routes on top
 * of the real library, whose own guard answers the same 403, so removing a route's guard
 * would go unnoticed there. Here the library is a set of spies: for an account that is not
 * approved, each write route must answer 403 not_approved without calling the library and
 * without reading the request body. For an approved account the call goes through, and a
 * not_approved answer from the library (approval withdrawn mid-request) is still a 403.
 */

const session = vi.hoisted(() => ({ current: null as null | { tenantId: string; isDemo?: boolean } }));
const lib = vi.hoisted(() => ({
  createEntity: vi.fn(async (_tenantId: string, domain: string) => ({
    ok: true as const,
    entity: { id: 'e-1', domain, challenge: 'challenge-1', proofStatus: 'unproven' },
  })),
  proveEntity: vi.fn(async (_tenantId: string, _id: string): Promise<{ ok: true } | { ok: false; code: string }> => ({ ok: true })),
  connectEntity: vi.fn(async (_tenantId: string, _id: string, _endpoint: string, _key: string):
    Promise<{ ok: true; count: number } | { ok: false; code: string }> => ({ ok: true, count: 3 })),
  listEntities: vi.fn(async () => []),
  deleteEntity: vi.fn(async () => true),
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => session.current }));
vi.mock('@/lib/verifyEntities', () => lib);
vi.mock('@/lib/db', () => ({
  db: {
    execute: async () => { throw new Error('the database must not be touched by these routes here'); },
    batch: async () => { throw new Error('batch not expected'); },
  },
}));

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { ENTITY_APPROVAL_ENV } from '../../src/lib/verifyEntityAccess';
import { POST as CREATE } from '../../src/pages/api/verify/entities/index';
import { POST as PROVE } from '../../src/pages/api/verify/entities/[id]/prove';
import { POST as CONNECT } from '../../src/pages/api/verify/entities/[id]/connect';

const LISTED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const ROUTES = [
  ['create', CREATE, '/api/verify/entities', { domain: 'platform.example' }, {}, lib.createEntity],
  ['prove', PROVE, '/api/verify/entities/e-1/prove', {}, { id: 'e-1' }, lib.proveEntity],
  ['connect', CONNECT, '/api/verify/entities/e-1/connect',
    { endpoint: 'https://platform.example/.well-known/payment-addresses', apiKey: 'k' }, { id: 'e-1' }, lib.connectEntity],
] as const;

const call = async (handler: any, path: string, body: unknown, params: Record<string, string>) => {
  const request = new Request(`https://almstins.com${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const res: Response = await handler({ request, params });
  return { status: res.status, body: await res.json(), bodyUsed: request.bodyUsed };
};

beforeEach(() => {
  session.current = null;
  for (const fn of Object.values(lib)) fn.mockClear();
  vi.stubEnv(ENTITY_APPROVAL_ENV, LISTED);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(ROUTES)('POST %s: the route guard', (_name, handler, path, body, params, spy) => {
  it('refuses an account that is not approved before the library or the body is touched', async () => {
    session.current = { tenantId: OTHER };
    const r = await call(handler, path, body, params);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, error: 'not_approved' });
    expect(r.body.message).toContain('support@almstins.com');
    expect(r.bodyUsed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['the owner', OWNER_TENANT_ID],
    ['a listed tenant', LISTED],
  ])('lets %s through to the library', async (_who, tenant) => {
    session.current = { tenantId: tenant };
    const r = await call(handler, path, body, params);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0] as unknown[])[0]).toBe(tenant);
  });

  it('still answers 403 when the library refuses (approval withdrawn mid-request)', async () => {
    session.current = { tenantId: LISTED };
    (spy as any).mockResolvedValueOnce({ ok: false, code: 'not_approved' });
    const r = await call(handler, path, body, params);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, error: 'not_approved' });
  });
});
