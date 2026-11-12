import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The owner's switch for Verify plans: the rules (src/lib/verifyPlanAdmin.ts), the admin endpoint
 * that calls them (GET lists, POST sets) and the panel on /admin. The database is the in-memory
 * stand-in, the admin check is replaced and the activity log is a spy. The day is fixed at
 * Nov 11, 2026 (UTC). Every address, tenant and note is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const admin = vi.hoisted(() => ({ who: 'admin' as 'admin' | 'user' | 'nobody' }));
vi.mock('@/lib/adminGuard', () => ({
  requireAdminSession: async () => {
    if (admin.who === 'nobody') throw new Response('Unauthorized', { status: 401 });
    if (admin.who === 'user') throw new Response('Forbidden', { status: 403 });
    return { userId: 'u-admin', email: 'admin@example.test' };
  },
}));
const activity = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('@/lib/activityLog', () => ({ logActivity: (...a: unknown[]) => activity.log(...a) }));

const ROOT = path.resolve(__dirname, '../..');
const A = 'tenant-a';
const B = 'tenant-b';
const C = 'tenant-c';
const TODAY = '2026-11-11';
const addr = (n: number) => `0x${'ef'.repeat(18)}${n.toString(16).padStart(4, '0')}`;

let fake: ReceivablesDbFake;
let lib: typeof import('../../src/lib/verifyPlanAdmin');
let ent: typeof import('../../src/lib/verifyEntitlements');
let reg: typeof import('../../src/lib/verifyRegistry');
let route: typeof import('../../src/pages/api/admin/verify-plan');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  admin.who = 'admin';
  activity.log.mockReset();
  await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS tenants (id TEXT, name TEXT)`, args: [] });
  await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS auth_users (id TEXT, email TEXT, active_tenant_id TEXT)`, args: [] });
  await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS tenant_memberships (id TEXT, tenant_id TEXT, user_id TEXT, role TEXT, created_at TEXT)`, args: [] });
  // A: one member, working in A. B: one member with no active account. C: an account with no member.
  // u3 joined B after u2 and A after u1, and works in A. The owner's account has its own member.
  for (const id of [A, B, C, OWNER_TENANT_ID]) fake.seed('tenants', { id, name: id });
  for (const [id, email, active] of [
    ['u1', 'shop@example.test', A],
    ['u2', 'second@example.test', null],
    ['u3', 'helper@example.test', A],
    ['u-owner', 'owner@example.test', OWNER_TENANT_ID],
  ] as const) fake.seed('auth_users', { id, email, active_tenant_id: active });
  for (const [tenant, user, at] of [
    [A, 'u1', '2026-09-01 00:00:00'],
    [B, 'u2', '2026-09-02 00:00:00'],
    [B, 'u3', '2026-09-03 00:00:00'],
    [A, 'u3', '2026-09-04 00:00:00'],
    [OWNER_TENANT_ID, 'u-owner', '2026-01-01 00:00:00'],
  ] as const) fake.seed('tenant_memberships', { id: `m-${tenant}-${user}`, tenant_id: tenant, user_id: user, role: 'owner', created_at: at });
  reg = await import('../../src/lib/verifyRegistry');
  ent = await import('../../src/lib/verifyEntitlements');
  lib = await import('../../src/lib/verifyPlanAdmin');
  route = await import('../../src/pages/api/admin/verify-plan');
  await reg.ensureVerifyTables();
  fake.log.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const set = (account: string, plan: string, more: { paidThrough?: string | null; note?: string | null } = {}) =>
  lib.setVerifyPlan({ account, plan, setBy: 'u-admin', ...more });
const planRows = (tenant?: string) => fake.rows('verify_subscriptions').filter((r) => !tenant || r.tenant_id === tenant);
const writes = () => fake.statements(/^(INSERT INTO|UPDATE|DELETE FROM) verify_subscriptions\b/);
const call = async (method: 'GET' | 'POST', body?: unknown) => {
  const request = new Request('https://almstins.com/api/admin/verify-plan', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = (await (route[method] as any)({ request, url: new URL(request.url) })) as Response;
  return { res, json: (await res.json().catch(() => null)) as any };
};

describe('which account is meant', () => {
  it('an email names the account its user is working in', async () => {
    expect(await lib.resolveVerifyAccount('shop@example.test')).toEqual({ tenantId: A, email: 'shop@example.test' });
    // u3 joined B first but works in A; the address shown is A's first member.
    expect(await lib.resolveVerifyAccount('helper@example.test')).toEqual({ tenantId: A, email: 'shop@example.test' });
  });

  it('an email with no active account names the first account it joined', async () => {
    expect(await lib.resolveVerifyAccount('second@example.test')).toEqual({ tenantId: B, email: 'second@example.test' });
  });

  it('an email is matched whatever its case or the space around it', async () => {
    expect((await lib.resolveVerifyAccount('  Shop@Example.TEST '))?.tenantId).toBe(A);
  });

  it('anything without an @ is a tenant id; an account with no member has no email', async () => {
    expect(await lib.resolveVerifyAccount(B)).toEqual({ tenantId: B, email: 'second@example.test' });
    expect(await lib.resolveVerifyAccount(C)).toEqual({ tenantId: C, email: null });
  });

  it('an unknown email, an unknown tenant id and an empty value name nothing', async () => {
    for (const v of ['nobody@example.test', 'tenant-z', '', '   ']) expect(await lib.resolveVerifyAccount(v), v).toBeNull();
  });
});

describe('setting a plan', () => {
  it('Business writes one active row: the plan, the last day paid, the note and who set it', async () => {
    const r = await set('shop@example.test', 'business', { paidThrough: '2027-11-11', note: ' Invoice 1042, paid by wire ' });
    expect(r).toEqual({
      ok: true,
      account: { tenantId: A, email: 'shop@example.test' },
      plan: 'business',
      status: 'active',
      paidThrough: '2027-11-11',
      previous: null,
      changed: true,
    });
    expect(planRows()).toHaveLength(1);
    expect(planRows(A)[0]).toMatchObject({
      tenant_id: A, plan: 'business', status: 'active', paid_through: '2027-11-11',
      note: 'Invoice 1042, paid by wire', set_by: 'u-admin', updated_at: '2026-11-11 12:00:00',
    });
    expect(await ent.getVerifyEntitlements(A)).toMatchObject({ plan: 'business', limits: { total: 10 } });
  });

  it('the plan name is taken in any case; no date is a plan with no end', async () => {
    const r = await set(A, ' Pro ');
    expect(r).toMatchObject({ ok: true, plan: 'pro', paidThrough: null });
    expect(planRows(A)[0]).toMatchObject({ plan: 'pro', paid_through: null, note: null });
    expect(await ent.getVerifyEntitlements(A)).toMatchObject({ plan: 'pro', limits: { total: 50 } });
  });

  it('a second change updates the same row and reports what it said before', async () => {
    await set(A, 'business', { paidThrough: '2027-01-31', note: 'first' });
    vi.setSystemTime(new Date(`${TODAY}T13:30:00Z`));
    const r = await set(A, 'pro', { note: 'moved up' });
    expect(r).toMatchObject({ ok: true, plan: 'pro', paidThrough: null, changed: true, previous: { plan: 'business', status: 'active', paidThrough: '2027-01-31' } });
    expect(planRows()).toHaveLength(1);
    expect(planRows(A)[0]).toMatchObject({ plan: 'pro', status: 'active', paid_through: null, note: 'moved up', updated_at: '2026-11-11 13:30:00' });
  });

  it('paid through today is accepted: the plan is live to the end of the day', async () => {
    expect(await set(A, 'business', { paidThrough: TODAY })).toMatchObject({ ok: true, paidThrough: TODAY });
    expect(await ent.getVerifyEntitlements(A)).toMatchObject({ plan: 'business' });
  });

  it('a plan set by hand leaves a subscription’s Stripe ids as they are', async () => {
    fake.seed('verify_subscriptions', { tenant_id: A, plan: 'business', status: 'past_due', paid_through: null, stripe_customer_id: 'cus_invented', stripe_subscription_id: 'sub_invented', created_at: '2026-10-01 00:00:00' });
    await set(A, 'pro');
    expect(planRows(A)[0]).toMatchObject({ plan: 'pro', status: 'active', stripe_customer_id: 'cus_invented', stripe_subscription_id: 'sub_invented', created_at: '2026-10-01 00:00:00' });
    await set(A, 'free');
    expect(planRows(A)[0]).toMatchObject({ status: 'canceled', stripe_customer_id: 'cus_invented', stripe_subscription_id: 'sub_invented' });
  });

  it('a plan changes nothing in another account', async () => {
    await set(A, 'pro');
    expect(await ent.getVerifyEntitlements(B)).toMatchObject({ plan: 'free' });
    expect(planRows(B)).toHaveLength(0);
  });
});

describe('taking a plan back to Free', () => {
  it('keeps the row and marks it canceled, with the new note', async () => {
    await set(A, 'business', { paidThrough: '2027-11-11', note: 'Invoice 1042' });
    vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
    const r = await set(A, 'free', { note: 'Refunded' });
    expect(r).toMatchObject({ ok: true, plan: 'free', status: 'canceled', paidThrough: null, changed: true, previous: { plan: 'business', status: 'active', paidThrough: '2027-11-11' } });
    expect(planRows()).toHaveLength(1);
    expect(planRows(A)[0]).toMatchObject({ plan: 'business', status: 'canceled', paid_through: '2027-11-11', note: 'Refunded', set_by: 'u-admin', updated_at: '2026-11-11 15:00:00' });
    expect(await ent.getVerifyEntitlements(A)).toMatchObject({ plan: 'free', limits: { address: 2, qr: 1 } });
  });

  it('an account with no row is on Free already: nothing is written', async () => {
    const r = await set(B, 'free', { note: 'never mind' });
    expect(r).toMatchObject({ ok: true, plan: 'free', status: 'none', previous: null, changed: false });
    expect(planRows()).toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  it('a canceled row is on Free already: the row and its note stay as they were', async () => {
    await set(A, 'business', { note: 'Invoice 1042' });
    await set(A, 'free', { note: 'Refunded' });
    const before = { ...planRows(A)[0] };
    fake.log.length = 0;
    vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`));
    expect(await set(A, 'free', { note: 'again' })).toMatchObject({ ok: true, status: 'canceled', changed: false });
    expect(planRows(A)[0]).toEqual(before);
    expect(writes()).toEqual([]);
  });

  it('a row past its paid-through day is still marked canceled, so the change is on record', async () => {
    fake.seed('verify_subscriptions', { tenant_id: A, plan: 'pro', status: 'active', paid_through: '2026-10-31' });
    expect(await set(A, 'free')).toMatchObject({ ok: true, status: 'canceled', changed: true });
    expect(planRows(A)[0]).toMatchObject({ plan: 'pro', status: 'canceled' });
  });

  it('a paid plan set again after Free is live again', async () => {
    await set(A, 'business');
    await set(A, 'free');
    expect(await set(A, 'business', { paidThrough: '2026-12-31' })).toMatchObject({ ok: true, status: 'active', changed: true, previous: { status: 'canceled' } });
    expect(planRows()).toHaveLength(1);
    expect(await ent.getVerifyEntitlements(A)).toMatchObject({ plan: 'business' });
  });

  it('Free takes no date, so a date sent with it is not looked at', async () => {
    await set(A, 'business');
    expect(await set(A, 'free', { paidThrough: '2020-01-01' })).toMatchObject({ ok: true, status: 'canceled' });
  });
});

describe('what is refused', () => {
  it.each(['unlimited', 'enterprise', 'starter', ''])('plan "%s" is not one that can be set', async (plan) => {
    expect(await set(A, plan)).toEqual({ ok: false, error: 'invalid_plan' });
  });

  it.each(['2026-13-01', '2026-02-30', '11/12/2026', '2026-11-12T00:00:00Z', 'tomorrow'])('paid through "%s" is not a date', async (paidThrough) => {
    expect(await set(A, 'business', { paidThrough })).toEqual({ ok: false, error: 'invalid_paid_through' });
  });

  it('a paid-through day that has passed', async () => {
    expect(await set(A, 'business', { paidThrough: '2026-11-10' })).toEqual({ ok: false, error: 'paid_through_past' });
  });

  it('a note over 500 characters; 500 is taken', async () => {
    expect(lib.VERIFY_PLAN_NOTE_MAX).toBe(500);
    expect(await set(A, 'business', { note: 'n'.repeat(501) })).toEqual({ ok: false, error: 'note_too_long' });
    expect(await set(A, 'business', { note: 'n'.repeat(500) })).toMatchObject({ ok: true });
  });

  it('no account, and an account that does not exist', async () => {
    expect(await set('  ', 'business')).toEqual({ ok: false, error: 'account_required' });
    expect(await set('nobody@example.test', 'business')).toEqual({ ok: false, error: 'account_not_found' });
    expect(await set('tenant-z', 'pro')).toEqual({ ok: false, error: 'account_not_found' });
  });

  it('the owner’s account, by email or by id, in any case', async () => {
    for (const account of ['owner@example.test', OWNER_TENANT_ID]) {
      for (const plan of ['business', 'pro', 'free']) expect(await set(account, plan), `${account} ${plan}`).toEqual({ ok: false, error: 'owner_account' });
    }
  });

  it('a refusal writes nothing, and a bad value is refused before the database is read', async () => {
    await set(A, 'unlimited');
    await set(A, 'business', { paidThrough: '2026-11-10' });
    await set(A, 'business', { note: 'n'.repeat(501) });
    await set('', 'business');
    expect(fake.log).toEqual([]);
    await set('nobody@example.test', 'business');
    await set(OWNER_TENANT_ID, 'business');
    expect(writes()).toEqual([]);
    expect(planRows()).toHaveLength(0);
  });
});

describe('the list', () => {
  it('is empty while no account has a row', async () => {
    expect(await lib.listVerifyPlans()).toEqual([]);
  });

  it('gives each row its account, what it counts as today and how many destinations it holds, newest change first', async () => {
    await set(A, 'business', { paidThrough: '2027-11-11', note: 'Invoice 1042' });
    for (let n = 1; n <= 3; n += 1) await reg.createDestination(A, { kind: 'address', rail: 'ethereum', value: addr(n) });
    await reg.createDestination(A, { kind: 'qr', rail: 'url', value: 'https://pay.example/1' });
    await reg.createDestination(B, { kind: 'address', rail: 'ethereum', value: addr(9) });
    vi.setSystemTime(new Date(`${TODAY}T13:00:00Z`));
    await set(C, 'pro');
    // B's plan ran out last month; it was never set back to Free.
    fake.seed('verify_subscriptions', { tenant_id: B, plan: 'pro', status: 'active', paid_through: '2026-10-31', note: null, set_by: null, created_at: '2026-10-01 09:00:00', updated_at: null });

    const list = await lib.listVerifyPlans();
    expect(list.map((r) => r.tenantId)).toEqual([C, A, B]);
    expect(list[0]).toMatchObject({ tenantId: C, email: null, plan: 'pro', status: 'active', paidThrough: null, live: true, readsAs: 'Pro', destinations: 0, setBy: 'u-admin', updatedAt: '2026-11-11 13:00:00' });
    expect(list[1]).toMatchObject({ tenantId: A, email: 'shop@example.test', plan: 'business', status: 'active', paidThrough: '2027-11-11', note: 'Invoice 1042', live: true, readsAs: 'Business', destinations: 4 });
    expect(list[2]).toMatchObject({ tenantId: B, email: 'second@example.test', plan: 'pro', status: 'active', paidThrough: '2026-10-31', note: null, setBy: null, createdAt: '2026-10-01 09:00:00', updatedAt: null, live: false, readsAs: 'Free', destinations: 1 });
  });

  it('a canceled row and a row naming a plan nobody can buy both count as Free', async () => {
    await set(A, 'business');
    await set(A, 'free');
    fake.seed('verify_subscriptions', { tenant_id: B, plan: 'unlimited', status: 'active', paid_through: null, created_at: '2026-10-01 09:00:00' });
    const byTenant = new Map((await lib.listVerifyPlans()).map((r) => [r.tenantId, r]));
    expect(byTenant.get(A)).toMatchObject({ plan: 'business', status: 'canceled', live: false, readsAs: 'Free' });
    expect(byTenant.get(B)).toMatchObject({ plan: 'unlimited', live: false, readsAs: 'Free' });
  });

  it('agrees with the limits code about every row', async () => {
    await set(A, 'business', { paidThrough: TODAY });
    await set(C, 'pro');
    fake.seed('verify_subscriptions', { tenant_id: B, plan: 'business', status: 'past_due', paid_through: null, created_at: '2026-10-01 09:00:00' });
    for (const day of [`${TODAY}T23:59:59Z`, '2026-11-12T00:00:00Z']) {
      vi.setSystemTime(new Date(day));
      for (const r of await lib.listVerifyPlans()) {
        expect(r.readsAs, `${r.tenantId} at ${day}`).toBe((await ent.getVerifyEntitlements(r.tenantId)).label);
      }
    }
  });
});

describe('the endpoint: who may use it', () => {
  it.each([['nobody', 401, 'unauthorized'], ['user', 403, 'forbidden']] as const)('answers %s with %i, before it reads the body or the database', async (who, status, error) => {
    admin.who = who;
    for (const method of ['GET', 'POST'] as const) {
      const { res, json } = await call(method, { account: A, plan: 'pro' });
      expect(res.status, method).toBe(status);
      expect(json).toEqual({ ok: false, error });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fake.log).toEqual([]);
    expect(planRows()).toHaveLength(0);
    expect(activity.log).not.toHaveBeenCalled();
  });
});

describe('the endpoint: setting and listing', () => {
  it('POST sets the plan as the signed-in admin and answers which account it was', async () => {
    const { res, json } = await call('POST', { account: 'shop@example.test', plan: 'business', paidThrough: '2027-11-11', note: 'Invoice 1042' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ ok: true, tenantId: A, email: 'shop@example.test', plan: 'business', status: 'active', paidThrough: '2027-11-11', changed: true });
    expect(planRows(A)[0]).toMatchObject({ plan: 'business', status: 'active', set_by: 'u-admin', note: 'Invoice 1042' });
  });

  it('every change writes one activity line under the account, with no email and no note in it', async () => {
    await call('POST', { account: 'shop@example.test', plan: 'business', paidThrough: '2027-11-11', note: 'Invoice 1042 for shop@example.test' });
    expect(activity.log).toHaveBeenCalledTimes(1);
    expect(activity.log).toHaveBeenLastCalledWith(A, 'verify_plan_set', 'Verify plan set to Business', {
      plan: 'business', status: 'active', paidThrough: '2027-11-11', previousPlan: null, previousStatus: null,
    });
    await call('POST', { account: A, plan: 'free', note: 'Refunded to shop@example.test' });
    expect(activity.log).toHaveBeenCalledTimes(2);
    expect(activity.log).toHaveBeenLastCalledWith(A, 'verify_plan_set', 'Verify plan set to Free', {
      plan: 'free', status: 'canceled', paidThrough: null, previousPlan: 'business', previousStatus: 'active',
    });
    const written = JSON.stringify(activity.log.mock.calls);
    for (const secret of ['@', 'Invoice', 'Refunded', 'u-admin']) expect(written, secret).not.toContain(secret);
  });

  it('an account already on Free answers changed: false and writes no activity line', async () => {
    const { res, json } = await call('POST', { account: B, plan: 'free' });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, tenantId: B, email: 'second@example.test', plan: 'free', status: 'none', paidThrough: null, changed: false });
    expect(activity.log).not.toHaveBeenCalled();
  });

  it.each([
    [{ account: '', plan: 'business' }, 400, 'account_required'],
    [{ account: A, plan: 'unlimited' }, 400, 'invalid_plan'],
    [{ account: A }, 400, 'invalid_plan'],
    [{ account: A, plan: 'business', paidThrough: 'soon' }, 400, 'invalid_paid_through'],
    [{ account: A, plan: 'business', paidThrough: '2026-11-10' }, 400, 'paid_through_past'],
    [{ account: A, plan: 'business', note: 'n'.repeat(501) }, 400, 'note_too_long'],
    [{ account: 123, plan: 'business' }, 400, 'account_required'],
    [{ account: 'nobody@example.test', plan: 'business' }, 404, 'account_not_found'],
    [{ account: OWNER_TENANT_ID, plan: 'pro' }, 409, 'owner_account'],
  ] as const)('POST %j answers %i %s and changes nothing', async (body, status, error) => {
    const { res, json } = await call('POST', body);
    expect(res.status).toBe(status);
    expect(json).toEqual({ ok: false, error });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(planRows()).toHaveLength(0);
    expect(activity.log).not.toHaveBeenCalled();
  });

  it.each(['not json', '[]', 'null', '"business"', '7'])('a body of %s is refused as invalid_body', async (body) => {
    const { res, json } = await call('POST', body);
    expect(res.status).toBe(400);
    expect(json).toEqual({ ok: false, error: 'invalid_body' });
    expect(fake.log).toEqual([]);
  });

  it('GET lists the rows', async () => {
    await call('POST', { account: A, plan: 'pro', note: 'Invoice 1043' });
    const { res, json } = await call('GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json.ok).toBe(true);
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]).toMatchObject({ tenantId: A, email: 'shop@example.test', plan: 'pro', live: true, readsAs: 'Pro', destinations: 0, note: 'Invoice 1043' });
  });

  it('a database failure answers 500 unavailable, with nothing of the error in the answer', async () => {
    fake.options.failDml = (sql) => /verify_subscriptions/.test(sql);
    for (const [method, body] of [['GET', undefined], ['POST', { account: A, plan: 'pro' }]] as const) {
      const { res, json } = await call(method, body);
      expect(res.status, method).toBe(500);
      expect(json).toEqual({ ok: false, error: 'unavailable' });
    }
    expect(activity.log).not.toHaveBeenCalled();
  });
});

describe('the panel on /admin', () => {
  const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

  it('the admin page renders the panel', () => {
    const page = read('src/pages/admin/index.astro');
    expect(page).toContain("import VerifyPlans from '@/components/admin/VerifyPlans.astro';");
    expect(page).toContain('<VerifyPlans />');
  });

  it('is four files: markup, words, behavior and presentation', () => {
    const markup = read('src/components/admin/VerifyPlans.astro');
    expect(markup).toContain("from './verifyPlans.copy'");
    expect(markup).toContain("import './VerifyPlans.css';");
    expect(markup).toContain("import './verifyPlans.client.ts';");
    expect(markup).not.toMatch(/<style[\s>]/);
    expect(markup).not.toMatch(/\sstyle=/);
    expect(read('src/components/admin/VerifyPlans.css')).toContain('.vplans');
    // No word is typed between the tags: every text node is read from the copy file.
    const template = markup.slice(markup.indexOf('---', 3) + 3).replace(/<script>[\s\S]*?<\/script>/, '');
    expect(template).toContain('{copy.title}');
    expect(template.match(/>[^<>{}]*[A-Za-z][^<>{}]*</g) ?? []).toEqual([]);
    expect(template).not.toMatch(/(placeholder|title|aria-label)="/);
  });

  it('the behavior calls the endpoint and escapes what people typed', () => {
    const client = read('src/components/admin/verifyPlans.client.ts');
    expect(client).toContain("const ENDPOINT = '/api/admin/verify-plan';");
    // The middleware answers a signed-out request as "Unauthorized"; the copy's key is lower case.
    expect(client).toContain('copy.errors[String(code).toLowerCase()]');
    expect(client).toContain("from '@/lib/escapeHtml'");
    for (const field of ['r.tenantId', 'r.email ?? copy.noEmail', 'r.note ??', 'r.readsAs', 'r.paidThrough ?? copy.noEndDate']) {
      expect(client, field).toContain(`escapeHtml(${field}`);
    }
  });

  it('has a sentence for every error the endpoint can answer', async () => {
    const { VERIFY_PLANS_COPY } = await import('../../src/components/admin/verifyPlans.copy');
    const routeSrc = read('src/pages/api/admin/verify-plan.ts');
    const libSrc = read('src/lib/verifyPlanAdmin.ts');
    // `error: 'x'`, and the two sides of `error: cond ? 'x' : 'y'`.
    const codes = new Set(
      [...routeSrc.matchAll(/error: (?:[^,}'\n]*\? )?'([a-z_]+)'(?: : '([a-z_]+)')?/g), ...libSrc.matchAll(/error: '([a-z_]+)'/g)]
        .flatMap((m) => [m[1], m[2]])
        .filter(Boolean),
    );
    expect([...codes].sort()).toEqual(['account_not_found', 'account_required', 'forbidden', 'invalid_body', 'invalid_paid_through', 'invalid_plan', 'note_too_long', 'owner_account', 'paid_through_past', 'unauthorized', 'unavailable']);
    for (const code of codes) expect(VERIFY_PLANS_COPY.errors[code], code).toBeTruthy();
  });

  it('the plan choices come from the plans file, with Business offered first', () => {
    const markup = read('src/components/admin/VerifyPlans.astro');
    expect(markup).toContain('VERIFY_PLAN_ORDER.map(');
    expect(markup).toContain("selected={o.id === 'business'}");
    expect(markup).toContain('maxlength={VERIFY_PLAN_NOTE_MAX}');
  });
});
