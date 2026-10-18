import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

/**
 * Every paid product (the tracker today; Agentics, Receivables and PetroTins later) is billed
 * on its own, with its own entitlement table, but all of them are sold from one Stripe account
 * and so reach one webhook endpoint. The tracker keeps one subscriptions row per tenant, and its
 * plan decides every paid feature. These pin that the Almstins webhook and checkout
 * (src/pages/api/billing/) act only on Almstins plans, so another product's subscription can
 * never overwrite or cancel a tracker customer's plan:
 *   - a subscription is Almstins's only if its first price is a known Almstins price and nothing
 *     tags it as another product; one from before checkout tagged carries no tag and still counts;
 *   - anything else, in any handler (the lookup by customer and the cancel included), writes
 *     nothing, sends no email, logs one line and answers 200, so Stripe does not retry it;
 *   - a deleted account's checkout is canceled whatever the product, before the product matters;
 *   - checkout refuses a price that is not an Almstins plan, and tags what it creates;
 *   - known prices do what they always did.
 *
 * No database, no network, no secrets: '@/lib/db' records every statement, '@/lib/stripe' hands
 * the handlers the event under test, and the mail transport is a stub. Every id, price and
 * address here is invented.
 */

const A = 'tenant-a';
const OWNER = 'owner@example.test';
const BUYER = 'buyer@example.test';

const wh = vi.hoisted(() => ({
  event: null as unknown,
  liveTenants: new Set<string>(),
  sql: [] as Array<{ sql: string; args: unknown[] }>,
  subs: {} as Record<string, { id: string; status: string }>,
  retrieved: null as unknown,
  /** The Stripe customer the tenant's row already names, as checkout reads it. */
  customer: null as string | null,
  /** The signed-in tenant, as checkout reads it. */
  signedIn: null as string | null,
  /**
   * PRICE_TO_PLAN built the way src/lib/stripe.ts builds it from env vars, in a build where two
   * of them were unset (they collapse into the key "undefined") and one was empty (the key "").
   */
  prices: {
    price_test_starter: 'starter',
    price_test_pro: 'pro',
    undefined: 'unlimited',
    '': 'starter',
  } as Record<string, string>,
}));

const stripeMock = vi.hoisted(() => ({
  constructEventAsync: vi.fn(async () => wh.event),
  retrieve: vi.fn(async (id: string) => wh.retrieved ?? { ...wh.subs[id] }),
  cancel: vi.fn(async (id: string, _params?: unknown) => {
    wh.subs[id] = { id, status: 'canceled' };
    return wh.subs[id];
  }),
  createSession: vi.fn(async (_params: Record<string, any>) => ({ url: 'https://checkout.test/session' })),
}));

const mail = vi.hoisted(() => ({
  sendMail: vi.fn(async (_message: { to: string; subject: string }) => ({})),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEventAsync: stripeMock.constructEventAsync },
    subscriptions: { retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
    checkout: { sessions: { create: stripeMock.createSession } },
  },
  PRICE_TO_PLAN: wh.prices,
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
      // Checkout: the owner's email, and the Stripe customer the tenant already has.
      if (sql.startsWith('SELECT au.email, au.id as user_id FROM tenant_memberships tm')) {
        return { rows: [{ email: BUYER, user_id: 'user-a' }], rowsAffected: 0 };
      }
      if (sql === 'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ? LIMIT 1') {
        return { rows: wh.customer ? [{ stripe_customer_id: wh.customer }] : [], rowsAffected: 0 };
      }
      // No row exists to change in this stub: a write is recorded and changes nothing.
      if (/^(UPDATE|INSERT) /.test(sql)) return { rows: [], rowsAffected: 0 };
      throw new Error(`unexpected statement: ${sql}`);
    },
  },
}));

vi.mock('@/lib/requireTenantSession', () => ({
  requireTenantSession: async () => (wh.signedIn ? { tenantId: wh.signedIn } : null),
}));
vi.mock('@/lib/i18n/userLang', () => ({ getTenantLang: async () => 'en' }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }));

import { POST as webhook } from '../../src/pages/api/billing/webhook';
import { POST as checkout } from '../../src/pages/api/billing/checkout';

const send = async (event: unknown): Promise<Response> => {
  wh.event = event;
  return webhook({
    request: new Request('https://app.test/api/billing/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=signature-under-test' },
      body: JSON.stringify(event),
    }),
  } as unknown as Parameters<typeof webhook>[0]);
};

const startCheckout = async (body: unknown): Promise<Response> =>
  checkout({
    request: new Request('https://app.test/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof checkout>[0]);

const PERIOD_END = 1767225600; // 2026-01-01T00:00:00Z
const PERIOD_END_ISO = '2026-01-01T00:00:00.000Z';

/** What an event says about its subscription: the first price (undefined: no item at all) and the product tag. */
type Spec = { price: string | undefined; product?: unknown };

const KNOWN: Spec = { price: 'price_test_pro' };

const subscription = ({ price, product }: Spec, byCustomer = false) => ({
  id: 'sub_a',
  object: 'subscription',
  status: 'active',
  customer: 'cus_a',
  cancel_at_period_end: false,
  metadata: { ...(byCustomer ? {} : { tenant_id: A }), ...(product === undefined ? {} : { product }) },
  items: { data: price === undefined ? [] : [{ price: { id: price }, current_period_end: PERIOD_END }] },
});

/** A checkout.session.completed for a live account whose new subscription is `sub`. */
const checkoutCompleted = (sub: unknown, session: Record<string, unknown> = {}) => {
  wh.liveTenants.add(A);
  wh.retrieved = sub;
  return send({
    type: 'checkout.session.completed',
    data: {
      object: {
        mode: 'subscription',
        subscription: 'sub_a',
        metadata: { tenant_id: A },
        customer_details: { email: BUYER },
        amount_total: 2000,
        ...session,
      },
    },
  });
};

const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
const log = vi.spyOn(console, 'log').mockImplementation(() => {});
const error = vi.spyOn(console, 'error').mockImplementation(() => {});
const writes = () => wh.sql.filter((c) => /^(UPDATE|INSERT) /.test(c.sql));
const warned = () => warn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'configured-for-tests');
  vi.stubEnv('EMAIL_SERVER', 'smtp://mail.test');
  vi.stubEnv('EMAIL_FROM', 'Almstins <no-reply@mail.test>');
  vi.stubEnv('OWNER_ALERT_EMAIL', OWNER);
  wh.event = null;
  wh.liveTenants = new Set();
  wh.sql = [];
  wh.subs = {};
  wh.retrieved = null;
  wh.customer = null;
  wh.signedIn = A;
  for (const fn of [...Object.values(stripeMock), mail.sendMail, warn, log, error]) fn.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const spy of [warn, log, error]) spy.mockRestore();
});

interface Delivery {
  label: string;
  type: string;
  /** What the log line names: the tenant when the metadata carries it, else the customer. */
  who: string;
  deliver: (spec: Spec) => Promise<Response>;
  /** The one statement a subscription of ours makes, for the plan its price maps to. */
  write: (plan: string, price: string) => { sql: RegExp; args: unknown[] };
}

const UPDATE_SQL = (where: string) =>
  new RegExp(`^UPDATE subscriptions SET plan_id = \\?, status = \\?, .* WHERE ${where} = \\?$`);
const DELETE_SQL = (where: string) =>
  new RegExp(`^UPDATE subscriptions SET plan_id = 'free', status = 'canceled', .* WHERE ${where} = \\?$`);

const DELIVERIES: Delivery[] = [
  {
    label: 'checkout.session.completed',
    type: 'checkout.session.completed',
    who: `tenant ${A}`,
    deliver: (spec) => checkoutCompleted(subscription(spec)),
    write: (plan, price) => ({
      sql: /^INSERT INTO subscriptions /,
      args: [A, plan, 'active', 'cus_a', 'sub_a', price, PERIOD_END_ISO, 0],
    }),
  },
  {
    label: 'customer.subscription.updated, tenant in the metadata',
    type: 'customer.subscription.updated',
    who: `tenant ${A}`,
    deliver: (spec) => send({ type: 'customer.subscription.updated', data: { object: subscription(spec) } }),
    write: (plan, price) => ({ sql: UPDATE_SQL('tenant_id'), args: [plan, 'active', price, PERIOD_END_ISO, 0, A] }),
  },
  {
    label: 'customer.subscription.updated, found by customer',
    type: 'customer.subscription.updated',
    who: 'customer cus_a',
    deliver: (spec) => send({ type: 'customer.subscription.updated', data: { object: subscription(spec, true) } }),
    write: (plan, price) => ({
      sql: UPDATE_SQL('stripe_customer_id'),
      args: [plan, 'active', price, PERIOD_END_ISO, 0, 'cus_a'],
    }),
  },
  {
    label: 'customer.subscription.deleted, tenant in the metadata',
    type: 'customer.subscription.deleted',
    who: `tenant ${A}`,
    deliver: (spec) => send({ type: 'customer.subscription.deleted', data: { object: subscription(spec) } }),
    write: () => ({ sql: DELETE_SQL('tenant_id'), args: [A] }),
  },
  {
    label: 'customer.subscription.deleted, found by customer',
    type: 'customer.subscription.deleted',
    who: 'customer cus_a',
    deliver: (spec) => send({ type: 'customer.subscription.deleted', data: { object: subscription(spec, true) } }),
    write: () => ({ sql: DELETE_SQL('stripe_customer_id'), args: ['cus_a'] }),
  },
];

/** Prices that are not Almstins plans, though a plain lookup or a loose check would take them for one. */
const NOT_PLANS: Array<[string, string | undefined]> = [
  ['a price of another product', 'price_test_other'],
  ['the inherited key constructor', 'constructor'],
  ['the inherited key __proto__', '__proto__'],
  ['the inherited key toString', 'toString'],
  ['the inherited key hasOwnProperty', 'hasOwnProperty'],
  ['the key "undefined" an unset env var leaves in the map', 'undefined'],
  ['an empty price id, the key an empty env var leaves in the map', ''],
  ['no price at all (a subscription without items)', undefined],
];

describe.each(DELIVERIES)('$label', (d) => {
  const expectIgnored = async (res: Response, price: string | undefined) => {
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(writes()).toEqual([]);
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(stripeMock.cancel).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // One line, naming the event, who and the price, and nothing personal.
    expect(warned()).toHaveLength(1);
    const line = warned()[0];
    expect(line).toContain(d.type);
    expect(line).toContain(d.who);
    expect(line).toContain(`price ${price || 'none'}`);
    expect(line).not.toContain('@');
    expect(line).not.toContain(BUYER);
  };

  it("ignores a price that is not an Almstins plan: no write, no email, 200, one log line", async () => {
    const spec: Spec = { price: 'price_test_other' };
    await expectIgnored(await d.deliver(spec), spec.price);
  });

  it.each(NOT_PLANS)('does not take %s for a plan', async (_what, price) => {
    await expectIgnored(await d.deliver({ price }), price);
  });

  it.each(['agentics', 'Almstins'])("ignores a subscription tagged product %j, even on a known Almstins price", async (product) => {
    await expectIgnored(await d.deliver({ ...KNOWN, product }), KNOWN.price);
  });

  it.each([
    ['price_test_pro', 'pro'],
    ['price_test_starter', 'starter'],
  ])('still acts on the known price %s, as it always did', async (price, plan) => {
    const res = await d.deliver({ price });
    const want = d.write(plan, price);
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].sql).toMatch(want.sql);
    expect(writes()[0].args).toEqual(want.args);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("still acts on a known price on a subscription tagged Almstins", async () => {
    const res = await d.deliver({ ...KNOWN, product: 'almstins' });
    const want = d.write('pro', 'price_test_pro');
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].sql).toMatch(want.sql);
    expect(writes()[0].args).toEqual(want.args);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('checkout.session.completed', () => {
  it('ignores a checkout whose session is tagged as another product, though its subscription carries no tag', async () => {
    const res = await checkoutCompleted(subscription(KNOWN), { metadata: { tenant_id: A, product: 'agentics' } });
    expect(res.status).toBe(200);
    expect(writes()).toEqual([]);
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toContain('checkout.session.completed');
  });

  it('ignores a checkout whose subscription is tagged as another product, though its session carries no tag', async () => {
    const res = await checkoutCompleted(subscription({ ...KNOWN, product: 'agentics' }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([]);
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(warned()).toHaveLength(1);
  });

  it.each([
    ['both tagged Almstins', { metadata: { tenant_id: A, product: 'almstins' } }, 'almstins'],
    ['only the session tagged Almstins', { metadata: { tenant_id: A, product: 'almstins' } }, undefined],
    ['only the subscription tagged Almstins', {}, 'almstins'],
    ['neither tagged, a checkout from before the tag', {}, undefined],
  ])('stores the plan when %s', async (_what, session, product) => {
    const res = await checkoutCompleted(subscription({ ...KNOWN, product }), session);
    expect(res.status).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].args).toEqual([A, 'pro', 'active', 'cus_a', 'sub_a', 'price_test_pro', PERIOD_END_ISO, 0]);
  });

  it('still sends the owner and the buyer their emails for a known price', async () => {
    const res = await checkoutCompleted(subscription(KNOWN));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mail.sendMail).toHaveBeenCalledTimes(2));
    expect(mail.sendMail.mock.calls.map((c) => c[0].to).sort()).toEqual([BUYER, OWNER].sort());
    expect(error).not.toHaveBeenCalled();
  });

  it('sends no email for another product\'s checkout, though it has a buyer address', async () => {
    const res = await checkoutCompleted(subscription({ price: 'price_test_other' }));
    expect(res.status).toBe(200);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['tagged as another product', { tenant_id: A, product: 'agentics' }],
    ['tagged Almstins', { tenant_id: A, product: 'almstins' }],
    ['carrying no tag', { tenant_id: A }],
  ])('cancels a checkout for a deleted account %s, and stores nothing', async (_what, metadata) => {
    wh.subs.sub_late = { id: 'sub_late', status: 'active' };
    // What the subscription is does not matter here, and must not even be asked.
    wh.retrieved = subscription({ price: 'price_test_other' });

    const res = await send({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_late', metadata, amount_total: 1900 } },
    });
    expect(res.status).toBe(200);
    expect(stripeMock.cancel).toHaveBeenCalledWith('sub_late', expect.anything());
    expect(wh.subs.sub_late.status).toBe('canceled');
    expect(stripeMock.retrieve).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(wh.sql.map((c) => c.sql)).toEqual(['SELECT 1 AS ok FROM tenant_memberships WHERE tenant_id = ? LIMIT 1']);
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toContain('deleted tenant');
    // The first payment was taken whatever the product, so the owner is told to refund it.
    await vi.waitFor(() => expect(mail.sendMail).toHaveBeenCalledTimes(1));
    expect(mail.sendMail.mock.calls[0][0].to).toBe(OWNER);
  });

  it.each([
    ['a one-time payment', { mode: 'payment', metadata: { tenant_id: A } }],
    ['a session with no tenant', { metadata: {} }],
  ])('leaves %s alone, without a single call to Stripe or the database', async (_what, session) => {
    wh.liveTenants.add(A);
    const res = await send({
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', subscription: 'sub_a', ...session } },
    });
    expect(res.status).toBe(200);
    expect(stripeMock.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.cancel).not.toHaveBeenCalled();
    expect(wh.sql).toEqual([]);
    expect(mail.sendMail).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/checkout', () => {
  it.each([
    ['a price of another product', 'price_test_other'],
    ['the inherited key constructor', 'constructor'],
    ['the inherited key __proto__', '__proto__'],
    ['the inherited key toString', 'toString'],
    ['the inherited key hasOwnProperty', 'hasOwnProperty'],
    ['the key "undefined" an unset env var leaves in the map', 'undefined'],
  ])('refuses %s with 400, before any call to Stripe', async (_what, priceId) => {
    const res = await startCheckout({ priceId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: true, message: expect.any(String) });
    expect(stripeMock.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', 42],
    ['an array that prints as a known price', ['price_test_pro']],
    ['an empty string', ''],
    ['nothing', undefined],
  ])('refuses %s as the price with 400, before any call to Stripe', async (_what, priceId) => {
    const res = await startCheckout({ priceId });
    expect(res.status).toBe(400);
    expect(stripeMock.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['price_test_pro'],
    ['price_test_starter'],
  ])('creates a session for the known price %s, tagging the session and the subscription as Almstins', async (price) => {
    const res = await startCheckout({ priceId: price });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.test/session' });

    expect(stripeMock.createSession).toHaveBeenCalledTimes(1);
    const params = stripeMock.createSession.mock.calls[0][0];
    expect(params.mode).toBe('subscription');
    expect(params.line_items).toEqual([{ price, quantity: 1 }]);
    expect(params.metadata).toEqual({ tenant_id: A, product: 'almstins' });
    expect(params.subscription_data.metadata).toEqual({ tenant_id: A, product: 'almstins' });
    // Pre-fills the owner's email for a tenant with no Stripe customer yet.
    expect(params.customer).toBeUndefined();
    expect(params.customer_email).toBe(BUYER);
  });

  it('reuses the tenant\'s Stripe customer, as it always did', async () => {
    wh.customer = 'cus_a';
    const res = await startCheckout({ priceId: 'price_test_pro' });
    expect(res.status).toBe(200);
    const params = stripeMock.createSession.mock.calls[0][0];
    expect(params.customer).toBe('cus_a');
    expect(params.customer_email).toBeUndefined();
  });

  it('still answers 401 to a visitor who is not signed in, without a call to Stripe', async () => {
    wh.signedIn = null;
    const res = await startCheckout({ priceId: 'price_test_pro' });
    expect(res.status).toBe(401);
    expect(stripeMock.createSession).not.toHaveBeenCalled();
  });
});
