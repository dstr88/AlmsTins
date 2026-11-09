import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The Verify free plan: 2 wallet addresses and 1 payment QR for every account but the owner's,
 * which has no limit. Enforced where the row is written (createDestination), as a capped insert
 * behind the account's advisory lock, the same shape as the Agent Vault's, over the same in-memory
 * stand-in for the database. A real Postgres proves the race (tests/pgVerifyLimits.test.ts, opt-in);
 * here the rules are pinned: every boundary, what frees a slot, who is exempt, whose rows count, and
 * that the lock is taken before the insert. Every address, tenant and label is invented.
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
const addr = (n: number) => `0x${'ab'.repeat(18)}${n.toString(16).padStart(4, '0')}`;

let fake: ReceivablesDbFake;
let reg: typeof import('../../src/lib/verifyRegistry');
let ent: typeof import('../../src/lib/verifyEntitlements');

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  reg = await import('../../src/lib/verifyRegistry');
  ent = await import('../../src/lib/verifyEntitlements');
});

const add = (tenant: string, n: number, kind: 'address' | 'qr' = 'address') =>
  reg.createDestination(tenant, kind === 'qr'
    ? { kind, rail: 'url', value: `https://pay.example/${n}` }
    : { kind, rail: 'ethereum', value: addr(n) });
const rows = (tenant: string, kind?: string) =>
  fake.rows('verify_destinations').filter((r) => r.tenant_id === tenant && (!kind || r.kind === kind));

describe('the plan an account is on', () => {
  it('is Free for every account but the owner: 2 addresses and 1 payment QR', async () => {
    for (const tenant of [A, B, '00000000-0000-4000-8000-000000000002', 'x']) {
      expect(await ent.getVerifyEntitlements(tenant), tenant).toEqual({ plan: 'free', label: 'Free', limits: { address: 2, qr: 1 } });
    }
    expect(ent.VERIFY_FREE_LIMITS).toEqual({ address: 2, qr: 1 });
    expect(reg.FREE_LIMIT_ADDRESS).toBe(2);
    expect(reg.FREE_LIMIT_QR).toBe(1);
  });

  it('is Unlimited for the owner, whatever the case of the id', async () => {
    for (const id of [OWNER_TENANT_ID, OWNER_TENANT_ID.toUpperCase()]) {
      expect(await ent.getVerifyEntitlements(id)).toEqual({ plan: 'unlimited', label: 'Unlimited', limits: { address: null, qr: null } });
    }
  });
});

describe('the cap where the row is written', () => {
  it('takes two addresses and refuses the third, writing nothing for it', async () => {
    expect((await add(A, 1)).ok).toBe(true);
    expect((await add(A, 2)).ok).toBe(true);
    const third = await add(A, 3);
    expect(third).toMatchObject({ ok: false, error: 'limit_reached' });
    expect((third as any).message).toContain('2 wallet addresses');
    expect(rows(A, 'address')).toHaveLength(2);
  });

  it('takes one payment QR and refuses the second; the kinds do not share a count', async () => {
    expect((await add(A, 1)).ok).toBe(true);
    expect((await add(A, 2)).ok).toBe(true);
    expect((await add(A, 1, 'qr')).ok).toBe(true);
    expect(await add(A, 2, 'qr')).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A)).toHaveLength(3);
  });

  it('counts only the account itself: a second account has its own two', async () => {
    await add(A, 1); await add(A, 2);
    expect((await add(B, 1)).ok).toBe(true);
    expect((await add(B, 2)).ok).toBe(true);
    expect(await add(B, 3)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A, 'address')).toHaveLength(2);
    expect(rows(B, 'address')).toHaveLength(2);
  });

  it('a removed destination frees its slot', async () => {
    const first = await add(A, 1);
    await add(A, 2);
    expect(await add(A, 3)).toMatchObject({ ok: false, error: 'limit_reached' });
    if (!first.ok) throw new Error('setup');
    await reg.deleteDestination(A, first.destination.id);
    expect((await add(A, 3)).ok).toBe(true);
    expect(rows(A, 'address').map((r) => r.value).sort()).toEqual([addr(2), addr(3)].sort());
  });

  it('the owner has no cap: five addresses and two QRs land, through the plain insert', async () => {
    for (let n = 1; n <= 5; n += 1) expect((await add(OWNER_TENANT_ID, n)).ok, `address ${n}`).toBe(true);
    expect((await add(OWNER_TENANT_ID, 1, 'qr')).ok).toBe(true);
    expect((await add(OWNER_TENANT_ID, 2, 'qr')).ok).toBe(true);
    expect(rows(OWNER_TENANT_ID)).toHaveLength(7);
    expect(fake.batches).toHaveLength(0);
  });

  it('a capped insert takes the account lock first, then counts and inserts in one statement', async () => {
    await add(A, 1);
    expect(fake.batches).toHaveLength(1);
    const [lock, insert] = fake.batches[0];
    expect(lock.sql).toMatch(/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/);
    expect(lock.args).toEqual([A]);
    expect(insert.sql).toMatch(/^INSERT INTO verify_destinations \(.*\) SELECT \?.* WHERE \(SELECT COUNT\(\*\) FROM verify_destinations WHERE tenant_id = \? AND kind = \?\) < \?$/);
    expect(insert.args.slice(-3)).toEqual([A, 'address', 2]);
  });

  it('refuses the last slot under the lock even when the early count said there was room', async () => {
    // Two requests race: both pass the early count, then take turns at the capped insert.
    await add(A, 1);
    const original = fake.execute.bind(fake);
    let sneaked = false;
    fake.execute = async (stmt: any) => {
      const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ');
      const r = await original(stmt);
      if (!sneaked && sql.startsWith('SELECT COUNT(*) AS cnt FROM verify_destinations')) {
        // After this request's early count, another request lands the second address.
        sneaked = true;
        fake.tables.get('verify_destinations')!.push({ ...rows(A)[0], id: 'sneaked', value: addr(99) });
      }
      return r;
    };
    const r = await add(A, 2);
    expect(r).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(rows(A, 'address')).toHaveLength(2);
    expect(rows(A, 'address').some((x) => x.value === addr(2))).toBe(false);
  });

  it('a duplicate is still a duplicate, never a cap refusal, even at the cap', async () => {
    await add(A, 1); await add(A, 2);
    expect(await add(A, 2)).toMatchObject({ ok: false, error: 'duplicate' });
    expect(rows(A, 'address')).toHaveLength(2);
  });

  it('the same value racing in for the last slot is told it is a duplicate, not that the plan is full', async () => {
    await add(A, 1);
    const original = fake.execute.bind(fake);
    let sneaked = false;
    fake.execute = async (stmt: any) => {
      const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ');
      const r = await original(stmt);
      if (!sneaked && sql.startsWith('SELECT COUNT(*) AS cnt FROM verify_destinations')) {
        sneaked = true;
        fake.tables.get('verify_destinations')!.push({ ...rows(A)[0], id: 'sneaked', value: addr(2) });
      }
      return r;
    };
    expect(await add(A, 2)).toMatchObject({ ok: false, error: 'duplicate' });
    expect(rows(A, 'address')).toHaveLength(2);
  });
});
