import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk, fakeDeps, type FakeDeps } from '../helpers/agentVault';

/**
 * GET /api/verify/check with and without a key that is linked to an Agent Vault tin. The public
 * answer must not change at all; a keyed call on a linked key is also written to the tin's ledger
 * and gains one `vault` field. The proof lookups are replaced (this suite is about what the route
 * adds), the database is the in-memory stand-in, and fetch is switched off as a net. Every
 * address, key and account is invented.
 */

const holder = vi.hoisted(() => ({
  db: null as any,
  intercept: null as null | ((sql: string) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      holder.intercept?.((typeof s === 'string' ? s : s.sql).replace(/\s+/g, ' ').trim());
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));

const entities = vi.hoisted(() => ({
  address: vi.fn<(v: string) => Promise<any>>(),
  url: vi.fn<(v: string) => Promise<any>>(),
}));
vi.mock('@/lib/verifyEntities', () => ({
  lookupVerifiedAddress: (v: string) => entities.address(v),
  lookupVerifiedUrl: (v: string) => entities.url(v),
}));

const KEY_LINKED = 'a1'.repeat(12);
const KEY_UNLINKED = 'b2'.repeat(12);
const BEARER = { linked: 'avk_linked', unlinked: 'avk_unlinked' };
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({
  listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [],
  authenticateAgentKey: async (bearer: string) =>
    bearer === 'avk_linked' ? { id: 'a1'.repeat(12), domain: 'agent.example' }
    : bearer === 'avk_unlinked' ? { id: 'b2'.repeat(12), domain: 'other.example' }
    : null,
}));

const A = 'tenant-a';
let fake: ReceivablesDbFake;
let deps: FakeDeps;
let route: typeof import('../../src/pages/api/verify/check');
let vault: typeof import('../../src/lib/agentVault/vault');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  keys.byTenant = { [A]: [{ id: KEY_LINKED, status: 'active' }, { id: KEY_UNLINKED, status: 'active' }] };
  deps = fakeDeps();
  entities.address.mockReset().mockResolvedValue(null);
  entities.url.mockReset().mockResolvedValue(null);
  await fake.execute({
    sql: `CREATE TABLE IF NOT EXISTS verify_agent_keys (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`,
    args: [],
  });
  fake.seed('verify_agent_keys', { id: KEY_LINKED, tenant_id: A, domain: 'agent.example', status: 'active' });
  fake.seed('verify_agent_keys', { id: KEY_UNLINKED, tenant_id: A, domain: 'other.example', status: 'active' });
  route = await import('../../src/pages/api/verify/check');
  vault = await import('../../src/lib/agentVault/vault');
});

const call = async (value: string, opts: { bearer?: string; expect?: string; ip?: string } = {}) => {
  const url = new URL('https://almstins.com/api/verify/check');
  url.searchParams.set('value', value);
  if (opts.expect) url.searchParams.set('expect', opts.expect);
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  const res = await (route.GET as any)({ request: new Request(url, { headers }), url, clientAddress: '203.0.113.1' });
  return { res, body: await res.json() };
};

const hit = (over: Record<string, any> = {}) => ({
  source: 'merchant', level: 'verified', since: '2026-08-01', domain: 'acme.example',
  provingDomain: 'acme.example', label: null, chain: 'ethereum', ...over,
});

const linkedTin = async () => expectOk(await vault.createTin(A, { label: 'Treasury agent', agentKeyId: KEY_LINKED })).tin;
const register = async (tinId: string, text: string) => expectOk(await vault.addDestinations(A, { tinId, text }, deps));
const events = () => fake.rows('agent_events');
/** The public part of an answer: everything but the time it was made and the Vault's own field. */
const publicPart = (b: Record<string, unknown>) => { const { checkedAt, vault: _v, ...rest } = b; return rest; };

describe('the public answer does not change', () => {
  it('a keyed call on a linked key gets exactly the answer a keyless call gets, plus one `vault` field', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    entities.address.mockResolvedValue(hit());

    const keyless = await call(addr(1));
    const keyed = await call(addr(1), { bearer: BEARER.linked });

    expect(keyless.res.status).toBe(200);
    expect(keyed.res.status).toBe(200);
    expect(publicPart(keyed.body)).toEqual(publicPart(keyless.body));
    expect(keyed.body.status).toBe('proven');
    expect(Object.keys(keyed.body).filter((k) => !(k in keyless.body))).toEqual(['vault']);
    expect(keyed.body.vault).toMatchObject({ cleared: true, answer: 'proven', registry: 'trusted', logged: true });
  });

  it('a keyless call never gets the field and is never recorded', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    const { body } = await call(addr(1));
    expect(body).not.toHaveProperty('vault');
    expect(events()).toEqual([]);
    // The ledger table is not even created by an anonymous call.
    expect(fake.statements(/agent_events/i)).toEqual([]);
  });

  it('a key that is not linked to a tin gets the plain answer, and nothing is recorded', async () => {
    await linkedTin();
    entities.address.mockResolvedValue(hit());
    const { res, body } = await call(addr(1), { bearer: BEARER.unlinked });
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('vault');
    expect(events()).toEqual([]);
  });

  it('a payment link is not recorded and gets no `vault` field, even with a linked key', async () => {
    await linkedTin();
    entities.url.mockResolvedValue(hit());
    const { res, body } = await call('https://pay.acme.example/invoice/1', { bearer: BEARER.linked });
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('vault');
    expect(events()).toEqual([]);
  });

  it('a bad key still answers 401 and an invalid address 400, and neither is recorded', async () => {
    await linkedTin();
    expect((await call(addr(1), { bearer: 'avk_nope' })).res.status).toBe(401);
    expect((await call('not-an-address', { bearer: BEARER.linked })).res.status).toBe(400);
    expect(events()).toEqual([]);
  });

  it('an outage of the proof lookup is still a 503, and nothing is recorded', async () => {
    await linkedTin();
    entities.address.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await call(addr(1), { bearer: BEARER.linked });
    expect(res.status).toBe(503);
    expect(events()).toEqual([]);
  });
});

describe('what a keyed call on a linked key writes', () => {
  it('records an address outside the registry as unknown and not cleared, even when it is domain-proven', async () => {
    await linkedTin();
    entities.address.mockResolvedValue(hit());
    const { body } = await call(addr(9), { bearer: BEARER.linked });
    expect(body.status).toBe('proven'); // the public fact about the address
    expect(body.vault).toMatchObject({ cleared: false, answer: 'unknown', registry: 'none', history: 'none', logged: true });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ address: addr(9), registry: 'none', answer: 'unknown', status: 'proven', key_id: KEY_LINKED });
  });

  it('follows the first and the second check of a trusted address, and stores the caller as metadata', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    const first = await call(addr(1), { bearer: BEARER.linked, ip: '203.0.113.77' });
    const second = await call(addr(1), { bearer: BEARER.linked, ip: '203.0.113.77' });
    expect(first.body.vault).toMatchObject({ answer: 'unknown', cleared: true, history: 'none' });
    expect(second.body.vault).toMatchObject({ answer: 'consistent-with-history', cleared: true, history: 'consistent' });
    expect(events().map((e) => [e.answer, e.source_ip])).toEqual([['unknown', '203.0.113.77'], ['consistent-with-history', '203.0.113.77']]);
    expect(first.body.vault.eventId).toBe(events()[0].id);
  });

  it('flags a domain mismatch for the agent that expected another business', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    entities.address.mockResolvedValue(hit());
    const { body } = await call(addr(1), { bearer: BEARER.linked, expect: 'someone-else.example' });
    expect(body.status).toBe('mismatch');
    expect(body.vault).toMatchObject({ answer: 'flagged', cleared: false });
  });

  it('a failure to write never changes the answer: the same public fields, `logged: false`', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    entities.address.mockResolvedValue(hit());
    const plain = await call(addr(1));
    holder.intercept = (sql) => { if (/^INSERT INTO agent_events/i.test(sql)) throw new Error('disk full'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await call(addr(1), { bearer: BEARER.linked });
    expect(res.status).toBe(200);
    expect(publicPart(body)).toEqual(publicPart(plain.body));
    expect(body.vault).toMatchObject({ logged: false, eventId: null, answer: 'proven', cleared: true });
  });

  it('even a broken Vault module cannot change the answer', async () => {
    const tin = await linkedTin();
    await register(tin.id, addr(1));
    holder.intercept = (sql) => { if (/agent_tins|agent_destinations|agent_events|verify_agent_keys/i.test(sql)) throw new Error('everything is down'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await call(addr(1), { bearer: BEARER.linked });
    expect(res.status).toBe(200);
    expect(body.status).toBe('unknown');
    expect(body.vault).toEqual({ cleared: null, answer: null, registry: null, history: null, eventId: null, logged: false });
  });
});
