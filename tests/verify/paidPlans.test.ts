import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The paid Verify plans: Business holds 10 destinations and Pro holds 50, counted in total over
 * wallet addresses and payment QRs together. An account is on one of them while it has a live row
 * in verify_subscriptions; no row, or a row that is not live, is Free (tests/verify/freeCap.test.ts
 * pins Free). Pinned here: the names, prices and numbers; which rows are live; that the tracker's
 * plan is never read; the total where the row is written, with the same lock and the same one-statement
 * count as Free; and what a refusal says. The day is fixed at Nov 11, 2026 (UTC). Every address,
 * tenant and note is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
  db: {
    execute: (s: any) => holder.db.execute(s),
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));

const A = 'tenant-a';
const B = 'tenant-b';
const TODAY = '2026-11-11';
const addr = (n: number) => `0x${'cd'.repeat(18)}${n.toString(16).padStart(4, '0')}`;

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/verifyRegistry');
let ent: typeof import('../../src/lib/verifyEntitlements');
let plans: typeof import('../../src/lib/verifyPlans');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake = createReceivablesDbFake();
  holder.db = fake;
  reg = await import('../../src/lib/verifyRegistry');
  ent = await import('../../src/lib/verifyEntitlements');
  plans = await import('../../src/lib/verifyPlans');
  await reg.ensureVerifyTables();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Give an account a plan row, or replace the one it has. */
const setRow = (tenant: string, row: { plan: string; status?: string; paid_through?: string | null }) => {
  const table = fake.tables.get('verify_subscriptions')!;
  const at = table.findIndex((r) => r.tenant_id === tenant);
  if (at >= 0) table.splice(at, 1);
  return fake.seed('verify_subscriptions', { tenant_id: tenant, status: 'active', paid_through: null, ...row });
};
const add = (tenant: string, n: number, kind: 'address' | 'qr' = 'address') =>
  reg.createDestination(tenant, kind === 'qr'
    ? { kind, rail: 'url', value: `https://pay.example/${n}` }
    : { kind, rail: 'ethereum', value: addr(n) });
const fill = async (tenant: string, addresses: number, qrs = 0) => {
  for (let n = 1; n <= addresses; n += 1) expect((await add(tenant, n)).ok, `address ${n}`).toBe(true);
  for (let n = 1; n <= qrs; n += 1) expect((await add(tenant, n, 'qr')).ok, `qr ${n}`).toBe(true);
};
const rows = (tenant: string, kind?: string) =>
  fake.rows('verify_destinations').filter((r) => r.tenant_id === tenant && (!kind || r.kind === kind));

const BUSINESS = { plan: 'business', label: 'Business', limits: { address: null, qr: null, total: 10 } };
const PRO = { plan: 'pro', label: 'Pro', limits: { address: null, qr: null, total: 50 } };
const FREE = { plan: 'free', label: 'Free', limits: { address: 2, qr: 1, total: null } };

describe('the plans in one file', () => {
  it('names, prices and numbers', () => {
    expect(plans.VERIFY_PLANS).toEqual({
      free: { id: 'free', name: 'Free', monthlyUsd: 0, yearlyUsd: 0, limits: { address: 2, qr: 1, total: null } },
      business: { id: 'business', name: 'Business', monthlyUsd: 99, yearlyUsd: 990, limits: { address: null, qr: null, total: 10 } },
      pro: { id: 'pro', name: 'Pro', monthlyUsd: 299, yearlyUsd: 2990, limits: { address: null, qr: null, total: 50 } },
    });
    expect(plans.VERIFY_PLAN_ORDER).toEqual(['free', 'business', 'pro']);
  });

  it('every plan has one way of counting: by kind or in total, never both', () => {
    // The capped insert carries one count per cap; a plan with both would need two in one statement.
    for (const id of plans.VERIFY_PLAN_ORDER) {
      const { address, qr, total } = plans.VERIFY_PLANS[id].limits;
      const byKind = address !== null || qr !== null;
      expect(byKind !== (total !== null), id).toBe(true);
    }
  });

  it('a year costs ten months', () => {
    for (const id of ['business', 'pro'] as const) {
      expect(plans.VERIFY_PLANS[id].yearlyUsd).toBe(plans.VERIFY_PLANS[id].monthlyUsd * 10);
    }
  });

  it('the next plan up, and none from the largest', () => {
    expect(plans.nextVerifyPlan('free')?.id).toBe('business');
    expect(plans.nextVerifyPlan('business')?.id).toBe('pro');
    expect(plans.nextVerifyPlan('pro')).toBeNull();
    expect(plans.isVerifyPaidPlan('business')).toBe(true);
    expect(plans.isVerifyPaidPlan('pro')).toBe(true);
    for (const v of ['free', 'unlimited', 'Business', '', null, undefined]) expect(plans.isVerifyPaidPlan(v), String(v)).toBe(false);
  });

  it('a refusal names the limit reached and the next plan up', () => {
    expect(plans.verifyLimitMessage('free', 'address')).toBe('The Free plan includes 2 wallet addresses. The Business plan holds 10 destinations. Get in touch to move up.');
    expect(plans.verifyLimitMessage('free', 'qr')).toBe('The Free plan includes 1 payment QR. The Business plan holds 10 destinations. Get in touch to move up.');
    for (const kind of ['address', 'qr'] as const) {
      expect(plans.verifyLimitMessage('business', kind)).toBe('The Business plan holds 10 destinations. The Pro plan holds 50 destinations. Get in touch to move up.');
      expect(plans.verifyLimitMessage('pro', kind)).toBe('The Pro plan holds 50 destinations. Need more? Get in touch.');
      expect(plans.verifyLimitMessage('unlimited', kind)).toBe('This account is at its destination limit.');
    }
  });
});

describe('the plan an account is on', () => {
  it('a live Business or Pro row is that plan', async () => {
    setRow(A, { plan: 'business' });
    setRow(B, { plan: 'pro' });
    expect(await ent.getVerifyEntitlements(A)).toEqual(BUSINESS);
    expect(await ent.getVerifyEntitlements(B)).toEqual(PRO);
  });

  it.each(['active', 'trialing', 'past_due'])('status %s is live', async (status) => {
    setRow(A, { plan: 'business', status });
    expect(await ent.getVerifyEntitlements(A)).toEqual(BUSINESS);
  });

  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', 'ACTIVE'])('status "%s" is Free', async (status) => {
    setRow(A, { plan: 'pro', status });
    expect(await ent.getVerifyEntitlements(A)).toEqual(FREE);
  });

  it('a plan is live through the end of its paid-through day, and Free the day after', async () => {
    setRow(A, { plan: 'business', paid_through: '2026-11-12' });
    expect(await ent.getVerifyEntitlements(A), 'tomorrow').toEqual(BUSINESS);
    setRow(A, { plan: 'business', paid_through: TODAY });
    expect(await ent.getVerifyEntitlements(A), 'today').toEqual(BUSINESS);
    vi.setSystemTime(new Date(`${TODAY}T23:59:59Z`));
    expect(await ent.getVerifyEntitlements(A), 'the last second of today').toEqual(BUSINESS);
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    expect(await ent.getVerifyEntitlements(A), 'the first second of tomorrow').toEqual(FREE);
    setRow(A, { plan: 'business', paid_through: '2026-11-10' });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
    expect(await ent.getVerifyEntitlements(A), 'yesterday').toEqual(FREE);
  });

  it('no paid-through date is a plan with no end', async () => {
    for (const paid_through of [null, '']) {
      setRow(A, { plan: 'pro', paid_through });
      expect(await ent.getVerifyEntitlements(A)).toEqual(PRO);
    }
  });

  it('a paid-through date does not rescue a canceled row', async () => {
    setRow(A, { plan: 'business', status: 'canceled', paid_through: '2027-11-11' });
    expect(await ent.getVerifyEntitlements(A)).toEqual(FREE);
  });

  it.each(['free', 'unlimited', 'enterprise', 'Business', ''])('a row naming "%s" is Free: only business and pro can be bought', async (plan) => {
    setRow(A, { plan });
    expect(await ent.getVerifyEntitlements(A)).toEqual(FREE);
  });

  it('the owner has no limit, whatever a row says', async () => {
    setRow(OWNER_TENANT_ID, { plan: 'business', status: 'canceled' });
    expect(await ent.getVerifyEntitlements(OWNER_TENANT_ID)).toMatchObject({ plan: 'unlimited', limits: { address: null, qr: null, total: null } });
  });

  it('one account’s plan is its own', async () => {
    setRow(A, { plan: 'pro' });
    expect(await ent.getVerifyEntitlements(B)).toEqual(FREE);
  });

  it('the tracker’s plan is never read: Unlimited on almstins.com is Free in Verify', async () => {
    await fake.execute({ sql: `CREATE TABLE IF NOT EXISTS subscriptions (tenant_id TEXT, plan TEXT, status TEXT)`, args: [] });
    fake.seed('subscriptions', { tenant_id: A, plan: 'unlimited', status: 'active' });
    fake.log.length = 0;
    expect(await ent.getVerifyEntitlements(A)).toEqual(FREE);
    expect(await add(A, 1)).toMatchObject({ ok: true });
    expect(await add(A, 2)).toMatchObject({ ok: true });
    expect(await add(A, 3)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(fake.statements(/\bsubscriptions\b/).filter((s) => !/\bverify_subscriptions\b/.test(s.sql))).toEqual([]);
  });
});

describe('the total where the row is written', () => {
  it('Business takes ten destinations in any mix and refuses the eleventh of either kind', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 6, 4);
    for (const kind of ['address', 'qr'] as const) {
      const r = await add(A, 99, kind);
      expect(r).toMatchObject({ ok: false, error: 'limit_reached' });
      expect((r as any).message).toBe('The Business plan holds 10 destinations. The Pro plan holds 50 destinations. Get in touch to move up.');
    }
    expect(rows(A)).toHaveLength(10);
  });

  it('Business takes ten of one kind: Free’s 2 and 1 no longer apply', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 10);
    expect(await add(A, 11)).toMatchObject({ ok: false, error: 'limit_reached' });
    setRow(B, { plan: 'business' });
    await fill(B, 0, 10);
    expect(await add(B, 11, 'qr')).toMatchObject({ ok: false, error: 'limit_reached' });
  });

  it('Pro takes fifty and refuses the fifty-first, with nowhere further to point', async () => {
    setRow(A, { plan: 'pro' });
    await fill(A, 30, 20);
    const r = await add(A, 99);
    expect(r).toMatchObject({ ok: false, error: 'limit_reached' });
    expect((r as any).message).toBe('The Pro plan holds 50 destinations. Need more? Get in touch.');
    expect(rows(A)).toHaveLength(50);
  });

  it('the insert takes the account lock, then counts every destination of the account in the same statement', async () => {
    setRow(A, { plan: 'business' });
    fake.batches.length = 0;
    await add(A, 1, 'qr');
    expect(fake.batches).toHaveLength(1);
    const [lock, insert] = fake.batches[0];
    expect(lock.sql).toMatch(/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/);
    expect(lock.args).toEqual([A]);
    expect(insert.sql).toMatch(/^INSERT INTO verify_destinations \(.*\) SELECT \?.* WHERE \(SELECT COUNT\(\*\) FROM verify_destinations WHERE tenant_id = \?\) < \?$/);
    expect(insert.args.slice(-2)).toEqual([A, 10]);
  });

  it('refuses the last slot under the lock even when the early count said there was room', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 9);
    const original = fake.execute.bind(fake);
    let sneaked = false;
    fake.execute = async (stmt: any) => {
      const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ');
      const r = await original(stmt);
      if (!sneaked && sql.startsWith('SELECT COUNT(*) AS cnt FROM verify_destinations')) {
        // After this request's early count, another request lands the tenth, of the other kind.
        sneaked = true;
        fake.tables.get('verify_destinations')!.push({ ...rows(A)[0], id: 'sneaked', kind: 'qr', rail: 'url', value: 'https://pay.example/sneaked' });
      }
      return r;
    };
    expect(await add(A, 10)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A)).toHaveLength(10);
    expect(rows(A).some((x) => x.value === addr(10))).toBe(false);
  });

  it('a removed destination frees its slot', async () => {
    setRow(A, { plan: 'business' });
    const first = await add(A, 1);
    if (!first.ok) throw new Error('setup');
    for (let n = 2; n <= 10; n += 1) await add(A, n);
    expect(await add(A, 11)).toMatchObject({ ok: false, error: 'limit_reached' });
    await reg.deleteDestination(A, first.destination.id);
    expect((await add(A, 11)).ok).toBe(true);
    expect(rows(A)).toHaveLength(10);
  });

  it('a duplicate is still a duplicate at the total, never a plan refusal', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 10);
    expect(await add(A, 3)).toMatchObject({ ok: false, error: 'duplicate' });
  });

  it('counts only the account itself', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 10);
    setRow(B, { plan: 'business' });
    await fill(B, 10);
    expect(rows(A)).toHaveLength(10);
    expect(rows(B)).toHaveLength(10);
  });
});

describe('moving between plans', () => {
  it('a full Free account has room the moment its row is set', async () => {
    await fill(A, 2, 1);
    expect(await add(A, 3)).toMatchObject({ ok: false, error: 'limit_reached' });
    setRow(A, { plan: 'business' });
    expect((await add(A, 3)).ok).toBe(true);
    expect((await add(A, 2, 'qr')).ok).toBe(true);
  });

  it('a full Business account has room the moment it is Pro', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 10);
    expect(await add(A, 11)).toMatchObject({ ok: false, error: 'limit_reached' });
    setRow(A, { plan: 'pro' });
    expect((await add(A, 11)).ok).toBe(true);
  });

  it('a plan that ended keeps what it registered and is held to Free for anything new', async () => {
    setRow(A, { plan: 'business' });
    await fill(A, 6, 2);
    setRow(A, { plan: 'business', status: 'canceled' });
    const address = await add(A, 99);
    expect(address).toMatchObject({ ok: false, error: 'limit_reached' });
    expect((address as any).message).toContain('The Free plan includes 2 wallet addresses.');
    const qr = await add(A, 99, 'qr');
    expect(qr).toMatchObject({ ok: false, error: 'limit_reached' });
    expect((qr as any).message).toContain('The Free plan includes 1 payment QR.');
    expect(rows(A)).toHaveLength(8);
  });

  it('a plan past its paid-through day is held to Free the same way', async () => {
    setRow(A, { plan: 'pro', paid_through: TODAY });
    await fill(A, 8);
    vi.setSystemTime(new Date('2026-11-12T00:00:01Z'));
    expect(await add(A, 9)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A)).toHaveLength(8);
  });

  it('Free counts by kind, so an ended plan holding only payment QRs can still add two addresses', async () => {
    // Known gap until the pause ships (PR 2 of the plan): Free has no total, so the kinds are
    // counted apart. Pinned so the pause changes it on purpose.
    setRow(A, { plan: 'business' });
    await fill(A, 0, 8);
    setRow(A, { plan: 'business', status: 'canceled' });
    expect((await add(A, 1)).ok).toBe(true);
    expect((await add(A, 2)).ok).toBe(true);
    expect(await add(A, 3)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(await add(A, 9, 'qr')).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A)).toHaveLength(10);
  });
});
