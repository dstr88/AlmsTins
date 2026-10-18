import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';

/**
 * `transaction` events in the ledger: written once, named by what they are, read back with their
 * facts, and added up per tin. The database is the in-memory stand-in; every value is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

const A = 'tenant-a';
const B = 'tenant-b';
let fake: ReceivablesDbFake;
let events: typeof import('../../src/lib/agentVault/events');

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  events = await import('../../src/lib/agentVault/events');
});

const iso = (sec: number, ms = 0) => new Date(Date.UTC(2026, 9, 18, 12, 0, sec, ms)).toISOString();
const facts = (over: Record<string, unknown> = {}) => ({
  hash: txHash(1), direction: 'out' as const, wallet: addr(1), amount: '1.5', asset: 'ETH', assetContract: null, usd: 3000, blockNumber: 100, ...over,
});
const tx = (tenant: string, over: Record<string, unknown> = {}, facts_: Record<string, unknown> = {}) =>
  events.insertTransactionEvent(tenant, {
    tinId: 'tin-1', address: addr(2), chain: 'ethereum', leg: 'native:0', answer: 'unknown', status: null,
    tx: facts(facts_), detail: { source: 'txlist' }, at: iso(0), ...over,
  } as never);

describe('the id of a movement', () => {
  const id = (t = A, tin = 'tin-1', chain = 'ethereum', hash = txHash(1), leg = 'native:0') => events.transactionEventId(t, tin, chain, hash, leg);

  it('is the same for the same movement, every time', () => {
    expect(id()).toBe(id());
  });

  it('changes with each part of the movement, and with the account', () => {
    const base = id();
    for (const other of [id(B), id(A, 'tin-2'), id(A, 'tin-1', 'polygon'), id(A, 'tin-1', 'ethereum', txHash(2)), id(A, 'tin-1', 'ethereum', txHash(1), 'native:1')]) {
      expect(other).not.toBe(base);
    }
  });

  it('cannot be confused by parts that run together', () => {
    expect(events.transactionEventId('ab', 'c', 'ethereum', txHash(1), 'x')).not.toBe(events.transactionEventId('a', 'bc', 'ethereum', txHash(1), 'x'));
  });

  it('is shaped like a UUID, so it fits the ledger\'s cursor', () => {
    expect(id()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(events.parseCursor(`${iso(0)}|${id()}`)).toEqual({ at: iso(0), id: id() });
  });
});

describe('a movement is written once', () => {
  it('writes the event with all its facts, and says it did', async () => {
    const r = await tx(A);
    expect(r.inserted).toBe(true);
    expect(fake.rows('agent_events')).toEqual([expect.objectContaining({
      id: r.id, tenant_id: A, tin_id: 'tin-1', kind: 'transaction', address: addr(2), chain: 'ethereum',
      answer: 'unknown', registry: 'trusted', status: null, key_id: null, source_ip: null,
      tx_hash: txHash(1), direction: 'out', wallet: addr(1), amount: '1.5', asset: 'ETH', asset_contract: null, usd_value: 3000, block_number: 100,
      occurred_at: iso(0),
    })]);
    expect(JSON.parse(fake.rows('agent_events')[0].detail_json)).toEqual({ source: 'txlist', leg: 'native:0' });
  });

  it('reading the same movement again adds nothing and says so', async () => {
    const first = await tx(A);
    const again = await tx(A);
    expect(again).toEqual({ id: first.id, inserted: false });
    expect(fake.rows('agent_events')).toHaveLength(1);
  });

  it('a second movement in the same transaction, or in another, is its own event', async () => {
    await tx(A);
    await tx(A, { leg: 'native:1' });
    await tx(A, {}, { hash: txHash(2) });
    expect(fake.rows('agent_events')).toHaveLength(3);
  });

  it('the same movement on two accounts is two events: an id never crosses an account', async () => {
    const a = await tx(A);
    const b = await tx(B);
    expect(a.id).not.toBe(b.id);
    expect(a.inserted && b.inserted).toBe(true);
    expect(fake.rows('agent_events').map((r) => r.tenant_id).sort()).toEqual([A, B]);
  });

  it('has exactly one INSERT for the ledger, and it skips an id that exists', async () => {
    await tx(A);
    const inserts = fake.statements(/^INSERT INTO agent_events/i);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/ON CONFLICT \(id\) DO NOTHING$/);
  });

  it('a check that was not written is an error, not a quiet success', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', async (orig) => ({ ...(await orig<typeof import('node:crypto')>()), randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
    const fresh = await import('../../src/lib/agentVault/events');
    const input = { tinId: 'tin-1', address: addr(2), chain: null, answer: 'unknown' as const, registry: 'none' as const, status: 'unknown', keyId: 'k', sourceIp: null, detail: {}, at: iso(0) };
    await fresh.insertCheckedEvent(A, input);
    await expect(fresh.insertCheckedEvent(A, input)).rejects.toThrow(/not written/);
    expect(fake.rows('agent_events')).toHaveLength(1);
    vi.doUnmock('node:crypto');
  });
});

describe('reading transactions back', () => {
  it('lists a transaction with its facts and a check without them, newest first', async () => {
    await events.insertCheckedEvent(A, { tinId: 'tin-1', address: addr(2), chain: 'ethereum', answer: 'consistent-with-history', registry: 'trusted', status: 'unknown', keyId: 'k', sourceIp: null, detail: {}, at: iso(5) });
    await tx(A, { at: iso(9) }, { assetContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', asset: 'USDC', amount: '250', usd: 250 });
    const { events: page, next } = await events.listEvents(A, 'tin-1', { limit: 10 });
    expect(next).toBeNull();
    expect(page.map((e) => e.kind)).toEqual(['transaction', 'checked']);
    expect(page[0]).toMatchObject({
      address: addr(2), chain: 'ethereum', answer: 'unknown', registry: 'trusted', keyId: null,
      tx: { hash: txHash(1), direction: 'out', wallet: addr(1), amount: '250', asset: 'USDC', assetContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', usd: 250, blockNumber: 100 },
      detail: { source: 'txlist', leg: 'native:0' },
    });
    expect(page[1].tx).toBeNull();
  });

  it('an unpriced transfer reads back with usd null, never 0', async () => {
    await tx(A, {}, { usd: null });
    expect((await events.listEvents(A, 'tin-1', { limit: 1 })).events[0].tx?.usd).toBeNull();
  });
});

describe('the checks a transfer can inherit from', () => {
  const check = (tenant: string, over: Record<string, unknown> = {}) =>
    events.insertCheckedEvent(tenant, { tinId: 'tin-1', address: addr(2), chain: 'ethereum', answer: 'consistent-with-history', registry: 'trusted', status: 'unknown', keyId: 'k1', sourceIp: null, detail: {}, at: iso(10), ...over } as never);
  const range = { fromIso: iso(0), toIso: iso(20), limit: 10 };

  it('newest first, inside the range (ends included), for this tin and this address only', async () => {
    const early = await check(A, { at: iso(2) });
    const late = await check(A, { at: iso(18) });
    await check(A); // at iso(10)
    await check(A, { at: iso(0) });
    await check(A, { at: iso(20) });
    await check(A, { at: iso(-1) });          // before the range
    await check(A, { at: iso(21) });          // after it
    await check(A, { address: addr(3) });     // another address
    await check(A, { tinId: 'tin-2' });       // another tin
    await check(B);                           // another account
    const found = await events.listChecksForLink(A, 'tin-1', addr(2), range);
    expect(found.map((c) => c.at)).toEqual([iso(20), iso(18), iso(10), iso(2), iso(0)]);
    expect(found.find((c) => c.id === late.id)).toMatchObject({ answer: 'consistent-with-history', status: 'unknown', keyId: 'k1' });
    expect(found.some((c) => c.id === early.id)).toBe(true);
  });

  it('never returns a transaction event, only checks', async () => {
    await tx(A, { at: iso(10) });
    expect(await events.listChecksForLink(A, 'tin-1', addr(2), range)).toEqual([]);
  });

  it('stops at the limit, keeping the newest', async () => {
    for (const s of [1, 2, 3, 4]) await check(A, { at: iso(s) });
    const found = await events.listChecksForLink(A, 'tin-1', addr(2), { ...range, limit: 2 });
    expect(found.map((c) => c.at)).toEqual([iso(4), iso(3)]);
  });

  it('skips a stored check that has no recognizable answer: it cannot stamp anything', async () => {
    await check(A);
    fake.rows('agent_events')[0].answer = 'maybe';
    expect(await events.listChecksForLink(A, 'tin-1', addr(2), range)).toEqual([]);
  });

  it('a millisecond is kept: two checks in one second still order', async () => {
    await check(A, { at: iso(5, 100) });
    await check(A, { at: iso(5, 900) });
    const found = await events.listChecksForLink(A, 'tin-1', addr(2), range);
    expect(found.map((c) => c.at)).toEqual([iso(5, 900), iso(5, 100)]);
  });
});

describe('totals: raw value in and out, USD at the time, nothing netted', () => {
  it('an empty tin adds up to zero', async () => {
    expect(await events.sumTransactions(A, 'tin-1')).toEqual({
      transactions: 0,
      bought: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 },
      sold: { count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 },
    });
  });

  it('bought is value in, sold is value out, and an unpriced transfer is counted but never added as zero', async () => {
    await tx(A, { leg: 'a' }, { direction: 'in', usd: 100.25 });
    await tx(A, { leg: 'b' }, { direction: 'in', usd: 50 });
    await tx(A, { leg: 'c' }, { direction: 'in', usd: null });
    await tx(A, { leg: 'd' }, { direction: 'out', usd: 30.5 });
    await tx(A, { leg: 'e' }, { direction: 'out', usd: null });
    expect(await events.sumTransactions(A, 'tin-1')).toEqual({
      transactions: 5,
      bought: { count: 3, pricedCount: 2, unpricedCount: 1, usd: 150.25 },
      sold: { count: 2, pricedCount: 1, unpricedCount: 1, usd: 30.5 },
    });
  });

  it('adds cents exactly (0.1 + 0.2 is 0.3, not 0.30000000000000004)', async () => {
    await tx(A, { leg: 'a' }, { usd: 0.1 });
    await tx(A, { leg: 'b' }, { usd: 0.2 });
    expect((await events.sumTransactions(A, 'tin-1')).sold.usd).toBe(0.3);
  });

  it('counts only this tin\'s transactions on this account: not checks, not another tin, not another account', async () => {
    await tx(A, { leg: 'a' }, { usd: 10 });
    await tx(A, { tinId: 'tin-2', leg: 'a' }, { usd: 1000 });
    await tx(B, { leg: 'a' }, { usd: 1_000_000 });
    await events.insertCheckedEvent(A, { tinId: 'tin-1', address: addr(2), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', keyId: 'k', sourceIp: null, detail: {}, at: iso(1) });
    expect((await events.sumTransactions(A, 'tin-1')).sold).toEqual({ count: 1, pricedCount: 1, unpricedCount: 0, usd: 10 });
  });

  it('reads past one page of rows', async () => {
    await events.sumTransactions(A, 'tin-1'); // creates the table
    for (let i = 0; i < 2_300; i++) {
      fake.seed('agent_events', {
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, tenant_id: A, tin_id: 'tin-1', kind: 'transaction',
        direction: i % 2 ? 'in' : 'out', usd_value: i % 5 === 0 ? null : 2, occurred_at: iso(0, i % 1000),
      });
    }
    const totals = await events.sumTransactions(A, 'tin-1');
    expect(totals.transactions).toBe(2_300);
    expect(totals.bought.count + totals.sold.count).toBe(2_300);
    expect(totals.bought.pricedCount + totals.sold.pricedCount).toBe(2_300 - 460);
    expect(totals.bought.usd + totals.sold.usd).toBe((2_300 - 460) * 2);
  });
});
