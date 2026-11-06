import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';

/**
 * Daily prices (src/lib/agentVault/dailyPrices.ts): a transfer is written the moment the chain shows
 * it, with a pending mark when its day's price is not in yet, and its USD value comes from one row per
 * coin and day, laid over the events when they are read. Bots make many tiny payments, so the rule
 * that matters is one lookup per coin and day, never one per transfer. The database is the in-memory
 * fake and the price lookup is a stub: no network.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

const A = 'tenant-a';
const B = 'tenant-b';
const DAY = '2026-10-18';
const NOON = Date.parse(`${DAY}T12:00:00.000Z`);
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

let fake: ReceivablesDbFake;
let dp: typeof import('../../src/lib/agentVault/dailyPrices');
let events: typeof import('../../src/lib/agentVault/events');
let asked: string[];
let table: Record<string, number | null>;
const pricing = { unitPriceUsd: async (coin: string, day: string) => { asked.push(`${coin}|${day}`); return table[`${coin}|${day}`] ?? null; } };

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  asked = [];
  table = {};
  dp = await import('../../src/lib/agentVault/dailyPrices');
  events = await import('../../src/lib/agentVault/events');
});

let seq = 0;
/** One transfer of `amount` ETH, written pending for `day` (or with a USD value already). */
async function transfer(tenant: string, tinId: string, amount: string, opts: { day?: string; coin?: string; usd?: number | null; atIso?: string } = {}) {
  seq += 1;
  const day = opts.day ?? DAY;
  const usd = opts.usd ?? null;
  return events.insertTransactionEvent(tenant, {
    tinId, address: addr(20 + (seq % 50)), chain: 'ethereum', registry: 'trusted', leg: `native:${seq}`, answer: 'unknown', status: null,
    tx: { hash: `0x${seq.toString(16).padStart(64, '0')}`, direction: 'out', wallet: addr(1), amount, asset: 'ETH', assetContract: null, usd, blockNumber: seq },
    detail: { price: usd === null ? { basis: null, pending: true, coinId: opts.coin ?? 'ethereum', day } : { basis: 'daily_price', day } },
    at: opts.atIso ?? `${day}T08:${String(seq % 60).padStart(2, '0')}:00.000Z`,
  });
}

const read = async (tenant = A, tinId = 'tin-1') => (await events.listEvents(tenant, tinId, { limit: 500 })).events;

describe('the fill', () => {
  it('never asks for a day\'s price before 12:00 UTC of that day', async () => {
    await transfer(A, 'tin-1', '0.0001');
    table = { [`ethereum|${DAY}`]: 2500 };
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON - 60_000)).toEqual({ priced: 0, none: 0, waiting: 1 });
    expect(asked).toEqual([]);
    expect(fake.rows('agent_daily_prices') ?? []).toEqual([]);
  });

  it('asks once per coin and day, however many transfers share it, and writes one row', async () => {
    for (let i = 0; i < 40; i += 1) await transfer(A, 'tin-1', `0.000${(i % 9) + 1}`);
    table = { [`ethereum|${DAY}`]: 2500 };
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + HOUR)).toEqual({ priced: 1, none: 0, waiting: 0 });
    expect(asked).toEqual([`ethereum|${DAY}`]);
    expect(fake.rows('agent_daily_prices')).toEqual([expect.objectContaining({ coin_id: 'ethereum', day: DAY, status: 'priced', unit_usd: 2500 })]);
    // A later fill finds the row and asks for nothing.
    asked = [];
    await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + 2 * HOUR);
    expect(asked).toEqual([]);
  });

  it('a price that does not come back is asked for again, and after a week the day is written as having none', async () => {
    await transfer(A, 'tin-1', '1');
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + HOUR)).toEqual({ priced: 0, none: 0, waiting: 1 });
    expect(fake.rows('agent_daily_prices') ?? []).toEqual([]);
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + WEEK + HOUR)).toEqual({ priced: 0, none: 1, waiting: 0 });
    expect(fake.rows('agent_daily_prices')).toEqual([expect.objectContaining({ coin_id: 'ethereum', day: DAY, status: 'none', unit_usd: null })]);
  });

  it('a row once written is kept: a second price for the same coin and day changes nothing', async () => {
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 2500 });
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 9999 });
    await dp.writeDailyPrice('ethereum', DAY, { status: 'none' });
    expect(fake.rows('agent_daily_prices')).toEqual([expect.objectContaining({ status: 'priced', unit_usd: 2500 })]);
  });

  it('reads only the account and tin it was given', async () => {
    await transfer(B, 'tin-9', '1');
    table = { [`ethereum|${DAY}`]: 2500 };
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + HOUR)).toEqual({ priced: 0, none: 0, waiting: 0 });
    expect(asked).toEqual([]);
  });

  it('skips transfers already valued and marks it cannot trust', async () => {
    await transfer(A, 'tin-1', '1', { usd: 2500 });
    await transfer(A, 'tin-1', '1', { coin: 'Not An Id' });
    await transfer(A, 'tin-1', '1', { day: '18/10/2026', atIso: `${DAY}T08:00:00.000Z` });
    expect(await dp.fillPendingPrices(A, 'tin-1', pricing, NOON + HOUR)).toEqual({ priced: 0, none: 0, waiting: 0 });
    expect(asked).toEqual([]);
  });
});

describe('the value on read', () => {
  it('is the exact amount times the day\'s price, for every transfer of that coin and day', async () => {
    await transfer(A, 'tin-1', '0.0001');
    await transfer(A, 'tin-1', '1.5');
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 2000 });
    const usd = (await read()).map((e) => e.tx?.usd).sort((a, b) => Number(a) - Number(b));
    expect(usd[0]).toBeCloseTo(0.2, 10);
    expect(usd[1]).toBe(3000);
    for (const e of await read()) expect(e.detail?.price).toEqual({ basis: 'daily_price', day: DAY, unitUsd: 2000, filledLater: true });
  });

  it('leaves the ledger row exactly as it was written: the value is worked out when read', async () => {
    await transfer(A, 'tin-1', '1.5');
    const before = JSON.stringify(fake.rows('agent_events'));
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 2000 });
    await read();
    expect(JSON.stringify(fake.rows('agent_events'))).toBe(before);
  });

  it('stays pending while the day has no row, and says no value once the day has none for good', async () => {
    await transfer(A, 'tin-1', '1');
    expect((await read())[0]).toMatchObject({ tx: { usd: null }, detail: { price: { pending: true, coinId: 'ethereum', day: DAY } } });
    await dp.writeDailyPrice('ethereum', DAY, { status: 'none' });
    expect((await read())[0]).toMatchObject({ tx: { usd: null }, detail: { price: { basis: null, reason: 'no_price' } } });
  });

  it('a price table that cannot be read leaves the events pending, never wrong, and logs no detail', async () => {
    await transfer(A, 'tin-1', '1');
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 2000 });
    const real = fake.execute.bind(fake);
    holder.db = { ...fake, batch: fake.batch.bind(fake), execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      if (/FROM agent_daily_prices/i.test(sql)) throw Object.assign(new Error('secret detail'), { name: 'DatabaseError', code: '57P01' });
      return real(s);
    } };
    expect((await read())[0]).toMatchObject({ tx: { usd: null }, detail: { price: { pending: true } } });
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('secret detail');
  });

  it('counts in the totals once filled', async () => {
    await transfer(A, 'tin-1', '1.5');
    await transfer(A, 'tin-1', '0.5');
    const before = await events.sumTransactions(A, 'tin-1');
    await dp.writeDailyPrice('ethereum', DAY, { status: 'priced', unitUsd: 2000 });
    const after = await events.sumTransactions(A, 'tin-1');
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    expect(JSON.stringify(after)).toContain('4000');
  });
});
