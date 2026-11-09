// REAL-POSTGRES TEST, opt-in (RUN_PG_VERIFY_LIMITS=1 + a DATABASE_URL on localhost); it WRITES.
// The unit step of CI skips it (vitest.ci.config.ts excludes tests/pg*.test.ts); CI runs it in its own
// step against the job's throwaway Postgres (.github/workflows/ci.yml), so a regression in the lock
// or the capped insert fails the build.
//
// Proves on a real Postgres what tests/verify/freeCap.test.ts cannot: that the Verify free plan's
// caps hold when many requests race for the last slot. createDestination (src/lib/verifyRegistry.ts)
// takes an advisory lock for the account and then counts and inserts in one statement; this runs
// the real registry code through the app's own database layer against a throwaway local database,
// with every request in flight at once.
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

d('the Verify free plan caps, under concurrency, on a real Postgres', () => {
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
  const add = (t: string, n: number) => reg.createDestination(t, { kind: 'address', rail: 'ethereum', value: addr(n) });

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    reg = await import('../src/lib/verifyRegistry');
    await reg.ensureVerifyTables();
  });

  afterAll(async () => {
    for (const t of tenants) {
      await db.execute({ sql: `DELETE FROM verify_deposit_challenges WHERE tenant_id = ?`, args: [t] });
      await db.execute({ sql: `DELETE FROM verify_destinations WHERE tenant_id = ?`, args: [t] });
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
});
