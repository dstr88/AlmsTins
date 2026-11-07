import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { blockIso, blockTime, createFakeExplorer, nativeRow, units, type FakeExplorer } from '../helpers/fakeExplorer';

/**
 * The day's pass of the chain read, in as many calls as it takes (src/lib/agentVault/syncPass.ts),
 * over the in-memory database and a fake block explorer. What is pinned: the wallet read longest ago
 * goes first and a wallet never read goes before all; a pass reads every wallet once before any twice;
 * a call the deadline cuts is picked up by the next one from the cursor, with nothing written twice
 * and nothing counted twice; a pass with no wallets is done at once; the totals the health rule
 * judges are the pass's, not one call's; and the answer is numbers and true/false only.
 * Every address, hash and amount is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

const A = 'tenant-a';
const B = 'tenant-b';
const W1 = addr(1);
const W2 = addr(2);
const W3 = addr(3);
const PAYEE = addr(11);

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let watcher: typeof import('../../src/lib/agentVault/watcher');
let sync: typeof import('../../src/lib/agentVault/syncPass');
let explorer: FakeExplorer;
let nowMs: number;

/** The clock at which the newest confirmed Ethereum block is `block`. */
const clockAt = (block: number) => (nowMs = (blockTime(block) + 180) * 1000);
const stored = (block: number) => blockIso(block).slice(0, 19).replace('T', ' ');
const DAY_MS = 24 * 60 * 60 * 1000;

const deps = (over: Record<string, unknown> = {}) =>
  ({ explorer, pricing: { unitPriceUsd: async () => 2000 }, now: () => nowMs, ...over }) as import('../../src/lib/agentVault/watcher').WatchDeps;

/** An explorer that moves the clock on by `stepMs` after every page it answers, so a deadline falls between pages. */
const slowDeps = (stepMs: number, over: Record<string, unknown> = {}) =>
  deps({
    explorer: { blockAt: (c: any, s: number) => explorer.blockAt(c, s), page: async (q: any) => { const got = await explorer.page(q); nowMs += stepMs; return got; } },
    ...over,
  });

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  explorer = createFakeExplorer();
  clockAt(20_000);
  store = await import('../../src/lib/agentVault/store');
  watcher = await import('../../src/lib/agentVault/watcher');
  sync = await import('../../src/lib/agentVault/syncPass');
});

async function agent(tenant: string, wallets: string[], label = 'Agent') {
  const tin = await store.insertTin(tenant, { label, agentKeyId: null, at: stored(0) });
  const out = [];
  for (const [i, address] of wallets.entries()) out.push((await store.insertWallet(tenant, { tinId: tin.id, chain: 'ethereum', address, at: stored(i) })).wallet);
  return { tin, wallets: out };
}

/** The wallets the explorer was asked about, in the order their reads began. */
const readOrder = () => {
  const out: string[] = [];
  for (const q of explorer.pages()) if (out[out.length - 1] !== q.address) out.push(q.address);
  return out;
};
const ledger = () => fake.rows('agent_events').filter((r) => r.kind === 'transaction');
const reads = () => fake.rows('agent_wallet_reads') ?? [];
const pay = (hash: number, block: number, from = W1) => nativeRow({ hash, block, from, to: PAYEE, value: units('1') });
const onlyNumbers = (o: object) => Object.values(o).every((v) => typeof v === 'number' || typeof v === 'boolean');

describe('a pass with no wallets', () => {
  it('is done at once, reads nothing, and answers zeros', async () => {
    await store.insertTin(A, { label: 'No wallet', agentKeyId: null, at: stored(0) });
    const r = await sync.runSyncCall(deps());
    expect(r).toEqual({
      done: true, remaining: 0, tins: 0, wallets: 0, complete: 0, partial: 0, unavailable: 0, failed: 0, recorded: 0, truncated: false,
      pass_wallets: 0, pass_complete: 0, pass_partial: 0, pass_unavailable: 0, pass_failed: 0, pass_recorded: 0,
    });
    expect(explorer.calls).toEqual([]);
  });
});

describe('the order: least recently read first', () => {
  it('a wallet never read goes first, then the one read longest ago', async () => {
    const a = await agent(A, [W1]);
    const b = await agent(B, [W2]);
    const c = await agent(A, [W3], 'Third');
    const yesterday = sync.passDayOf(nowMs - DAY_MS);
    // W2 was read early yesterday, W1 late yesterday, W3 never.
    await sync.markWalletRead({ tenantId: A, tinId: a.tin.id, walletId: a.wallets[0].id }, yesterday, { status: 'complete', recorded: 0, atMs: nowMs - DAY_MS + 60_000 });
    await sync.markWalletRead({ tenantId: B, tinId: b.tin.id, walletId: b.wallets[0].id }, yesterday, { status: 'complete', recorded: 0, atMs: nowMs - DAY_MS });
    expect(c.tin.id).toBeTruthy();

    const r = await sync.runSyncCall(deps());
    expect(readOrder()).toEqual([W3, W2, W1]);
    expect(r).toMatchObject({ done: true, remaining: 0, tins: 3, wallets: 3, pass_wallets: 3, pass_complete: 3 });
  });

  it('a deadline that has passed reads nothing, and the order still stands for the next call', async () => {
    await agent(A, [W1]);
    const r = await sync.runSyncCall(deps(), { deadlineAt: nowMs - 1 });
    expect(r).toMatchObject({ done: false, remaining: 1, tins: 0, wallets: 0, truncated: true });
    expect(explorer.calls).toEqual([]);
  });

  it('a tin\'s wallets that come up together are read in one tin pass, in their order', async () => {
    await agent(A, [W1, W2]);
    const r = await sync.runSyncCall(deps());
    expect(readOrder()).toEqual([W1, W2]);
    expect(r).toMatchObject({ tins: 1, wallets: 2 });
  });
});

describe('once a day: no wallet is read twice in a pass', () => {
  it('a second call the same day reads nothing; the next day reads every wallet again', async () => {
    await agent(A, [W1]);
    await agent(B, [W2]);
    expect(await sync.runSyncCall(deps())).toMatchObject({ done: true, wallets: 2 });
    const first = explorer.calls.length;

    const again = await sync.runSyncCall(deps());
    expect(again).toMatchObject({ done: true, remaining: 0, tins: 0, wallets: 0, pass_wallets: 2, pass_complete: 2 });
    expect(explorer.calls.length).toBe(first);

    nowMs += DAY_MS;
    const tomorrow = await sync.runSyncCall(deps());
    expect(tomorrow).toMatchObject({ done: true, wallets: 2, pass_wallets: 2 });
    expect(explorer.calls.length).toBeGreaterThan(first);
  });

  it('a wallet added after the pass finished is read by a later call the same day', async () => {
    const a = await agent(A, [W1]);
    await sync.runSyncCall(deps());
    await store.insertWallet(A, { tinId: a.tin.id, chain: 'ethereum', address: W2, at: stored(0) });
    explorer.calls.length = 0;
    expect(await sync.runSyncCall(deps())).toMatchObject({ done: true, wallets: 1, pass_wallets: 2 });
    expect(readOrder()).toEqual([W2]);
  });

  it('a removed tin or wallet is not read and not waited for', async () => {
    const a = await agent(A, [W1]);
    const b = await agent(B, [W2, W3]);
    await store.softDeleteTin(A, a.tin.id, stored(10_000));
    await store.softDeleteWallet(B, b.wallets[1].id, stored(10_000));
    const r = await sync.runSyncCall(deps());
    expect(readOrder()).toEqual([W2]);
    expect(r).toMatchObject({ done: true, remaining: 0, wallets: 1 });
  });
});

describe('resume after a cut', () => {
  it('the next call reads on from the cursor: nothing written twice, each wallet counted once, by how it ended', async () => {
    // W1 (the second account) was read longest ago, so it goes first, ahead of the account order.
    const b = await agent(B, [W1]);
    const a = await agent(A, [W2]);
    const yesterday = sync.passDayOf(nowMs - DAY_MS);
    const readYesterday = nowMs - DAY_MS;
    await sync.markWalletRead({ tenantId: B, tinId: b.tin.id, walletId: b.wallets[0].id }, yesterday, { status: 'complete', recorded: 0, atMs: readYesterday });
    await sync.markWalletRead({ tenantId: A, tinId: a.tin.id, walletId: a.wallets[0].id }, yesterday, { status: 'complete', recorded: 0, atMs: readYesterday + 60_000 });
    const rows = Array.from({ length: 5 }, (_, i) => pay(300 + i, 2000 + i * 10));
    explorer.add('ethereum', W1, 'txlist', ...rows);
    explorer.add('ethereum', W2, 'txlist', pay(400, 2500, W2));
    const limits = { pageSize: 2, maxPages: 5 };

    // The clock runs out right after the first page of the first wallet.
    const cut = await sync.runSyncCall(slowDeps(100_000, { limits }), { deadlineAt: nowMs + 50_000 });
    expect(cut).toMatchObject({ done: false, remaining: 2, truncated: true, tins: 1, wallets: 1, partial: 1, recorded: 1, pass_wallets: 1, pass_partial: 1, pass_recorded: 1 });
    expect(ledger()).toHaveLength(1);
    expect(readOrder()).toEqual([W1]);
    // Cut, not done: it keeps when its last finished read ended, and what it recorded so far.
    expect(reads().find((r) => r.tenant_id === B)).toMatchObject({ status: 'cut', read_at: new Date(readYesterday).toISOString(), recorded: 1 });

    // The same day, a fresh call with its own budget.
    clockAt(20_000);
    explorer.calls.length = 0;
    const rest = await sync.runSyncCall(deps({ limits }));
    expect(rest).toMatchObject({ done: true, remaining: 0, truncated: false, wallets: 2, complete: 2 });
    expect(rest).toMatchObject({ pass_wallets: 2, pass_complete: 2, pass_partial: 0, pass_failed: 0, pass_recorded: 6 });
    expect(ledger().map((r) => r.block_number).sort()).toEqual([2000, 2010, 2020, 2030, 2040, 2500]);
    // The cut wallet went first again: it kept its place at the front of the order.
    expect(readOrder()).toEqual([W1, W2]);
    expect(reads().every((r) => r.status === 'complete' && typeof r.read_at === 'string')).toBe(true);
  });

  it('a wallet cut on one day and not finished is read in full the next, counting only that day', async () => {
    await agent(A, [W1]);
    explorer.add('ethereum', W1, 'txlist', ...Array.from({ length: 3 }, (_, i) => pay(500 + i, 3000 + i * 10)));
    const limits = { pageSize: 2, maxPages: 5 };
    await sync.runSyncCall(slowDeps(100_000, { limits }), { deadlineAt: nowMs + 50_000 });
    clockAt(20_000);
    nowMs += DAY_MS;
    const next = await sync.runSyncCall(deps({ limits }));
    expect(next).toMatchObject({ done: true, pass_wallets: 1, pass_complete: 1, pass_recorded: 2 });
    expect(ledger()).toHaveLength(3);
  });
});

describe('the health rule judges the whole pass', () => {
  it('a tin that cannot be read fails its wallets for the pass once: not read again today, and counted in pass_failed', async () => {
    await agent(A, [W1, W2]);
    await agent(B, [W3]);
    const real = fake.execute.bind(fake);
    holder.db = { ...fake, execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      if (/FROM agent_destinations/i.test(sql) && (s.args ?? []).includes(A)) throw new Error('database hiccup');
      return real(s);
    } };
    const r = await sync.runSyncCall(deps());
    expect(r).toMatchObject({ done: true, wallets: 3, failed: 2, complete: 1, pass_failed: 2, pass_complete: 1 });
    expect(readOrder()).toEqual([W3]);
    const again = await sync.runSyncCall(deps());
    expect(again).toMatchObject({ done: true, wallets: 0, pass_failed: 2 });
  });

  it('an explorer that cannot answer is not a failure: the wallet is picked up tomorrow', async () => {
    await agent(A, [W1]);
    explorer.failBlockAt = () => true;
    const r = await sync.runSyncCall(deps());
    expect(r).toMatchObject({ done: true, unavailable: 1, pass_unavailable: 1, pass_failed: 0 });
  });

  it('answers numbers and true/false only, naming no wallet and no account', async () => {
    await agent(A, [W1]);
    explorer.add('ethereum', W1, 'txlist', pay(600, 4000));
    const r = await sync.runSyncCall(deps());
    expect(onlyNumbers(r)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/0x|tenant-/);
  });
});

describe('the tin pass reads the wallets it is given', () => {
  it('only those, in that order, and skips one no longer live', async () => {
    const a = await agent(A, [W1, W2, W3]);
    await store.softDeleteWallet(A, a.wallets[0].id, stored(10_000));
    const report = await watcher.runTinPass(A, a.tin, deps(), { walletIds: [a.wallets[2].id, a.wallets[0].id, a.wallets[1].id] });
    expect(report.wallets.map((w) => w.address)).toEqual([W3, W2]);
    expect(readOrder()).toEqual([W3, W2]);
  });
});

describe('the schema', () => {
  it('is keyed by tenant_id, one row per wallet, bookkeeping only', () => {
    const table = sync.AGENT_WALLET_READS_DDL[0];
    expect(table).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
    expect(table).toMatch(/PRIMARY KEY \(tenant_id, wallet_id\)/);
    const cols = [...table.matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]).filter((c) => c !== 'PRIMARY');
    expect(cols).toEqual(['tenant_id', 'tin_id', 'wallet_id', 'pass_day', 'read_at', 'status', 'recorded']);
  });
});
