// REAL-POSTGRES TEST, opt-in (RUN_PG_AGENTICS_LIMITS=1 + a DATABASE_URL on localhost); it WRITES.
// The unit step of CI skips it (vitest.ci.config.ts excludes tests/pg*.test.ts); CI runs it in its own
// step against the job's throwaway Postgres (.github/workflows/ci.yml, which tests/agentics/guards.test.ts
// holds to exactly that), so a regression in the locks or the capped inserts fails the build.
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
// Skips without the opt-in. With the opt-in but a DATABASE_URL that is not on this machine it throws,
// so a real database is never written to by mistake; with the opt-in and a database that cannot be
// reached it fails (it never passes by skipping). Tenants are invented and unique to each run, and
// their rows are deleted at the end.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

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

  it('the same is true with no limit, which is how the owner\'s account adds: an agent that was removed takes nothing', async () => {
    const t = fresh('removed-first-unlimited');
    const tin = await newTin(t);
    await vault.removeTin(t, tin.id);
    expect(await store.insertDestinationWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(1), label: null, at: store.nowUtc() }, null)).toEqual({ kind: 'no_tin' });
    expect(await store.insertWalletWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(2), at: store.nowUtc() }, null)).toEqual({ kind: 'no_tin' });
    expect(await count('agent_destinations', t)).toBe(0);
    expect(await count('agent_wallets', t)).toBe(0);
    // And an agent that is live takes them, so the refusal above is the guard and not a broken insert.
    const live = await newTin(t, 'Live');
    expect((await store.insertDestinationWithinCap(t, { tinId: live.id, chain: 'ethereum', address: addr(3), label: null, at: store.nowUtc() }, null)).kind).toBe('inserted');
    expect((await store.insertWalletWithinCap(t, { tinId: live.id, chain: 'ethereum', address: addr(4), at: store.nowUtc() }, null)).kind).toBe('inserted');
  });

  it('removing an agent while unlimited adds race for it leaves nothing live under it', async () => {
    for (let round = 0; round < 5; round += 1) {
      const t = fresh(`remove-race-unlimited-${round}`);
      const gone = await newTin(t, 'Gone');
      const jobs: Array<Promise<unknown>> = [store.softDeleteTin(t, gone.id, store.nowUtc())];
      for (let i = 0; i < 10; i += 1) {
        jobs.push(store.insertDestinationWithinCap(t, { tinId: gone.id, chain: 'ethereum', address: addr(800 + i), label: null, at: store.nowUtc() }, null));
        jobs.push(store.insertWalletWithinCap(t, { tinId: gone.id, chain: 'ethereum', address: addr(900 + i), at: store.nowUtc() }, null));
      }
      await Promise.all(jobs);
      expect(await count('agent_destinations', t), `round ${round}`).toBe(0);
      expect(await count('agent_wallets', t), `round ${round}`).toBe(0);
    }
  });

  /**
   * Holds the account's lock (the one every capped add and every removal takes) for `ms` in a transaction
   * of its own, and says when it has it. The races above are chance; this is not: whatever is asked while
   * the lock is held has to wait for it, so a statement that does not take the lock finishes at once.
   */
  const holdLock = async (t: string, ms: number) => {
    const held = db.batch(
      [
        { sql: 'SELECT pg_advisory_xact_lock(1095194188, hashtext(?))', args: [t] },
        { sql: `SELECT pg_sleep(${ms / 1000})`, args: [] },
      ],
      'write',
    );
    await new Promise((resolve) => setTimeout(resolve, 150)); // long enough for it to have taken the lock
    // Wrapped: an async function that returned the promise itself would be awaited until the hold was over.
    return { over: held };
  };
  const timed = async (job: () => Promise<unknown>) => {
    const started = Date.now();
    await job();
    return Date.now() - started;
  };

  it('removing an agent waits for the account\'s lock, so a removal and an add take turns', async () => {
    const t = fresh('lock-removal');
    const tin = await newTin(t);
    const held = await holdLock(t, 900);
    const waited = await timed(() => store.softDeleteTin(t, tin.id, store.nowUtc()));
    await held.over;
    expect(waited).toBeGreaterThanOrEqual(500); // about 750 ms of the hold were left; a removal that took no lock would be done in milliseconds
    expect(await count('agent_tins', t)).toBe(0);
  });

  it('every way of adding an address or a wallet waits for it too, with a limit and without one', async () => {
    const t = fresh('lock-adds');
    const tin = await newTin(t);
    for (const [name, job] of [
      ['a capped address', () => store.insertDestinationWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(1), label: null, at: store.nowUtc() }, 15)],
      ['an address with no limit', () => store.insertDestinationWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(2), label: null, at: store.nowUtc() }, null)],
      ['a capped wallet', () => store.insertWalletWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(3), at: store.nowUtc() }, 5)],
      ['a wallet with no limit', () => store.insertWalletWithinCap(t, { tinId: tin.id, chain: 'ethereum', address: addr(4), at: store.nowUtc() }, null)],
    ] as const) {
      const held = await holdLock(t, 700);
      const waited = await timed(job);
      await held.over;
      expect(waited, name).toBeGreaterThanOrEqual(350);
    }
    expect(await count('agent_destinations', t)).toBe(2);
    expect(await count('agent_wallets', t)).toBe(2);
  });

  it('another account is not held by it: the lock is for one account', async () => {
    const [mine, theirs] = [fresh('lock-a'), fresh('lock-b')];
    const [tinA, tinB] = [await newTin(mine), await newTin(theirs)];
    const held = await holdLock(mine, 700);
    const waited = await timed(() => vault.addDestinations(theirs, { tinId: tinB.id, text: addr(5), trust: false }));
    await held.over;
    expect(waited).toBeLessThan(400);
    void tinA;
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 7b: the opening email's claim, the signups table's schema check, and the daily limit's marker,
// on a real Postgres. The in-memory stand-in the unit tests use is a hand-written parser of SQL;
// these run the real statements (a LIKE on the detail, ON CONFLICT, an UPDATE that claims a row,
// an ALTER that waits for a lock) so a difference between the stand-in and Postgres fails here.
// ─────────────────────────────────────────────────────────────────────────────────────────────
d('the opening email, on a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const prefix = `pg-open-${run}-`;
  const tenants = Array.from({ length: 40 }, (_, i) => `${prefix}${String(i).padStart(2, '0')}`);
  let signup: typeof import('../src/lib/agenticsSignup');
  let db: typeof import('../src/lib/db').db;
  const NOW = new Date('2026-10-19T12:00:00.000Z');

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    signup = await import('../src/lib/agenticsSignup');
    await signup.ensureAgenticsSignupsTable();
    // This test sends to everyone waiting. It will not run beside rows that are not its own.
    const others = Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM agentics_signups WHERE tenant_id NOT LIKE ?`, args: [`${prefix}%`] })).rows[0].n);
    if (others > 0) throw new Error('agentics_signups holds rows that are not this test\'s: run it against an empty throwaway database.');
    for (const [i, t] of tenants.entries()) {
      await db.execute({
        sql: `INSERT INTO agentics_signups (tenant_id, source, created_at, welcomed_at) VALUES (?, 'direct', ?, ?)`,
        args: [t, `2026-10-01 00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, '2026-10-01 00:00:00'],
      });
    }
  });

  afterAll(async () => {
    await db.execute({ sql: `DELETE FROM agentics_signups WHERE tenant_id LIKE ?`, args: [`${prefix}%`] });
  });

  const deps = (sent: string[], over: Record<string, unknown> = {}) => ({
    send: async (mail: { to: string }) => { sent.push(mail.to); },
    now: () => NOW,
    appUrl: 'https://almstins.com',
    replyTo: 'support@almstins.com',
    emailOf: async (t: string) => `${t}@example.test`,
    ...over,
  });

  it('twenty requests at once for one account\'s claim give it to exactly one', async () => {
    const t = tenants[0];
    const claims = await Promise.all(Array.from({ length: 20 }, () => signup.claimOpening(t, NOW)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await signup.releaseOpening(t, NOW);
  });

  it('a claim is taken over once it is stale, by the real timestamps, and a release only gives back the claim its caller took', async () => {
    const t = tenants[1];
    const stale = new Date(NOW.getTime() + signup.CLAIM_STALE_MS + 1000);
    expect(await signup.claimOpening(t, NOW)).toBe(true);
    expect(await signup.claimOpening(t, new Date(NOW.getTime() + 1000))).toBe(false);
    expect(await signup.claimOpening(t, stale)).toBe(true); // the first went stale
    await signup.releaseOpening(t, NOW); // the slow first caller fails late: it must not undo the takeover
    const held = (await db.execute({ sql: `SELECT open_claimed_at FROM agentics_signups WHERE tenant_id = ?`, args: [t] })).rows[0] as unknown as { open_claimed_at: string | null };
    expect(held.open_claimed_at).toBe('2026-10-19 12:15:01');
    await signup.releaseOpening(t, stale);
  });

  it('four overlapping calls over forty accounts send each account exactly once', async () => {
    const sent: string[] = [];
    const reports = await Promise.all(Array.from({ length: 4 }, () => signup.sendOpeningNotices({ apply: true, limit: 200 }, deps(sent))));
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(40);
    expect(sent.sort()).toEqual(tenants.map((t) => `${t}@example.test`).sort());
    const told = Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM agentics_signups WHERE tenant_id LIKE ? AND opened_notified_at IS NOT NULL`, args: [`${prefix}%`] })).rows[0].n);
    expect(told).toBe(40);
    expect((await signup.sendOpeningNotices({ apply: true }, deps([]))).sent).toBe(0);
  });

  it('a mail that went out but could not be marked leaves the account claimed, so the next call does not send it again at once', async () => {
    const t = `${prefix}late`;
    await db.execute({ sql: `INSERT INTO agentics_signups (tenant_id, source, created_at, welcomed_at) VALUES (?, 'direct', '2026-10-02 00:00:00', '2026-10-02 00:00:00')`, args: [t] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent: string[] = [];
    // Fail the mark: a trigger that refuses the update which sets opened_notified_at.
    await db.execute({ sql: `CREATE OR REPLACE FUNCTION pg_open_refuse_${run}() RETURNS trigger AS $$ BEGIN IF NEW.opened_notified_at IS NOT NULL AND NEW.tenant_id = '${t}' THEN RAISE EXCEPTION 'refused on purpose'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`, args: [] });
    await db.execute({ sql: `CREATE TRIGGER pg_open_refuse_${run} BEFORE UPDATE ON agentics_signups FOR EACH ROW EXECUTE FUNCTION pg_open_refuse_${run}()`, args: [] });
    try {
      const r = await signup.sendOpeningNotices({ apply: true }, deps(sent));
      expect(r.sent).toBe(1);
      expect(sent).toEqual([`${t}@example.test`]);
    } finally {
      await db.execute({ sql: `DROP TRIGGER IF EXISTS pg_open_refuse_${run} ON agentics_signups`, args: [] });
      await db.execute({ sql: `DROP FUNCTION IF EXISTS pg_open_refuse_${run}()`, args: [] });
    }
    const row = (await db.execute({ sql: `SELECT open_claimed_at, opened_notified_at FROM agentics_signups WHERE tenant_id = ?`, args: [t] })).rows[0] as unknown as { open_claimed_at: string | null; opened_notified_at: string | null };
    expect(row.opened_notified_at).toBeNull();
    expect(row.open_claimed_at).not.toBeNull(); // the claim was NOT released
    expect((await signup.sendOpeningNotices({ apply: true }, deps(sent))).sent).toBe(0);
    expect(sent).toHaveLength(1);
  });
});

d('the signups table\'s schema check, on a real Postgres', () => {
  it('does not wait for a row lock when the columns are already there: a fresh process is ready at once while an account is being deleted', async () => {
    const { db } = await import('../src/lib/db');
    const first = await import('../src/lib/agenticsSignup');
    await first.ensureAgenticsSignupsTable();
    const t = `pg-ensure-${randomUUID().slice(0, 8)}`;
    await db.execute({ sql: `INSERT INTO agentics_signups (tenant_id, source) VALUES (?, 'direct')`, args: [t] });
    // A second connection holds a row lock, the way the account-delete batch does.
    const { Client } = await import('pg');
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`UPDATE agentics_signups SET source = 'direct' WHERE tenant_id = $1`, [t]);
      vi.resetModules();
      const fresh = await import('../src/lib/agenticsSignup'); // a new process: nothing remembered
      const started = Date.now();
      await Promise.race([
        fresh.ensureAgenticsSignupsTable(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('the schema check waited for the row lock')), 3000)),
      ]);
      expect(Date.now() - started).toBeLessThan(1500);
      // And a plain read is not queued behind an ALTER either.
      const read = Date.now();
      await db.execute({ sql: `SELECT COUNT(*) AS n FROM agentics_signups WHERE tenant_id = ?`, args: [t] });
      expect(Date.now() - read).toBeLessThan(1500);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
      await db.execute({ sql: `DELETE FROM agentics_signups WHERE tenant_id = ?`, args: [t] });
    }
  });

  it('has both opening columns, and creates nothing twice', async () => {
    const { db } = await import('../src/lib/db');
    const signup = await import('../src/lib/agenticsSignup');
    await signup.ensureAgenticsSignupsTable();
    const cols = (await db.execute({ sql: `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agentics_signups'`, args: [] })).rows.map((r) => String((r as unknown as { column_name: unknown }).column_name));
    expect(cols).toEqual(expect.arrayContaining(['tenant_id', 'source', 'created_at', 'claimed_at', 'welcomed_at', 'open_claimed_at', 'opened_notified_at']));
  });
});

d('the daily limit of recorded checks, on a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const tenant = `pg-cap-${run}`;
  const keyId = randomBytes(12).toString('hex'); // a key id is 24 hex characters
  let db: typeof import('../src/lib/db').db;
  let vault: typeof import('../src/lib/agentVault/vault');
  let checkLog: typeof import('../src/lib/agentVault/checkLog');
  let entitlements: typeof import('../src/lib/agentVault/entitlements');
  let tinId = '';
  const DAY = '2026-10-19';
  const at = (iso: string) => new Date(iso);
  const ask = (iso: string, over: Record<string, unknown> = {}) =>
    checkLog.recordKeyedCheck({ keyId, value: addr(1), status: 'proven', level: 'verified', domain: 'acme.example', proofAgeDays: 3, sourceIp: '203.0.113.9', now: at(iso), ...over } as never, { onFlagged: () => undefined });
  const rows = async () => (await db.execute({ sql: `SELECT id, detail_json, occurred_at FROM agent_events WHERE tenant_id = ? AND tin_id = ? ORDER BY occurred_at, id`, args: [tenant, tinId] })).rows as unknown as Array<{ id: string; detail_json: string; occurred_at: string }>;
  const markers = async () => (await rows()).filter((r) => /"limit":\{"reached":true/.test(r.detail_json));

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    vault = await import('../src/lib/agentVault/vault');
    checkLog = await import('../src/lib/agentVault/checkLog');
    entitlements = await import('../src/lib/agentVault/entitlements');
    const keys = await import('../src/lib/agentKeys');
    await keys.listAgentKeys(tenant); // makes the keys table
    await (await import('../src/lib/agentVault/events')).ensureAgentEventsTable();
    await db.execute({
      sql: `INSERT INTO verify_agent_keys (id, tenant_id, domain, challenge_token, key_hash, status, proven_at) VALUES (?, ?, 'pg-cap.example', 'x', ?, 'active', '2026-10-01 00:00:00')`,
      args: [keyId, tenant, `hash-${run}`],
    });
    const made = await vault.createTin(tenant, { label: 'Cap agent', agentKeyId: keyId });
    if (!made.ok) throw new Error(`setup: ${JSON.stringify(made)}`);
    tinId = made.tin.id;
    await vault.addDestinations(tenant, { tinId, text: addr(1), trust: false });
    await db.execute({ sql: `UPDATE agent_destinations SET trust_status = 'trusted' WHERE tenant_id = ? AND tin_id = ?`, args: [tenant, tinId] });
  });

  afterAll(async () => {
    for (const table of ['agent_events', 'agent_destinations', 'agent_wallets', 'agent_tins']) await db.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [tenant] });
    await db.execute({ sql: `DELETE FROM verify_agent_keys WHERE id = ?`, args: [keyId] });
  });

  const fill = async (n: number, when: string) => {
    await db.execute({
      sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, answer, registry, status, key_id, detail_json, occurred_at)
            SELECT 'fill-${run}-' || g || '-' || ?::text, ?, ?, 'checked', ?, 'unknown', 'none', 'unknown', ?, '{}', ? FROM generate_series(1, ?::int) AS g`,
      args: [when, tenant, tinId, addr(900), keyId, when, n],
    });
  };

  it('the check that finds the day full is recorded with a marker, found again by the LIKE, and the rest of the day writes nothing', async () => {
    const limit = entitlements.FREE_LOGGED_CHECKS_PER_DAY;
    await fill(limit, `${DAY}T00:00:00.000Z`);
    const found = await ask(`${DAY}T00:30:00.000Z`);
    expect(found).toMatchObject({ logged: true, answer: 'proven' });
    expect((await markers())).toHaveLength(1);
    expect(await entitlements.getLoggedChecksPerDay(tenant)).toBe(limit);
    // A process that forgot the marker finds it in the ledger.
    checkLog._clearKeyTenantCache();
    expect(await ask(`${DAY}T23:59:59.999Z`)).toMatchObject({ logged: false, reason: 'log_limit' });
    expect((await markers())).toHaveLength(1);
    expect((await rows()).length).toBe(limit + 1);
  });

  it('a check that comes back flagged is still recorded past the limit', async () => {
    const flagged = await ask(`${DAY}T12:00:00.000Z`, { status: 'mismatch', domain: 'other.example' });
    expect(flagged).toMatchObject({ answer: 'flagged', logged: true });
    expect((await markers())).toHaveLength(1);
  });

  it('thirty checks at once on a day that is not marked yet write ONE marker', async () => {
    const limit = entitlements.FREE_LOGGED_CHECKS_PER_DAY;
    const next = '2026-10-20';
    await fill(limit, `${next}T00:00:00.000Z`);
    checkLog._clearKeyTenantCache();
    const answers = await Promise.all(Array.from({ length: 30 }, () => ask(`${next}T08:00:00.000Z`)));
    expect(answers.filter((a) => a?.logged === true)).toHaveLength(1);
    expect(answers.filter((a) => a?.reason === 'log_limit')).toHaveLength(29);
    expect((await markers()).filter((m) => m.occurred_at.startsWith(next))).toHaveLength(1);
  });

  it('the UTC day is the UTC day: the first millisecond of tomorrow starts a clean count', async () => {
    const answer = await ask('2026-10-21T00:00:00.000Z');
    expect(answer).toMatchObject({ logged: true });
    expect(answer).not.toHaveProperty('reason');
    expect((await markers()).filter((m) => m.occurred_at.startsWith('2026-10-21'))).toHaveLength(0);
  });
});

d('the live feed, on a real Postgres', () => {
  const run = randomUUID().slice(0, 8);
  const tenant = `pg-feed-${run}`;
  const other = `pg-feed-other-${run}`;
  let db: typeof import('../src/lib/db').db;
  let store: typeof import('../src/lib/agentVault/store');
  let events: typeof import('../src/lib/agentVault/events');
  let feed: typeof import('../src/lib/agentVault/feed');
  let tinId = '';
  let otherTinId = '';
  let n = 0;

  /** One check, written by a statement of its own, with the table's own created_at (the moment of writing). */
  const writeCheck = async (t = tenant, tin = tinId) => {
    n += 1;
    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, answer, registry, status, detail_json, occurred_at) VALUES (?, ?, ?, 'checked', ?, 'unknown', 'none', 'unknown', '{}', ?)`,
      args: [id, t, tin, addr(n % 50), new Date().toISOString()],
    });
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import('../src/lib/db'));
    store = await import('../src/lib/agentVault/store');
    events = await import('../src/lib/agentVault/events');
    feed = await import('../src/lib/agentVault/feed');
    await (await import('../src/lib/agentKeys')).listAgentKeys(tenant); // makes the keys table
    await events.ensureAgentEventsTable();
    tinId = (await store.insertTin(tenant, { label: 'Feed agent', agentKeyId: null, at: '2026-10-01 00:00:00' })).id;
    otherTinId = (await store.insertTin(other, { label: 'Someone else\'s agent', agentKeyId: null, at: '2026-10-01 00:00:00' })).id;
  });

  afterAll(async () => {
    for (const t of [tenant, other]) for (const table of ['agent_events', 'agent_tins']) await db.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [t] });
  });

  const ok = async (q: Record<string, unknown>) => {
    const r = await feed.readFeed(tenant, q);
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r;
  };

  it('builds its index, and building it again is harmless', async () => {
    await events.ensureFeedIndex();
    const def = async () => (await db.execute({ sql: `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`, args: [events.AGENT_EVENTS_FEED_INDEX] })).rows;
    const rows = await def();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].indexdef)).toMatch(/\(tenant_id, created_at, id\)/);
    // The migration file says the same thing, and runs twice without a complaint.
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../migrations-pg/0055_agent_events_feed_index.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    expect(sql).toHaveLength(1);
    await db.execute({ sql: sql[0], args: [] });
    await db.execute({ sql: sql[0], args: [] });
    expect(await def()).toHaveLength(1);
  });

  it('the statements the feed really runs are served from the index on a ledger of 50,000 rows: a page late in the backlog reads a handful of rows, not everything before it', async () => {
    const planTenant = `pg-feedplan-${run}`;
    try {
      await db.execute({
        sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, answer, registry, status, detail_json, occurred_at, created_at)
              SELECT 'plan-${run}-' || g, ?, 'tin-plan', 'checked', ?, 'unknown', 'none', 'unknown', '{}', '2026-10-01T00:00:00.000Z',
                     to_char(timestamp '2026-09-01 00:00:00' + (g * interval '4 seconds'), 'YYYY-MM-DD HH24:MI:SS')
              FROM generate_series(1, 50000) AS g`,
        args: [planTenant, addr(1)],
      });
      await db.execute({ sql: `ANALYZE agent_events`, args: [] });
      await events.ensureFeedIndex();
      // The SQL the functions themselves send, captured, so this cannot drift from what the feed runs.
      const real = db.execute.bind(db);
      const sent: Array<{ sql: string; args: unknown[] }> = [];
      (db as { execute: typeof db.execute }).execute = ((stmt: any) => {
        if (typeof stmt === 'object' && /FROM agent_events WHERE tenant_id = \?/.test(stmt.sql)) sent.push({ sql: stmt.sql, args: stmt.args });
        return real(stmt);
      }) as typeof db.execute;
      try {
        // Row 45,000 (4 seconds apart from 2026-09-01 00:00:00): a page late in a backlog, with 5,000 rows after it and 45,000 before.
        const late = '2026-09-03 02:00:00';
        await events.eventsWrittenSince(planTenant, { writtenAt: late, limit: 100 });
        await events.eventsWrittenAfter(planTenant, { writtenAt: late, id: `plan-${run}-45000`, limit: 100 });
        await events.latestEventsWritten(planTenant, { limit: 30 });
      } finally {
        (db as { execute: typeof db.execute }).execute = real;
      }
      expect(sent).toHaveLength(3);
      for (const { sql, args } of sent) {
        const r = await db.execute({ sql: `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, args: args as never });
        const raw = Object.values(r.rows[0] as Record<string, unknown>)[0];
        const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const nodes: any[] = [];
        const walk = (n: any) => { nodes.push(n); (n.Plans ?? []).forEach(walk); };
        walk(plan[0].Plan);
        const removed = nodes.reduce((sum, n) => sum + Number(n['Rows Removed by Filter'] ?? 0), 0);
        expect(nodes.some((n) => n['Index Name'] === events.AGENT_EVENTS_FEED_INDEX), sql).toBe(true);
        expect(removed, `${sql} read ${removed} rows it threw away`).toBeLessThan(50);
      }
    } finally {
      await db.execute({ sql: `DELETE FROM agent_events WHERE tenant_id = ?`, args: [planTenant] });
    }
  });

  it('shows a transfer written now for a block an hour old, which a feed that followed the event\'s time would never see', async () => {
    const first = await writeCheck();
    const opened = await ok({});
    expect(opened.events.map((e: any) => e.id)).toContain(first);
    await db.execute({
      sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, chain, answer, registry, status, tx_hash, direction, wallet, amount, asset, usd_value, detail_json, occurred_at)
            VALUES (?, ?, ?, 'transaction', ?, 'ethereum', 'unknown', 'trusted', 'unknown', ?, 'out', ?, '1.5', 'ETH', 4200, '{}', ?)`,
      args: [randomUUID(), tenant, tinId, addr(7), `0x${'ab'.repeat(32)}`, addr(8), new Date(Date.now() - 3600_000).toISOString()],
    });
    const poll = await ok({ since: opened.since });
    const transfer = poll.events.find((e: any) => e.kind === 'transaction');
    if (!transfer) throw new Error('the transfer was not in the poll');
    expect(transfer).toMatchObject({ tx: { direction: 'out', amount: '1.5', asset: 'ETH' }, agent: 'Feed agent' });
    expect(Date.parse(String(transfer.at))).toBeLessThan(Date.now() - 3000_000);
  });

  it('reads a burst of 150 events written in the same second or two, by cursor, once each and in order', async () => {
    const ids = await Promise.all(Array.from({ length: 150 }, () => writeCheck()));
    const start = '1970-01-01 00:00:00';
    const got: string[] = [];
    let q: Record<string, unknown> = { since: start, limit: 40 };
    for (let page = 0; page < 20; page += 1) {
      const r = await ok(q);
      got.push(...r.events.map((e: any) => e.id));
      if (!r.more) break;
      q = { after: r.cursor, limit: 40 };
    }
    expect(new Set(got).size).toBe(got.length);
    for (const id of ids) expect(got).toContain(id);
  });

  it('misses nothing when events are written while a reader is polling: the overlap, the cursor and the ids cover the same-second case', async () => {
    // A reader as the page does it: ask from the newest second seen, follow `more` with the cursor to the end, drop repeats by id.
    const pollAll = async (from: string) => {
      const events: any[] = [];
      let r = await ok({ since: from });
      let since = r.since;
      events.push(...r.events);
      for (let page = 0; r.more && page < 20; page += 1) {
        r = await ok({ after: r.cursor });
        events.push(...r.events);
        if (r.since > since) since = r.since;
      }
      return { events, since };
    };
    const opened = await ok({});
    let since = opened.since;
    const seen = new Set<string>(opened.events.map((e: any) => e.id));
    const written: string[] = [];
    let done = false;
    const writer = (async () => {
      for (let batch = 0; batch < 8; batch += 1) {
        written.push(...(await Promise.all(Array.from({ length: 12 }, () => writeCheck()))));
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      done = true;
    })();
    // Poll while the writer works, then once more after it is done.
    for (let turn = 0; turn < 400; turn += 1) {
      const r = await pollAll(since);
      for (const e of r.events) seen.add(e.id);
      since = r.since;
      if (done && written.every((id) => seen.has(id))) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await writer;
    expect(written).toHaveLength(96);
    for (const id of written) expect(seen.has(id), id).toBe(true);
  });

  it('never shows another account\'s events, and never reads an agent that is not the account\'s', async () => {
    const theirs = await writeCheck(other, otherTinId);
    const all = await ok({ since: '1970-01-01 00:00:00', limit: 200 });
    expect(all.events.map((e: any) => e.id)).not.toContain(theirs);
    expect(await feed.readFeed(tenant, { tinId: otherTinId })).toMatchObject({ ok: false, error: 'tin_not_found' });
    const mine = await feed.readFeed(other, {});
    if (!mine.ok) throw new Error(`expected ok, got ${JSON.stringify(mine)}`);
    expect(mine.events.map((e: any) => e.id)).toEqual([theirs]);
  });
});
