import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk, fakeDeps, type FakeDeps } from '../helpers/agentVault';
import { hashWithSalt } from '../../src/lib/analytics/hash';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

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
const KEY_OWNER = 'c3'.repeat(12);
const BEARER = { linked: 'avk_linked', unlinked: 'avk_unlinked', owner: 'avk_owner' };
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({
  listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [],
  authenticateAgentKey: async (bearer: string) =>
    bearer === 'avk_linked' ? { id: 'a1'.repeat(12), domain: 'agent.example' }
    : bearer === 'avk_unlinked' ? { id: 'b2'.repeat(12), domain: 'other.example' }
    : bearer === 'avk_owner' ? { id: 'c3'.repeat(12), domain: 'owner.example' }
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
    // The caller is kept as a salted one-way hash, the same for the same caller, and never as the address.
    expect(events().map((e) => [e.answer, e.source_ip])).toEqual([['unknown', hashWithSalt('203.0.113.77')], ['consistent-with-history', hashWithSalt('203.0.113.77')]]);
    expect(JSON.stringify(events())).not.toContain('203.0.113.77');
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

describe('the daily limit on recorded checks', () => {
  const NOON = '2026-10-19T12:00:00.000Z';
  const limitOf = async () => (await import('../../src/lib/agentVault/entitlements')).FREE_LOGGED_CHECKS_PER_DAY;

  /** Runs a test with the clock at noon UTC on the day the filler events are written for. */
  const atNoon = async (run: () => Promise<void>) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(NOON));
      await run();
    } finally {
      vi.useRealTimers();
    }
  };

  /** `n` events already on an agent's ledger, written straight into the stand-in table at the time given. */
  const fillLedger = async (tenantId: string, tinId: string, n: number, at: string, kind: 'checked' | 'transaction' = 'checked') => {
    await (await import('../../src/lib/agentVault/events')).ensureAgentEventsTable();
    for (let i = 0; i < n; i += 1) {
      fake.seed('agent_events', {
        id: `filler-${tinId}-${kind}-${at}-${i}`, tenant_id: tenantId, tin_id: tinId, kind, address: addr(900), chain: null, answer: 'unknown',
        registry: 'none', status: 'unknown', key_id: KEY_LINKED, source_ip: null, detail_json: '{}', occurred_at: at,
      });
    }
  };

  /** A check already on the ledger that carries the limit marker, as the one that found the day full is written. */
  const seedMarker = async (tenantId: string, tinId: string, at: string, perDay: number) => {
    await (await import('../../src/lib/agentVault/events')).ensureAgentEventsTable();
    fake.seed('agent_events', {
      id: `marker-${tinId}-${at}`, tenant_id: tenantId, tin_id: tinId, kind: 'checked', address: addr(901), chain: null, answer: 'unknown',
      registry: 'none', status: 'unknown', key_id: KEY_LINKED, source_ip: null, detail_json: JSON.stringify({ basis: 'not_in_registry', limit: { reached: true, perDay } }), occurred_at: at,
    });
  };
  const markers = () => events().filter((e) => /"limit":\{"reached":true/.test(String(e.detail_json)));

  it('records checks up to the limit; the check that finds the day full is recorded WITH a marker; after it nothing is written', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit - 1, '2026-10-19T00:00:00.000Z'); // the first millisecond of the day counts

      const last = await call(addr(1), { bearer: BEARER.linked });
      expect(last.body.vault).toMatchObject({ logged: true, answer: 'proven' });
      expect(last.body.vault).not.toHaveProperty('reason');
      expect(events()).toHaveLength(limit);
      expect(markers()).toHaveLength(0); // the limit-th check is an ordinary row

      // The next check finds the day full. It is answered in full and written, and the row says so.
      const filled = await call(addr(1), { bearer: BEARER.linked });
      expect(filled.body.vault).toMatchObject({ logged: true, answer: 'proven' });
      expect(events()).toHaveLength(limit + 1);
      expect(markers()).toHaveLength(1);
      expect(JSON.parse(String(markers()[0].detail_json)).limit).toEqual({ reached: true, perDay: limit });

      // After it: answered in full, nothing written, and the block says why.
      const over = await call(addr(1), { bearer: BEARER.linked });
      const plain = await call(addr(1));
      expect(over.res.status).toBe(200);
      expect(publicPart(over.body)).toEqual(publicPart(plain.body));
      expect(over.body.vault).toMatchObject({ cleared: true, answer: 'proven', registry: 'trusted', eventId: null, logged: false, reason: 'log_limit' });
      expect(events()).toHaveLength(limit + 1);
      expect(markers()).toHaveLength(1); // one marker for the day, however many checks come after
    });
  });

  it('a day that filled past the limit without any marker (checks that raced) gets its marker on the next check', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit + 50, '2026-10-19T00:30:00.000Z'); // 50 over, and no row says the limit was reached
      const { body } = await call(addr(1), { bearer: BEARER.linked });
      expect(body.vault).toMatchObject({ logged: true });
      expect(markers()).toHaveLength(1);
      expect((await call(addr(1), { bearer: BEARER.linked })).body.vault).toMatchObject({ logged: false, reason: 'log_limit' });
    });
  });

  it('a marker is one agent\'s, for one UTC day: another day\'s or another agent\'s does not stand in for today\'s', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      const other = expectOk(await vault.createTin(A, { label: 'Another agent' })).tin;
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await seedMarker(A, tin.id, '2026-10-18T23:59:59.999Z', limit); // yesterday's
      await seedMarker(A, other.id, '2026-10-19T01:00:00.000Z', limit); // another agent's today
      await fillLedger(A, tin.id, limit, '2026-10-19T02:00:00.000Z');
      const { body } = await call(addr(1), { bearer: BEARER.linked });
      expect(body.vault).toMatchObject({ logged: true }); // written, as today's marker
      expect(markers().filter((m) => m.tin_id === tin.id && String(m.occurred_at).startsWith('2026-10-19'))).toHaveLength(1);
    });
  });

  it('the marker is found again by a process that forgot it: the day does not get a second one', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit, '2026-10-19T01:00:00.000Z');
      await call(addr(1), { bearer: BEARER.linked }); // writes the marker
      (await import('../../src/lib/agentVault/checkLog'))._clearKeyTenantCache(); // a restart: the process remembers nothing
      const { body } = await call(addr(1), { bearer: BEARER.linked });
      expect(body.vault).toMatchObject({ logged: false, reason: 'log_limit' });
      expect(markers()).toHaveLength(1);
    });
  });

  it('checks that find the day full at the same moment write ONE marker between them, not one each', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit, '2026-10-19T01:00:00.000Z');
      const answers = await Promise.all(Array.from({ length: 25 }, () => call(addr(1), { bearer: BEARER.linked })));
      expect(answers.filter((a) => a.body.vault.logged === true)).toHaveLength(1); // the one that wrote the marker
      expect(answers.filter((a) => a.body.vault.reason === 'log_limit')).toHaveLength(24);
      expect(markers()).toHaveLength(1);
      expect(events()).toHaveLength(limit + 1);
    });
  });

  it('a marker that could not be written is tried again by the next check that finds the day full', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit, '2026-10-19T01:00:00.000Z');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      let failures = 1;
      holder.intercept = (sql) => { if (failures > 0 && /^INSERT INTO agent_events/i.test(sql)) { failures -= 1; throw new Error('the disk is full'); } };
      const failed = await call(addr(1), { bearer: BEARER.linked });
      expect(failed.body.vault).toMatchObject({ logged: false, eventId: null });
      expect(failed.body.vault).not.toHaveProperty('reason'); // not the limit: the write failed
      expect(markers()).toHaveLength(0);
      const retried = await call(addr(1), { bearer: BEARER.linked });
      expect(retried.body.vault).toMatchObject({ logged: true });
      expect(markers()).toHaveLength(1);
    });
  });

  it('a check that comes back FLAGGED is still recorded past the limit, for a further room of its own, and then it is not either', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const extra = (await import('../../src/lib/agentVault/entitlements')).FLAGGED_LOGGED_PAST_LIMIT;
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      await fillLedger(A, tin.id, limit, '2026-10-19T01:00:00.000Z');
      await seedMarker(A, tin.id, '2026-10-19T01:30:00.000Z', limit);
      const flagged = () => call(addr(1), { bearer: BEARER.linked, expect: 'wrong.example' }); // a different domain stands behind it: flagged
      entities.address.mockResolvedValue(hit({ domain: 'other.example' }));

      // An ordinary check is not recorded now...
      const plainRows = events().length;
      expect((await call(addr(2), { bearer: BEARER.linked })).body.vault).toMatchObject({ logged: false, reason: 'log_limit' });
      expect(events()).toHaveLength(plainRows);
      // ...a flagged one is.
      const { body } = await flagged();
      expect(body.vault).toMatchObject({ answer: 'flagged', logged: true });
      expect(events()).toHaveLength(plainRows + 1);

      // Fill the flagged room, and the next flagged check is answered and not recorded.
      const room = limit + extra - events().length;
      await fillLedger(A, tin.id, room, '2026-10-19T03:00:00.000Z');
      expect(events()).toHaveLength(limit + extra);
      const over = await flagged();
      expect(over.body.vault).toMatchObject({ answer: 'flagged', logged: false, reason: 'log_limit' });
      expect(events()).toHaveLength(limit + extra);
    });
  });

  it('counts one agent\'s checks of one UTC day: not another agent\'s, not yesterday\'s, not transfers', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      const other = expectOk(await vault.createTin(A, { label: 'Another agent' })).tin;
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger(A, tin.id, limit, '2026-10-18T23:59:59.999Z'); // yesterday, to the last millisecond
      await fillLedger(A, other.id, limit, '2026-10-19T01:00:00.000Z'); // another agent of the same account
      await fillLedger(A, tin.id, limit, '2026-10-19T02:00:00.000Z', 'transaction'); // transfers read from the chain
      const { body } = await call(addr(1), { bearer: BEARER.linked });
      expect(body.vault).toMatchObject({ logged: true });
    });
  });

  it('is the account\'s own to reach: another account\'s agent is not held by it', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      await fillLedger('tenant-b', tin.id, limit, '2026-10-19T01:00:00.000Z'); // a foreign row that carries the same agent id
      const { body } = await call(addr(1), { bearer: BEARER.linked });
      expect(body.vault).toMatchObject({ logged: true });
    });
  });

  it('does not apply to the owner\'s account, which has no limits', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      keys.byTenant[OWNER_TENANT_ID] = [{ id: KEY_OWNER, status: 'active' }];
      fake.seed('verify_agent_keys', { id: KEY_OWNER, tenant_id: OWNER_TENANT_ID, domain: 'owner.example', status: 'active' });
      const tin = expectOk(await vault.createTin(OWNER_TENANT_ID, { label: 'Treasury agent', agentKeyId: KEY_OWNER })).tin;
      entities.address.mockResolvedValue(hit());
      await fillLedger(OWNER_TENANT_ID, tin.id, limit + 5, '2026-10-19T01:00:00.000Z');
      const { body } = await call(addr(1), { bearer: BEARER.owner });
      expect(body.vault).toMatchObject({ logged: true });
      expect(body.vault).not.toHaveProperty('reason');
    });
  });

  it('still tells the operator about a flag on a registered address when even the flagged room is used up, and writes nothing', async () => {
    await atNoon(async () => {
      const limit = await limitOf();
      const extra = (await import('../../src/lib/agentVault/entitlements')).FLAGGED_LOGGED_PAST_LIMIT;
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      await fillLedger(A, tin.id, limit + extra - 1, '2026-10-19T01:00:00.000Z');
      await seedMarker(A, tin.id, '2026-10-19T01:30:00.000Z', limit);
      const total = events().length;
      expect(total).toBe(limit + extra);
      const { recordKeyedCheck } = await import('../../src/lib/agentVault/checkLog');
      const onFlagged = vi.fn();
      const block = await recordKeyedCheck(
        { keyId: KEY_LINKED, value: addr(1), status: 'mismatch', level: 'verified', domain: 'other.example', proofAgeDays: 3, sourceIp: '203.0.113.9', now: new Date(NOON) },
        { onFlagged },
      );
      expect(block).toMatchObject({ answer: 'flagged', logged: false, eventId: null, reason: 'log_limit' });
      await vi.waitFor(() => expect(onFlagged).toHaveBeenCalledTimes(1));
      expect(onFlagged).toHaveBeenCalledWith({ tenantId: A, tinId: tin.id, address: addr(1) });
      expect(events()).toHaveLength(total);
    });
  });

  describe('the UTC day, whatever time zone the server runs in', () => {
    async function withTimeZone(tz: string, run: () => Promise<void>) {
      const before = process.env.TZ;
      process.env.TZ = tz;
      try {
        await run();
      } finally {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      }
    }

    it.each([['UTC'], ['Pacific/Kiritimati'], ['America/Los_Angeles'], ['Asia/Kolkata']])('starts at 00:00:00.000 UTC and ends at 23:59:59.999 UTC (server zone %s)', async (tz) => {
      await withTimeZone(tz, async () => {
        // The zone really changed: half past midnight UTC is the evening before in Los Angeles.
        if (tz === 'America/Los_Angeles') expect(new Date('2026-10-19T00:30:00.000Z').getDate()).toBe(18);
        if (tz === 'Pacific/Kiritimati') expect(new Date('2026-10-19T23:30:00.000Z').getDate()).toBe(20);
        const limit = await limitOf();
        const tin = await linkedTin();
        await register(tin.id, addr(1));
        await fillLedger(A, tin.id, 1, '2026-10-18T23:59:59.999Z'); // the last millisecond of yesterday: not today's
        await fillLedger(A, tin.id, limit, '2026-10-19T00:00:00.000Z'); // the first millisecond of today: counted
        const { recordKeyedCheck } = await import('../../src/lib/agentVault/checkLog');
        const ask = (iso: string) =>
          recordKeyedCheck({ keyId: KEY_LINKED, value: addr(1), status: 'proven', level: 'verified', domain: 'acme.com', proofAgeDays: 3, sourceIp: null, now: new Date(iso) });
        const found = await ask('2026-10-19T00:30:00.000Z');
        expect(found, 'the day is full at half past midnight').toMatchObject({ logged: true });
        expect(markers()).toHaveLength(1);
        expect(await ask('2026-10-19T23:59:59.999Z'), 'and still full at the last millisecond').toMatchObject({ logged: false, reason: 'log_limit' });
        const tomorrow = await ask('2026-10-20T00:00:00.000Z');
        expect(tomorrow, 'a new day starts clean').toMatchObject({ logged: true });
        expect(tomorrow).not.toHaveProperty('reason');
        expect(markers()).toHaveLength(1);
      });
    });
  });

  it('a failure to count never changes the answer or stops the record: the check is written as it would be without a limit', async () => {
    await atNoon(async () => {
      const tin = await linkedTin();
      await register(tin.id, addr(1));
      entities.address.mockResolvedValue(hit());
      holder.intercept = (sql) => { if (/^SELECT COUNT\(\*\) AS n FROM agent_events/i.test(sql)) throw new Error('the disk is slow'); };
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const plain = await call(addr(1));
      const { res, body } = await call(addr(1), { bearer: BEARER.linked });
      expect(res.status).toBe(200);
      expect(publicPart(body)).toEqual(publicPart(plain.body));
      expect(body.vault).toMatchObject({ logged: true, answer: 'proven' });
      expect(events()).toHaveLength(1);
    });
  });
});
