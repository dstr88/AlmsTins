import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * Reading an account's wallets while its Live page is open (src/lib/agentVault/liveRead.ts). The pass itself is
 * the watcher's and is tested there (watcher.test.ts, refresh.test.ts); what is tested here is WHEN it runs:
 * once in 45 seconds for an agent however many pages ask, one at a time in a process, the agent that has waited
 * longest first, nothing for an account with nothing to read, and a pace the server sets. The read is replaced
 * by a table of answers and the clock is a number, so nothing waits and nothing touches a network.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: vi.fn(), getCached: vi.fn(() => null) }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: vi.fn() }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: vi.fn() }));

const A = 'tenant-a';
const B = 'tenant-b';

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let live: typeof import('../../src/lib/agentVault/liveRead');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  store = await import('../../src/lib/agentVault/store');
  live = await import('../../src/lib/agentVault/liveRead');
});

const newTin = (tenant: string, label: string, at: string) => store.insertTin(tenant, { label, agentKeyId: null, at });

const pass = (tinId: string, wallets: Array<{ status: string }>, recorded = 0) =>
  ({ tinId, startedAt: '2026-10-19T12:00:00.000Z', watchedDestinations: 1, notWatched: { pending: 0, flagged: 0, overLimit: 0 }, wallets, recorded }) as never;

/** A read that answers from a table by agent id; anything not listed has a wallet and reads completely. */
function reader(table: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const read = vi.fn(async (_tenant: string, tinId: string) => {
    calls.push(tinId);
    return (tinId in table ? table[tinId] : { ok: true, pass: pass(tinId, [{ status: 'complete' }]) }) as never;
  });
  return { calls, read };
}

const T0 = 1_760_000_000_000;
// The read is a table of answers, not the real pass: the deps type is told so once, here.
const deps = (now: { t: number }, read: unknown) => ({ now: () => now.t, read: read as import('../../src/lib/agentVault/liveRead').LiveReadDeps['read'] });

describe('what it does', () => {
  it('reads an agent and says how long to wait before asking again', async () => {
    const t = await newTin(A, 'Treasury agent', '2026-10-01 00:00:00');
    const { read, calls } = reader({ [t.id]: { ok: true, pass: pass(t.id, [{ status: 'complete' }], 2) } });
    const now = { t: T0 };
    const r = await live.liveRead(A, {}, deps(now, read));
    expect(r).toMatchObject({ ok: true, status: 'read', tinId: t.id, waitMs: live.LIVE_READ_PAUSE_MS });
    expect((r as any).pass.recorded).toBe(2);
    expect(calls).toEqual([t.id]);
    expect(read).toHaveBeenCalledWith(A, t.id);
  });

  it('is for the account in the session only: another account\'s agents are never read', async () => {
    const mine = await newTin(A, 'Mine', '2026-10-01 00:00:00');
    await newTin(B, 'Theirs', '2026-10-01 00:00:00');
    const { read, calls } = reader();
    const now = { t: T0 };
    await live.liveRead(A, {}, deps(now, read));
    now.t += live.LIVE_READ_MIN_GAP_MS;
    await live.liveRead(A, {}, deps(now, read));
    expect(new Set(calls)).toEqual(new Set([mine.id]));
  });

  it('says there is nothing to read for an account with no agent', async () => {
    const { read } = reader();
    const r = await live.liveRead(A, {}, deps({ t: T0 }, read));
    expect(r).toEqual({ ok: true, status: 'nothing', tinId: null, pass: null, waitMs: live.LIVE_READ_NOTHING_WAIT_MS });
    expect(read).not.toHaveBeenCalled();
  });

  it('says there is nothing to read when no agent has a wallet and a trusted address on the same chain, and tries each before it says so', async () => {
    const a = await newTin(A, 'One', '2026-10-01 00:00:00');
    const b = await newTin(A, 'Two', '2026-10-02 00:00:00');
    const { read, calls } = reader({ [a.id]: { ok: true, pass: pass(a.id, []) }, [b.id]: { ok: true, pass: pass(b.id, []) } });
    const r = await live.liveRead(A, {}, deps({ t: T0 }, read));
    expect(r).toMatchObject({ ok: true, status: 'nothing', tinId: null, pass: null, waitMs: live.LIVE_READ_NOTHING_WAIT_MS });
    expect(calls).toEqual([a.id, b.id]);
  });

  it('goes on to the next agent when one has nothing to read, in the same request', async () => {
    const a = await newTin(A, 'Empty', '2026-10-01 00:00:00');
    const b = await newTin(A, 'Busy wallet', '2026-10-02 00:00:00');
    const { read, calls } = reader({ [a.id]: { ok: true, pass: pass(a.id, []) } });
    const r = await live.liveRead(A, {}, deps({ t: T0 }, read));
    expect(r).toMatchObject({ status: 'read', tinId: b.id });
    expect(calls).toEqual([a.id, b.id]);
  });
});

describe('the pace', () => {
  it('reads an agent at most once in 45 seconds, however many pages ask', async () => {
    const t = await newTin(A, 'Treasury agent', '2026-10-01 00:00:00');
    const { read, calls } = reader();
    const now = { t: T0 };
    expect((await live.liveRead(A, {}, deps(now, read))).ok).toBe(true);
    now.t += 10_000;
    const second = await live.liveRead(A, {}, deps(now, read));
    expect(second).toEqual({ ok: true, status: 'recent', tinId: null, pass: null, waitMs: 35_000 });
    now.t += 34_999;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'recent', waitMs: live.LIVE_READ_MIN_WAIT_MS });
    now.t += 1;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: t.id });
    expect(calls).toEqual([t.id, t.id]);
  });

  it('never tells a page to wait less than five seconds', async () => {
    await newTin(A, 'Treasury agent', '2026-10-01 00:00:00');
    const { read } = reader();
    const now = { t: T0 };
    await live.liveRead(A, {}, deps(now, read));
    now.t += live.LIVE_READ_MIN_GAP_MS - 200;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'recent', waitMs: live.LIVE_READ_MIN_WAIT_MS });
  });

  it('takes the agents in turn: the one that has waited longest, and one never read before any that was', async () => {
    const a = await newTin(A, 'First', '2026-10-01 00:00:00');
    const b = await newTin(A, 'Second', '2026-10-02 00:00:00');
    const c = await newTin(A, 'Third', '2026-10-03 00:00:00');
    const { read, calls } = reader();
    const now = { t: T0 };
    for (let i = 0; i < 3; i += 1) {
      expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read' });
      now.t += 1_000;
    }
    // Three agents, three asks a second apart: each once, in the order they were made. A fourth ask finds every one read lately.
    expect(calls).toEqual([a.id, b.id, c.id]);
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'recent' });
    // 45 seconds after the first read it is due again, and it has waited longest: it goes first, then the next as each comes due.
    now.t = T0 + live.LIVE_READ_MIN_GAP_MS;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: a.id });
    now.t += 1_000;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: b.id });
    now.t += 1_000;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: c.id });
  });

  it('reads the agent it is asked for, and only that one, even when another has waited longer', async () => {
    const a = await newTin(A, 'First', '2026-10-01 00:00:00');
    const b = await newTin(A, 'Second', '2026-10-02 00:00:00');
    const { read, calls } = reader();
    const now = { t: T0 };
    expect(await live.liveRead(A, { tinId: b.id }, deps(now, read))).toMatchObject({ status: 'read', tinId: b.id });
    expect(await live.liveRead(A, { tinId: b.id }, deps(now, read))).toMatchObject({ status: 'recent' });
    expect(calls).toEqual([b.id]);
    void a;
  });

  it('forgets nothing it should remember: a read of one account does not delay another account\'s agent of the same id', async () => {
    const mine = await newTin(A, 'Mine', '2026-10-01 00:00:00');
    const theirs = await newTin(B, 'Theirs', '2026-10-01 00:00:00');
    const { read, calls } = reader();
    const now = { t: T0 };
    await live.liveRead(A, {}, deps(now, read));
    expect(await live.liveRead(B, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: theirs.id });
    expect(calls).toEqual([mine.id, theirs.id]);
  });
});

describe('one at a time', () => {
  it('tells a second page that a read is running instead of queueing behind it, and frees the place when the read ends', async () => {
    const a = await newTin(A, 'First', '2026-10-01 00:00:00');
    const b = await newTin(B, 'Second account\'s agent', '2026-10-01 00:00:00');
    let release: (v: unknown) => void = () => {};
    const slow = vi.fn((_t: string, id: string) => (id === a.id ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ ok: true, pass: pass(id, [{ status: 'complete' }]) })) as never);
    const now = { t: T0 };
    const first = live.liveRead(A, {}, deps(now, slow));
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    const second = await live.liveRead(B, {}, deps(now, slow));
    expect(second).toEqual({ ok: true, status: 'busy', tinId: null, pass: null, waitMs: live.LIVE_READ_BUSY_WAIT_MS });
    expect(slow).toHaveBeenCalledTimes(1);
    release({ ok: true, pass: pass(a.id, [{ status: 'complete' }]) });
    expect(await first).toMatchObject({ status: 'read' });
    expect(await live.liveRead(B, {}, deps(now, slow))).toMatchObject({ status: 'read', tinId: b.id });
  });

  it('frees the place when the read throws, and the failure is the caller\'s to handle', async () => {
    const a = await newTin(A, 'First', '2026-10-01 00:00:00');
    const boom = vi.fn(async () => { throw new Error('the database went away'); });
    const now = { t: T0 };
    await expect(live.liveRead(A, {}, deps(now, boom as never))).rejects.toThrow('the database went away');
    const { read } = reader();
    now.t += live.LIVE_READ_MIN_GAP_MS;
    expect(await live.liveRead(A, {}, deps(now, read))).toMatchObject({ status: 'read', tinId: a.id });
  });

  it('leaves an agent whose read is already running (the button, the daily job) and tries the next; busy when every one is', async () => {
    const a = await newTin(A, 'Being read', '2026-10-01 00:00:00');
    const b = await newTin(A, 'Free', '2026-10-02 00:00:00');
    const { read, calls } = reader({ [a.id]: { ok: false, error: 'refresh_in_progress' } });
    const r = await live.liveRead(A, {}, deps({ t: T0 }, read));
    expect(r).toMatchObject({ status: 'read', tinId: b.id });
    expect(calls).toEqual([a.id, b.id]);

    const only = reader({ [a.id]: { ok: false, error: 'refresh_in_progress' }, [b.id]: { ok: false, error: 'refresh_in_progress' } });
    const busy = await live.liveRead(A, {}, deps({ t: T0 + 10 * live.LIVE_READ_MIN_GAP_MS }, only.read));
    expect(busy).toEqual({ ok: true, status: 'busy', tinId: null, pass: null, waitMs: live.LIVE_READ_BUSY_WAIT_MS });
  });

  it('hands back any other refusal of the read as it came', async () => {
    const a = await newTin(A, 'First', '2026-10-01 00:00:00');
    const { read } = reader({ [a.id]: { ok: false, error: 'tin_not_found' } });
    expect(await live.liveRead(A, {}, deps({ t: T0 }, read))).toEqual({ ok: false, error: 'tin_not_found' });
  });
});

describe('what it refuses', () => {
  it('an agent id that is not one, and an agent of another account or that does not exist (the same answer for both)', async () => {
    const theirs = await newTin(B, 'Theirs', '2026-10-01 00:00:00');
    await newTin(A, 'Mine', '2026-10-01 00:00:00');
    const { read } = reader();
    const d = deps({ t: T0 }, read);
    expect(await live.liveRead(A, { tinId: 7 }, d)).toMatchObject({ ok: false, error: 'invalid_id' });
    expect(await live.liveRead(A, { tinId: 'x'.repeat(65) }, d)).toMatchObject({ ok: false, error: 'invalid_id' });
    expect(await live.liveRead(A, { tinId: theirs.id }, d)).toMatchObject({ ok: false, error: 'tin_not_found' });
    expect(await live.liveRead(A, { tinId: 'no-such-agent' }, d)).toMatchObject({ ok: false, error: 'tin_not_found' });
    expect(read).not.toHaveBeenCalled();
  });

  it('treats an empty agent id as none given', async () => {
    const a = await newTin(A, 'Mine', '2026-10-01 00:00:00');
    const { read } = reader();
    let t = T0;
    for (const tinId of [undefined, null, '']) {
      t += 10 * live.LIVE_READ_MIN_GAP_MS;
      expect(await live.liveRead(A, { tinId }, deps({ t }, read))).toMatchObject({ ok: true, status: 'read', tinId: a.id });
    }
  });

  it('does not read an agent that has been removed', async () => {
    const a = await newTin(A, 'Gone', '2026-10-01 00:00:00');
    await store.softDeleteTin(A, a.id, '2026-10-19 11:00:00');
    const { read } = reader();
    expect(await live.liveRead(A, {}, deps({ t: T0 }, read))).toMatchObject({ status: 'nothing' });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the numbers', () => {
  it('are the ones the page, the docs and the privacy text rely on', () => {
    expect(live.LIVE_READ_MIN_GAP_MS).toBe(45_000);
    expect(live.LIVE_READ_PAUSE_MS).toBe(30_000);
    expect(live.LIVE_READS_IN_FLIGHT_MAX).toBe(1);
    expect(live.LIVE_READ_REQUESTS_PER_WINDOW).toBe(6);
    // A read takes up to 20 seconds and the page waits 30 after it: about a minute for one agent.
    expect(live.LIVE_READ_PAUSE_MS + 20_000).toBeLessThanOrEqual(60_000);
  });
});
