import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * POST /api/account/delete deleted the tenant's subscriptions row but never told Stripe, so
 * a paying owner who deleted their account kept being billed. These pin the fix
 * (src/lib/accountDeleteBilling.ts, run first by the endpoint):
 *   - the tenant's subscriptions are canceled at Stripe, by id, before anything is deleted;
 *   - every live one is found: the row's subscription, older ones on the row's customer (a
 *     plan switch opens a new subscription), and ones only Stripe's metadata search knows
 *     (the webhook never stored them); ended ones and other tenants' are left alone;
 *   - if a cancel or a Stripe lookup fails, nothing is deleted and the dialog gets a code
 *     it can show, so the owner can retry or contact support;
 *   - a tenant with no subscription is deleted as before.
 *
 * No database and no network: '@/lib/db' answers the statements this path runs and records
 * every one; '@/lib/stripe' is an in-memory Stripe account; the Verify delete is a stub
 * (tests/account/deleteAccount.test.ts covers it).
 */

type Sub = { id: string; status: string; customer: string; metadata: Record<string, string> };

const A = 'tenant-a';
const B = 'tenant-b';
const USER_A = 'user-a';

const st = vi.hoisted(() => ({
  /** subscriptions rows */
  rows: [] as Array<Record<string, unknown>>,
  readFails: null as Error | null,
  sql: [] as Array<{ sql: string; args: unknown[] }>,
  /** One timeline of SQL, Stripe cancels and the Verify delete, to check the order. */
  order: [] as string[],
}));

const fake = vi.hoisted(() => {
  const subs: Record<string, Sub> = {};
  const failing = { cancel: null as Error | null, lookup: null as Error | null };
  const iterate = <T>(items: () => T[]) => ({
    async *[Symbol.asyncIterator]() {
      if (failing.lookup) throw failing.lookup;
      yield* items();
    },
  });
  const notFound = (id: string) => Object.assign(new Error(`No such subscription: '${id}'`), { code: 'resource_missing' });
  return {
    subs,
    failing,
    // Stripe's default list leaves out canceled subscriptions.
    list: vi.fn((p: { customer: string }) =>
      iterate(() => Object.values(subs).filter((s) => s.customer === p.customer && s.status !== 'canceled'))),
    search: vi.fn((p: { query: string }) => {
      const tenant = p.query.match(/^metadata\['tenant_id'\]:'(.*)'$/)?.[1];
      return iterate(() => Object.values(subs).filter((s) => tenant !== undefined && s.metadata.tenant_id === tenant));
    }),
    retrieve: vi.fn(async (id: string) => {
      if (!subs[id]) throw notFound(id);
      return { ...subs[id] };
    }),
    cancel: vi.fn(async (id: string, _params?: unknown) => {
      st.order.push(`stripe:cancel:${id}`);
      if (failing.cancel) throw failing.cancel;
      if (!subs[id]) throw notFound(id);
      subs[id].status = 'canceled';
      return { ...subs[id] };
    }),
  };
});

vi.mock('@/lib/stripe', () => ({
  stripe: { subscriptions: { list: fake.list, search: fake.search, retrieve: fake.retrieve, cancel: fake.cancel } },
  PRICE_TO_PLAN: {},
}));

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const SUBS_READ = 'SELECT stripe_customer_id, stripe_subscription_id FROM subscriptions WHERE tenant_id = ?';

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      const sql = oneLine(stmt.sql);
      const args = stmt.args ?? [];
      st.sql.push({ sql, args });
      st.order.push(`sql:${sql}`);
      if (sql === SUBS_READ) {
        if (st.readFails) throw st.readFails;
        return { rows: st.rows.filter((r) => r.tenant_id === args[0]), rowsAffected: 0 };
      }
      if (sql.startsWith('SELECT tenant_id FROM tenant_memberships WHERE user_id = ?')) {
        return { rows: args[0] === USER_A ? [{ tenant_id: A }] : [], rowsAffected: 0 };
      }
      if (/^(DELETE|UPDATE) /.test(sql)) return { rows: [], rowsAffected: 0 };
      throw new Error(`unexpected statement: ${sql}`);
    },
    batch: async () => [],
  },
}));

const verify = vi.hoisted(() => ({
  deleteVerifyAccountData: vi.fn(async () => {
    st.order.push('verify');
    return { affected: {} };
  }),
}));
vi.mock('@/lib/verifyAccountDelete', () => verify);

const auth = vi.hoisted(() => ({ getAuthSession: vi.fn() }));
vi.mock('@/lib/authSession', () => auth);

const gate = vi.hoisted(() => ({ invalidateUserAuthFacts: vi.fn() }));
vi.mock('@/lib/sessionGate', () => gate);

import { POST } from '../../src/pages/api/account/delete';
import { cancelTenantStripeSubscriptions } from '../../src/lib/accountDeleteBilling';

type Ctx = Parameters<typeof POST>[0];
const clearedCookies: string[] = [];
const callPost = () => POST({
  request: new Request('https://app.test/api/account/delete', { method: 'POST' }),
  cookies: { delete: (name: string) => { clearedCookies.push(name); } },
} as unknown as Ctx);

function addSub(id: string, customer: string, status: string, tenant?: string): void {
  fake.subs[id] = { id, customer, status, metadata: tenant ? { tenant_id: tenant } : {} };
}
const canceledIds = () => fake.cancel.mock.calls.map((c) => c[0]).sort();
const writes = () => st.sql.filter((c) => /^(DELETE|UPDATE|INSERT) /.test(c.sql));
const at = (entry: string) => st.order.indexOf(entry);

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'configured-for-tests');
  st.rows = [];
  st.readFails = null;
  st.sql = [];
  st.order = [];
  for (const id of Object.keys(fake.subs)) delete fake.subs[id];
  fake.failing.cancel = null;
  fake.failing.lookup = null;
  for (const fn of [fake.list, fake.search, fake.retrieve, fake.cancel]) fn.mockClear();
  verify.deleteVerifyAccountData.mockClear();
  gate.invalidateUserAuthFacts.mockReset();
  auth.getAuthSession.mockReset();
  auth.getAuthSession.mockResolvedValue({ user: { id: USER_A } });
  clearedCookies.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/account/delete: Stripe billing', () => {
  it('cancels the tenant\'s subscription at Stripe, by id, before anything is deleted', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a' }];
    addSub('sub_a', 'cus_a', 'active', A);

    const res = await callPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(fake.cancel).toHaveBeenCalledTimes(1);
    expect(fake.cancel).toHaveBeenCalledWith('sub_a', expect.objectContaining({ cancellation_details: expect.any(Object) }));
    expect(fake.subs.sub_a.status).toBe('canceled');
    // Looked up by the row's own customer and by this tenant only.
    expect(fake.list).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_a' }));
    expect(fake.search).toHaveBeenCalledWith(expect.objectContaining({ query: `metadata['tenant_id']:'${A}'` }));

    // The cancel comes first: before the Verify delete, the row and the account.
    const cancel = at('stripe:cancel:sub_a');
    expect(cancel).toBeGreaterThanOrEqual(0);
    expect(cancel).toBeLessThan(at('verify'));
    expect(cancel).toBeLessThan(at('sql:DELETE FROM subscriptions WHERE tenant_id = ?'));
    expect(cancel).toBeLessThan(st.order.findIndex((e) => e.startsWith('sql:DELETE')));
    expect(st.sql.find((c) => c.sql === SUBS_READ)?.args).toEqual([A]);
  });

  it('cancels every live subscription the tenant has, not just the one the row names', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_new' }];
    addSub('sub_new', 'cus_a', 'active', A);
    addSub('sub_old', 'cus_a', 'active', A); // left behind by a plan switch
    addSub('sub_unpaid', 'cus_a', 'past_due', A); // Stripe would keep retrying the card
    addSub('sub_lost', 'cus_elsewhere', 'trialing', A); // only the metadata search finds it
    addSub('sub_ended', 'cus_a', 'canceled', A);
    addSub('sub_expired', 'cus_a', 'incomplete_expired', A);
    addSub('sub_b', 'cus_a', 'active', B); // names another tenant: not ours to cancel
    addSub('sub_b2', 'cus_b', 'active', B);

    expect((await callPost()).status).toBe(200);
    expect(canceledIds()).toEqual(['sub_lost', 'sub_new', 'sub_old', 'sub_unpaid']);
    expect(fake.subs.sub_b.status).toBe('active');
    expect(fake.subs.sub_b2.status).toBe('active');
  });

  it('finds and cancels a subscription the webhook never stored on the row', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: null, stripe_subscription_id: null }];
    addSub('sub_unstored', 'cus_x', 'active', A);

    expect((await callPost()).status).toBe(200);
    expect(canceledIds()).toEqual(['sub_unstored']);
    expect(fake.list).not.toHaveBeenCalled();
  });

  it('keeps the whole account when the cancel fails, and tells the dialog why', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a' }];
    addSub('sub_a', 'cus_a', 'active', A);
    fake.failing.cancel = new Error('Stripe API error');

    const res = await callPost();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'billing_cancel_failed' });
    expect(body.error).toMatch(/not deleted/);
    expect(body.error).not.toMatch(/\u2014/); // no em dash in user-facing copy

    expect(fake.subs.sub_a.status).toBe('active');
    expect(writes()).toEqual([]);
    expect(verify.deleteVerifyAccountData).not.toHaveBeenCalled();
    expect(gate.invalidateUserAuthFacts).not.toHaveBeenCalled();
    expect(clearedCookies).toEqual([]); // still signed in, so the owner can retry
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps the whole account when Stripe can\'t be asked which subscriptions exist', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a' }];
    addSub('sub_a', 'cus_a', 'active', A);
    fake.failing.lookup = new Error('connection reset');

    const res = await callPost();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('billing_cancel_failed');
    expect(fake.cancel).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(verify.deleteVerifyAccountData).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps the whole account when the subscriptions row can\'t be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    st.readFails = new Error('connection lost');

    const res = await callPost();
    expect(res.status).toBe(502);
    expect(fake.search).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(verify.deleteVerifyAccountData).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('goes ahead when the cancel fails because the subscription had already ended', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a' }];
    addSub('sub_a', 'cus_a', 'active', A);
    // Another tab canceled it between the lookup and this cancel.
    fake.cancel.mockImplementationOnce(async (id: string) => {
      st.order.push(`stripe:cancel:${id}`);
      fake.subs[id].status = 'canceled';
      throw new Error('This subscription is already canceled');
    });

    expect((await callPost()).status).toBe(200);
    expect(verify.deleteVerifyAccountData).toHaveBeenCalled();
    expect(writes().some((c) => c.sql === 'DELETE FROM subscriptions WHERE tenant_id = ?')).toBe(true);
  });

  it('deletes a tenant with no subscription as before, canceling nothing', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: null, stripe_subscription_id: null }]; // the free row
    addSub('sub_b', 'cus_b', 'active', B);

    const res = await callPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.cancel).not.toHaveBeenCalled();
    expect(fake.subs.sub_b.status).toBe('active');
    expect(verify.deleteVerifyAccountData).toHaveBeenCalledWith(A);
    expect(writes().map((c) => c.sql)).toEqual(expect.arrayContaining([
      'DELETE FROM subscriptions WHERE tenant_id = ?',
      'DELETE FROM tenant_memberships WHERE tenant_id = ?',
      'DELETE FROM auth_users WHERE id = ?',
    ]));
    expect(gate.invalidateUserAuthFacts).toHaveBeenCalledWith(USER_A);
    expect(clearedCookies.length).toBeGreaterThan(0);
  });

  it('deletes a tenant with no subscriptions row at all', async () => {
    expect((await callPost()).status).toBe(200);
    expect(fake.cancel).not.toHaveBeenCalled();
    expect(verify.deleteVerifyAccountData).toHaveBeenCalledWith(A);
  });
});

describe('cancelTenantStripeSubscriptions without a Stripe key', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', ''));

  it('lets a tenant with no stored Stripe ids through without calling Stripe', async () => {
    st.rows = [{ tenant_id: A, stripe_customer_id: null, stripe_subscription_id: null }];
    await expect(cancelTenantStripeSubscriptions(A)).resolves.toEqual({ canceled: [] });
    for (const fn of [fake.list, fake.search, fake.retrieve, fake.cancel]) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a tenant with stored Stripe ids, so its account is kept', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    st.rows = [{ tenant_id: A, stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a' }];
    await expect(cancelTenantStripeSubscriptions(A)).rejects.toThrow(/not configured/);

    const res = await callPost();
    expect(res.status).toBe(502);
    expect(writes()).toEqual([]);
    spy.mockRestore();
  });
});
