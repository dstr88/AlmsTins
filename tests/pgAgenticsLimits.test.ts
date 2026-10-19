// DIAGNOSTIC, NOT A CI TEST: opt-in only (RUN_PG_AGENTICS_LIMITS=1 + a DATABASE_URL on localhost); it WRITES.
//
// Proves on a real Postgres what the in-memory tests cannot: that the Agent Vault's plan limits hold
// when many requests race for the last slot. The Vault's capped inserts (src/lib/agentVault/store.ts)
// take an advisory lock for the account and then count and insert in one statement; this runs the
// real vault code through the app's own database layer (src/lib/db.ts -> db.pg.ts) against a
// throwaway local database, with every request in flight at once.
//
//   RUN_PG_AGENTICS_LIMITS=1 DATABASE_URL=postgres://postgres@127.0.0.1:54395/slice5 \
//     npx vitest run tests/pgAgenticsLimits.test.ts
//
// Skips without the opt-in (the CI config excludes tests/pg*.test.ts besides). With the opt-in but a
// DATABASE_URL that is not on this machine it throws, so a real database is never written to by
// mistake. Tenants are invented and unique to each run, and their rows are deleted at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const OPT_IN = process.env.RUN_PG_AGENTICS_LIMITS === '1';
const URL_HOST = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    return '';
  }
})();
if (OPT_IN && !/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(URL_HOST)) {
  throw new Error('RUN_PG_AGENTICS_LIMITS=1 needs DATABASE_URL on localhost or 127.0.0.1: this test writes rows.');
}

const d = OPT_IN ? describe : describe.skip;
const addr = (n: number) => `0x${'c0ffee'.padEnd(36, '0')}${n.toString(16).padStart(4, '0')}`;
const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => addr(from + i)).join('\n');

d('the Agent Vault plan limits, under concurrency, on a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const tenant = (name: string) => `pg-limits-${run}-${name}`;
  const tenants: string[] = [];
  let vault: typeof import('../src/lib/agentVault/vault');
  let store: typeof import('../src/lib/agentVault/store');
  let db: typeof import('../src/lib/db').db;

  const fresh = (name: string) => {
    const t = tenant(name);
    tenants.push(t);
    return t;
  };
  const count = async (table: string, t: string, extra = '') =>
    Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND deleted_at IS NULL${extra}`, args: [t] })).rows[0].n);
  const newTin = async (t: string, label = 'Agent') => {
    const r = await vault.createTin(t, { label });
    if (!r.ok) throw new Error(`could not create a tin: ${JSON.stringify(r)}`);
    return r.tin;
  };

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    vault = await import('../src/lib/agentVault/vault');
    store = await import('../src/lib/agentVault/store');
    await store.ensureAgentVaultTables();
  });

  afterAll(async () => {
    for (const t of tenants) {
      for (const table of ['agent_destinations', 'agent_wallets', 'agent_tins']) await db.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [t] });
    }
  });

  it('twenty requests at once for the last agent slot make exactly one agent', async () => {
    const t = fresh('tins');
    await newTin(t, 'One');
    await newTin(t, 'Two');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => vault.createTin(t, { label: `Racer ${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(19);
    expect(await count('agent_tins', t)).toBe(3);
  });

  it('twenty requests at once for the last own-wallet slot add exactly one wallet', async () => {
    const t = fresh('wallets');
    const tin = await newTin(t);
    for (let n = 1; n <= 4; n += 1) await vault.addWallet(t, { tinId: tin.id, chain: 'ethereum', address: addr(n) });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => vault.addWallet(t, { tinId: tin.id, chain: 'ethereum', address: addr(100 + i) })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(19);
    expect(await count('agent_wallets', t)).toBe(5);
  });

  it('thirty requests at once for the last address slot add exactly one address', async () => {
    const t = fresh('one-slot');
    const tin = await newTin(t);
    await vault.addDestinations(t, { tinId: tin.id, text: lines(1, 10), trust: false });
    await vault.addDestinations(t, { tinId: tin.id, text: lines(11, 4), trust: false });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => vault.addDestinations(t, { tinId: tin.id, text: addr(100 + i), trust: false })));
    expect(results.filter((r) => r.ok && r.summary.added === 1)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(29);
    expect(await count('agent_destinations', t)).toBe(15);
  });

  it('twenty pastes of ten at once add fifteen addresses in all, never more', async () => {
    const t = fresh('pastes');
    const tin = await newTin(t);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => vault.addDestinations(t, { tinId: tin.id, text: lines(1000 + i * 10, 10), trust: false })));
    expect(results.reduce((n, r) => n + (r.ok ? r.summary.added : 0), 0)).toBe(15);
    expect(await count('agent_destinations', t)).toBe(15);
  });

  it('the limit is for the account, not for each agent: three agents racing add fifteen in all', async () => {
    const t = fresh('pooled');
    const tins = [await newTin(t, 'One'), await newTin(t, 'Two'), await newTin(t, 'Three')];
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => vault.addDestinations(t, { tinId: tins[i % 3].id, text: lines(2000 + i * 3, 3), trust: false })));
    expect(results.reduce((n, r) => n + (r.ok ? r.summary.added : 0), 0)).toBe(15);
    expect(await count('agent_destinations', t)).toBe(15);
  });

  it('one address added by many requests at once takes one slot, and the others are told it is already registered', async () => {
    const t = fresh('same-address');
    const tin = await newTin(t);
    const results = await Promise.all(Array.from({ length: 12 }, () => vault.addDestinations(t, { tinId: tin.id, text: addr(7), trust: false })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.summary.added === 1)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.skipped.some((s) => s.reason === 'already_registered'))).toHaveLength(11);
    expect(await count('agent_destinations', t)).toBe(1);
  });

  it('one new address added by many requests at once with one place left takes it once, and none of the others is told the plan is full', async () => {
    const t = fresh('last-same');
    const tin = await newTin(t);
    await vault.addDestinations(t, { tinId: tin.id, text: lines(1, 10), trust: false });
    await vault.addDestinations(t, { tinId: tin.id, text: lines(11, 4), trust: false });
    const results = await Promise.all(Array.from({ length: 12 }, () => vault.addDestinations(t, { tinId: tin.id, text: addr(100), trust: false })));
    expect(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok))).toBe(true);
    expect(results.filter((r) => r.ok && r.summary.added === 1)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.skipped.some((x) => x.reason === 'already_registered'))).toHaveLength(11);
    expect(await count('agent_destinations', t)).toBe(15);
  });

  it('removing an agent while adds race for it leaves nothing live under it, and no place held', async () => {
    const t = fresh('remove-race');
    const gone = await newTin(t, 'Gone');
    const keep = await newTin(t, 'Keep');
    await vault.addDestinations(t, { tinId: keep.id, text: lines(500, 3), trust: false });
    const jobs: Array<Promise<unknown>> = [vault.removeTin(t, gone.id)];
    for (let i = 0; i < 12; i += 1) jobs.push(vault.addDestinations(t, { tinId: gone.id, text: addr(600 + i), trust: false }));
    for (let i = 0; i < 4; i += 1) jobs.push(vault.addWallet(t, { tinId: gone.id, chain: 'ethereum', address: addr(700 + i) }));
    await Promise.all(jobs);
    const underGone = async (table: string) =>
      Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ? AND tin_id = ? AND deleted_at IS NULL`, args: [t, gone.id] })).rows[0].n);
    expect(await underGone('agent_destinations')).toBe(0);
    expect(await underGone('agent_wallets')).toBe(0);
    // Only the other agent's three addresses use the plan.
    expect((await (await import('../src/lib/agentVault/entitlements')).getPlanSummary(t)).use).toEqual({ bots: 1, addresses: 3 });
    expect(await store.countLiveDestinations(t)).toBe(3);
    expect(await count('agent_destinations', t)).toBe(3);
  });

  it('an address added to an agent that was removed a moment before is refused as tin_not_found and stores nothing', async () => {
    const t = fresh('removed-first');
    const tin = await newTin(t);
    await vault.removeTin(t, tin.id);
    // The request got past its own check of the agent (as one that was already running would have); the insert itself looks again.
    expect(await store.insertDestinationWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(1), label: null, at: store.nowUtc() }, 15)).toEqual({ kind: 'no_tin' });
    expect(await store.insertWalletWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(2), at: store.nowUtc() }, 5)).toEqual({ kind: 'no_tin' });
    expect(await count('agent_destinations', t)).toBe(0);
    expect(await count('agent_wallets', t)).toBe(0);
  });

  it('accounts racing at the same time each get their own limit: neither waits on, nor counts, the other', async () => {
    const [a, b] = [fresh('iso-a'), fresh('iso-b')];
    const [tinA, tinB] = [await newTin(a), await newTin(b)];
    const jobs = Array.from({ length: 40 }, (_, i) => {
      const t = i % 2 === 0 ? a : b;
      return vault.addDestinations(t, { tinId: (i % 2 === 0 ? tinA : tinB).id, text: addr(3000 + i), trust: false });
    });
    const results = await Promise.all(jobs);
    expect(results.filter((r) => r.ok)).toHaveLength(30);
    expect(await count('agent_destinations', a)).toBe(15);
    expect(await count('agent_destinations', b)).toBe(15);
  });

  it('a slot freed while requests are racing is taken once, and the count never passes the limit', async () => {
    const t = fresh('free');
    const tin = await newTin(t);
    const first = await vault.addDestinations(t, { tinId: tin.id, text: lines(1, 10), trust: false });
    await vault.addDestinations(t, { tinId: tin.id, text: lines(11, 5), trust: false });
    if (!first.ok) throw new Error('setup failed');
    const removing = vault.removeDestination(t, first.destinations[0].id);
    const adds = Array.from({ length: 10 }, (_, i) => vault.addDestinations(t, { tinId: tin.id, text: addr(500 + i), trust: false }));
    await Promise.all([removing, ...adds]);
    expect(await count('agent_destinations', t)).toBeLessThanOrEqual(15);
  });
});
