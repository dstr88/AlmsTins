import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Account deletion cancels the tenant's Stripe subscriptions, then deletes its subscriptions
 * row (src/pages/api/account/delete.ts). Stripe then sends the cancel events. These pin that
 * the billing webhook (src/pages/api/billing/webhook.ts) never brings the row back:
 *   - update and cancel events only UPDATE, so for a deleted account they write nothing;
 *   - a checkout that completes after its account was deleted cancels the new subscription
 *     and stores nothing (and a failed cancel answers 500, so Stripe redelivers);
 *   - a checkout for a live account stores its Stripe ids and period end, which on the API
 *     version the client pins comes from the subscription item.
 *
 * No database, no network, no secrets: '@/lib/db' records every statement, '@/lib/stripe'
 * hands the handler the event under test.
 */

const A = 'tenant-a';

const wh = vi.hoisted(() => ({
  event: null as unknown,
  liveTenants: new Set<string>(),
  sql: [] as Array<{ sql: string; args: unknown[] }>,
  subs: {} as Record<string, { id: string; status: string }>,
  retrieved: null as unknown,
  cancelFails: null as Error | null,
}));

const stripeMock = vi.hoisted(() => ({
  constructEventAsync: vi.fn(async () => wh.event),
  retrieve: vi.fn(async (id: string) => wh.retrieved ?? { ...wh.subs[id] }),
  cancel: vi.fn(async (id: string, _params?: unknown) => {
    if (wh.cancelFails) throw wh.cancelFails;
    wh.subs[id] = { id, status: 'canceled' };
    return wh.subs[id];
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEventAsync: stripeMock.constructEventAsync },
    subscriptions: { retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
  },
  PRICE_TO_PLAN: { price_pro: 'pro' },
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      const sql = stmt.sql.replace(/\s+/g, ' ').trim();
      const args = stmt.args ?? [];
      wh.sql.push({ sql, args });
      if (sql === 'SELECT 1 AS ok FROM tenant_memberships WHERE tenant_id = ? LIMIT 1') {
        return { rows: wh.liveTenants.has(String(args[0])) ? [{ ok: 1 }] : [], rowsAffected: 0 };
      }
      // No row exists for a deleted tenant: an UPDATE changes nothing.
      if (/^(UPDATE|INSERT) /.test(sql)) return { rows: [], rowsAffected: 0 };
      throw new Error(`unexpected statement: ${sql}`);
    },
  },
}));

import { POST } from '../../src/pages/api/billing/webhook';

const send = (event: unknown) => {
  wh.event = event;
  return POST({
    request: new Request('https://app.test/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=signature-under-test' },
      body: JSON.stringify(event),
    }),
  } as unknown as Parameters<typeof POST>[0]);
};

const PERIOD_END = 1767225600; // 2026-01-01T00:00:00Z
const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_a',
  object: 'subscription',
  status: 'canceled',
  customer: 'cus_a',
  cancel_at_period_end: false,
  metadata: { tenant_id: A },
  items: { data: [{ price: { id: 'price_pro' }, current_period_end: PERIOD_END }] },
  ...over,
});
const inserts = () => wh.sql.filter((c) => c.sql.startsWith('INSERT'));
let quiet: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'configured-for-tests');
  vi.stubEnv('EMAIL_SERVER', '');
  wh.event = null;
  wh.liveTenants = new Set();
  wh.sql = [];
  wh.subs = {};
  wh.retrieved = null;
  wh.cancelFails = null;
  for (const fn of Object.values(stripeMock)) fn.mockClear();
  // The handlers log every event; the warnings and errors under test are asserted instead.
  quiet = [vi.spyOn(console, 'log').mockImplementation(() => {})];
});

afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
});

describe('billing webhook after an account is deleted', () => {
  it.each([
    ['with the tenant in its metadata', subscription()],
    ['found by customer only', subscription({ metadata: {} })],
  ])('a customer.subscription.deleted event %s writes no row', async (_label, sub) => {
    const res = await send({ type: 'customer.subscription.deleted', data: { object: sub } });
    expect(res.status).toBe(200);
    expect(wh.sql.length).toBeGreaterThan(0);
    for (const c of wh.sql) expect(c.sql).toMatch(/^UPDATE subscriptions SET /);
    expect(inserts()).toEqual([]);
  });

  it.each([
    ['with the tenant in its metadata', subscription({ status: 'active', cancel_at_period_end: true })],
    ['found by customer only', subscription({ status: 'active', metadata: {} })],
  ])('a customer.subscription.updated event %s writes no row', async (_label, sub) => {
    const res = await send({ type: 'customer.subscription.updated', data: { object: sub } });
    expect(res.status).toBe(200);
    for (const c of wh.sql) expect(c.sql).toMatch(/^UPDATE subscriptions SET /);
    expect(inserts()).toEqual([]);
  });

  it('cancels a checkout that completes after its account was deleted, and stores nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wh.subs.sub_late = { id: 'sub_late', status: 'active' };

    const res = await send({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_late', metadata: { tenant_id: A }, amount_total: 1900 } },
    });
    expect(res.status).toBe(200);
    expect(stripeMock.cancel).toHaveBeenCalledWith('sub_late', expect.anything());
    expect(wh.subs.sub_late.status).toBe('canceled');
    expect(inserts()).toEqual([]);
    expect(wh.sql.map((c) => c.sql)).toEqual(['SELECT 1 AS ok FROM tenant_memberships WHERE tenant_id = ? LIMIT 1']);
    warn.mockRestore();
  });

  it('answers 500 when that cancel fails, so Stripe redelivers the event', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    wh.subs.sub_late = { id: 'sub_late', status: 'active' };
    wh.cancelFails = new Error('Stripe API error');

    const res = await send({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_late', metadata: { tenant_id: A } } },
    });
    expect(res.status).toBe(500);
    expect(inserts()).toEqual([]);
    err.mockRestore();
  });

  it('stores a live account\'s Stripe ids and period end, read from the item on this API version', async () => {
    wh.liveTenants.add(A);
    wh.retrieved = subscription({ status: 'active' }); // no current_period_end on the subscription

    const res = await send({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_a', metadata: { tenant_id: A } } },
    });
    expect(res.status).toBe(200);
    expect(stripeMock.cancel).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].args).toEqual([A, 'pro', 'active', 'cus_a', 'sub_a', 'price_pro', '2026-01-01T00:00:00.000Z', 0]);
  });
});
