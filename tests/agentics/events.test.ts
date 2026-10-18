import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, upper, expectOk, fakeDeps, walletResult, type FakeDeps } from '../helpers/agentVault';

/**
 * The Agent Vault ledger (events.ts, checkLog.ts, and the read in vault.ts) over its real SQL,
 * run by the in-memory stand-in for the database that the receivables tests use. The stand-in
 * evaluates the WHERE clauses, so a dropped `AND tenant_id = ?` shows up as a wrong answer. The
 * checks are injected (no network); fetch is switched off as a net. Every address, label, tenant
 * and key is invented.
 */

const holder = vi.hoisted(() => ({
  db: null as any,
  /** Runs before each statement; may throw to play a database error. */
  intercept: null as null | ((sql: string, args: unknown[]) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      holder.intercept?.(sql.replace(/\s+/g, ' ').trim(), typeof s === 'string' ? [] : s.args ?? []);
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [] }));

const A = 'tenant-a';
const B = 'tenant-b';
const KEY_1 = 'a1'.repeat(12);
const KEY_2 = 'b2'.repeat(12);
const KEY_3 = 'c3'.repeat(12);
const NOW = new Date('2026-10-18T12:00:00.123Z');

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let vault: typeof import('../../src/lib/agentVault/vault');
let events: typeof import('../../src/lib/agentVault/events');
let checkLog: typeof import('../../src/lib/agentVault/checkLog');
let deps: FakeDeps;

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  keys.byTenant = { [A]: [{ id: KEY_1, status: 'active' }, { id: KEY_2, status: 'active' }, { id: KEY_3, status: 'active' }], [B]: [{ id: KEY_3, status: 'active' }] };
  deps = fakeDeps();
  // The key table is the key code's own; the ledger only reads which account a key belongs to.
  await fake.execute({
    sql: `CREATE TABLE IF NOT EXISTS verify_agent_keys (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`,
    args: [],
  });
  fake.seed('verify_agent_keys', { id: KEY_1, tenant_id: A, domain: 'agent-a.example', status: 'active' });
  fake.seed('verify_agent_keys', { id: KEY_2, tenant_id: A, domain: 'agent-a2.example', status: 'active' });
  fake.seed('verify_agent_keys', { id: KEY_3, tenant_id: B, domain: 'agent-b.example', status: 'active' });
  store = await import('../../src/lib/agentVault/store');
  vault = await import('../../src/lib/agentVault/vault');
  events = await import('../../src/lib/agentVault/events');
  checkLog = await import('../../src/lib/agentVault/checkLog');
});

const newTin = async (tenant = A, label = 'Treasury agent', agentKeyId: string | null = KEY_1) =>
  expectOk(await vault.createTin(tenant, { label, ...(agentKeyId ? { agentKeyId } : {}) })).tin;
const register = async (tenant: string, tinId: string, text: string, extra: Record<string, unknown> = {}) =>
  expectOk(await vault.addDestinations(tenant, { tinId, text, ...extra }, deps));
const rowsOf = (table: string) => fake.rows(table);

const ask = (over: Partial<import('../../src/lib/agentVault/checkLog').KeyedCheckInput> = {}) =>
  checkLog.recordKeyedCheck({
    keyId: KEY_1,
    value: addr(1),
    status: 'unknown',
    level: null,
    domain: null,
    proofAgeDays: null,
    sourceIp: '203.0.113.9',
    now: NOW,
    ...over,
  });

describe('the answer a tin gives (deriveAnswer)', () => {
  const cases: Array<[string, { status: any; registry: any; checkedBefore: boolean }, Record<string, unknown>]> = [
    ['a flag in the registry outranks a domain proof', { status: 'proven', registry: 'flagged', checkedBefore: true }, { answer: 'flagged', basis: 'registry_flagged', cleared: false, history: 'none' }],
    ['a domain mismatch is flagged, trusted or not', { status: 'mismatch', registry: 'trusted', checkedBefore: true }, { answer: 'flagged', basis: 'domain_mismatch', cleared: false, history: 'none' }],
    ['a mismatch on an address outside the registry is flagged too (the loudest signal)', { status: 'mismatch', registry: 'none', checkedBefore: false }, { answer: 'flagged', basis: 'domain_mismatch', cleared: false, history: 'none' }],
    ['a public proof alone never clears an address the owner has not registered', { status: 'proven', registry: 'none', checkedBefore: false }, { answer: 'unknown', basis: 'not_in_registry', cleared: false, history: 'none' }],
    ['not in the registry and unknown', { status: 'unknown', registry: 'none', checkedBefore: false }, { answer: 'unknown', basis: 'not_in_registry', cleared: false, history: 'none' }],
    ['registered but the checks have not finished', { status: 'proven', registry: 'pending', checkedBefore: true }, { answer: 'unknown', basis: 'registry_pending', cleared: false, history: 'none' }],
    ['trusted and domain-proven', { status: 'proven', registry: 'trusted', checkedBefore: false }, { answer: 'proven', basis: 'domain_proof', cleared: true, history: 'none' }],
    ['trusted, domain-proven, and asked about before', { status: 'proven', registry: 'trusted', checkedBefore: true }, { answer: 'proven', basis: 'domain_proof', cleared: true, history: 'consistent' }],
    ['trusted and asked about before: sameness, never proof', { status: 'unknown', registry: 'trusted', checkedBefore: true }, { answer: 'consistent-with-history', basis: 'registered_and_checked_before', cleared: true, history: 'consistent' }],
    ['trusted with an unanchored record, asked about before', { status: 'unanchored', registry: 'trusted', checkedBefore: true }, { answer: 'consistent-with-history', basis: 'registered_and_checked_before', cleared: true, history: 'consistent' }],
    ['trusted, first check, nothing else supports it: unknown, but cleared on the owner\'s say-so', { status: 'unknown', registry: 'trusted', checkedBefore: false }, { answer: 'unknown', basis: 'registered_first_check', cleared: true, history: 'none' }],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(checkLog.deriveAnswer(input)).toEqual(expected);
  });

  it('over every combination: history never answers proven, a flag is never cleared, and cleared needs a trusted registry', () => {
    for (const status of ['proven', 'mismatch', 'unanchored', 'unknown'] as const) {
      for (const registry of ['trusted', 'flagged', 'pending', 'none'] as const) {
        for (const checkedBefore of [true, false]) {
          const d = checkLog.deriveAnswer({ status, registry, checkedBefore });
          const label = `${status}/${registry}/${checkedBefore}`;
          if (d.answer === 'proven') expect(status, label).toBe('proven');
          if (d.answer === 'flagged') expect(d.cleared, label).toBe(false);
          if (d.cleared) expect(registry, label).toBe('trusted');
          if (registry !== 'trusted') expect(d.cleared, label).toBe(false);
          if (d.history === 'consistent') expect([registry, checkedBefore], label).toEqual(['trusted', true]);
        }
      }
    }
  });

  it('a registry flag wins across chains, then trusted, then pending, then none', () => {
    const v = checkLog.registryVerdict;
    expect(v([])).toBe('none');
    expect(v([{ trustStatus: 'pending' }])).toBe('pending');
    expect(v([{ trustStatus: 'pending' }, { trustStatus: 'trusted' }])).toBe('trusted');
    expect(v([{ trustStatus: 'trusted' }, { trustStatus: 'flagged' }])).toBe('flagged');
  });

  it('writes an EVM address in lowercase and any other address as given', () => {
    expect(checkLog.eventAddress(`  ${upper(addr(7))}  `)).toBe(addr(7));
    expect(checkLog.eventAddress(' bc1qExampleOnlyNotARealAddress ')).toBe('bc1qExampleOnlyNotARealAddress');
  });
});

describe('a keyed check is written to the ledger of the tin its key is linked to', () => {
  it('writes the address, the time, the answer, the registry verdict, the key and the caller, and returns the same facts', async () => {
    const tin = await newTin();
    await register(A, tin.id, `${addr(1)}, Exchange`);

    const block = await ask({ value: upper(addr(1)), status: 'unanchored', level: 'claimed', proofAgeDays: 12 });

    expect(block).toMatchObject({ cleared: true, answer: 'unknown', registry: 'trusted', history: 'none', logged: true });
    const rows = rowsOf('agent_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: A, tin_id: tin.id, kind: 'checked', address: addr(1), chain: 'ethereum',
      answer: 'unknown', registry: 'trusted', status: 'unanchored', key_id: KEY_1, source_ip: '203.0.113.9',
      occurred_at: '2026-10-18T12:00:00.123Z',
    });
    expect(rows[0].id).toBe(block!.eventId);
    expect(JSON.parse(rows[0].detail_json)).toEqual({
      basis: 'registered_first_check', cleared: true, history: 'none', level: 'claimed', domain: null, proofAgeDays: 12,
    });
  });

  it('the second check of a trusted address answers consistent-with-history, never proven', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    const first = await ask();
    const second = await ask({ now: new Date('2026-10-18T12:00:05.000Z') });
    expect(first).toMatchObject({ answer: 'unknown', history: 'none', cleared: true });
    expect(second).toMatchObject({ answer: 'consistent-with-history', history: 'consistent', cleared: true });
    expect(rowsOf('agent_events').map((r) => r.answer)).toEqual(['unknown', 'consistent-with-history']);
  });

  it('history is per address: a first check of a second trusted address is not consistent just because another one was checked', async () => {
    const tin = await newTin();
    await register(A, tin.id, `${addr(1)}\n${addr(2)}`);
    await ask({ value: addr(1) });
    expect(await ask({ value: addr(2) })).toMatchObject({ answer: 'unknown', history: 'none', cleared: true });
    expect(await ask({ value: addr(1) })).toMatchObject({ answer: 'consistent-with-history', history: 'consistent' });
  });

  it('writes a check for an address that is NOT in the registry: unknown, not cleared, no watch and no slot', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    const destinationsBefore = JSON.stringify(rowsOf('agent_destinations'));

    const block = await ask({ value: addr(9), status: 'proven', level: 'verified', domain: 'acme.example' });

    expect(block).toMatchObject({ cleared: false, answer: 'unknown', registry: 'none', history: 'none', logged: true });
    const [row] = rowsOf('agent_events');
    expect(row).toMatchObject({ address: addr(9), chain: null, answer: 'unknown', registry: 'none', status: 'proven' });
    expect(JSON.parse(row.detail_json).basis).toBe('not_in_registry');
    // Asking about an address does not register it, watch it, or use one of the owner's slots.
    expect(JSON.stringify(rowsOf('agent_destinations'))).toBe(destinationsBefore);
    expect(rowsOf('agent_wallets')).toEqual([]);
  });

  it('a flagged destination answers flagged and is not cleared', async () => {
    const tin = await newTin();
    deps.wallets[addr(2)] = walletResult({ flags: { sanctioned: true } });
    await register(A, tin.id, addr(2));
    expect(await ask({ value: addr(2), status: 'proven', level: 'verified', domain: 'acme.example' })).toMatchObject({
      answer: 'flagged', registry: 'flagged', cleared: false, logged: true,
    });
  });

  it('a destination whose checks have not finished is pending and not cleared', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(3), { trust: false });
    expect(await ask({ value: addr(3) })).toMatchObject({ answer: 'unknown', registry: 'pending', cleared: false });
  });

  it('a public domain mismatch is flagged even when the owner trusted the address', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    expect(await ask({ status: 'mismatch', level: 'verified', domain: 'other.example' })).toMatchObject({ answer: 'flagged', cleared: false });
  });

  it('adds nothing for a key that is not linked to a tin, or is not a key', async () => {
    await newTin(A, 'Treasury agent', KEY_1);
    expect(await ask({ keyId: KEY_2 })).toBeNull(); // a real key of this account, linked to no tin
    expect(await ask({ keyId: 'f0'.repeat(12) })).toBeNull(); // not a key at all
    expect(rowsOf('agent_events')).toEqual([]);
  });

  it('adds nothing for a tin that was removed', async () => {
    const tin = await newTin();
    expectOk(await vault.removeTin(A, tin.id));
    expect(await ask()).toBeNull();
    expect(rowsOf('agent_events')).toEqual([]);
  });

  it('one account never reads or writes another: a key finds its own account, and the other account\'s registry is invisible', async () => {
    const tinA = await newTin(A, 'Agent A', KEY_1);
    // The other account registered and trusted the very same address, on its own tin and key.
    const tinB = await newTin(B, 'Agent B', KEY_3);
    await register(B, tinB.id, addr(1));

    // Account A's tin has not registered it: the answer is "not in the registry".
    expect(await ask({ keyId: KEY_1 })).toMatchObject({ registry: 'none', cleared: false });
    // Account B's key resolves to account B, so B's own registry answers.
    expect(await ask({ keyId: KEY_3 })).toMatchObject({ registry: 'trusted', cleared: true });

    const rows = rowsOf('agent_events');
    expect(rows.map((r) => [r.tenant_id, r.tin_id])).toEqual([[A, tinA.id], [B, tinB.id]]);
  });

  it('a failure to write the event never changes the answer: the caller gets the facts and logged: false', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    holder.intercept = (sql) => { if (/^INSERT INTO agent_events/i.test(sql)) throw Object.assign(new Error('disk full: secret-value'), { code: '53100' }); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const block = await ask();

    expect(block).toEqual({ cleared: true, answer: 'unknown', registry: 'trusted', history: 'none', eventId: null, logged: false });
    expect(rowsOf('agent_events')).toEqual([]);
    // The failure is logged by name and code only, never the database's message.
    expect(JSON.stringify(spy.mock.calls)).toContain('53100');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret-value');
  });

  it('when the registry cannot be read there is no answer at all: nulls, never a guess', async () => {
    await newTin();
    holder.intercept = (sql) => { if (/FROM agent_destinations/i.test(sql)) throw new Error('connection lost'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ask()).toEqual({ cleared: null, answer: null, registry: null, history: null, eventId: null, logged: false });
    expect(rowsOf('agent_events')).toEqual([]);
  });

  it('looks a key up once: the account of a key is cached', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    await ask();
    await ask();
    expect(fake.statements(/FROM verify_agent_keys/i)).toHaveLength(1);
  });
});

describe('every ledger and registry read names the account, even if a row of another account carries the same tin id', () => {
  it('listEvents, hasPriorCheck and the registry lookup ignore a foreign row', async () => {
    const tin = await newTin();
    await events.ensureAgentEventsTable();
    fake.seed('agent_events', {
      id: 'foreign-event', tenant_id: B, tin_id: tin.id, kind: 'checked', address: addr(1), chain: null, answer: 'unknown',
      registry: 'none', status: 'unknown', key_id: KEY_3, source_ip: null, detail_json: '{}', occurred_at: '2026-10-18T12:00:00.000Z',
    });
    fake.seed('agent_destinations', {
      id: 'foreign-destination', tenant_id: B, tin_id: tin.id, chain: 'ethereum', address: addr(1), label: null,
      trust_status: 'trusted', trust_checked_at: null, trust_detail_json: null, created_at: '2026-10-18 12:00:00', deleted_at: null,
    });

    expect((await events.listEvents(A, tin.id, { limit: 10 })).events).toEqual([]);
    expect(await events.hasPriorCheck(A, tin.id, addr(1))).toBe(false);
    expect(await store.listDestinationsByAddress(A, tin.id, addr(1))).toEqual([]);
    // The foreign rows are still there, for their own account.
    expect((await events.listEvents(B, tin.id, { limit: 10 })).events).toHaveLength(1);
    expect(await events.hasPriorCheck(B, tin.id, addr(1))).toBe(true);
    expect(await store.listDestinationsByAddress(B, tin.id, addr(1))).toHaveLength(1);
  });

  it('a registry row of another account never makes this account\'s answer trusted', async () => {
    const tin = await newTin();
    fake.seed('agent_destinations', {
      id: 'foreign-destination', tenant_id: B, tin_id: tin.id, chain: 'ethereum', address: addr(1), label: null,
      trust_status: 'trusted', trust_checked_at: null, trust_detail_json: null, created_at: '2026-10-18 12:00:00', deleted_at: null,
    });
    expect(await ask({ value: addr(1) })).toMatchObject({ registry: 'none', cleared: false });
  });
});

describe('the ledger is dated and append-only', () => {
  it('sets the time once, at the write, and nothing ever rewrites a row', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    await ask();
    await ask();
    await vault.listTinEvents(A, tin.id);
    const writes = fake.log.map((s) => s.sql).filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql) && /agent_events/i.test(sql));
    expect(writes.length).toBe(2);
    for (const sql of writes) expect(sql).toMatch(/^INSERT INTO agent_events/i);
  });

  it('keeps events of a removed tin (the history stays), and lists none of them for anyone', async () => {
    const tin = await newTin();
    await register(A, tin.id, addr(1));
    await ask();
    expectOk(await vault.removeTin(A, tin.id));
    expect(rowsOf('agent_events')).toHaveLength(1);
    expect(await vault.listTinEvents(A, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
  });
});

describe('reading a tin\'s ledger (listTinEvents)', () => {
  /** Writes n events, one millisecond apart, plus a tie, and returns them oldest first. */
  const seed = async (tinId: string, n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(await events.insertCheckedEvent(A, {
        tinId, address: addr(i + 1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
        keyId: KEY_1, sourceIp: null, detail: { basis: 'not_in_registry' }, at: new Date(Date.UTC(2026, 9, 18, 12, 0, 0, i)).toISOString(),
      }));
    }
    return out;
  };

  it('answers newest first, pages with an opaque cursor, and walks the whole ledger exactly once', async () => {
    const tin = await newTin();
    const all = await seed(tin.id, 5);
    // Two events in the same millisecond still order, by id.
    const tie = await events.insertCheckedEvent(A, {
      tinId: tin.id, address: addr(99), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
      keyId: KEY_1, sourceIp: null, detail: {}, at: all[4].at,
    });
    const expected = [...all, tie].sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1)).map((e) => e.id);

    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = expectOk(await vault.listTinEvents(A, tin.id, { limit: 2, before }));
      expect(r.events.length).toBeLessThanOrEqual(2);
      seen.push(...r.events.map((e) => e.id));
      if (!r.next) break;
      before = r.next;
    }
    expect(seen).toEqual(expected);
  });

  it('clamps the page size and refuses a cursor it did not make', async () => {
    const tin = await newTin();
    await seed(tin.id, 3);
    const size = async (limit: unknown) => expectOk(await vault.listTinEvents(A, tin.id, { limit })).events.length;
    expect(await size('0')).toBe(3);        // not a positive integer: the default page, which holds all 3
    expect(await size('abc')).toBe(3);
    expect(await size('2')).toBe(2);
    expect(await size('100000')).toBe(3);   // capped at 200
    expect(await vault.listTinEvents(A, tin.id, { before: 'not-a-cursor' })).toEqual({ ok: false, error: 'invalid_cursor' });
    expect(await vault.listTinEvents(A, tin.id, { before: "2026-10-18T12:00:00.000Z|'; DROP TABLE agent_events; --" })).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('refuses a missing tin id, and answers an unknown or another account\'s tin exactly alike', async () => {
    const tin = await newTin();
    await seed(tin.id, 2);
    expect(await vault.listTinEvents(A, '')).toEqual({ ok: false, error: 'invalid_id' });
    expect(await vault.listTinEvents(A, null)).toEqual({ ok: false, error: 'invalid_id' });
    expect(await vault.listTinEvents(A, 'no-such-tin')).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.listTinEvents(B, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
  });

  it('never returns another account\'s events, even for a tin id they know', async () => {
    const tinA = await newTin(A, 'Agent A', KEY_1);
    const tinB = await newTin(B, 'Agent B', KEY_3);
    await seed(tinA.id, 2);
    await events.insertCheckedEvent(B, {
      tinId: tinB.id, address: addr(50), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
      keyId: KEY_3, sourceIp: null, detail: {}, at: NOW.toISOString(),
    });
    expect(expectOk(await vault.listTinEvents(A, tinA.id)).events).toHaveLength(2);
    expect(expectOk(await vault.listTinEvents(B, tinB.id)).events).toHaveLength(1);
    // Nothing in the answer carries an account id.
    expect(JSON.stringify(expectOk(await vault.listTinEvents(A, tinA.id)))).not.toMatch(/tenant/i);
  });

  it('marks the key that asked: active, revoked, or no longer known, so a rotated key stays marked', async () => {
    const tin = await newTin();
    const put = (keyId: string | null, i: number) =>
      events.insertCheckedEvent(A, {
        tinId: tin.id, address: addr(i), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
        keyId: keyId as string, sourceIp: null, detail: {}, at: new Date(Date.UTC(2026, 9, 18, 12, 0, 0, i)).toISOString(),
      });
    await put(KEY_1, 1);
    await put(KEY_2, 2);
    await put('f0'.repeat(12), 3);
    keys.byTenant[A] = [{ id: KEY_1, status: 'active' }, { id: KEY_2, status: 'revoked' }];
    const r = expectOk(await vault.listTinEvents(A, tin.id));
    expect(r.events.map((e) => [e.keyId?.slice(0, 2), e.keyStatus])).toEqual([['f0', 'unknown'], ['b2', 'revoked'], ['a1', 'active']]);
  });
});
