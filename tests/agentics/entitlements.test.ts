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
    expect(await add(A, tin.id, addr(16))).toEqual({ ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 });
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
    expect(await add(A, tin.id, lines(16, 4))).toEqual({ ok: false, error: 'plan_limit', cap: 'addresses', limit: 15, used: 15 });
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
      expect(batch[1].sql).toMatch(/^INSERT INTO agent_(tins|wallets|destinations) \(id, tenant_id, .*\) SELECT \?(, \?)+ WHERE \(SELECT COUNT\(\*\) FROM agent_(tins|wallets|destinations) WHERE tenant_id = \? .*AND deleted_at IS NULL\) < \?$/);
      // The tenant is named in the row and in the count, and the last argument is the limit.
      expect(batch[1].args.filter((a) => a === A)).toHaveLength(2);
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

  it('the owner\'s creates are the plain inserts: no lock, no count', async () => {
    const tin = await newTin(OWNER);
    await vault.addWallet(OWNER, { tinId: tin.id, chain: 'ethereum', address: addr(1) });
    await add(OWNER, tin.id, addr(2));
    expect(capped()).toHaveLength(0);
    expect(fake.log.some((s) => /pg_advisory_xact_lock|SELECT COUNT/.test(s.sql))).toBe(false);
    expect(live('agent_tins', OWNER)).toHaveLength(1);
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
