import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';

/**
 * The live feed's read side (src/lib/agentVault/feed.ts and the written-order reads in events.ts) over its real
 * SQL, run by the in-memory stand-in for the database. Events are put in the table with the moment they were
 * WRITTEN set by hand, so the cases that matter (the same second, a transfer written long after its block, a
 * burst) are exact rather than left to a clock. Every address, label, tenant and key is invented.
 */

const holder = vi.hoisted(() => ({
  db: null as any,
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
const KEY = 'a1'.repeat(12);
const NOW = new Date('2026-10-19T12:00:00.000Z');

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let feed: typeof import('../../src/lib/agentVault/feed');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  keys.byTenant = { [A]: [{ id: KEY, status: 'active' }], [B]: [] };
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  feed = await import('../../src/lib/agentVault/feed');
  await events.ensureAgentEventsTable();
});

const newTin = (tenant = A, label = 'Treasury agent') => store.insertTin(tenant, { label, agentKeyId: null, at: '2026-10-01 00:00:00' });

let seq = 0;
/** One ledger row written at `writtenAt` (the table's created_at), whatever time it says it happened. */
function put(tenant: string, tinId: string, writtenAt: string, over: Record<string, unknown> = {}) {
  seq += 1;
  const id = (over.id as string) ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  fake.seed('agent_events', {
    id,
    tenant_id: tenant,
    tin_id: tinId,
    kind: 'checked',
    address: addr(1),
    chain: null,
    answer: 'unknown',
    registry: 'none',
    status: 'unknown',
    key_id: null,
    source_ip: 'a-salted-hash',
    tx_hash: null,
    direction: null,
    wallet: null,
    amount: null,
    asset: null,
    asset_contract: null,
    usd_value: null,
    block_number: null,
    detail_json: JSON.stringify({ basis: 'not_in_registry' }),
    occurred_at: `${writtenAt.replace(' ', 'T')}.000Z`,
    created_at: writtenAt,
    ...over,
  });
  return id;
}

const ids = (answer: any) => answer.events.map((e: any) => e.id);
const ok = async (tenant: string, q: Record<string, unknown> = {}) => {
  const r = await feed.readFeed(tenant, q, () => NOW);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
};

describe('opening: the newest events, oldest first, of every agent of the account', () => {
  it('returns them in the order they were written, and says where the live polls start', async () => {
    const t1 = await newTin();
    const t2 = await newTin(A, 'Payroll agent');
    const e1 = put(A, t1.id, '2026-10-19 11:00:01');
    const e2 = put(A, t2.id, '2026-10-19 11:00:02');
    const e3 = put(A, t1.id, '2026-10-19 11:00:03');
    const r = await ok(A);
    expect(ids(r)).toEqual([e1, e2, e3]);
    expect(r.since).toBe('2026-10-19 11:00:03');
    expect(r.more).toBe(false);
    expect(r.cursor).toBeNull();
    expect(r.now).toBe(NOW.toISOString());
  });

  it('takes the newest 30 when there are more, still oldest first', async () => {
    const t = await newTin();
    const all = Array.from({ length: 35 }, (_, i) => put(A, t.id, `2026-10-19 11:00:${String(i).padStart(2, '0')}`));
    const r = await ok(A);
    expect(ids(r)).toEqual(all.slice(5));
  });

  it('starts at the beginning of time when the ledger is empty, so the first poll misses nothing', async () => {
    await newTin();
    const r = await ok(A);
    expect(r.events).toEqual([]);
    expect(r.since).toBe('1970-01-01 00:00:00');
  });

  it('never shows another account\'s events', async () => {
    const t = await newTin();
    const other = await newTin(B, 'Other agent');
    const mine = put(A, t.id, '2026-10-19 11:00:01');
    put(B, other.id, '2026-10-19 11:00:02');
    expect(ids(await ok(A))).toEqual([mine]);
    expect(ids(await ok(B))).toHaveLength(1);
  });

  it('names the agent and the owner\'s label for the address, and says nothing of the caller', async () => {
    const t = await newTin(A, 'Treasury agent');
    await store.insertDestination(A, { tinId: t.id, chain: 'ethereum', address: addr(1), label: 'Exchange deposit', at: '2026-10-01 00:00:00' });
    put(A, t.id, '2026-10-19 11:00:01', { key_id: KEY });
    put(A, t.id, '2026-10-19 11:00:02', { address: addr(2) });
    const r = await ok(A);
    expect(r.events[0]).toMatchObject({ agent: 'Treasury agent', label: 'Exchange deposit', address: addr(1), keyId: KEY, keyStatus: 'active', writtenAt: '2026-10-19 11:00:01' });
    expect(r.events[1]).toMatchObject({ agent: 'Treasury agent', label: null, keyStatus: null });
    for (const e of r.events as any[]) expect(Object.keys(e)).not.toContain('sourceIp');
    expect(JSON.stringify(r)).not.toContain('a-salted-hash');
  });

  it('marks a key that has been revoked, as the ledger page does', async () => {
    const t = await newTin();
    keys.byTenant[A] = [{ id: KEY, status: 'revoked' }];
    put(A, t.id, '2026-10-19 11:00:01', { key_id: KEY });
    put(A, t.id, '2026-10-19 11:00:02', { key_id: 'ff'.repeat(12) });
    const r = await ok(A);
    expect(r.events.map((e: any) => e.keyStatus)).toEqual(['revoked', 'unknown']);
  });

  it('leaves out the events of an agent that has been removed, and still moves on past them', async () => {
    const live = await newTin();
    const gone = await newTin(A, 'Removed agent');
    const kept = put(A, live.id, '2026-10-19 11:00:01');
    put(A, gone.id, '2026-10-19 11:00:09');
    await store.softDeleteTin(A, gone.id, '2026-10-19 11:30:00');
    const r = await ok(A);
    expect(ids(r)).toEqual([kept]);
    expect(r.since).toBe('2026-10-19 11:00:09');
  });
});

describe('the order of writing, not the time of the event', () => {
  it('shows a transfer that was written now for a block an hour old, which a feed that followed the event\'s time would never see', async () => {
    const t = await newTin();
    const seen = put(A, t.id, '2026-10-19 11:59:50');
    const first = await ok(A);
    expect(ids(first)).toEqual([seen]);
    // The watcher writes the transfer a minute later, stamped with its block's time, an hour earlier.
    const transfer = put(A, t.id, '2026-10-19 12:00:40', {
      kind: 'transaction', chain: 'ethereum', tx_hash: `0x${'ab'.repeat(32)}`, direction: 'out', wallet: addr(9), amount: '1.5', asset: 'ETH', usd_value: 4200,
      occurred_at: '2026-10-19T10:58:00.000Z',
    });
    const poll = await ok(A, { since: first.since });
    expect(ids(poll)).toContain(transfer);
    expect(poll.events.find((e: any) => e.id === transfer)).toMatchObject({ kind: 'transaction', at: '2026-10-19T10:58:00.000Z', writtenAt: '2026-10-19 12:00:40', tx: { direction: 'out', amount: '1.5', asset: 'ETH', usd: 4200 } });
  });
});

describe('a live poll', () => {
  it('starts five seconds before `since`, so an event written in the same second after the page last looked is not missed', async () => {
    const t = await newTin();
    const first = put(A, t.id, '2026-10-19 11:00:10', { id: '00000000-0000-4000-8000-0000000000f0' });
    const page = await ok(A);
    expect(page.since).toBe('2026-10-19 11:00:10');
    // Written in the same second, after the page looked, with an id that sorts BEFORE the one it had.
    const late = put(A, t.id, '2026-10-19 11:00:10', { id: '00000000-0000-4000-8000-000000000001' });
    const poll = await ok(A, { since: page.since });
    expect(ids(poll)).toEqual([late, first]);
  });

  it('carries events from the five seconds before, which the page drops by id, and nothing older', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:04');
    const inWindow = put(A, t.id, '2026-10-19 11:00:06');
    const after = put(A, t.id, '2026-10-19 11:00:20');
    const r = await ok(A, { since: '2026-10-19 11:00:10' });
    expect(ids(r)).toEqual([inWindow, after]);
  });

  it('returns nothing and does not slide `since` back when there is nothing new', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:01');
    const r = await ok(A, { since: '2026-10-19 11:30:00' });
    expect(r.events).toEqual([]);
    expect(r.since).toBe('2026-10-19 11:30:00');
  });

  it('does not slide `since` back when all it finds is inside the overlap', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:07');
    const r = await ok(A, { since: '2026-10-19 11:00:10' });
    expect(ids(r)).toHaveLength(1);
    expect(r.since).toBe('2026-10-19 11:00:10');
  });

  it('asks for the cheap case with one statement: nothing new costs no lookups of names, keys or labels', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:01');
    const seen: string[] = [];
    holder.intercept = (sql) => seen.push(sql);
    await ok(A, { since: '2026-10-19 11:30:00' });
    expect(seen.filter((s) => /FROM agent_tins|FROM agent_destinations|FROM verify_agent_keys/.test(s))).toEqual([]);
  });
});

describe('a backlog longer than one answer', () => {
  it('is read to its end by the cursor with no gap and no repeat, even when every event was written in the same second', async () => {
    const t = await newTin();
    const written = Array.from({ length: 25 }, (_, i) => put(A, t.id, '2026-10-19 11:00:30', { id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}` }));
    const got: string[] = [];
    let q: Record<string, unknown> = { since: '2026-10-19 11:00:30', limit: 10 };
    for (let page = 0; page < 10; page += 1) {
      const r = await ok(A, q);
      got.push(...ids(r));
      if (!r.more) break;
      expect(r.cursor).toEqual(expect.any(String));
      q = { after: r.cursor, limit: 10 };
    }
    expect(got).toEqual(written);
  });

  it('says `more` and gives a cursor only when there is more, and the cursor is the last event it reached', async () => {
    const t = await newTin();
    const a = put(A, t.id, '2026-10-19 11:00:01');
    const b = put(A, t.id, '2026-10-19 11:00:02');
    put(A, t.id, '2026-10-19 11:00:03');
    const r = await ok(A, { since: '2026-10-19 11:00:00', limit: 2 });
    expect(ids(r)).toEqual([a, b]);
    expect(r.more).toBe(true);
    expect(r.cursor).toBe(`2026-10-19 11:00:02|${b}`);
    const rest = await ok(A, { after: r.cursor });
    expect(rest.events).toHaveLength(1);
    expect(rest.more).toBe(false);
    expect(rest.cursor).toBeNull();
  });

  it('moves on past events of a removed agent without stalling', async () => {
    const live = await newTin();
    const gone = await newTin(A, 'Removed agent');
    const first = put(A, live.id, '2026-10-19 11:00:01');
    put(A, gone.id, '2026-10-19 11:00:02');
    put(A, gone.id, '2026-10-19 11:00:03');
    const last = put(A, live.id, '2026-10-19 11:00:04');
    await store.softDeleteTin(A, gone.id, '2026-10-19 11:30:00');
    const page1 = await ok(A, { since: '2026-10-19 11:00:00', limit: 2 });
    expect(ids(page1)).toEqual([first]);
    expect(page1.more).toBe(true);
    const page2 = await ok(A, { after: page1.cursor });
    expect(ids(page2)).toEqual([last]);
  });
});

describe('one agent', () => {
  it('filters to the agent asked for', async () => {
    const t1 = await newTin();
    const t2 = await newTin(A, 'Payroll agent');
    put(A, t1.id, '2026-10-19 11:00:01');
    const mine = put(A, t2.id, '2026-10-19 11:00:02');
    expect(ids(await ok(A, { tinId: t2.id }))).toEqual([mine]);
    expect(ids(await ok(A, { tinId: t2.id, since: '2026-10-19 11:00:00' }))).toEqual([mine]);
  });

  it('answers 404 tin_not_found for an agent of another account or one that does not exist, the same for both', async () => {
    const other = await newTin(B, 'Other agent');
    await newTin();
    expect(await feed.readFeed(A, { tinId: other.id }, () => NOW)).toMatchObject({ ok: false, error: 'tin_not_found' });
    expect(await feed.readFeed(A, { tinId: 'no-such-agent' }, () => NOW)).toMatchObject({ ok: false, error: 'tin_not_found' });
  });
});

describe('what it refuses', () => {
  it('a time or a cursor that this code did not make, both at once, and an id that is not one', async () => {
    await newTin();
    const bad = async (q: Record<string, unknown>) => (await feed.readFeed(A, q, () => NOW)) as any;
    for (const since of ['yesterday', '2026-10-19', '2026-10-19T11:00:00Z', '2026-13-45 99:99:99', "2026-10-19 11:00:00'; --", 12345]) {
      expect(await bad({ since })).toMatchObject({ ok: false, error: 'invalid_cursor' });
    }
    for (const after of ['nope', '2026-10-19 11:00:00', '2026-10-19 11:00:00|', '2026-10-19 11:00:00|a b', 'x|2026-10-19 11:00:00', `2026-10-19 11:00:00|${'x'.repeat(65)}`, 7]) {
      expect(await bad({ after })).toMatchObject({ ok: false, error: 'invalid_cursor' });
    }
    expect(await bad({ since: '2026-10-19 11:00:00', after: '2026-10-19 11:00:00|abc' })).toMatchObject({ ok: false, error: 'invalid_cursor' });
    expect(await bad({ tinId: 'x'.repeat(65) })).toMatchObject({ ok: false, error: 'invalid_id' });
    expect(await bad({ tinId: 42 })).toMatchObject({ ok: false, error: 'invalid_id' });
  });

  it('treats an empty parameter as not given', async () => {
    await newTin();
    expect(await feed.readFeed(A, { since: '', after: '', tinId: '', limit: '' }, () => NOW)).toMatchObject({ ok: true });
    expect(await feed.readFeed(A, { since: null, after: undefined }, () => NOW)).toMatchObject({ ok: true });
  });
});

describe('page sizes', () => {
  it('uses 30 to open and 100 to poll, and caps them at 100 and 200', async () => {
    const t = await newTin();
    for (let i = 0; i < 230; i += 1) put(A, t.id, `2026-10-19 11:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
    expect((await ok(A)).events).toHaveLength(30);
    expect((await ok(A, { limit: 1000 })).events).toHaveLength(100);
    expect((await ok(A, { since: '2026-10-19 11:00:00' })).events).toHaveLength(100);
    expect((await ok(A, { since: '2026-10-19 11:00:00', limit: 1000 })).events).toHaveLength(200);
    for (const limit of [0, -5, 'many', 2.5]) {
      expect((await ok(A, { limit })).events).toHaveLength(30);
      expect((await ok(A, { since: '2026-10-19 11:00:00', limit })).events).toHaveLength(100);
    }
    expect((await ok(A, { limit: 3 })).events).toHaveLength(3);
  });
});

describe('every statement is for the account in the session', () => {
  it('names the account in each read of the ledger, the agents, the registry and the keys', async () => {
    const t = await newTin();
    await store.insertDestination(A, { tinId: t.id, chain: 'ethereum', address: addr(1), label: 'Label', at: '2026-10-01 00:00:00' });
    put(A, t.id, '2026-10-19 11:00:01');
    const seen: Array<{ sql: string; args: unknown[] }> = [];
    holder.intercept = (sql, args) => seen.push({ sql, args });
    await ok(A);
    await ok(A, { since: '2026-10-19 11:00:00' });
    await ok(A, { after: '2026-10-19 11:00:00|00000000-0000-4000-8000-000000000000' });
    await ok(A, { tinId: t.id });
    const reads = seen.filter((s) => /\bFROM (agent_events|agent_tins|agent_destinations)\b/.test(s.sql));
    expect(reads.length).toBeGreaterThan(8);
    for (const s of reads) {
      expect(s.sql, s.sql).toMatch(/tenant_id = \?/);
      expect(s.args, s.sql).toContain(A);
    }
    for (const s of seen.filter((x) => /agent_events/.test(x.sql) && /^SELECT/.test(x.sql))) expect(s.sql).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);
  });
});

describe('the index', () => {
  it('is asked for once per process, only by the feed, with a lock timeout, and never fails a read', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:01');
    const batches: string[][] = [];
    const real = holder.db.batch.bind(holder.db);
    holder.db.batch = (s: any, m?: any) => {
      batches.push(s.map((x: any) => x.sql));
      return real(s, m);
    };
    await ok(A);
    await ok(A);
    await ok(A, { since: '2026-10-19 11:00:00' });
    const index = batches.filter((b) => b.some((sql) => /CREATE INDEX IF NOT EXISTS agent_events_tenant_written/.test(sql)));
    expect(index).toHaveLength(1);
    expect(index[0][0]).toMatch(/SET LOCAL lock_timeout = '2s'/);
  });

  it('is not asked for when a check is written: only the feed builds it', async () => {
    const t = await newTin();
    const batches: string[][] = [];
    const real = holder.db.batch.bind(holder.db);
    holder.db.batch = (s: any, m?: any) => {
      batches.push(s.map((x: any) => x.sql));
      return real(s, m);
    };
    await events.insertCheckedEvent(A, { tinId: t.id, address: addr(1), answer: 'unknown', registry: 'none', status: 'unknown', keyId: null, sourceIp: null, detail: {}, at: NOW.toISOString() } as never);
    expect(batches.flat().join('\n')).not.toContain('agent_events_tenant_written');
  });

  it('a failed attempt is logged by name and code only, the read still answers, and the next read tries again', async () => {
    const t = await newTin();
    put(A, t.id, '2026-10-19 11:00:01');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = holder.db.batch.bind(holder.db);
    let fail = true;
    holder.db.batch = (s: any, m?: any) => {
      if (fail && s.some((x: any) => /agent_events_tenant_written/.test(x.sql))) return Promise.reject(Object.assign(new Error('canceling statement due to lock timeout with SECRET detail'), { name: 'DatabaseError', code: '55P03' }));
      return real(s, m);
    };
    expect((await ok(A)).events).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith('[agent-vault] feed index not ensured', { name: 'DatabaseError', code: '55P03' });
    expect(JSON.stringify(errors.mock.calls)).not.toContain('SECRET');
    fail = false;
    let tried = 0;
    const counting = holder.db.batch;
    holder.db.batch = (s: any, m?: any) => {
      if (s.some((x: any) => /agent_events_tenant_written/.test(x.sql))) tried += 1;
      return counting(s, m);
    };
    await ok(A);
    expect(tried).toBe(1);
    errors.mockRestore();
  });
});
