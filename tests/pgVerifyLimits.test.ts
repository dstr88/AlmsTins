// REAL-POSTGRES TEST, opt-in (RUN_PG_VERIFY_LIMITS=1 + a DATABASE_URL on localhost); it WRITES.
// The unit step of CI skips it (vitest.ci.config.ts excludes tests/pg*.test.ts); CI runs it in its own
// step against the job's throwaway Postgres (.github/workflows/ci.yml), so a regression in the lock
// or the capped insert fails the build.
//
// Proves on a real Postgres what tests/verify/freeCap.test.ts and tests/verify/paidPlans.test.ts
// cannot: that a Verify plan's caps hold when many requests race for the last slot. Free is counted
// by kind (2 addresses, 1 payment QR); Business and Pro are counted in total (10 and 50), read from
// the account's row in verify_subscriptions. createDestination (src/lib/verifyRegistry.ts) takes an
// advisory lock for the account and then counts and inserts in one statement; this runs the real
// registry code through the app's own database layer against a throwaway local database, with
// every request in flight at once.
//
//   RUN_PG_VERIFY_LIMITS=1 DATABASE_URL=postgres://postgres@127.0.0.1:54395/slice5 \
//     npx vitest run tests/pgVerifyLimits.test.ts
//
// Skips without the opt-in. With the opt-in but a DATABASE_URL that is not on this machine it throws,
// so a real database is never written to by mistake. Tenants are invented and unique to each run,
// and their rows are deleted at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const OPT_IN = process.env.RUN_PG_VERIFY_LIMITS === '1';
const URL_HOST = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    return '';
  }
})();
if (OPT_IN && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(URL_HOST)) {
  throw new Error('RUN_PG_VERIFY_LIMITS=1 needs DATABASE_URL on localhost or 127.0.0.1: this test writes rows.');
}

const d = OPT_IN ? describe : describe.skip;
const addr = (n: number) => `0x${'5e1f'.padEnd(36, '0')}${n.toString(16).padStart(4, '0')}`;

d('the Verify plan caps, under concurrency, on a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const tenants: string[] = [];
  const fresh = (name: string) => {
    const t = `pg-verify-${run}-${name}`;
    tenants.push(t);
    return t;
  };
  let reg: typeof import('../src/lib/verifyRegistry');
  let db: typeof import('../src/lib/db').db;
  const count = async (t: string, kind: string) =>
    Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM verify_destinations WHERE tenant_id = ? AND kind = ?`, args: [t, kind] })).rows[0].n);
  const total = async (t: string) =>
    Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM verify_destinations WHERE tenant_id = ?`, args: [t] })).rows[0].n);
  const add = (t: string, n: number) => reg.createDestination(t, { kind: 'address', rail: 'ethereum', value: addr(n) });
  const addQr = (t: string, n: number) => reg.createDestination(t, { kind: 'qr', rail: 'url', value: `https://pay.example/${run}/${t}/${n}` });
  /** Put an invented account on a paid plan, the way the owner's switch writes the row. */
  const setPlan = (t: string, plan: string, status = 'active', paidThrough: string | null = null) =>
    db.execute({
      sql: `INSERT INTO verify_subscriptions (tenant_id, plan, status, paid_through) VALUES (?, ?, ?, ?)
            ON CONFLICT (tenant_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, paid_through = excluded.paid_through`,
      args: [t, plan, status, paidThrough],
    });

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    reg = await import('../src/lib/verifyRegistry');
    await reg.ensureVerifyTables();
  });

  afterAll(async () => {
    for (const t of tenants) {
      await db.execute({ sql: `DELETE FROM verify_deposit_challenges WHERE tenant_id = ?`, args: [t] });
      await db.execute({ sql: `DELETE FROM verify_destinations WHERE tenant_id = ?`, args: [t] });
      await db.execute({ sql: `DELETE FROM verify_subscriptions WHERE tenant_id = ?`, args: [t] });
    }
  });

  it('twenty requests at once for the last address slot add exactly one address', async () => {
    const t = fresh('last-slot');
    expect((await add(t, 1)).ok).toBe(true);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => add(t, 100 + i)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(19);
    expect(await count(t, 'address')).toBe(2);
  });

  it('twenty requests at once on an empty account add exactly two addresses', async () => {
    const t = fresh('empty');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => add(t, 200 + i)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(18);
    expect(await count(t, 'address')).toBe(2);
  });

  it('twenty requests at once for the one payment QR add exactly one', async () => {
    const t = fresh('qr');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      reg.createDestination(t, { kind: 'qr', rail: 'url', value: `https://pay.example/${run}/${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(19);
    expect(await count(t, 'qr')).toBe(1);
  });

  it('one address added by many requests at once takes one slot, and the others are told it is a duplicate', async () => {
    const t = fresh('same');
    const results = await Promise.all(Array.from({ length: 12 }, () => add(t, 7)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'duplicate')).toHaveLength(11);
    expect(await count(t, 'address')).toBe(1);
  });

  it('Business: thirty requests at once on an empty account, both kinds mixed, add exactly ten', async () => {
    const t = fresh('business-empty');
    await setPlan(t, 'business');
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? addQr(t, i) : add(t, 300 + i))));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(20);
    expect(await total(t)).toBe(10);
  });

  it('Business: twenty requests at once for the tenth slot, both kinds mixed, add exactly one', async () => {
    const t = fresh('business-last');
    await setPlan(t, 'business');
    for (let n = 1; n <= 6; n += 1) expect((await add(t, 400 + n)).ok).toBe(true);
    for (let n = 1; n <= 3; n += 1) expect((await addQr(t, n)).ok).toBe(true);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? addQr(t, 100 + i) : add(t, 500 + i))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(19);
    expect(await total(t)).toBe(10);
  });

  it('Pro: seventy requests at once on an empty account add exactly fifty', async () => {
    const t = fresh('pro-empty');
    await setPlan(t, 'pro');
    const results = await Promise.all(Array.from({ length: 70 }, (_, i) => (i % 3 ? add(t, 600 + i) : addQr(t, i))));
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect(results.filter((r) => !r.ok && r.error === 'limit_reached')).toHaveLength(20);
    expect(await total(t)).toBe(50);
  });

  it('a plan set while requests are in flight never lets an account past the larger plan', async () => {
    const t = fresh('moving-up');
    const results = await Promise.all([
      ...Array.from({ length: 15 }, (_, i) => add(t, 700 + i)),
      setPlan(t, 'business').then(() => null),
      ...Array.from({ length: 15 }, (_, i) => add(t, 800 + i)),
    ]);
    const landed = results.filter((r) => r && r.ok).length;
    expect(landed).toBeGreaterThanOrEqual(2);
    expect(landed).toBeLessThanOrEqual(10);
    expect(await total(t)).toBe(landed);
  });

  it('a row that is not live is Free: a canceled plan and one past its paid-through day take two addresses', async () => {
    const canceled = fresh('canceled');
    await setPlan(canceled, 'pro', 'canceled');
    const ended = fresh('ended');
    await setPlan(ended, 'business', 'active', '2020-01-01');
    for (const t of [canceled, ended]) {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => add(t, 900 + i)));
      expect(results.filter((r) => r.ok), t).toHaveLength(2);
      expect(await count(t, 'address')).toBe(2);
    }
  });

  it('the plans table is the one the app creates: one row per account, the plan and its status required', async () => {
    const t = fresh('shape');
    await setPlan(t, 'business');
    await setPlan(t, 'pro');
    const r = await db.execute({ sql: `SELECT plan, status, paid_through, created_at FROM verify_subscriptions WHERE tenant_id = ?`, args: [t] });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ plan: 'pro', status: 'active', paid_through: null });
    expect(String(r.rows[0].created_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    await expect(db.execute({ sql: `INSERT INTO verify_subscriptions (tenant_id, plan) VALUES (?, NULL)`, args: [fresh('no-plan')] })).rejects.toThrow();
  });
});
