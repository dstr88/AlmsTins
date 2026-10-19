import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk, fakeDeps, walletResult, type FakeDeps } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * The plan an account is on and the limits it brings: 3 agents, 15 registered addresses pooled over
 * them, and 5 own wallets for each agent, for every account but the owner's, which has none.
 * Enforced where rows are written (vault.ts over the capped inserts in store.ts), over the same
 * in-memory stand-in for the database the other Vault tests use. A real Postgres proves the race
 * (tests/pgAgenticsLimits.test.ts, opt-in); here the rules are pinned: every boundary, what frees a
 * slot, who is exempt, whose rows count. Every address, label, tenant and key is invented.
 */

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({
  db: {
    execute: (s: any) => holder.db.execute(s),
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const A = 'tenant-a';
const B = 'tenant-b';
const OWNER = OWNER_TENANT_ID;

let fake: ReceivablesDbFake;
let vault: typeof import('../../src/lib/agentVault/vault');
let entitlements: typeof import('../../src/lib/agentVault/entitlements');
let deps: FakeDeps;

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  deps = fakeDeps();
  vault = await import('../../src/lib/agentVault/vault');
  entitlements = await import('../../src/lib/agentVault/entitlements');
});

const newTin = async (tenant = A, label = 'Agent') => expectOk(await vault.createTin(tenant, { label })).tin;
const add = (tenant: string, tinId: string, text: string, extra: Record<string, unknown> = {}) => vault.addDestinations(tenant, { tinId, text, ...extra }, deps);
const rows = (table: string) => fake.rows(table);
const live = (table: string, tenant: string) => rows(table).filter((r) => r.tenant_id === tenant && r.deleted_at == null);
/** `n` distinct addresses starting at `from`, one per line. */
const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => addr(from + i)).join('\n');

describe('the plan an account is on', () => {
  it('is Free for every account but the owner: 3 agents, 15 addresses over all of them, 5 own wallets for each agent', async () => {
    for (const tenant of [A, B, '00000000-0000-4000-8000-000000000002', 'x']) {
      expect(await entitlements.getEntitlements(tenant), tenant).toEqual({
        plan: 'free',
        label: 'Free',
        limits: { bots: 3, addresses: 15, walletsPerBot: 5 },
      });
    }
    expect(entitlements.FREE_LIMITS).toEqual({ bots: 3, addresses: 15, walletsPerBot: 5 });
  });

  it('has no limits for the owner, whatever the letter case of the id', async () => {
    for (const id of [OWNER, OWNER.toUpperCase()]) {
      expect(await entitlements.getEntitlements(id)).toEqual({
        plan: 'unlimited',
        label: 'Unlimited',
        limits: { bots: null, addresses: null, walletsPerBot: null },
      });
    }
  });

  it('is never decided by the account asking for it: nothing in the request can raise a limit', async () => {
    // The only input is the tenant id from the session; a plan name or limit in a request body is not read anywhere.
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, addr(1), { plan: 'unlimited', limits: { addresses: 999 }, tenantId: OWNER }));
    expect(r.summary.added).toBe(1);
    expect(await entitlements.getEntitlements(A)).toMatchObject({ plan: 'free' });
  });

  it('says what an account uses: live agents and live registered addresses, never removed ones, never another account\'s', async () => {
    const t1 = await newTin(A, 'One');
    const t2 = await newTin(A, 'Two');
    const other = await newTin(B, 'Theirs');
    expectOk(await add(A, t1.id, lines(1, 4)));
    expectOk(await add(A, t2.id, lines(10, 3)));
    expectOk(await add(B, other.id, lines(20, 5)));
    const gone = expectOk(await add(A, t1.id, addr(99))).destinations[0];
    expectOk(await vault.removeDestination(A, gone.id));
    expect(await entitlements.getPlanSummary(A)).toEqual({
      plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 2, addresses: 7 },
    });
    expect((await entitlements.getPlanSummary(B)).use).toEqual({ bots: 1, addresses: 5 });
    expect((await entitlements.getPlanSummary('nobody')).use).toEqual({ bots: 0, addresses: 0 });
  });

  it('slotsLeft: null with no limit, otherwise what is left, never below zero', () => {
    expect(entitlements.slotsLeft(null, 99)).toBeNull();
    expect(entitlements.slotsLeft(3, 0)).toBe(3);
    expect(entitlements.slotsLeft(3, 3)).toBe(0);
    expect(entitlements.slotsLeft(3, 7)).toBe(0);
  });
});

describe('agents: 3 on the Free plan', () => {
  it('allows the third and refuses the fourth, with the cap, the limit and the use, and stores nothing', async () => {
    await newTin(A, 'One');
    await newTin(A, 'Two');
    expect(await vault.createTin(A, { label: 'Three' })).toMatchObject({ ok: true });
    const refused = await vault.createTin(A, { label: 'Four' });
    expect(refused).toEqual({ ok: false, error: 'plan_limit', cap: 'bots', limit: 3, used: 3 });
    expect(live('agent_tins', A).map((t) => t.label)).toEqual(['One', 'Two', 'Three']);
    expect(rows('agent_tins')).toHaveLength(3);
  });

  it('a removed agent frees its slot, and the removed row stays as history without counting', async () => {
    const one = await newTin(A, 'One');
    await newTin(A, 'Two');
    await newTin(A, 'Three');
    expect((await vault.createTin(A, { label: 'Four' })).ok).toBe(false);
    expectOk(await vault.removeTin(A, one.id));
    expect(rows('agent_tins')).toHaveLength(3); // soft delete: the row stays
    expect(expectOk(await vault.createTin(A, { label: 'Four' })).tin.label).toBe('Four');
    expect(rows('agent_tins')).toHaveLength(4);
    expect(live('agent_tins', A)).toHaveLength(3);
    expect(await vault.createTin(A, { label: 'Five' })).toMatchObject({ ok: false, error: 'plan_limit', used: 3 });
  });

  it('counts the account\'s own agents only: another account\'s are not in the count, and are not blocked by it', async () => {
    for (const label of ['a', 'b', 'c']) await newTin(A, label);
    expect((await vault.createTin(A, { label: 'd' })).ok).toBe(false);
    for (const label of ['x', 'y', 'z']) await newTin(B, label);
    expect(await vault.createTin(B, { label: 'w' })).toMatchObject({ ok: false, error: 'plan_limit', cap: 'bots', limit: 3, used: 3 });
    expect(live('agent_tins', A)).toHaveLength(3);
    expect(live('agent_tins', B)).toHaveLength(3);
  });

  it('has no limit for the owner', async () => {
    for (let i = 0; i < 7; i += 1) expectOk(await vault.createTin(OWNER, { label: `Agent ${i}` }));
    expect(live('agent_tins', OWNER)).toHaveLength(7);
    // And the owner's agents never use up anyone else's slots.
    expect((await vault.createTin(A, { label: 'Mine' })).ok).toBe(true);
  });

  it('twenty requests at once for the last slot make exactly one agent', async () => {
    await newTin(A, 'One');
    await newTin(A, 'Two');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => vault.createTin(A, { label: `Racer ${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(19);
    expect(live('agent_tins', A)).toHaveLength(3);
  });

  it('a label or key that is wrong is refused for that reason, before the plan is asked', async () => {
    for (const label of ['a', 'b', 'c']) await newTin(A, label);
    expect(await vault.createTin(A, { label: '   ' })).toEqual({ ok: false, error: 'invalid_label' });
    expect(await vault.createTin(A, { label: 'ok', agentKeyId: 'not a key id' })).toEqual({ ok: false, error: 'key_not_found' });
  });
});

describe('own wallets: 5 for each agent on the Free plan', () => {
  const wallet = (tenant: string, tinId: string, n: number, chain = 'ethereum') => vault.addWallet(tenant, { tinId, chain, address: addr(n) });

  it('allows the fifth and refuses the sixth, with the cap, the limit and the use', async () => {
    const tin = await newTin();
    for (let n = 1; n <= 5; n += 1) expect(await wallet(A, tin.id, n), String(n)).toMatchObject({ ok: true, added: true });
    expect(await wallet(A, tin.id, 6)).toEqual({ ok: false, error: 'plan_limit', cap: 'wallets', limit: 5, used: 5 });
    expect(live('agent_wallets', A)).toHaveLength(5);
  });

  it('is a limit for each agent, not for the account: another agent has its own five', async () => {
    const one = await newTin(A, 'One');
    const two = await newTin(A, 'Two');
    for (let n = 1; n <= 5; n += 1) expectOk(await wallet(A, one.id, n));
    expect((await wallet(A, one.id, 6)).ok).toBe(false);
    for (let n = 1; n <= 5; n += 1) expectOk(await wallet(A, two.id, n));
    expect(live('agent_wallets', A)).toHaveLength(10);
  });

  it('a wallet the agent already lists is not added again and is not refused at the limit', async () => {
    const tin = await newTin();
    for (let n = 1; n <= 5; n += 1) expectOk(await wallet(A, tin.id, n));
    expect(await wallet(A, tin.id, 3)).toMatchObject({ ok: true, added: false });
    expect(live('agent_wallets', A)).toHaveLength(5);
  });

  it('a removed wallet frees its slot', async () => {
    const tin = await newTin();
    const first = expectOk(await wallet(A, tin.id, 1)).wallet;
    for (let n = 2; n <= 5; n += 1) expectOk(await wallet(A, tin.id, n));
    expect((await wallet(A, tin.id, 6)).ok).toBe(false);
    expectOk(await vault.removeWallet(A, first.id));
    expectOk(await wallet(A, tin.id, 6));
    expect(rows('agent_wallets')).toHaveLength(6); // the removed one stays as history
    expect(live('agent_wallets', A)).toHaveLength(5);
  });

  it('has no limit for the owner', async () => {
    const tin = await newTin(OWNER);
    for (let n = 1; n <= 8; n += 1) expectOk(await wallet(OWNER, tin.id, n));
    expect(live('agent_wallets', OWNER)).toHaveLength(8);
  });

  it('twenty requests at once for the last slot add exactly one wallet', async () => {
    const tin = await newTin();
    for (let n = 1; n <= 4; n += 1) expectOk(await wallet(A, tin.id, n));
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => wallet(A, tin.id, 100 + i)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(19);
    expect(live('agent_wallets', A)).toHaveLength(5);
  });
});

describe('registered addresses: 15 over all of an account\'s agents on the Free plan', () => {
  it('allows the fifteenth and refuses the sixteenth, with the cap, the limit and the use', async () => {
    const tin = await newTin();
    const fill = expectOk(await add(A, tin.id, lines(1, 10)));
    expect(fill.summary).toMatchObject({ added: 10, skipped: 0 });
    expect(expectOk(await add(A, tin.id, lines(11, 5))).summary).toMatchObject({ added: 5, skipped: 0 });
    expect(await add(A, tin.id, addr(16))).toEqual({
      ok: false,
      error: 'plan_limit',
      cap: 'addresses',
      limit: 15,
      used: 15,
      skipped: [{ line: 1, chain: 'ethereum', address: addr(16), reason: 'over_limit' }],
      rejected: [],
    });
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('is pooled over the account\'s agents: fifteen across three agents is the limit', async () => {
    const tins = [await newTin(A, 'One'), await newTin(A, 'Two'), await newTin(A, 'Three')];
    for (const [i, tin] of tins.entries()) expectOk(await add(A, tin.id, lines(1 + i * 5, 5)));
    expect(live('agent_destinations', A)).toHaveLength(15);
    for (const tin of tins) expect(await add(A, tin.id, addr(40)), tin.label).toMatchObject({ ok: false, error: 'plan_limit', cap: 'addresses', used: 15 });
  });

  it('a paste longer than the slots left adds what fits and reports the rest as over_limit, in order, with nothing stored', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    const r = expectOk(await add(A, tin.id, `address,label\n${addr(11)}, First\n${addr(12)}\n${addr(13)}\n${addr(14)}\n${addr(15)}\n${addr(16)}, Sixth\n${addr(17)}\nnot an address\n${addr(18)}`));
    expect(r.summary).toEqual({ added: 5, trusted: 5, flagged: 0, pending: 0, skipped: 3, rejected: 1 });
    expect(r.destinations.map((d) => d.address)).toEqual([addr(11), addr(12), addr(13), addr(14), addr(15)]);
    expect(r.skipped).toEqual([
      { line: 7, chain: 'ethereum', address: addr(16), reason: 'over_limit' },
      { line: 8, chain: 'ethereum', address: addr(17), reason: 'over_limit' },
      { line: 10, chain: 'ethereum', address: addr(18), reason: 'over_limit' },
    ]);
    expect(r.rejected).toEqual([{ line: 9, reason: 'no_address', text: 'not an address' }]);
    expect(live('agent_destinations', A)).toHaveLength(15);
    expect(rows('agent_destinations').some((d) => [addr(16), addr(17), addr(18)].includes(d.address))).toBe(false);
  });

  it('the addresses that did not fit are never checked: no outside call is made for them', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 3)));
    const before = deps.calls.wallet.length;
    const r = expectOk(await add(A, tin.id, lines(14, 6)));
    expect(r.summary).toMatchObject({ added: 2, skipped: 4 });
    expect(deps.calls.wallet.slice(before).sort()).toEqual([addr(14), addr(15)]);
  });

  it('a paste that fits none of its addresses is refused as a whole: plan_limit', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 5)));
    const before = deps.calls.wallet.length;
    expect(await add(A, tin.id, lines(16, 4))).toEqual({
      ok: false,
      error: 'plan_limit',
      cap: 'addresses',
      limit: 15,
      used: 15,
      skipped: [16, 17, 18, 19].map((n, i) => ({ line: i + 1, chain: 'ethereum', address: addr(n), reason: 'over_limit' })),
      rejected: [],
    });
    expect(deps.calls.wallet.length).toBe(before);
  });

  it('an address that is already registered is never refused at the limit: it takes no slot', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 5)));
    const again = expectOk(await add(A, tin.id, `${addr(3)}\n${addr(4)}`));
    expect(again.summary).toMatchObject({ added: 0, skipped: 2 });
    expect(again.skipped.map((s) => s.reason)).toEqual(['already_registered', 'already_registered']);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('a registered address and a new one at the limit: the new one is over the limit, the registered one is still reported as registered', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 4)));
    const r = expectOk(await add(A, tin.id, `${addr(20)}\n${addr(2)}\n${addr(21)}\n${addr(3)}`));
    expect(r.summary).toMatchObject({ added: 1, skipped: 3 });
    expect(r.skipped.map((s) => [s.address, s.reason])).toEqual([
      [addr(2), 'already_registered'],
      [addr(21), 'over_limit'],
      [addr(3), 'already_registered'],
    ]);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('adding without the checks (trust: false) is limited the same way', async () => {
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, lines(1, 10), { trust: false }));
    expect(r.checked).toBe(false);
    expectOk(await add(A, tin.id, lines(11, 5), { trust: false }));
    expect(await add(A, tin.id, addr(16), { trust: false })).toMatchObject({ ok: false, error: 'plan_limit', cap: 'addresses' });
  });

  it('a removed address frees its slot, and so does removing the whole agent', async () => {
    const one = await newTin(A, 'One');
    const two = await newTin(A, 'Two');
    const first = expectOk(await add(A, one.id, lines(1, 10))).destinations[0];
    expectOk(await add(A, two.id, lines(11, 5)));
    expect((await add(A, one.id, addr(40))).ok).toBe(false);

    expectOk(await vault.removeDestination(A, first.id));
    expect(expectOk(await add(A, one.id, addr(40))).summary.added).toBe(1);
    expect((await add(A, one.id, addr(41))).ok).toBe(false);

    expectOk(await vault.removeTin(A, two.id)); // takes its five addresses with it
    expect(expectOk(await add(A, one.id, lines(50, 5))).summary.added).toBe(5);
    expect(rows('agent_destinations').length).toBeGreaterThan(15); // removed rows stay as history
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('counts the account\'s own addresses only', async () => {
    const mine = await newTin(A);
    const theirs = await newTin(B);
    expectOk(await add(A, mine.id, lines(1, 10)));
    expectOk(await add(A, mine.id, lines(11, 5)));
    expect((await add(A, mine.id, addr(30))).ok).toBe(false);
    // The same addresses in another account are that account's own, and take its slots.
    expect(expectOk(await add(B, theirs.id, lines(1, 10))).summary.added).toBe(10);
    expect(live('agent_destinations', B)).toHaveLength(10);
  });

  it('has no limit for the owner', async () => {
    const tin = await newTin(OWNER);
    for (let i = 0; i < 4; i += 1) expectOk(await add(OWNER, tin.id, lines(1 + i * 10, 10)));
    expect(live('agent_destinations', OWNER)).toHaveLength(40);
  });

  it('thirty requests at once for the last slot add exactly one address', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 4)));
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => add(A, tin.id, addr(100 + i))));
    expect(results.filter((r) => r.ok && r.summary.added === 1)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(29);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('twenty pastes of ten at once never pass the limit', async () => {
    const tin = await newTin();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => add(A, tin.id, lines(1000 + i * 10, 10))));
    const added = results.reduce((n, r) => n + (r.ok ? r.summary.added : 0), 0);
    expect(added).toBe(15);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });
});

describe('how the limits are enforced', () => {
  const capped = () => fake.batches.filter((b) => b.some((s) => /^INSERT INTO agent_(tins|wallets|destinations) /.test(s.sql)));

  it('a limited create is one transaction: the account\'s lock first, then the insert that counts and inserts together', async () => {
    const tin = await newTin();
    expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) }));
    expectOk(await add(A, tin.id, addr(2)));
    const batches = capped();
    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch).toHaveLength(2);
      expect(batch[0].sql).toMatch(/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/);
      expect(batch[0].args).toEqual([A]);
      // A wallet or an address is added only under a live agent of the account (the guard); an agent has none.
      const underAgent = /^INSERT INTO agent_(wallets|destinations) /.test(batch[1].sql);
      expect(batch[1].sql).toMatch(
        /^INSERT INTO agent_(tins|wallets|destinations) \(id, tenant_id, .*\) SELECT \?(, \?)+ WHERE (EXISTS \(SELECT 1 FROM agent_tins WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL\) AND )?\(SELECT COUNT\(\*\) FROM agent_(tins|wallets|destinations)( d)? WHERE (d\.)?tenant_id = \? .*AND (d\.)?deleted_at IS NULL.*\) < \?$/,
      );
      expect(/WHERE EXISTS \(SELECT 1 FROM agent_tins WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL\) AND /.test(batch[1].sql)).toBe(underAgent);
      // The tenant is named in the row, in the guard (an agent has none) and in the count, and the last argument is the limit.
      expect(batch[1].args.filter((a) => a === A)).toHaveLength(underAgent ? 3 : 2);
    }
    expect(batches.map((b) => b[1].args[b[1].args.length - 1])).toEqual([3, 5, 15]);
  });

  it('counts only live rows of the account, in the statement itself', async () => {
    const tin = await newTin();
    await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) });
    await add(A, tin.id, addr(2));
    for (const sql of fake.log.map((s) => s.sql).filter((s) => /SELECT COUNT\(\*\)/.test(s))) {
      expect(sql, sql).toMatch(/\btenant_id = \?/);
      expect(sql, sql).toMatch(/\bdeleted_at IS NULL\b/);
      expect(sql, sql).not.toMatch(/\bJOIN\b/i);
    }
    expect(fake.log.some((s) => /SELECT COUNT\(\*\)/.test(s.sql))).toBe(true);
  });

  it('the owner\'s own wallets and addresses are added behind the same lock and under a live agent, but nothing is counted', async () => {
    const tin = await newTin(OWNER);
    fake.batches.length = 0;
    fake.log.length = 0;
    await vault.addWallet(OWNER, { tinId: tin.id, chain: 'ethereum', address: addr(1) });
    await add(OWNER, tin.id, addr(2));
    const batches = capped();
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      expect(batch[0].sql).toMatch(/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/);
      expect(batch[0].args).toEqual([OWNER]);
      // The agent is checked live in the statement itself, and no count and no limit are in it.
      expect(batch[1].sql).toMatch(/WHERE EXISTS \(SELECT 1 FROM agent_tins WHERE id = \? AND tenant_id = \? AND deleted_at IS NULL\)$/);
      expect(batch[1].sql).not.toMatch(/COUNT\(\*\)/);
    }
    expect(fake.log.some((s) => /SELECT COUNT/.test(s.sql))).toBe(false);
    expect(live('agent_tins', OWNER)).toHaveLength(1);
    expect(live('agent_wallets', OWNER)).toHaveLength(1);
    expect(live('agent_destinations', OWNER)).toHaveLength(1);
  });

  it('an agent of the owner is the plain insert: there is nothing above it to check, and no cap to count', async () => {
    fake.batches.length = 0;
    await newTin(OWNER);
    expect(capped()).toHaveLength(0);
  });

  it('a refused create writes no row and answers without any text of its own', async () => {
    for (const label of ['a', 'b', 'c']) await newTin(A, label);
    const before = rows('agent_tins').length;
    const refused = await vault.createTin(A, { label: 'd' });
    expect(Object.keys(refused).sort()).toEqual(['cap', 'error', 'limit', 'ok', 'used']);
    expect(rows('agent_tins')).toHaveLength(before);
  });

  it('a test of the checks is not needed to hit the limit: a flagged address takes a slot like any other', async () => {
    const tin = await newTin();
    deps.wallets[addr(1)] = walletResult({ flags: { sanctioned: true } });
    expectOk(await add(A, tin.id, `${addr(1)}\n${lines(2, 9)}`));
    expectOk(await add(A, tin.id, lines(11, 5)));
    expect((await add(A, tin.id, addr(40))).ok).toBe(false);
    expect(live('agent_destinations', A).filter((d) => d.trust_status === 'flagged')).toHaveLength(1);
  });
});

describe('an agent that is removed while a request for it is running', () => {
  /** Removes the agent just before the next capped insert under it runs: the request has passed its checks and is about to write. */
  function removeAgentBeforeNextInsert(tenant: string, tinId: string) {
    const real = holder.db;
    let done = false;
    holder.db = {
      execute: (s: any) => real.execute(s),
      batch: async (s: any, m?: any) => {
        if (!done && s.some((x: any) => /^INSERT INTO agent_(wallets|destinations) /.test(x.sql))) {
          done = true;
          expectOk(await vault.removeTin(tenant, tinId));
        }
        return real.batch(s, m);
      },
    };
  }

  it('writes no address under it: the answer is tin_not_found, nothing is stored, and no place on the plan is held', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, addr(1)));
    removeAgentBeforeNextInsert(A, tin.id);
    expect(await add(A, tin.id, addr(2))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(rows('agent_destinations').filter((r) => r.address === addr(2))).toHaveLength(0);
    expect(live('agent_destinations', A)).toHaveLength(0);
    expect((await entitlements.getPlanSummary(A)).use).toEqual({ bots: 0, addresses: 0 });
  });

  it('writes no own wallet under it either', async () => {
    const tin = await newTin();
    removeAgentBeforeNextInsert(A, tin.id);
    expect(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(rows('agent_wallets')).toHaveLength(0);
  });

  it('holds for the owner too, whose plan has no limits: nothing is written under the removed agent', async () => {
    const tin = await newTin(OWNER);
    removeAgentBeforeNextInsert(OWNER, tin.id);
    expect(await add(OWNER, tin.id, addr(2))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(rows('agent_destinations').filter((r) => r.address === addr(2))).toHaveLength(0);
    const second = await newTin(OWNER, 'Second');
    removeAgentBeforeNextInsert(OWNER, second.id);
    expect(await vault.addWallet(OWNER, { tinId: second.id, chain: 'ethereum', address: addr(3) })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(rows('agent_wallets')).toHaveLength(0);
    expect(live('agent_destinations', OWNER)).toHaveLength(0);
  });

  it('a registered address whose agent is gone counts for nothing, even if its row were somehow still live', async () => {
    const gone = await newTin(A, 'Gone');
    const keep = await newTin(A, 'Keep');
    expectOk(await add(A, gone.id, lines(1, 5)));
    expectOk(await vault.removeTin(A, gone.id));
    for (const r of rows('agent_destinations')) r.deleted_at = null; // what a leaked row would look like
    expect((await entitlements.getPlanSummary(A)).use).toEqual({ bots: 1, addresses: 0 });
    // The account still has all fifteen places, and the stray row does not hold one (a paste takes ten at most).
    expect(expectOk(await add(A, keep.id, lines(20, 10))).summary).toMatchObject({ added: 10, skipped: 0 });
    expect(expectOk(await add(A, keep.id, lines(30, 5))).summary).toMatchObject({ added: 5, skipped: 0 });
  });

  it('removing an agent takes the account\'s lock first, the one a capped add takes, so the two take turns', async () => {
    const tin = await newTin();
    fake.batches.length = 0;
    expectOk(await vault.removeTin(A, tin.id));
    const removal = fake.batches.find((b) => b.some((s) => /^UPDATE agent_tins SET deleted_at/.test(s.sql)));
    expect(removal?.[0].sql).toMatch(/^SELECT pg_advisory_xact_lock\(\d+, hashtext\(\?\)\)$/);
    expect(removal?.[0].args).toEqual([A]);
  });
});

describe('the same address added by two requests at once, with one place left', () => {
  it('registers it once, and tells the second request it is already registered, not that the plan is full', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 4))); // 14 of 15
    const [one, two] = await Promise.all([add(A, tin.id, addr(100)), add(A, tin.id, addr(100))]);
    expect(one.ok && two.ok, JSON.stringify([one, two])).toBe(true);
    const results = [one, two].filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
    expect(results.filter((r) => r.summary.added === 1)).toHaveLength(1);
    expect(results.filter((r) => r.skipped.some((s) => s.reason === 'already_registered'))).toHaveLength(1);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('is the same for an own wallet', async () => {
    const tin = await newTin();
    for (let n = 1; n <= 4; n += 1) expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(n) }));
    const [one, two] = await Promise.all([
      vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(100) }),
      vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(100) }),
    ]);
    expect(one.ok && two.ok, JSON.stringify([one, two])).toBe(true);
    expect([one, two].filter((r) => r.ok && r.added)).toHaveLength(1);
    expect(live('agent_wallets', A)).toHaveLength(5);
  });

  it('a different new address that arrives second is still refused as over the limit', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 4)));
    const [one, two] = await Promise.all([add(A, tin.id, addr(100)), add(A, tin.id, addr(101))]);
    expect([one, two].filter((r) => r.ok)).toHaveLength(1);
    expect([one, two].filter((r) => !r.ok && r.error === 'plan_limit')).toHaveLength(1);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });
});

describe('a paste that the plan refuses says what became of every line', () => {
  it('lists the lines already registered, repeated, unreadable and over the limit, in the order they were pasted', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 5)));
    const refused = (await add(A, tin.id, `${addr(3)}\n${addr(3)}\nnot an address\n${addr(40)}\n${addr(41)}`)) as any;
    expect(refused).toMatchObject({ ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 });
    expect(refused.skipped.map((s: any) => [s.line, s.reason])).toEqual([[1, 'already_registered'], [2, 'repeated_in_paste'], [4, 'over_limit'], [5, 'over_limit']]);
    expect(refused.skipped[0]).toMatchObject({ address: addr(3), trustStatus: 'trusted' });
    expect(typeof refused.skipped[0].id).toBe('string');
    expect(refused.rejected.map((x: any) => [x.line, x.reason])).toEqual([[3, 'no_address']]);
    expect(live('agent_destinations', A)).toHaveLength(15);
  });

  it('an own-wallet or agent refusal carries no lines: only a paste has any', async () => {
    for (const label of ['a', 'b', 'c']) await newTin(A, label);
    expect(Object.keys((await vault.createTin(A, { label: 'd' })) as object).sort()).toEqual(['cap', 'error', 'limit', 'ok', 'used']);
  });
});

describe('the budget of checks', () => {
  const budgetOf = async (max: number) => (await import('../../src/lib/agentVault/checkBudget')).createCheckBudget({ max });

  it('pays for an add before anything is written: over the budget nothing is stored or asked, and the answer is rate_limited', async () => {
    deps.budget = await budgetOf(12);
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    const asked = deps.calls.wallet.length;
    expect(await add(A, tin.id, lines(11, 5))).toEqual({ ok: false, error: 'rate_limited' });
    expect(live('agent_destinations', A)).toHaveLength(10);
    expect(deps.calls.wallet.length).toBe(asked);
    // A refusal took nothing: the two places left in the budget are still there.
    expect(expectOk(await add(A, tin.id, lines(11, 2))).summary.added).toBe(2);
  });

  it('costs an add that asks for no checks nothing', async () => {
    deps.budget = await budgetOf(3);
    const tin = await newTin();
    expect(expectOk(await add(A, tin.id, lines(1, 8), { trust: false })).summary).toMatchObject({ added: 8, pending: 8 });
    expect(expectOk(await add(A, tin.id, lines(9, 3))).summary.added).toBe(3); // the budget is whole
  });

  it('pays for a check of existing addresses by the address, and refuses before any is asked', async () => {
    deps.budget = await budgetOf(12);
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 6), { trust: false }));
    const ids = live('agent_destinations', A).map((r) => r.id as string);
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids }, deps)).destinations).toHaveLength(6);
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids }, deps)).destinations).toHaveLength(6);
    const asked = deps.calls.wallet.length;
    expect(await vault.trustDestinations(A, { tinId: tin.id, ids }, deps)).toEqual({ ok: false, error: 'rate_limited' });
    expect(deps.calls.wallet.length).toBe(asked);
  });

  it('asks nothing of an account that has nothing to check: an empty list is not refused', async () => {
    deps.budget = await budgetOf(1);
    const tin = await newTin();
    expectOk(await add(A, tin.id, addr(1))); // spends the one
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps)).destinations).toEqual([]);
  });

  it('is for each account, and not for the owner', async () => {
    deps.budget = await budgetOf(5);
    const mine = await newTin(A);
    const theirs = await newTin(B);
    const owners = await newTin(OWNER);
    expectOk(await add(A, mine.id, lines(1, 5)));
    expect(await add(A, mine.id, addr(30))).toEqual({ ok: false, error: 'rate_limited' });
    expectOk(await add(B, theirs.id, lines(1, 5))); // their own five
    for (let from = 1; from <= 31; from += 10) expect(expectOk(await add(OWNER, owners.id, lines(from, 10))).summary.added).toBe(10); // no cap on addresses, no budget
  });

  it('gives back the checks of lines that were not made: pasting addresses that are already registered again and again costs nothing', async () => {
    deps.budget = await budgetOf(25);
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10))); // ten checks made and spent
    // The same ten, four times over: each paste is paid for in advance (10 more would be 20, then 30 without a refund),
    // every line is "already registered", nothing is asked, and the charge is given back.
    for (let i = 0; i < 4; i += 1) expect(expectOk(await add(A, tin.id, lines(1, 10))).summary, String(i)).toMatchObject({ added: 0, skipped: 10 });
    expect(expectOk(await add(A, tin.id, lines(11, 5))).summary.added).toBe(5); // ten used, five more: fifteen of twenty-five
    expect(expectOk(await add(A, tin.id, lines(1, 10))).summary.skipped).toBe(10);
    expect(await vault.addDestinations(A, { tinId: tin.id, text: lines(30, 10) }, deps)).toMatchObject({ ok: false, error: 'plan_limit' }); // the plan is full: refused, and given back
    expect(deps.calls.wallet).toHaveLength(15); // fifteen addresses were ever asked about
  });

  it('gives back the whole charge when the plan is full: a refused paste asked nobody anything', async () => {
    deps.budget = await budgetOf(30);
    const tin = await newTin();
    expectOk(await add(A, tin.id, lines(1, 10)));
    expectOk(await add(A, tin.id, lines(11, 5))); // fifteen: the plan is full, fifteen spent
    // Six refused pastes of ten: each is paid for in advance (25 of 30), refused, and given back. Without the
    // refund the second would already be over the budget.
    for (let i = 0; i < 6; i += 1) expect(await add(A, tin.id, lines(100 + i * 10, 10)), String(i)).toMatchObject({ ok: false, error: 'plan_limit' });
    // The other fifteen are still there for checking the registered addresses again (ten at a time).
    const ids = live('agent_destinations', A).map((r) => r.id as string);
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: ids.slice(0, 10) }, deps)).destinations).toHaveLength(10);
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: ids.slice(10) }, deps)).destinations).toHaveLength(5);
    expect(await vault.trustDestinations(A, { tinId: tin.id, ids: ids.slice(0, 1) }, deps)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('gives the whole charge back when the agent was removed while the paste was being added: nothing was written, nothing was asked', async () => {
    const real = await budgetOf(12);
    const tin = await newTin();
    deps.budget = {
      spend: (t, n, now) => {
        const paid = real.spend(t, n, now);
        // The agent is removed after the paste was paid for and before anything is written.
        rows('agent_tins').find((r) => r.id === tin.id)!.deleted_at = '2026-10-18T12:00:00.000Z';
        return paid;
      },
      refund: (t, n, at) => real.refund(t, n, at),
    };
    expect(await add(A, tin.id, lines(1, 10))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(live('agent_destinations', A)).toHaveLength(0);
    expect(deps.calls.wallet).toEqual([]);
    expect(real.spend(A, 12)).toBe(true); // the ten were given back: the whole budget of twelve is still there
  });

  it('names the time it paid at when it gives checks back, so a paste that ends late cannot refund into a newer window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
      const real = await budgetOf(30);
      const tin = await newTin();
      expectOk(await add(A, tin.id, lines(1, 10), { trust: false })); // ten registered, nothing asked
      let slow = true;
      deps.budget = {
        spend: (t, n, now) => {
          const paid = real.spend(t, n, now);
          if (slow) {
            slow = false;
            // While this paste is still being written, more than a minute goes by and the next window is spent in full.
            vi.setSystemTime(new Date('2026-10-18T12:01:10.000Z'));
            expect(real.spend(t, 30, Date.now())).toBe(true);
          }
          return paid;
        },
        refund: (t, n, at) => real.refund(t, n, at),
      };
      // The same ten again: every line is already registered, so the ten paid for are given back, to the window they were taken from.
      expect(expectOk(await add(A, tin.id, lines(1, 10))).summary).toMatchObject({ added: 0, skipped: 10 });
      expect(real.spend(A, 1, Date.now())).toBe(false); // the new window is still full: it was given nothing
    } finally {
      vi.useRealTimers();
    }
  });

  it('an add may be answered from memory, and a check again never is', async () => {
    const tin = await newTin();
    const first = expectOk(await add(A, tin.id, addr(1), { trust: false })).destinations[0];
    expectOk(await add(A, tin.id, addr(2)));
    expect(deps.calls.fresh).toEqual([]); // adding asks for no new screening
    expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [first.id] }, deps));
    expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps));
    expect(deps.calls.fresh).toEqual([addr(1)]); // a person asked to check it again; the second call had nothing pending
  });

  it('is open again a minute later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
      deps.budget = await budgetOf(5);
      const tin = await newTin();
      expectOk(await add(A, tin.id, lines(1, 5)));
      vi.setSystemTime(new Date('2026-10-18T12:00:59.000Z'));
      expect(await add(A, tin.id, addr(30))).toEqual({ ok: false, error: 'rate_limited' });
      vi.setSystemTime(new Date('2026-10-18T12:01:01.000Z'));
      expect(expectOk(await add(A, tin.id, addr(30))).summary.added).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is counted after the cheap refusals, so an add that was never going to run spends none of it', async () => {
    deps.budget = await budgetOf(5);
    const tin = await newTin();
    expect(await add(A, 'no-such-tin', lines(1, 5))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await add(A, tin.id, '')).toEqual({ ok: false, error: 'nothing_to_add' });
    expect(expectOk(await add(A, tin.id, lines(1, 5))).summary.added).toBe(5);
  });
});
