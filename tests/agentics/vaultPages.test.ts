import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, expectOk } from '../helpers/agentVault';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * What the Vault's agent pages load before they render: the home page's agents and one agent with
 * its wallets, addresses, first page of the ledger and totals. Over the in-memory stand-in for the
 * database, with the account's keys replaced. The rules pinned here: an account reads only its own,
 * a tin that is not its own is exactly a tin that does not exist, a key is offered only to an agent
 * that can take it, and the ledger rows carry nothing a screen has no use for. Every address, label,
 * tenant and key is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; domain: string; status: string; challenge: string | null }>> }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [] }));

const A = 'tenant-a';
const B = 'tenant-b';
const K1 = 'a1'.repeat(12);
const K2 = 'b2'.repeat(12);
const K3 = 'c3'.repeat(12);
const K4 = 'd4'.repeat(12);

let fake: ReceivablesDbFake;
let vault: typeof import('../../src/lib/agentVault/vault');
let events: typeof import('../../src/lib/agentVault/events');
let pages: typeof import('../../src/lib/agentVault/vaultPages');
let store: typeof import('../../src/lib/agentVault/store');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  keys.byTenant = {
    [A]: [
      { id: K1, domain: 'ops.example.test', status: 'active', challenge: null },
      { id: K2, domain: 'pay.example.test', status: 'active', challenge: null },
      { id: K3, domain: 'old.example.test', status: 'revoked', challenge: null },
      { id: K4, domain: 'new.example.test', status: 'pending', challenge: 'a-dns-challenge' },
    ],
    [B]: [{ id: 'f6'.repeat(12), domain: 'other.example.test', status: 'active', challenge: null }],
  };
  vault = await import('../../src/lib/agentVault/vault');
  events = await import('../../src/lib/agentVault/events');
  pages = await import('../../src/lib/agentVault/vaultPages');
  store = await import('../../src/lib/agentVault/store');
});

afterEach(() => {
  delete process.env.ALMSTINS_SIGNING_KEY;
});

const newTin = async (tenant: string, label: string, agentKeyId?: string) => expectOk(await vault.createTin(tenant, { label, agentKeyId })).tin;
const at = (h: number, m = 0, s = 0, ms = 0, day = 17) => new Date(Date.UTC(2026, 9, day, h, m, s, ms)).toISOString();
const check = (tenant: string, tinId: string, n: number, when: string, answer: 'proven' | 'unknown' | 'flagged' = 'unknown', basis = 'not_in_registry') =>
  events.insertCheckedEvent(tenant, {
    tinId, address: addr(n), chain: null, answer, registry: 'none', status: 'unknown', keyId: K1, sourceIp: '203.0.113.9', detail: { basis, cleared: false }, at: when,
  });
const transfer = (tenant: string, tinId: string, n: number, when: string, direction: 'in' | 'out', usd: number | null) =>
  events.insertTransactionEvent(tenant, {
    tinId, address: addr(n), chain: 'ethereum', leg: `native:${n}`, answer: 'unknown', status: null,
    tx: { hash: `0x${String(n).repeat(64).slice(0, 64)}`, direction, wallet: addr(900), amount: '1.5', asset: 'ETH', assetContract: null, usd, blockNumber: n },
    detail: { reason: 'no_preceding_check', source: 'explorer', walletId: 'w', destinationId: 'd' }, at: when,
  });
/** Registers destinations and sets their stored status directly (the checks themselves are not under test here). */
async function register(tenant: string, tinId: string, n: number, status: 'trusted' | 'flagged' | 'pending') {
  const r = await store.insertDestination(tenant, { tinId, chain: 'ethereum', address: addr(n), label: null, at: '2026-10-01 00:00:00' });
  if (r.kind !== 'inserted') throw new Error('setup');
  if (status !== 'pending') {
    const readout = { v: 1 as const, checkedAt: '2026-10-01T00:00:00.000Z', result: status === 'trusted' ? ('pass' as const) : ('fail' as const), hits: [], limits: [], sanctions: 'clear' as const, screening: 'clear' as const, verify: 'unknown' as const, provenBy: null, communityReports: null };
    await store.recordTrust(tenant, r.destination.id, { status, readout, checkedAt: '2026-10-01 00:00:00' });
  }
  return r.destination;
}

describe('the home page', () => {
  it('has a card for each agent with its key, its counts, its last check and its last transfer', async () => {
    const one = await newTin(A, 'Treasury agent', K1);
    const two = await newTin(A, 'Payments agent');
    expectOk(await vault.addWallet(A, { tinId: one.id, chain: 'ethereum', address: addr(901) }));
    expectOk(await vault.addWallet(A, { tinId: one.id, chain: 'polygon', address: addr(902) }));
    await register(A, one.id, 1, 'trusted');
    await register(A, one.id, 2, 'trusted');
    await register(A, one.id, 3, 'flagged');
    await register(A, one.id, 4, 'pending');
    await check(A, one.id, 7, at(8));
    await check(A, one.id, 8, at(9, 30, 5, 123));
    await transfer(A, one.id, 1, at(10, 15), 'in', 12.5);
    await transfer(A, one.id, 2, at(11, 45), 'out', null);

    const home = await pages.loadHomePage(A);
    // Agents made in the same second have no order between them but the order of their ids, so each is found by its own.
    expect(home.agents.map((a) => a.label).sort()).toEqual(['Payments agent', 'Treasury agent']);
    const byId = (id: string) => home.agents.find((a) => a.id === id);
    expect(byId(one.id)).toEqual({
      id: one.id,
      label: 'Treasury agent',
      key: { id: K1, domain: 'ops.example.test', status: 'active' },
      wallets: 2,
      destinations: { trusted: 2, flagged: 1, pending: 1 },
      lastCheckAt: at(9, 30, 5, 123),
      lastTransferAt: at(11, 45),
    });
    expect(byId(two.id)).toEqual({
      id: two.id, label: 'Payments agent', key: null, wallets: 0, destinations: { trusted: 0, flagged: 0, pending: 0 }, lastCheckAt: null, lastTransferAt: null,
    });
  });

  it('offers a new agent only the keys it could take: active, and not linked to another agent', async () => {
    await newTin(A, 'Treasury agent', K1);
    const home = await pages.loadHomePage(A);
    expect(home.availableKeys).toEqual([{ id: K2, domain: 'pay.example.test', status: 'active' }]);
  });

  it('never carries a key\'s secret, its hash or its DNS challenge', async () => {
    await newTin(A, 'Treasury agent', K1);
    const text = JSON.stringify(await pages.loadHomePage(A));
    expect(text).not.toContain('a-dns-challenge');
    expect(text).not.toMatch(/challenge|key_hash|keyHash|avk_/);
  });

  it('shows a linked key that was revoked, marked, so the owner sees why checks stopped being recorded', async () => {
    await newTin(A, 'Treasury agent', K1);
    keys.byTenant[A] = keys.byTenant[A].map((k) => (k.id === K1 ? { ...k, status: 'revoked' } : k)); // revoked after it was linked
    const home = await pages.loadHomePage(A);
    expect(home.agents[0].key).toEqual({ id: K1, domain: 'ops.example.test', status: 'revoked' });
    expect(home.availableKeys.map((k) => k.id)).toEqual([K2]);
  });

  it('says what the account\'s plan is and what it uses', async () => {
    const tin = await newTin(A, 'Treasury agent');
    await register(A, tin.id, 1, 'trusted');
    await register(A, tin.id, 2, 'pending');
    const home = await pages.loadHomePage(A);
    expect(home.plan).toEqual({ plan: 'free', label: 'Free', limits: { bots: 3, addresses: 15, walletsPerBot: 5 }, use: { bots: 1, addresses: 2 } });
    const owner = await pages.loadHomePage(OWNER_TENANT_ID);
    expect(owner.plan.limits).toEqual({ bots: null, addresses: null, walletsPerBot: null });
  });

  it('is empty for an account with no agents, and reads another account\'s nothing', async () => {
    const tin = await newTin(A, 'Treasury agent', K1);
    await register(A, tin.id, 1, 'trusted');
    await check(A, tin.id, 7, at(8));
    expect((await pages.loadHomePage(B)).agents).toEqual([]);
    expect((await pages.loadHomePage('nobody')).availableKeys).toEqual([]);
    const theirs = await newTin(B, 'Their agent');
    const home = await pages.loadHomePage(B);
    expect(home.agents.map((a) => a.id)).toEqual([theirs.id]);
    expect(home.agents[0].lastCheckAt).toBeNull();
    expect(home.agents[0].destinations).toEqual({ trusted: 0, flagged: 0, pending: 0 });
    // And the first account still sees only its own.
    expect((await pages.loadHomePage(A)).agents.map((a) => a.id)).toEqual([tin.id]);
  });

  it('every statement it sends names the account', async () => {
    const tin = await newTin(A, 'Treasury agent', K1);
    await register(A, tin.id, 1, 'trusted');
    await check(A, tin.id, 7, at(8));
    fake.log.length = 0;
    await pages.loadHomePage(A);
    const vaultSql = fake.log.filter((s) => /\bagent_(tins|wallets|destinations|events)\b/.test(s.sql) && !/^(CREATE|ALTER) /i.test(s.sql));
    expect(vaultSql.length).toBeGreaterThan(5);
    for (const s of vaultSql) {
      expect(s.sql, s.sql).toMatch(/\btenant_id = \?/);
      expect(s.args, s.sql).toContain(A);
      expect(s.sql, s.sql).not.toMatch(/\bJOIN\b/i);
    }
  });
});

describe('one agent', () => {
  it('answers null for an agent that is not this account\'s, one that does not exist and an id that is not one, all alike', async () => {
    const mine = await newTin(A, 'Mine');
    const theirs = await newTin(B, 'Theirs');
    expect(await pages.loadAgentPage(A, theirs.id)).toBeNull();
    expect(await pages.loadAgentPage(B, mine.id)).toBeNull();
    expect(await pages.loadAgentPage(A, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await pages.loadAgentPage(A, '')).toBeNull();
    expect(await pages.loadAgentPage(A, 'x'.repeat(65))).toBeNull();
    expect(await pages.loadAgentPage(A, mine.id)).not.toBeNull();
  });

  it('answers null for an agent that was removed', async () => {
    const tin = await newTin(A, 'Mine');
    expectOk(await vault.removeTin(A, tin.id));
    expect(await pages.loadAgentPage(A, tin.id)).toBeNull();
  });

  it('carries its wallets, addresses, key, plan, totals and the first page of its ledger, newest first', async () => {
    const tin = await newTin(A, 'Treasury agent', K1);
    const w = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(901) })).wallet;
    const d = await register(A, tin.id, 1, 'trusted');
    await check(A, tin.id, 7, at(8));
    await check(A, tin.id, 8, at(9));
    await transfer(A, tin.id, 1, at(10), 'in', 100.25);
    await transfer(A, tin.id, 2, at(11), 'out', 40);

    const page = await pages.loadAgentPage(A, tin.id, new Date('2026-10-18T12:00:00.000Z'));
    if (!page) throw new Error('no page');
    expect(page.tin.id).toBe(tin.id);
    expect(page.tin.label).toBe('Treasury agent');
    expect(page.today).toBe('2026-10-18');
    expect(page.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.key).toEqual({ id: K1, domain: 'ops.example.test', status: 'active' });
    expect(page.wallets.map((x) => x.id)).toEqual([w.id]);
    expect(page.destinations.map((x) => x.id)).toEqual([d.id]);
    expect(page.ledger.rows.map((r) => [r.kind, r.at])).toEqual([
      ['transaction', at(11)],
      ['transaction', at(10)],
      ['checked', at(9)],
      ['checked', at(8)],
    ]);
    expect(page.ledger.next).toBeNull();
    expect(page.totals.transactions).toBe(2);
    expect(page.totals.bought.usd).toBe(100.25);
    expect(page.totals.sold.usd).toBe(40);
    expect(page.plan.use).toEqual({ bots: 1, addresses: 1 });
  });

  it('pages the ledger: the first page is 50 rows and carries the cursor for the next', async () => {
    const tin = await newTin(A, 'Busy agent');
    for (let i = 0; i < 55; i += 1) await check(A, tin.id, 100 + i, at(8, 0, i));
    const page = await pages.loadAgentPage(A, tin.id);
    expect(page?.ledger.rows).toHaveLength(pages.FIRST_LEDGER_PAGE);
    expect(page?.ledger.next).toMatch(/^2026-10-17T08:00:\d\d\.000Z\|/);
    const more = expectOk(await vault.listTinEvents(A, tin.id, { limit: 50, before: page?.ledger.next }));
    expect(more.events).toHaveLength(5);
    expect(more.next).toBeNull();
  });

  it('gives the screen the ledger without the caller\'s address, the public status or the free text of what was answered', async () => {
    const tin = await newTin(A, 'Treasury agent');
    await check(A, tin.id, 7, at(8), 'unknown', '<img src=x onerror=alert(1)>');
    await transfer(A, tin.id, 1, at(9), 'in', 1);
    const page = await pages.loadAgentPage(A, tin.id);
    const text = JSON.stringify(page?.ledger);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toMatch(/sourceIp|source_ip|walletId|destinationId/);
    expect(text).not.toContain('onerror');
    const checkRow = page?.ledger.rows.find((r) => r.kind === 'checked');
    expect(checkRow?.basis).toBe('other');
    expect(Object.keys(checkRow ?? {}).sort()).toEqual(['address', 'answer', 'at', 'basis', 'chain', 'id', 'keyState', 'kind', 'linkReason', 'registry', 'tx']);
  });

  it('offers the keys it could take, never the one it has, nor one another agent has', async () => {
    const one = await newTin(A, 'One', K1);
    const two = await newTin(A, 'Two');
    const pageOne = await pages.loadAgentPage(A, one.id);
    const pageTwo = await pages.loadAgentPage(A, two.id);
    expect(pageOne?.availableKeys.map((k) => k.id)).toEqual([K2]);
    expect(pageTwo?.availableKeys.map((k) => k.id)).toEqual([K2]);
    expect(pageTwo?.key).toBeNull();
    const text = JSON.stringify([pageOne, pageTwo]);
    expect(text).not.toContain('a-dns-challenge');
  });

  it('says whether this server can sign an export', async () => {
    const tin = await newTin(A, 'Mine');
    expect((await pages.loadAgentPage(A, tin.id))?.signing).toEqual({ available: false });
    process.env.ALMSTINS_SIGNING_KEY = randomBytes(32).toString('hex');
    expect((await pages.loadAgentPage(A, tin.id))?.signing).toEqual({ available: true });
  });

  it('says whether today\'s limit on recorded checks is used up: today\'s checks of this agent only, and nothing to say for the owner', async () => {
    const { FREE_LOGGED_CHECKS_PER_DAY: limit } = await import('../../src/lib/agentVault/entitlements');
    const tin = await newTin(A, 'Busy agent');
    const now = new Date('2026-10-18T12:00:00.000Z');
    await events.ensureAgentEventsTable();
    const fill = (n: number, when: string, tinId = tin.id, kind = 'checked') => {
      for (let i = 0; i < n; i += 1) {
        fake.seed('agent_events', {
          id: `f-${tinId}-${kind}-${when}-${i}`, tenant_id: A, tin_id: tinId, kind, address: addr(900), chain: null, answer: 'unknown',
          registry: 'none', status: 'unknown', key_id: K1, source_ip: null, detail_json: '{}', occurred_at: when,
        });
      }
    };
    expect((await pages.loadAgentPage(A, tin.id, now))?.logLimit).toEqual({ perDay: limit, reached: false });
    fill(limit, '2026-10-17T23:59:59.999Z'); // yesterday
    fill(limit, '2026-10-18T01:00:00.000Z', 'another-agent'); // another agent
    fill(limit, '2026-10-18T02:00:00.000Z', tin.id, 'transaction'); // transfers
    expect((await pages.loadAgentPage(A, tin.id, now))?.logLimit).toEqual({ perDay: limit, reached: false });
    fill(limit - 1, '2026-10-18T00:00:00.000Z'); // the first millisecond of today counts
    expect((await pages.loadAgentPage(A, tin.id, now))?.logLimit).toEqual({ perDay: limit, reached: false });
    fill(1, '2026-10-18T11:59:59.999Z');
    expect((await pages.loadAgentPage(A, tin.id, now))?.logLimit).toEqual({ perDay: limit, reached: true });
    const mine = await newTin(OWNER_TENANT_ID, 'Owner agent');
    expect((await pages.loadAgentPage(OWNER_TENANT_ID, mine.id, now))?.logLimit).toBeNull();
  });

  it('every statement it sends names the account', async () => {
    const tin = await newTin(A, 'Mine', K1);
    await register(A, tin.id, 1, 'trusted');
    await check(A, tin.id, 7, at(8));
    fake.log.length = 0;
    await pages.loadAgentPage(A, tin.id);
    const vaultSql = fake.log.filter((s) => /\bagent_(tins|wallets|destinations|events)\b/.test(s.sql) && !/^(CREATE|ALTER) /i.test(s.sql));
    expect(vaultSql.length).toBeGreaterThan(5);
    for (const s of vaultSql) {
      expect(s.sql, s.sql).toMatch(/\btenant_id = \?/);
      expect(s.args, s.sql).toContain(A);
      expect(s.sql, s.sql).not.toMatch(/\bJOIN\b/i);
    }
  });
});
