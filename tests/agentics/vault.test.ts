import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr, upper, expectOk, fakeDeps, walletResult, type FakeDeps } from '../helpers/agentVault';

/**
 * The Agent Vault over its real SQL (store.ts, vault.ts), run by the in-memory stand-in for the
 * database that the receivables tests use (tests/helpers/receivablesDbFake.ts). The stand-in
 * evaluates the WHERE clauses, so a dropped `AND tenant_id = ?` shows up here as a wrong answer,
 * not only in review. The checks are injected (no network); fetch is switched off as a net. Every
 * address, label, tenant and key is invented.
 */

const holder = vi.hoisted(() => ({
  db: null as any,
  /** Runs before each statement; may throw to play a database error. */
  intercept: null as null | ((sql: string, args: unknown[]) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      holder.intercept?.(sql.replace(/\s+/g, ' ').trim(), typeof s === 'string' ? [] : s.args ?? []);
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));
const keys = vi.hoisted(() => ({ byTenant: {} as Record<string, Array<{ id: string; status: string }>> }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async (tenantId: string) => keys.byTenant[tenantId] ?? [] }));

const A = 'tenant-a';
const B = 'tenant-b';
const KEY_1 = 'a1'.repeat(12);
const KEY_2 = 'b2'.repeat(12);

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let vault: typeof import('../../src/lib/agentVault/vault');
let deps: FakeDeps;

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  keys.byTenant = { [A]: [{ id: KEY_1, status: 'active' }, { id: KEY_2, status: 'active' }], [B]: [] };
  deps = fakeDeps();
  store = await import('../../src/lib/agentVault/store');
  vault = await import('../../src/lib/agentVault/vault');
});

const newTin = async (tenant = A, label = 'Treasury agent') => expectOk(await vault.createTin(tenant, { label })).tin;
const add = (tenant: string, tinId: string, text: string, extra: Record<string, unknown> = {}) =>
  vault.addDestinations(tenant, { tinId, text, ...extra }, deps);
const dests = (tenant: string, tinId: string) => store.listDestinations(tenant, tinId);
const allRows = (table: string) => fake.rows(table);
const sanctioned = (a: string) => { deps.wallets[a] = walletResult({ flags: { sanctioned: true } }); };

describe('tenant isolation', () => {
  it('another account cannot see, change, check or remove a tin, a wallet or a destination', async () => {
    const tin = await newTin();
    const wallet = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) })).wallet;
    const destination = expectOk(await add(A, tin.id, `${addr(2)}, Exchange`)).destinations[0];
    const checksBefore = deps.calls.wallet.length;

    expect(await vault.listTins(B)).toEqual([]);
    expect(await vault.getTinDetail(B, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.listTinDestinations(B, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.addWallet(B, { tinId: tin.id, chain: 'ethereum', address: addr(3) })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await add(B, tin.id, addr(3))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.trustDestinations(B, { tinId: tin.id }, deps)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.trustDestinations(B, { tinId: tin.id, ids: [destination.id] }, deps)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.renameOrRelinkTin(B, tin.id, { label: 'Mine now' })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.removeTin(B, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.removeWallet(B, wallet.id)).toEqual({ ok: false, error: 'wallet_not_found' });
    expect(await vault.removeDestination(B, destination.id)).toEqual({ ok: false, error: 'destination_not_found' });
    // Nothing was checked on their behalf, and nothing of the owner's changed.
    expect(deps.calls.wallet.length).toBe(checksBefore);
    const detail = expectOk(await vault.getTinDetail(A, tin.id));
    expect(detail.tin.label).toBe('Treasury agent');
    expect(detail.wallets.map((w) => w.id)).toEqual([wallet.id]);
    expect(detail.destinations.map((d) => d.id)).toEqual([destination.id]);
    expect(allRows('agent_tins').concat(allRows('agent_wallets'), allRows('agent_destinations')).every((r) => r.deleted_at == null)).toBe(true);
  });

  it("an id from another account smuggled into one's own tin matches nothing", async () => {
    const tinA = await newTin(A);
    const tinB = await newTin(B, 'Their agent');
    const theirs = expectOk(await add(A, tinA.id, addr(2))).destinations[0];
    const checksBefore = deps.calls.wallet.length;

    const r = expectOk(await vault.trustDestinations(B, { tinId: tinB.id, ids: [theirs.id] }, deps));
    expect(r.destinations).toEqual([]);
    expect(r.notFound).toEqual([theirs.id]);
    expect(deps.calls.wallet.length).toBe(checksBefore);
    // Nor can a tin's id be used to reach a wallet or destination listed under another tin.
    expect(await vault.listTinDestinations(B, tinA.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await store.getDestinations(B, tinA.id, [theirs.id])).toEqual([]);
    expect(await store.getDestinations(A, tinB.id, [theirs.id])).toEqual([]);
  });

  it('the same address in two accounts is two independent destinations, each checked as its own account', async () => {
    const tinA = await newTin(A);
    const tinB = await newTin(B);
    const a = expectOk(await add(A, tinA.id, addr(1))).destinations[0];
    const b = expectOk(await add(B, tinB.id, addr(1))).destinations[0];
    expect(a.id).not.toBe(b.id);
    expect(deps.calls.verify.map((v) => v.tenantId).sort()).toEqual([A, B]);

    expect(expectOk(await vault.removeDestination(A, a.id))).toEqual({ ok: true });
    expect((await dests(A, tinA.id)).map((d) => d.id)).toEqual([]);
    expect((await dests(B, tinB.id)).map((d) => d.id)).toEqual([b.id]);
  });

  it('every statement the Vault sends names the tenant and joins nothing', async () => {
    const tin = await newTin(A);
    expectOk(await vault.renameOrRelinkTin(A, tin.id, { label: 'Renamed', agentKeyId: KEY_1 }));
    const wallet = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'polygon', address: addr(1) })).wallet;
    const first = expectOk(await add(A, tin.id, `${addr(2)}\n${addr(3)}, Payroll`)).destinations;
    expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [first[0].id] }, deps));
    expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps));
    expectOk(await vault.getTinDetail(A, tin.id));
    await vault.listTins(A);
    expectOk(await vault.removeDestination(A, first[0].id));
    expectOk(await vault.removeWallet(A, wallet.id));
    expectOk(await vault.removeTin(A, tin.id));

    const vaultSql = fake.log.filter((s) => /\bagent_(tins|wallets|destinations)\b/.test(s.sql) && !/^(CREATE|ALTER) /i.test(s.sql));
    expect(vaultSql.length).toBeGreaterThan(20);
    for (const s of vaultSql) {
      expect(s.sql, s.sql).not.toMatch(/\bJOIN\b/i);
      expect(s.args, s.sql).toContain(A);
      if (/^INSERT INTO/i.test(s.sql)) expect(s.sql, s.sql).toMatch(/\(id, tenant_id, /);
      else expect(s.sql, s.sql).toMatch(/\btenant_id = \?/);
    }
    // The statements that name a row by its id name the tenant beside it.
    for (const s of vaultSql.filter((x) => /\bWHERE id = \?/.test(x.sql))) expect(s.sql, s.sql).toMatch(/\bid = \? AND tenant_id = \?/);
  });
});

describe('uniqueness: one live row per tenant, tin, chain and normalized address', () => {
  it('a repeat inside one paste is one destination, and the repeat is reported', async () => {
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, `${addr(1)}, First\n${upper(addr(1))}, Second\n${addr(2)}`));
    expect(r.destinations).toHaveLength(2);
    expect(r.skipped).toEqual([{ line: 2, chain: 'ethereum', address: addr(1), reason: 'repeated_in_paste' }]);
    expect(r.destinations.find((d) => d.address === addr(1))?.label).toBe('First');
  });

  it('an address already live in the tin is skipped, in any spelling, and keeps its place and its status', async () => {
    const tin = await newTin();
    const first = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    const checks = deps.calls.wallet.length;
    const again = expectOk(await add(A, tin.id, upper(addr(1))));
    expect(again.destinations).toEqual([]);
    expect(again.skipped).toEqual([
      { line: 1, chain: 'ethereum', address: addr(1), reason: 'already_registered', id: first.id, trustStatus: 'trusted' },
    ]);
    expect(deps.calls.wallet.length).toBe(checks); // not checked again
    expect(await dests(A, tin.id)).toHaveLength(1);
  });

  it('the same address on two chains is two destinations; the same address in two tins is two destinations', async () => {
    const tin1 = await newTin(A, 'One');
    const tin2 = await newTin(A, 'Two');
    expectOk(await add(A, tin1.id, `${addr(1)}\npolygon, ${addr(1)}`));
    expectOk(await add(A, tin2.id, addr(1)));
    expect((await dests(A, tin1.id)).map((d) => d.chain).sort()).toEqual(['ethereum', 'polygon']);
    expect(await dests(A, tin2.id)).toHaveLength(1);
  });

  it('if another request wins the live slot first, the add is reported as a duplicate, not an error', async () => {
    const tin = await newTin();
    holder.intercept = (sql) => {
      if (!/^INSERT INTO agent_destinations/.test(sql)) return;
      holder.intercept = null;
      fake.seed('agent_destinations', {
        id: 'raced', tenant_id: A, tin_id: tin.id, chain: 'ethereum', address: addr(1), label: null,
        trust_status: 'pending', trust_checked_at: null, trust_detail_json: null, created_at: '2026-10-01 00:00:00', deleted_at: null,
      });
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    };
    const r = expectOk(await add(A, tin.id, addr(1)));
    expect(r.destinations).toEqual([]);
    expect(r.skipped).toMatchObject([{ reason: 'already_registered', id: 'raced' }]);
  });

  it('a wallet already registered is not added twice (added: false, the same wallet)', async () => {
    const tin = await newTin();
    const first = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) }));
    const again = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ETH', address: upper(addr(1)) }));
    expect(first.added).toBe(true);
    expect(again.added).toBe(false);
    expect(again.wallet.id).toBe(first.wallet.id);
    expect(allRows('agent_wallets')).toHaveLength(1);
    // Another chain is another wallet.
    expect(expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'polygon', address: addr(1) })).added).toBe(true);
  });

  it('declares the one-live-row rule in the database, as a partial unique index per table', () => {
    const live = store.AGENT_VAULT_DDL.filter((s) => /^CREATE UNIQUE INDEX/.test(s));
    expect(live).toHaveLength(3);
    expect(live.find((s) => s.includes('ON agent_destinations'))).toMatch(/\(tenant_id, tin_id, chain, address\) WHERE deleted_at IS NULL$/);
    expect(live.find((s) => s.includes('ON agent_wallets'))).toMatch(/\(tenant_id, tin_id, chain, address\) WHERE deleted_at IS NULL$/);
    expect(live.find((s) => s.includes('ON agent_tins'))).toMatch(/\(tenant_id, agent_key_id\) WHERE agent_key_id IS NOT NULL AND deleted_at IS NULL$/);
  });
});

describe('soft delete frees the slot and keeps the history', () => {
  it('a removed destination leaves the watched set but its row, status and readout stay', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(flagged.trustStatus).toBe('flagged');

    expect(expectOk(await vault.removeDestination(A, flagged.id))).toEqual({ ok: true });
    expect(await dests(A, tin.id)).toEqual([]);
    expect(await store.getDestinations(A, tin.id, [flagged.id])).toEqual([]);

    const rows = allRows('agent_destinations');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(flagged.id);
    expect(rows[0].deleted_at).toEqual(expect.any(String));
    expect(rows[0].trust_status).toBe('flagged');
    expect(JSON.parse(rows[0].trust_detail_json).hits).toEqual(['sanctioned']);
  });

  it('removing one twice, or one that never existed, is not found', async () => {
    const tin = await newTin();
    const d = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expectOk(await vault.removeDestination(A, d.id));
    expect(await vault.removeDestination(A, d.id)).toEqual({ ok: false, error: 'destination_not_found' });
    expect(await vault.removeDestination(A, 'nope')).toEqual({ ok: false, error: 'destination_not_found' });
    expect(await vault.removeDestination(A, '')).toEqual({ ok: false, error: 'invalid_id' });
  });

  it('the freed slot can be used again: the same address becomes a new row with a fresh check, and the old row stays', async () => {
    const tin = await newTin();
    const first = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expectOk(await vault.removeDestination(A, first.id));
    const checks = deps.calls.wallet.length;

    const second = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(second.id).not.toBe(first.id);
    expect(deps.calls.wallet.length).toBe(checks + 1);
    expect(allRows('agent_destinations')).toHaveLength(2);
    expect(allRows('agent_destinations').filter((r) => r.deleted_at == null).map((r) => r.id)).toEqual([second.id]);
  });

  it('a removed destination cannot be checked, and a removed wallet can be registered again', async () => {
    const tin = await newTin();
    const d = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    const w = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(2) })).wallet;
    expectOk(await vault.removeDestination(A, d.id));
    expectOk(await vault.removeWallet(A, w.id));
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [d.id] }, deps)).notFound).toEqual([d.id]);
    expect(await vault.removeWallet(A, w.id)).toEqual({ ok: false, error: 'wallet_not_found' });
    const again = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(2) }));
    expect(again.added).toBe(true);
    expect(again.wallet.id).not.toBe(w.id);
    expect(allRows('agent_wallets')).toHaveLength(2);
  });

  it('removing a tin removes its wallets and destinations with it, in one transaction, and deletes no row', async () => {
    const tin = await newTin();
    const other = await newTin(A, 'Another agent');
    expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) }));
    expectOk(await add(A, tin.id, `${addr(2)}\n${addr(3)}`));
    expectOk(await add(A, other.id, addr(4)));
    const rowsBefore = ['agent_tins', 'agent_wallets', 'agent_destinations'].map((t) => allRows(t).length);

    expect(expectOk(await vault.removeTin(A, tin.id))).toEqual({ ok: true });

    expect(['agent_tins', 'agent_wallets', 'agent_destinations'].map((t) => allRows(t).length)).toEqual(rowsBefore);
    const removal = fake.batches.find((b) => b.some((s) => /^UPDATE agent_tins SET deleted_at/.test(s.sql)));
    expect(removal?.map((s) => s.sql.split(' SET ')[0])).toEqual(['UPDATE agent_destinations', 'UPDATE agent_wallets', 'UPDATE agent_tins']);
    expect((await store.listTins(A)).map((t) => t.id)).toEqual([other.id]);
    expect(await store.getTin(A, tin.id)).toBeNull();
    expect(await vault.getTinDetail(A, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await add(A, tin.id, addr(9))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.removeTin(A, tin.id)).toEqual({ ok: false, error: 'tin_not_found' });
    // The other tin is untouched.
    expect((await dests(A, other.id)).map((d) => d.address)).toEqual([addr(4)]);
    expect(allRows('agent_destinations').filter((r) => r.deleted_at == null).map((r) => r.address)).toEqual([addr(4)]);
  });
});

describe('a flagged destination stays flagged', () => {
  it('a sanctioned address is kept, listed and flagged, with the reason on record, never dropped', async () => {
    const tin = await newTin();
    sanctioned(addr(2));
    const r = expectOk(await add(A, tin.id, `${addr(1)}, Fine\n${addr(2)}, Bad\n${addr(3)}, Also fine`));
    expect(r.summary).toEqual({ added: 3, trusted: 2, flagged: 1, pending: 0, skipped: 0, rejected: 0 });
    const flagged = r.destinations.find((d) => d.address === addr(2));
    expect(flagged?.trustStatus).toBe('flagged');
    expect(flagged?.trust).toMatchObject({ result: 'fail', hits: ['sanctioned'], sanctions: 'hit' });
    // And it is still there when read back.
    const listed = (await dests(A, tin.id)).find((d) => d.address === addr(2));
    expect(listed?.trustStatus).toBe('flagged');
    expect(listed?.trust?.hits).toEqual(['sanctioned']);
  });

  it('checking it again with a clean answer leaves it flagged, with the original readout', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    const readoutBefore = allRows('agent_destinations')[0].trust_detail_json;

    deps.wallets[addr(1)] = walletResult(); // the lookup now comes back clean
    const r = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [flagged.id] }, deps));
    expect(r.stillFlagged).toEqual([flagged.id]);
    expect(r.destinations[0].trustStatus).toBe('flagged');
    expect(allRows('agent_destinations')[0].trust_status).toBe('flagged');
    expect(allRows('agent_destinations')[0].trust_detail_json).toBe(readoutBefore);
    // Without ids it is not even picked up: only pending ones are.
    deps.calls.wallet.length = 0;
    expect(expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps)).destinations).toEqual([]);
    expect(deps.calls.wallet).toEqual([]);
  });

  it('a limited answer and a failed lookup cannot clear it either', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    for (const answer of [walletResult({ coverage: { sanctions: 'error' } }), new Error('network down')]) {
      deps.wallets[addr(1)] = answer;
      const r = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [flagged.id] }, deps));
      expect(r.stillFlagged).toEqual([flagged.id]);
      expect((await dests(A, tin.id))[0].trustStatus).toBe('flagged');
    }
  });

  it('pasting a flagged address again changes nothing: it is reported as already registered, still flagged', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    deps.wallets[addr(1)] = walletResult();
    const again = expectOk(await add(A, tin.id, addr(1)));
    expect(again.skipped).toMatchObject([{ id: flagged.id, trustStatus: 'flagged' }]);
    expect((await dests(A, tin.id))[0].trustStatus).toBe('flagged');
  });

  it('a new flag refreshes the readout, so the record shows everything found', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    deps.wallets[addr(1)] = walletResult({ flags: { sanctioned: true, phishing: true } });
    const r = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [flagged.id] }, deps));
    expect(r.stillFlagged).toEqual([]);
    expect(r.destinations[0].trust?.hits).toEqual(['sanctioned', 'phishing']);
  });

  it('the way to clear a flag is to remove the destination and add it again: a new row, a fresh check', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    deps.wallets[addr(1)] = walletResult();
    expectOk(await vault.removeDestination(A, flagged.id));
    const fresh = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(fresh.id).not.toBe(flagged.id);
    expect(fresh.trustStatus).toBe('trusted');
  });

  it('the database refuses to clear a flag, even if two checks race (recordTrust guards the row)', async () => {
    const tin = await newTin();
    sanctioned(addr(1));
    const flagged = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    const readout = { ...flagged.trust!, result: 'pass' as const, hits: [], sanctions: 'clear' as const };
    expect(await store.recordTrust(A, flagged.id, { status: 'trusted', readout, checkedAt: '2026-10-01 00:00:00' })).toBe(false);
    expect(await store.recordTrust(A, flagged.id, { status: 'pending', readout, checkedAt: '2026-10-01 00:00:00' })).toBe(false);
    expect(allRows('agent_destinations')[0].trust_status).toBe('flagged');
    // The other way round it does apply: a trusted destination that now fails is flagged.
    const ok = expectOk(await add(A, tin.id, addr(2))).destinations[0];
    expect(ok.trustStatus).toBe('trusted');
    expect(await store.recordTrust(A, ok.id, { status: 'flagged', readout: flagged.trust!, checkedAt: '2026-10-02 00:00:00' })).toBe(true);
    expect((await dests(A, tin.id)).find((d) => d.id === ok.id)?.trustStatus).toBe('flagged');
  });

  it('a trusted destination that later fails is flagged', async () => {
    const tin = await newTin();
    const d = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(d.trustStatus).toBe('trusted');
    deps.wallets[addr(1)] = walletResult({ flags: { mixer: true } });
    const r = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [d.id] }, deps));
    expect(r.destinations[0].trustStatus).toBe('flagged');
    expect(r.destinations[0].trust?.hits).toEqual(['mixer']);
  });

  it('an address another account has claimed without a domain is flagged for review', async () => {
    const tin = await newTin();
    deps.verifies[addr(1)] = { level: 'claimed', domain: null, claimedElsewhere: true };
    deps.verifies[addr(2)] = { level: 'verified', domain: 'example.test', claimedElsewhere: true };
    const r = expectOk(await add(A, tin.id, `${addr(1)}\n${addr(2)}`));
    expect(r.destinations.find((d) => d.address === addr(1))).toMatchObject({ trustStatus: 'flagged', trust: { hits: ['claimedElsewhere'] } });
    expect(r.destinations.find((d) => d.address === addr(2))).toMatchObject({ trustStatus: 'trusted', trust: { verify: 'proven', provenBy: 'example.test' } });
  });
});

describe('a failed sanctions lookup never passes', () => {
  it.each([
    ['the OFAC mirror could not be read', () => walletResult({ coverage: { sanctions: 'error' } })],
    ['Chainalysis was asked and did not answer', () => walletResult({ coverage: { chainalysis: 'error' } })],
    ['the public checker threw', () => new Error('upstream down')],
  ])('%s: the destination is pending with a Limited readout, not trusted', async (_why, answer) => {
    const tin = await newTin();
    deps.wallets[addr(1)] = answer();
    const r = expectOk(await add(A, tin.id, addr(1)));
    expect(r.summary).toMatchObject({ added: 1, trusted: 0, pending: 1, flagged: 0 });
    const d = r.destinations[0];
    expect(d.trustStatus).toBe('pending');
    expect(d.trust?.result).toBe('limited');
    expect(d.trust?.limits).toContain('sanctions');
    expect(d.trust?.sanctions).toBe('unavailable');
    // Stored the same way.
    expect(allRows('agent_destinations')[0].trust_status).toBe('pending');
  });

  it('a Verify lookup that fails leaves it pending too', async () => {
    const tin = await newTin();
    deps.verifies[addr(1)] = new Error('database unavailable');
    const d = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(d.trustStatus).toBe('pending');
    expect(d.trust?.limits).toEqual(['verify']);
  });

  it('nothing is ever written as trusted without a stored readout that passed', async () => {
    const tin = await newTin();
    deps.wallets[addr(1)] = walletResult({ coverage: { sanctions: 'error' } });
    deps.wallets[addr(2)] = walletResult({ coverage: { goplus: 'error' } });
    sanctioned(addr(3));
    expectOk(await add(A, tin.id, `${addr(1)}\n${addr(2)}\n${addr(3)}\n${addr(4)}`));
    const writes = fake.log.filter((s) => /^UPDATE agent_destinations SET trust_status/.test(s.sql));
    expect(writes).toHaveLength(4);
    const trustedWrites = writes.filter((s) => s.args[0] === 'trusted');
    expect(trustedWrites).toHaveLength(1);
    expect(JSON.parse(String(trustedWrites[0].args[2])).result).toBe('pass');
    for (const row of allRows('agent_destinations')) {
      if (row.trust_status === 'trusted') expect(JSON.parse(row.trust_detail_json).result).toBe('pass');
    }
  });

  it('a pending destination is trusted by a later complete check, and a trusted one drops back to pending when the lookup fails', async () => {
    const tin = await newTin();
    deps.wallets[addr(1)] = walletResult({ coverage: { sanctions: 'error' } });
    const pending = expectOk(await add(A, tin.id, addr(1))).destinations[0];
    expect(pending.trustStatus).toBe('pending');

    deps.wallets[addr(1)] = walletResult();
    const promoted = expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps));
    expect(promoted.destinations.map((d) => [d.id, d.trustStatus])).toEqual([[pending.id, 'trusted']]);

    deps.wallets[addr(1)] = walletResult({ coverage: { sanctions: 'error' } });
    const dropped = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: [pending.id] }, deps));
    expect(dropped.destinations[0].trustStatus).toBe('pending');
    expect(dropped.destinations[0].trust?.result).toBe('limited');
  });
});

describe('Add + Trust: every pasted line is accounted for', () => {
  const MAX = 10; // MAX_BATCH, asserted against the module below
  it('reports what was added, flagged, skipped and rejected, and each line is in exactly one place', async () => {
    const tin = await newTin();
    const existing = expectOk(await add(A, tin.id, addr(9))).destinations[0];
    deps.calls.wallet.length = 0;
    sanctioned(addr(3));
    deps.wallets[addr(4)] = walletResult({ coverage: { sanctions: 'error' } });
    const text = [
      'address,label',            // header, skipped quietly
      `${addr(1)}, Exchange`,     // 2 added, trusted
      `# a comment`,              // skipped quietly
      `${addr(2)}`,               // 4 added, trusted
      `${addr(3)}, Bad actor`,    // 5 added, flagged
      `${addr(4)}`,               // 6 added, pending (lookup failed)
      `${upper(addr(1))}`,        // 7 repeat of line 2
      `${addr(9)}`,               // 8 already registered
      'not an address at all',    // 9 rejected
      '',
      `polygon, ${addr(5)}, Payroll`, // 11 added, trusted, on polygon
    ].join('\n');

    const r = expectOk(await add(A, tin.id, text));
    expect(r.checked).toBe(true);
    expect(r.summary).toEqual({ added: 5, trusted: 3, flagged: 1, pending: 1, skipped: 2, rejected: 1 });
    expect(r.skipped).toEqual([
      { line: 7, chain: 'ethereum', address: addr(1), reason: 'repeated_in_paste' },
      { line: 8, chain: 'ethereum', address: addr(9), reason: 'already_registered', id: existing.id, trustStatus: 'trusted' },
    ]);
    expect(r.rejected).toEqual([{ line: 9, reason: 'no_address', text: 'not an address at all' }]);
    expect(r.destinations.find((d) => d.address === addr(5))).toMatchObject({ chain: 'polygon', label: 'Payroll', trustStatus: 'trusted' });
    // The already registered one was not checked again, and each new address was checked once.
    expect(deps.calls.wallet.slice().sort()).toEqual([addr(1), addr(2), addr(3), addr(4), addr(5)]);
    // Everything added is stored.
    expect((await dests(A, tin.id))).toHaveLength(6);
  });

  it('with trust: false it adds the destinations pending and runs no check', async () => {
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, `${addr(1)}\n${addr(2)}`, { trust: false }));
    expect(r.checked).toBe(false);
    expect(r.summary).toMatchObject({ added: 2, trusted: 0, flagged: 0, pending: 2 });
    expect(r.destinations.every((d) => d.trust === null && d.trustCheckedAt === null)).toBe(true);
    expect(deps.calls.wallet).toEqual([]);
    expect(deps.calls.verify).toEqual([]);
  });

  it('the cap on one request is 10 destinations', () => {
    expect(vault.MAX_BATCH).toBe(MAX);
  });

  it('then the pending ones are checked by the trust call, at most one batch at a time', async () => {
    const tin = await newTin();
    const text = Array.from({ length: MAX }, (_, i) => addr(i + 1)).join('\n');
    expectOk(await add(A, tin.id, text, { trust: false }));
    expectOk(await add(A, tin.id, Array.from({ length: 5 }, (_, i) => addr(i + 100)).join('\n'), { trust: false }));
    const first = expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps));
    expect(first.destinations).toHaveLength(MAX);
    expect(first.remaining).toBe(5);
    const second = expectOk(await vault.trustDestinations(A, { tinId: tin.id }, deps));
    expect(second.destinations).toHaveLength(5);
    expect(second.remaining).toBe(0);
    expect((await dests(A, tin.id)).every((d) => d.trustStatus === 'trusted')).toBe(true);
  });

  it('refuses a paste with more than one batch of distinct destinations, and adds none of them', async () => {
    const tin = await newTin();
    const text = Array.from({ length: MAX + 1 }, (_, i) => addr(i + 1)).join('\n');
    expect(await add(A, tin.id, text)).toEqual({ ok: false, error: 'too_many', max: MAX });
    expect(allRows('agent_destinations')).toEqual([]);
    expect(deps.calls.wallet).toEqual([]);
    // One line more than a batch, but a repeat: still one batch of destinations.
    const withRepeat = Array.from({ length: MAX }, (_, i) => addr(i + 1)).concat(addr(1)).join('\n');
    expect(expectOk(await add(A, tin.id, withRepeat)).summary.added).toBe(MAX);
  });

  it('answers with the rejections when nothing in the paste is an address', async () => {
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, 'hello\nworld'));
    expect(r.summary).toEqual({ added: 0, trusted: 0, flagged: 0, pending: 0, skipped: 0, rejected: 2 });
    expect(r.checked).toBe(false);
    expect(allRows('agent_destinations')).toEqual([]);
  });

  it('says plainly when there is nothing to add, the text is too long, or the request is malformed', async () => {
    const tin = await newTin();
    expect(await add(A, tin.id, '')).toEqual({ ok: false, error: 'nothing_to_add' });
    expect(await add(A, tin.id, '  \n # only a comment\n')).toEqual({ ok: false, error: 'nothing_to_add' });
    expect(await add(A, tin.id, undefined as never)).toEqual({ ok: false, error: 'nothing_to_add' });
    expect(await add(A, tin.id, 'x'.repeat(50_001))).toEqual({ ok: false, error: 'text_too_long', max: 50_000 });
    expect(await add(A, tin.id, addr(1), { chain: 'bitcoin' })).toEqual({ ok: false, error: 'invalid_chain' });
    expect(await add(A, '', addr(1))).toEqual({ ok: false, error: 'invalid_id' });
    expect(await add(A, undefined as never, addr(1))).toEqual({ ok: false, error: 'invalid_id' });
    expect(await add(A, 'no-such-tin', addr(1))).toEqual({ ok: false, error: 'tin_not_found' });
    expect(allRows('agent_destinations')).toEqual([]);
  });

  it('uses the chain given for lines that name none', async () => {
    const tin = await newTin();
    const r = expectOk(await add(A, tin.id, `${addr(1)}\navalanche, ${addr(2)}`, { chain: 'polygon' }));
    expect(r.destinations.map((d) => [d.address, d.chain]).sort()).toEqual([[addr(1), 'polygon'], [addr(2), 'avalanche']]);
  });

  it('asks the trust call about ids it cannot use', async () => {
    const tin = await newTin();
    expect(await vault.trustDestinations(A, { tinId: tin.id, ids: 'x' }, deps)).toEqual({ ok: false, error: 'invalid_id' });
    expect(await vault.trustDestinations(A, { tinId: tin.id, ids: [''] }, deps)).toEqual({ ok: false, error: 'invalid_id' });
    expect(await vault.trustDestinations(A, { tinId: tin.id, ids: Array.from({ length: MAX + 1 }, (_, i) => `id${i}`) }, deps)).toEqual({ ok: false, error: 'too_many', max: MAX });
    const none = expectOk(await vault.trustDestinations(A, { tinId: tin.id, ids: ['ghost'] }, deps));
    expect(none).toMatchObject({ destinations: [], notFound: ['ghost'] });
  });
});

describe('tins', () => {
  it('creates a tin with a cleaned label', async () => {
    const r = expectOk(await vault.createTin(A, { label: '  Treasury \u0007  agent  ' }));
    expect(r.tin).toMatchObject({ label: 'Treasury agent', agentKeyId: null });
    expect(r.tin.id).toEqual(expect.any(String));
    expect((await store.listTins(A)).map((t) => t.label)).toEqual(['Treasury agent']);
    expect(expectOk(await vault.createTin(A, { label: 'x'.repeat(200) })).tin.label).toHaveLength(80);
  });

  it.each([[undefined], [''], ['   '], ['\u0007\u0008'], [42], [{}], [null]])('refuses the label %j', async (label) => {
    expect(await vault.createTin(A, { label })).toEqual({ ok: false, error: 'invalid_label' });
    expect(allRows('agent_tins')).toEqual([]);
  });

  it('links an active key of the same account, and only one tin may hold a key', async () => {
    const t1 = expectOk(await vault.createTin(A, { label: 'One', agentKeyId: KEY_1 })).tin;
    expect(t1.agentKeyId).toBe(KEY_1);
    expect(await vault.createTin(A, { label: 'Two', agentKeyId: KEY_1 })).toEqual({ ok: false, error: 'key_in_use' });
    expect(expectOk(await vault.createTin(A, { label: 'Two', agentKeyId: KEY_2 })).tin.agentKeyId).toBe(KEY_2);
    expect((await store.listTins(A)).map((t) => t.label).sort()).toEqual(['One', 'Two']);
  });

  it('refuses a key that is not the account own, is not active, or is not a key', async () => {
    keys.byTenant[B] = [{ id: 'c3'.repeat(12), status: 'active' }];
    keys.byTenant[A].push({ id: 'd4'.repeat(12), status: 'revoked' }, { id: 'e5'.repeat(12), status: 'pending' });
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 'c3'.repeat(12) })).toEqual({ ok: false, error: 'key_not_found' }); // B's key
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 'f6'.repeat(12) })).toEqual({ ok: false, error: 'key_not_found' }); // no such key
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 'd4'.repeat(12) })).toEqual({ ok: false, error: 'key_not_active' });
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 'e5'.repeat(12) })).toEqual({ ok: false, error: 'key_not_active' });
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 'not-a-key' })).toEqual({ ok: false, error: 'key_not_found' });
    expect(await vault.createTin(A, { label: 'x', agentKeyId: 7 })).toEqual({ ok: false, error: 'key_not_found' });
    expect(allRows('agent_tins')).toEqual([]);
  });

  it('renames, relinks and unlinks; a field left out is left alone', async () => {
    const tin = expectOk(await vault.createTin(A, { label: 'One', agentKeyId: KEY_1 })).tin;
    expect(expectOk(await vault.renameOrRelinkTin(A, tin.id, { label: 'Renamed' })).tin).toMatchObject({ label: 'Renamed', agentKeyId: KEY_1 });
    expect(expectOk(await vault.renameOrRelinkTin(A, tin.id, { agentKeyId: KEY_2 })).tin).toMatchObject({ label: 'Renamed', agentKeyId: KEY_2 });
    expect(expectOk(await vault.renameOrRelinkTin(A, tin.id, { agentKeyId: null })).tin).toMatchObject({ label: 'Renamed', agentKeyId: null });
    expect(expectOk(await vault.renameOrRelinkTin(A, tin.id, {})).tin).toMatchObject({ label: 'Renamed', agentKeyId: null });
    expect((await store.getTin(A, tin.id))).toMatchObject({ label: 'Renamed', agentKeyId: null });
    expect(await vault.renameOrRelinkTin(A, tin.id, { label: '  ' })).toEqual({ ok: false, error: 'invalid_label' });
    expect(await vault.renameOrRelinkTin(A, tin.id, { agentKeyId: 'bad' })).toEqual({ ok: false, error: 'key_not_found' });
    expect(await vault.renameOrRelinkTin(A, 'no-such-tin', { label: 'x' })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.renameOrRelinkTin(A, undefined, { label: 'x' })).toEqual({ ok: false, error: 'invalid_id' });
  });

  it('a key held by another live tin cannot be taken, and is free again once that tin is removed', async () => {
    const holder1 = expectOk(await vault.createTin(A, { label: 'One', agentKeyId: KEY_1 })).tin;
    const tin2 = await newTin(A, 'Two');
    expect(await vault.renameOrRelinkTin(A, tin2.id, { agentKeyId: KEY_1 })).toEqual({ ok: false, error: 'key_in_use' });
    // Linking the key a tin already holds is fine.
    expectOk(await vault.renameOrRelinkTin(A, holder1.id, { agentKeyId: KEY_1, label: 'One again' }));
    expectOk(await vault.removeTin(A, holder1.id));
    expect(expectOk(await vault.renameOrRelinkTin(A, tin2.id, { agentKeyId: KEY_1 })).tin.agentKeyId).toBe(KEY_1);
    expect(allRows('agent_tins').filter((r) => r.agent_key_id === KEY_1)).toHaveLength(2); // history keeps the old link
  });

  it('if another request takes the key first, the database says so and the answer is key_in_use', async () => {
    holder.intercept = (sql) => {
      if (!/^INSERT INTO agent_tins/.test(sql)) return;
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    };
    expect(await vault.createTin(A, { label: 'x', agentKeyId: KEY_1 })).toEqual({ ok: false, error: 'key_in_use' });
    holder.intercept = null;
    const tin = await newTin(A, 'Plain');
    holder.intercept = (sql) => {
      if (/^UPDATE agent_tins SET label/.test(sql)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
    };
    expect(await vault.renameOrRelinkTin(A, tin.id, { agentKeyId: KEY_2 })).toEqual({ ok: false, error: 'key_in_use' });
  });

  it('any other database error is not turned into a business answer', async () => {
    holder.intercept = (sql) => {
      if (/^INSERT INTO agent_tins/.test(sql)) throw new Error('connection lost');
    };
    await expect(vault.createTin(A, { label: 'x' })).rejects.toThrow('connection lost');
  });
});

describe("the agent's own wallets", () => {
  it('registers a wallet on a tin, normalized, on the chain named', async () => {
    const tin = await newTin();
    const r = expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'Polygon', address: ` ${upper(addr(1))} ` }));
    expect(r.added).toBe(true);
    expect(r.wallet).toMatchObject({ tinId: tin.id, chain: 'polygon', address: addr(1) });
    expect(expectOk(await vault.getTinDetail(A, tin.id)).wallets.map((w) => w.address)).toEqual([addr(1)]);
    expect(Object.keys(r.wallet)).not.toContain('tenantId');
  });

  it('refuses a chain it does not track, an address that is not one, and a missing tin', async () => {
    const tin = await newTin();
    expect(await vault.addWallet(A, { tinId: tin.id, chain: 'bitcoin', address: addr(1) })).toEqual({ ok: false, error: 'invalid_chain' });
    expect(await vault.addWallet(A, { tinId: tin.id, chain: undefined, address: addr(1) })).toEqual({ ok: false, error: 'invalid_chain' });
    expect(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1).slice(0, -1) })).toEqual({ ok: false, error: 'invalid_address' });
    expect(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: undefined })).toEqual({ ok: false, error: 'invalid_address' });
    expect(await vault.addWallet(A, { tinId: 'no-such-tin', chain: 'ethereum', address: addr(1) })).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await vault.addWallet(A, { tinId: undefined, chain: 'ethereum', address: addr(1) })).toEqual({ ok: false, error: 'invalid_id' });
    expect(allRows('agent_wallets')).toEqual([]);
  });

  it('a wallet is never checked or marked trusted: it is the agent own', async () => {
    const tin = await newTin();
    expectOk(await vault.addWallet(A, { tinId: tin.id, chain: 'ethereum', address: addr(1) }));
    expect(deps.calls.wallet).toEqual([]);
    expect(Object.keys(allRows('agent_wallets')[0]).sort()).toEqual(['address', 'chain', 'created_at', 'id', 'tenant_id', 'tin_id'].concat(allRows('agent_wallets')[0].deleted_at === undefined ? [] : ['deleted_at']).sort());
  });
});

describe('details of what is stored', () => {
  it('reads back a destination with its readout, and never hands out a tenant id', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, `${addr(1)}, Kraken`));
    const [d] = await dests(A, tin.id);
    expect(d).toMatchObject({ tinId: tin.id, chain: 'ethereum', address: addr(1), label: 'Kraken', trustStatus: 'trusted' });
    expect(d.trust).toMatchObject({ v: 1, result: 'pass', checkedAt: '2026-10-01T12:00:00.000Z' });
    expect(d.trustCheckedAt).toBe('2026-10-01 12:00:00');
    expect(JSON.stringify(d)).not.toContain(A);
    expect(JSON.stringify(expectOk(await vault.getTinDetail(A, tin.id)))).not.toContain(A);
  });

  it('a damaged status or readout in the table reads as pending with no readout, never as trusted', async () => {
    const tin = await newTin();
    expectOk(await add(A, tin.id, addr(1)));
    allRows('agent_destinations')[0].trust_status = 'safe';
    allRows('agent_destinations')[0].trust_detail_json = '{not json';
    const [d] = await dests(A, tin.id);
    expect(d.trustStatus).toBe('pending');
    expect(d.trust).toBeNull();
  });

  it('creates its tables once, before the first read', async () => {
    await store.listTins(A);
    await store.listTins(A);
    await store.getTin(A, 'x');
    const creates = fake.log.filter((s) => /^CREATE TABLE/.test(s.sql));
    expect(creates.map((s) => s.sql.match(/EXISTS (\w+)/)?.[1])).toEqual(['agent_tins', 'agent_wallets', 'agent_destinations']);
  });

  it('retries creating its tables after a failure instead of remembering the failure', async () => {
    holder.intercept = (sql) => {
      if (/^CREATE TABLE IF NOT EXISTS agent_tins/.test(sql)) {
        holder.intercept = null;
        throw new Error('lock timeout');
      }
    };
    await expect(store.listTins(A)).rejects.toThrow('lock timeout');
    expect(await store.listTins(A)).toEqual([]);
  });
});

describe('account deletion', () => {
  it('removes the Vault tables with the account, destinations before wallets before tins', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    const order = ['agent_destinations', 'agent_wallets', 'agent_tins'].map((t) => (TENANT_TABLES as readonly string[]).indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });
});
