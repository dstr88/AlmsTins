import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * POST /api/account/delete used to delete the tracker, PetroTins, billing, memberships and
 * the user, but no Verify table. Payers kept seeing the deleted account's claims (scan,
 * wallet checker, agent check), and a returning owner was locked out of their own wallet
 * and business name by claim-once. These pin the fix (src/lib/verifyAccountDelete.ts):
 *   - every Verify table loses the tenant's rows, in one transaction, before the account;
 *   - the tenant's own open receivable requests are revoked and its read markers deleted,
 *     while other parties' records stay;
 *   - every statement is scoped to the deleting tenant (or user), so other rows survive;
 *   - a table that was never created is skipped instead of failing the whole deletion;
 *   - the public lookups (address, payment link, agent check) stop answering and the
 *     claim frees up for a new account;
 *   - a deleted agent key stops authenticating at once (the 60s auth cache is cleared);
 *   - the user's drip-campaign enrollments go, other sessions are cut in this process,
 *     and a final sweep removes Verify rows written while the account was going away;
 *   - the tenant is the one the app writes under, never 'default';
 *   - if the Verify delete fails, the account is left whole so the owner can retry.
 *
 * No database: '@/lib/db' is an in-memory, two-tenant stand-in that answers only the
 * statements these paths run. Any other statement is recorded and throws, so an unscoped
 * or changed query fails here loudly (the endpoint swallows its best-effort errors, so
 * the recorded list is asserted directly).
 */

type Row = Record<string, any>;
type Call = { via: 'execute' | 'batch'; sql: string; args: unknown[] };

const mem = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Call[],
  unexpected: [] as string[],
  failBatch: null as Error | null,
  /** Tables the catalog reports as never created; touching one throws, as Postgres would. */
  missing: new Set<string>(),
  /** Runs after a statement is applied (to simulate a concurrent writer). */
  after: null as null | ((sql: string, args: any[]) => void),
}));

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function run(sqlIn: string, args: any[] = []): { rows: Row[]; rowsAffected: number } {
  const sql = oneLine(sqlIn);
  const out = apply(sql, args);
  mem.after?.(sql, args);
  return out;
}

function apply(sql: string, args: any[]): { rows: Row[]; rowsAffected: number } {
  const none = { rows: [], rowsAffected: 0 };
  const t = (name: string): Row[] => (mem.tables[name] ??= []);

  // Lazy schema (ensure*Tables) and its idempotent legacy tag: no data removed.
  if (/^(CREATE|ALTER) /.test(sql) || /^UPDATE verify_destinations d SET legacy_unbound/.test(sql)) return none;

  // Catalog: which tables exist (verifyAccountDelete's one-query check).
  if (/^SELECT to_regclass\(\?\) AS t0(, to_regclass\(\?\) AS t\d+)*$/.test(sql)) {
    const row: Row = {};
    args.forEach((name, i) => { row[`t${i}`] = mem.missing.has(String(name)) ? null : String(name); });
    return { rows: [row], rowsAffected: 0 };
  }
  const touched = sql.match(/^(?:DELETE FROM|UPDATE) (\w+)/)?.[1];
  if (touched && mem.missing.has(touched)) throw new Error(`relation "${touched}" does not exist`);

  // Tenant resolution (delete.ts resolveTenantToDelete).
  if (sql === 'SELECT 1 AS ok FROM tenant_memberships WHERE user_id = ? AND tenant_id = ? LIMIT 1') {
    const hit = t('tenant_memberships').some((r) => r.user_id === args[0] && r.tenant_id === args[1]);
    return { rows: hit ? [{ ok: 1 }] : [], rowsAffected: 0 };
  }
  if (sql === "SELECT tenant_id FROM tenant_memberships WHERE user_id = ? AND tenant_id != 'default' ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1") {
    const rows = t('tenant_memberships')
      .filter((r) => r.user_id === args[0] && r.tenant_id !== 'default')
      .sort((a, b) => (Number(a.role !== 'owner') - Number(b.role !== 'owner'))
        || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
    return { rows: rows.slice(0, 1).map((r) => ({ tenant_id: r.tenant_id })), rowsAffected: 0 };
  }

  // DELETE FROM <table> WHERE tenant_id = ? [RETURNING id]
  let m = sql.match(/^DELETE FROM (\w+) WHERE tenant_id = \?( RETURNING id)?$/);
  if (m) {
    const [, table, returning] = m;
    const gone = t(table).filter((r) => r.tenant_id === args[0]);
    mem.tables[table] = t(table).filter((r) => r.tenant_id !== args[0]);
    return { rows: returning ? gone.map((r) => ({ id: r.id })) : [], rowsAffected: gone.length };
  }
  // DELETE FROM <child> WHERE <col> IN (SELECT id FROM <parent> WHERE tenant_id = ?)
  m = sql.match(/^DELETE FROM (\w+) WHERE (\w+) IN \(SELECT id FROM (\w+) WHERE tenant_id = \?\)$/);
  if (m) {
    const [, child, col, parent] = m;
    const ids = new Set(t(parent).filter((r) => r.tenant_id === args[0]).map((r) => r.id));
    const before = t(child).length;
    mem.tables[child] = t(child).filter((r) => !ids.has(r[col]));
    return { rows: [], rowsAffected: before - mem.tables[child].length };
  }
  // DELETE FROM <table> WHERE user_id = ? / WHERE id = ? (the user's own rows)
  m = sql.match(/^DELETE FROM (campaign_drip WHERE user_id|auth_users WHERE id) = \?$/);
  if (m) {
    const [table, col] = m[1].split(' WHERE ');
    const before = t(table).length;
    mem.tables[table] = t(table).filter((r) => r[col] !== args[0]);
    return { rows: [], rowsAffected: before - mem.tables[table].length };
  }
  // Revoke the tenant's own open receivable requests.
  const revoke = sql.match(/^UPDATE (receivable_invites|cairn_invites) SET revoked_at = to_char\(now\(\) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'\) WHERE from_tenant = \? AND accepted_at IS NULL AND revoked_at IS NULL$/);
  if (revoke) {
    const open = t(revoke[1]).filter((r) => r.from_tenant === args[0] && r.accepted_at == null && r.revoked_at == null);
    for (const r of open) r.revoked_at = nowStamp();
    return { rows: [], rowsAffected: open.length };
  }

  // Agent key auth (authenticateAgentKey) and its fire-and-forget usage touch.
  if (sql === "SELECT id, domain FROM verify_agent_keys WHERE key_hash = ? AND status = 'active' LIMIT 1") {
    return { rows: t('verify_agent_keys').filter((r) => r.key_hash === args[0] && r.status === 'active').slice(0, 1), rowsAffected: 0 };
  }
  if (sql === 'UPDATE verify_agent_keys SET last_used_at = ? WHERE id = ?') return none;

  // Public lookups (lookupVerifiedAddress, lookupVerifiedUrl) and the claim guard
  // (isClaimedElsewhere). Matched loosely on the table and filter so column-list changes
  // elsewhere don't break this suite.
  if (sql.includes('FROM verified_address_mirror m JOIN verified_entities e')) {
    const rows = t('verified_address_mirror')
      .filter((r) => r.status === 'verified' && r.address === args[0] && r.refreshed_at && r.refreshed_at >= args[1])
      .map((r) => ({ r, e: t('verified_entities').find((e) => e.id === r.entity_id) }))
      .filter(({ e }) => !!e)
      // The lookup only answers for approved publishers: lower(e.tenant_id) IN (...).
      .filter(({ e }) => !/lower\(e\.tenant_id\) IN \(/.test(sql) || args.slice(2).includes(String(e!.tenant_id).toLowerCase()))
      .map(({ r, e }) => ({ chain: r.chain, entity_domain: r.entity_domain, proven_at: e!.proven_at, tenant_id: e!.tenant_id }));
    return { rows: rows.slice(0, 1), rowsAffected: 0 };
  }
  if (sql.includes("FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)")) {
    const rows = t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven'
      && (r.value === args[0] || String(r.value).toLowerCase() === args[1]));
    return { rows, rowsAffected: 0 };
  }
  if (/FROM verify_destinations WHERE kind = 'qr' AND proof_status = 'proven'$/.test(sql)) {
    return { rows: t('verify_destinations').filter((r) => r.kind === 'qr' && r.proof_status === 'proven'), rowsAffected: 0 };
  }
  if (sql.includes("FROM verify_destinations WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ?")) {
    const rows = t('verify_destinations').filter((r) => r.kind === args[0] && r.proof_status === 'proven'
      && r.tenant_id !== args[1] && String(r.value).toLowerCase().includes(args[2]));
    return { rows, rowsAffected: 0 };
  }
  if (sql.includes('FROM verify_claimed_names WHERE tenant_id = ?')) {
    return { rows: t('verify_claimed_names').filter((r) => r.tenant_id === args[0]), rowsAffected: 0 };
  }

  mem.unexpected.push(sql);
  throw new Error(`unexpected statement: ${sql}`);
}

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      mem.calls.push({ via: 'execute', sql: oneLine(stmt.sql), args: stmt.args ?? [] });
      return run(stmt.sql, (stmt.args ?? []) as any[]);
    },
    // Transactional like db.pg.ts: all statements apply, or none do.
    batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
      for (const s of stmts) mem.calls.push({ via: 'batch', sql: oneLine(s.sql), args: s.args ?? [] });
      if (mem.failBatch) throw mem.failBatch;
      const snapshot = structuredClone(mem.tables);
      try {
        return stmts.map((s) => run(s.sql, (s.args ?? []) as any[]));
      } catch (e) {
        mem.tables = snapshot;
        throw e;
      }
    },
  },
}));

const auth = vi.hoisted(() => ({ getAuthSession: vi.fn() }));
vi.mock('@/lib/authSession', () => auth);

const gate = vi.hoisted(() => ({ invalidateUserAuthFacts: vi.fn() }));
vi.mock('@/lib/sessionGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/sessionGate')>()),
  invalidateUserAuthFacts: gate.invalidateUserAuthFacts,
}));

import { POST } from '../../src/pages/api/account/delete';
import { GET as checkGet } from '../../src/pages/api/verify/check';
import { deleteVerifyAccountData } from '../../src/lib/verifyAccountDelete';
import { authenticateAgentKey } from '../../src/lib/agentKeys';
import { lookupVerifiedAddress, lookupVerifiedUrl } from '../../src/lib/verifyEntities';
import { isClaimedElsewhere } from '../../src/lib/verifyRegistry';

const A = 'tenant-a';
const B = 'tenant-b';
const USER_A = 'user-a';
const WALLET_A = '0x' + 'a1'.repeat(20);
const WALLET_B = '0x' + 'b2'.repeat(20);
const MIRROR_A = '0x' + 'c3'.repeat(20);
const MIRROR_B = '0x' + 'd4'.repeat(20);
const KEY_A = 'avk_' + 'a'.repeat(48);
const KEY_B = 'avk_' + 'b'.repeat(48);
const LINK_A = 'https://buy.stripe.com/a';
const LINK_B = 'https://buy.stripe.com/b';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Every Verify table, named here on purpose rather than imported from the module. */
const VERIFY_TABLES = [
  'verify_destinations',
  'verify_domain_proofs',
  'verify_deposit_challenges',
  'verify_deposit_amount_log',
  'verify_claimed_names',
  'verify_agent_keys',
  'verified_entities',
  'verified_address_mirror',
];
/** The two tenant-only receivable steps. */
const RECEIVABLE_TABLES = ['receivable_invites', 'receivable_seen', 'cairn_invites'];
const ALL_STEP_TABLES = [...VERIFY_TABLES, ...RECEIVABLE_TABLES];

function seedTenant(tenant: string, user: string, tag: string, wallet: string, mirror: string, key: string): void {
  const add = (table: string, row: Row) => (mem.tables[table] ??= []).push(row);
  add('tenant_memberships', { id: `tm-${tag}`, user_id: user, tenant_id: tenant, role: 'owner', created_at: '2026-01-01 00:00:00' });
  add('auth_users', { id: user });
  add('campaign_drip', { campaign: 'business', user_id: user, email: `${tag}@example.test` });
  add('campaign_drip', { campaign: 'onboarding', user_id: user, email: `${tag}@example.test` });
  add('wallets', { id: `w-${tag}`, tenant_id: tenant });
  add('petro_tins', { id: `pt-${tag}`, tenant_id: tenant });
  add('petro_tin_entries', { id: `pe-${tag}`, tin_id: `pt-${tag}`, tenant_id: tenant });

  add('verify_destinations', {
    id: `d-${tag}`, tenant_id: tenant, kind: 'address', rail: 'ethereum', value: wallet, label: `Shop ${tag}`,
    proof_method: 'micro_deposit', proof_status: 'proven', proof_domain: null,
    proven_at: '2026-09-01 00:00:00', last_confirmed_at: null,
  });
  add('verify_destinations', {
    id: `q-${tag}`, tenant_id: tenant, kind: 'qr', rail: 'url', value: `https://buy.stripe.com/${tag}`,
    label: `Link ${tag}`, proof_method: 'account_claim', proof_status: 'proven',
    proven_at: '2026-09-01 00:00:00', monitor_url: null, last_confirmed_at: null,
  });
  add('verify_domain_proofs', { id: `dp-${tag}`, tenant_id: tenant, domain: `shop-${tag}.example`, status: 'proven' });
  add('verify_deposit_challenges', { id: `c-${tag}`, destination_id: `d-${tag}`, tenant_id: tenant, status: 'pending' });
  add('verify_deposit_amount_log', { id: `l-${tag}`, tenant_id: tenant, canonical_address: `evm:${wallet}` });
  add('verify_claimed_names', {
    name_key: `shop ${tag}`, tenant_id: tenant, display_name: `Shop ${tag}`, domain: `shop-${tag}.example`,
    created_at: '2026-09-01 00:00:00',
  });
  add('verify_agent_keys', { id: `k-${tag}`, tenant_id: tenant, domain: `shop-${tag}.example`, key_hash: sha256(key), status: 'active' });
  add('verified_entities', { id: `e-${tag}`, tenant_id: tenant, domain: `platform-${tag}.example`, proven_at: '2026-09-01 00:00:00' });
  add('verified_address_mirror', {
    id: `m-${tag}`, entity_id: `e-${tag}`, tenant_id: tenant, address: mirror, chain: 'ethereum',
    entity_domain: `platform-${tag}.example`, status: 'verified', refreshed_at: nowStamp(),
  });

  // Receivable desk: one open, one answered and one revoked request from this tenant,
  // plus a read marker. The shared records themselves (receivables, claims, ...) are kept
  // and never touched, so they are not modeled.
  add('receivable_invites', { token: `open-${tag}`, from_tenant: tenant, accepted_at: null, revoked_at: null });
  add('receivable_invites', { token: `answered-${tag}`, from_tenant: tenant, accepted_at: '2026-09-02 00:00:00', revoked_at: null });
  add('receivable_invites', { token: `revoked-${tag}`, from_tenant: tenant, accepted_at: null, revoked_at: '2026-09-03 00:00:00' });
  add('receivable_seen', { tenant_id: tenant, receivable_id: `r-${tag}`, seen_at: '2026-09-04 00:00:00' });
  // Milestone desk: the same three request states.
  add('cairn_invites', { token: `ms-open-${tag}`, from_tenant: tenant, accepted_at: null, revoked_at: null });
  add('cairn_invites', { token: `ms-answered-${tag}`, from_tenant: tenant, accepted_at: '2026-09-02 00:00:00', revoked_at: null });
  add('cairn_invites', { token: `ms-revoked-${tag}`, from_tenant: tenant, accepted_at: null, revoked_at: '2026-09-03 00:00:00' });
}

const rowsOf = (table: string, tenant: string) => (mem.tables[table] ?? []).filter((r) => r.tenant_id === tenant);
const invite = (token: string) => (mem.tables.receivable_invites ?? []).find((r) => r.token === token);
const verifyBatches = () => mem.calls.filter((c) => c.via === 'batch');

type Ctx = Parameters<typeof POST>[0];
const deleted: string[] = [];
const callPost = () => POST({
  request: new Request('https://app.test/api/account/delete', { method: 'POST' }),
  cookies: { delete: (name: string) => { deleted.push(name); } },
} as unknown as Ctx);

let ipSeq = 0;
async function check(value: string): Promise<any> {
  const url = new URL(`https://app.test/api/verify/check?value=${encodeURIComponent(value)}`);
  const res = await checkGet({
    request: new Request(url), url, clientAddress: `203.0.113.${++ipSeq}`,
  } as unknown as Parameters<typeof checkGet>[0]);
  expect(res.status).toBe(200);
  return res.json();
}

// Placeholders the shim numbers: every `?` outside a single-quoted literal (db.pg.ts toPg()).
function placeholders(sql: string): number {
  let n = 0;
  let inStr = false;
  for (const c of sql) {
    if (c === "'") inStr = !inStr;
    else if (c === '?' && !inStr) n++;
  }
  return n;
}

beforeEach(() => {
  // Platform lists publish only for approved tenants (verifyEntityAccess); these fixtures
  // model approved platforms, so approve their tenants.
  vi.stubEnv('VERIFY_ENTITY_TENANTS', `${A},${B}`);
  mem.tables = {};
  mem.calls = [];
  mem.unexpected = [];
  mem.failBatch = null;
  mem.missing = new Set();
  mem.after = null;
  deleted.length = 0;
  seedTenant(A, USER_A, 'a', WALLET_A, MIRROR_A, KEY_A);
  seedTenant(B, 'user-b', 'b', WALLET_B, MIRROR_B, KEY_B);
  auth.getAuthSession.mockReset();
  auth.getAuthSession.mockResolvedValue({ user: { id: USER_A } });
  gate.invalidateUserAuthFacts.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  expect(mem.unexpected).toEqual([]);
  for (const c of mem.calls) expect(placeholders(c.sql)).toBe(c.args.length);
});

describe('POST /api/account/delete: Verify data', () => {
  it('deletes every Verify table for the tenant in one transaction, before the account', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // The first pass (and the final sweep, which repeats it) cover every step table.
    const batches = verifyBatches();
    const firstPass = batches.slice(0, ALL_STEP_TABLES.length);
    const tables = firstPass.map((c) => c.sql.match(/^(?:DELETE FROM|UPDATE) (\w+)/)?.[1]);
    expect([...tables].sort()).toEqual([...ALL_STEP_TABLES].sort());
    for (const c of batches) expect(c.args).toEqual([A]);

    // Entities before their mirror rows (the lock order pullEntity shares).
    expect(tables.indexOf('verified_entities')).toBeLessThan(tables.indexOf('verified_address_mirror'));
    expect(tables.indexOf('verify_deposit_challenges')).toBeLessThan(tables.indexOf('verify_destinations'));
    // The whole first pass before any other delete in the request.
    const firstBatch = mem.calls.findIndex((c) => c.via === 'batch');
    const firstOtherDelete = mem.calls.findIndex((c) => c.via === 'execute' && c.sql.startsWith('DELETE'));
    expect(firstBatch).toBeGreaterThanOrEqual(0);
    expect(firstBatch).toBeLessThan(firstOtherDelete);

    for (const table of VERIFY_TABLES) {
      expect(rowsOf(table, A), table).toEqual([]);
    }
    expect(mem.tables.auth_users.map((r) => r.id)).toEqual(['user-b']);
  });

  it('runs nothing unscoped and leaves every other tenant\'s rows alone', async () => {
    const before = structuredClone(mem.tables);
    const res = await callPost();
    expect(res.status).toBe(200);

    for (const c of mem.calls) {
      const sql = c.sql;
      if (sql.startsWith('SELECT to_regclass(')) {
        // Catalog check: table names only, never a tenant or a user.
        expect([...(c.args as string[])].sort(), sql).toEqual([...ALL_STEP_TABLES].sort());
        continue;
      }
      if (sql.startsWith('SELECT tenant_id FROM tenant_memberships WHERE user_id = ?')
        || sql === 'DELETE FROM campaign_drip WHERE user_id = ?'
        || sql === 'DELETE FROM auth_users WHERE id = ?') {
        expect(c.args, sql).toEqual([USER_A]);
        continue;
      }
      const scoped = /^DELETE FROM \w+ WHERE tenant_id = \?( RETURNING id)?$/.test(sql)
        || /^DELETE FROM \w+ WHERE \w+ IN \(SELECT id FROM \w+ WHERE tenant_id = \?\)$/.test(sql)
        || /^UPDATE (receivable_invites|cairn_invites) SET revoked_at = .* WHERE from_tenant = \? AND accepted_at IS NULL AND revoked_at IS NULL$/.test(sql);
      expect(scoped, sql).toBe(true);
      expect(c.args, sql).toEqual([A]);
    }

    for (const [table, rows] of Object.entries(before)) {
      if (table === 'receivable_invites' || table === 'cairn_invites') continue; // revoked in place, asserted below
      const others = rows.filter((r) => r.tenant_id !== A && r.id !== USER_A && r.user_id !== USER_A);
      expect(mem.tables[table], table).toEqual(others);
    }
    for (const table of VERIFY_TABLES) expect(rowsOf(table, B), table).toHaveLength(1 + Number(table === 'verify_destinations'));
    // The other tenant's requests are untouched, open one included.
    expect(mem.tables.receivable_invites.filter((r) => r.from_tenant === B))
      .toEqual(before.receivable_invites.filter((r) => r.from_tenant === B));
    expect(mem.tables.cairn_invites.filter((r) => r.from_tenant === B))
      .toEqual(before.cairn_invites.filter((r) => r.from_tenant === B));
  });

  it('revokes only the tenant\'s own open receivable requests and deletes its read markers', async () => {
    expect((await callPost()).status).toBe(200);

    expect(invite('open-a')?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Answered and already-revoked requests are left as they were.
    expect(invite('answered-a')).toMatchObject({ accepted_at: '2026-09-02 00:00:00', revoked_at: null });
    expect(invite('revoked-a')?.revoked_at).toBe('2026-09-03 00:00:00');
    expect(invite('open-b')?.revoked_at).toBeNull();
    const msInvite = (token: string) => (mem.tables.cairn_invites ?? []).find((r) => r.token === token);
    expect(msInvite('ms-open-a')?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(msInvite('ms-answered-a')).toMatchObject({ accepted_at: '2026-09-02 00:00:00', revoked_at: null });
    expect(msInvite('ms-revoked-a')?.revoked_at).toBe('2026-09-03 00:00:00');
    expect(msInvite('ms-open-b')?.revoked_at).toBeNull();

    expect(rowsOf('receivable_seen', A)).toEqual([]);
    expect(rowsOf('receivable_seen', B)).toHaveLength(1);
  });

  it('deletes the user\'s drip-campaign enrollments and nobody else\'s', async () => {
    expect((await callPost()).status).toBe(200);
    const drip = mem.calls.filter((c) => c.sql.startsWith('DELETE FROM campaign_drip'));
    expect(drip).toEqual([{ via: 'execute', sql: 'DELETE FROM campaign_drip WHERE user_id = ?', args: [USER_A] }]);
    expect(mem.tables.campaign_drip.map((r) => r.user_id)).toEqual(['user-b', 'user-b']);
  });

  it('takes the claims off the public lookups and frees them for a new account', async () => {
    expect(await lookupVerifiedAddress(WALLET_A)).toMatchObject({ source: 'merchant', label: 'Shop a' });
    expect(await lookupVerifiedAddress(MIRROR_A)).toMatchObject({ source: 'entity', domain: 'platform-a.example' });
    expect(await lookupVerifiedUrl(LINK_A)).toMatchObject({ source: 'merchant', chain: 'url', label: 'Shop a' });
    expect(await isClaimedElsewhere('tenant-new', 'address', WALLET_A)).toBe(true);

    expect((await callPost()).status).toBe(200);

    expect(await lookupVerifiedAddress(WALLET_A)).toBeNull();
    expect(await lookupVerifiedAddress(MIRROR_A)).toBeNull();
    expect(await lookupVerifiedUrl(LINK_A)).toBeNull();
    expect(await isClaimedElsewhere('tenant-new', 'address', WALLET_A)).toBe(false);
    expect(mem.tables.verify_claimed_names.map((r) => r.name_key)).toEqual(['shop b']);
    // The other tenant still answers.
    expect(await lookupVerifiedAddress(WALLET_B)).toMatchObject({ source: 'merchant', label: 'Shop b' });
    expect(await lookupVerifiedUrl(LINK_B)).toMatchObject({ source: 'merchant', label: 'Shop b' });
    expect(await isClaimedElsewhere('tenant-new', 'address', WALLET_B)).toBe(true);
  });

  it('turns the agent check from proven to unknown for the deleted tenant only', async () => {
    expect(await check(WALLET_A)).toMatchObject({ status: 'proven', label: 'Shop a' });
    expect(await check(LINK_A)).toMatchObject({ status: 'proven' });

    expect((await callPost()).status).toBe(200);

    expect(await check(WALLET_A)).toMatchObject({ status: 'unknown', level: null, label: null, domain: null });
    expect(await check(LINK_A)).toMatchObject({ status: 'unknown', level: null });
    expect(await check(MIRROR_A)).toMatchObject({ status: 'unknown' });
    expect(await check(WALLET_B)).toMatchObject({ status: 'proven', label: 'Shop b' });
    expect(await check(MIRROR_B)).toMatchObject({ status: 'proven', domain: 'platform-b.example' });
  });

  it('stops a deleted agent key at once instead of serving it from the auth cache', async () => {
    const keySelects = () => mem.calls.filter((c) => c.sql.startsWith('SELECT id, domain FROM verify_agent_keys')).length;
    expect(await authenticateAgentKey(KEY_A)).toEqual({ id: 'k-a', domain: 'shop-a.example' });
    expect(await authenticateAgentKey(KEY_B)).toEqual({ id: 'k-b', domain: 'shop-b.example' });
    const warm = keySelects();
    expect(await authenticateAgentKey(KEY_A)).not.toBeNull(); // served from the cache
    expect(keySelects()).toBe(warm);

    expect((await callPost()).status).toBe(200);

    expect(await authenticateAgentKey(KEY_A)).toBeNull();
    expect(keySelects()).toBe(warm + 1); // evicted, so it went back to the (now empty) table
    expect(await authenticateAgentKey(KEY_B)).toEqual({ id: 'k-b', domain: 'shop-b.example' });
    expect(keySelects()).toBe(warm + 1); // another tenant's cached key is untouched
  });

  it('cuts the user\'s other sessions and sweeps a claim written while the account was going away', async () => {
    // Another tab of the same account saves a payment link after the first Verify pass,
    // just before the memberships go.
    mem.after = (sql) => {
      if (sql === 'DELETE FROM tenant_memberships WHERE tenant_id = ?') {
        mem.after = null;
        mem.tables.verify_destinations.push({
          id: 'q-late', tenant_id: A, kind: 'qr', rail: 'url', value: 'https://buy.stripe.com/late',
          proof_method: 'account_claim', proof_status: 'proven', proven_at: nowStamp(),
        });
      }
    };

    expect((await callPost()).status).toBe(200);

    expect(gate.invalidateUserAuthFacts).toHaveBeenCalledWith(USER_A);
    expect(gate.invalidateUserAuthFacts).toHaveBeenCalledTimes(1);
    // The sweep runs after the user is gone and after the gate was cleared.
    const batches = verifyBatches();
    expect(batches.length).toBe(ALL_STEP_TABLES.length * 2);
    const userGone = mem.calls.findIndex((c) => c.sql === 'DELETE FROM auth_users WHERE id = ?');
    const sweepStart = mem.calls.indexOf(batches[ALL_STEP_TABLES.length]);
    expect(sweepStart).toBeGreaterThan(userGone);

    expect(rowsOf('verify_destinations', A)).toEqual([]);
    expect(await lookupVerifiedUrl('https://buy.stripe.com/late')).toBeNull();
    expect(rowsOf('verify_destinations', B)).toHaveLength(2);
  });

  it('still deletes the account when the final sweep fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mem.after = (sql) => {
      if (sql === 'DELETE FROM auth_users WHERE id = ?') mem.failBatch = new Error('connection lost');
    };
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(rowsOf('verify_destinations', A)).toEqual([]); // the first pass already ran
    expect(mem.tables.auth_users.map((r) => r.id)).toEqual(['user-b']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps the whole account when the Verify delete fails, so the owner can retry', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mem.failBatch = new Error('connection lost');
    const before = structuredClone(mem.tables);

    const res = await callPost();
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
    expect(mem.calls.some((c) => c.via === 'execute' && /^(DELETE|UPDATE)/.test(c.sql))).toBe(false);
    expect(mem.tables).toEqual(before);
    expect(deleted).toEqual([]); // still signed in
    expect(gate.invalidateUserAuthFacts).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('skips a table that was never created instead of failing the deletion', async () => {
    mem.missing = new Set(['verify_deposit_amount_log', 'receivable_seen']);
    delete mem.tables.verify_deposit_amount_log;
    delete mem.tables.receivable_seen;

    const res = await callPost();
    expect(res.status).toBe(200);
    const touched = verifyBatches().map((c) => c.sql.match(/^(?:DELETE FROM|UPDATE) (\w+)/)?.[1]);
    expect(touched).not.toContain('verify_deposit_amount_log');
    expect(touched).not.toContain('receivable_seen');
    for (const table of VERIFY_TABLES.filter((t) => t !== 'verify_deposit_amount_log')) {
      expect(rowsOf(table, A), table).toEqual([]);
    }
  });

  it('returns 401 without a session and runs nothing', async () => {
    auth.getAuthSession.mockResolvedValue(null);
    const res = await callPost();
    expect(res.status).toBe(401);
    expect(mem.calls).toEqual([]);
  });

  it('returns 404 with no membership and deletes nothing', async () => {
    auth.getAuthSession.mockResolvedValue({ user: { id: 'user-without-tenant' } });
    const res = await callPost();
    expect(res.status).toBe(404);
    expect(mem.calls.every((c) => c.sql.startsWith('SELECT'))).toBe(true);
  });
});

describe('POST /api/account/delete: which tenant', () => {
  const SIDE = 'tenant-side';
  beforeEach(() => {
    // USER_A is also a member of the legacy 'default' tenant (listed first, oldest) and of
    // a second tenant, and that second tenant has its own proven wallet.
    mem.tables.tenant_memberships.unshift(
      { id: 'tm-0', user_id: USER_A, tenant_id: 'default', role: 'owner', created_at: '2020-01-01 00:00:00' },
      { id: 'tm-1', user_id: USER_A, tenant_id: SIDE, role: 'member', created_at: '2020-01-02 00:00:00' },
    );
    mem.tables.verify_destinations.push({
      id: 'd-side', tenant_id: SIDE, kind: 'address', rail: 'ethereum', value: '0x' + 'e5'.repeat(20),
      proof_method: 'micro_deposit', proof_status: 'proven',
    });
  });
  const deletedTenant = () => verifyBatches()[0]?.args[0];

  it('uses the session tenant when the user is a member of it', async () => {
    auth.getAuthSession.mockResolvedValue({ user: { id: USER_A }, tenantId: SIDE });
    expect((await callPost()).status).toBe(200);
    expect(deletedTenant()).toBe(SIDE);
    expect(rowsOf('verify_destinations', SIDE)).toEqual([]);
    expect(rowsOf('verify_destinations', A)).toHaveLength(2);
  });

  it('otherwise picks the owned tenant, never \'default\'', async () => {
    expect((await callPost()).status).toBe(200);
    expect(deletedTenant()).toBe(A);
    expect(mem.calls.some((c) => c.args.includes('default'))).toBe(false);
    expect(rowsOf('verify_destinations', A)).toEqual([]);
    expect(rowsOf('verify_destinations', SIDE)).toHaveLength(1);
  });

  it('ignores a session tenant the user is not a member of', async () => {
    auth.getAuthSession.mockResolvedValue({ user: { id: USER_A }, tenantId: B });
    expect((await callPost()).status).toBe(200);
    expect(deletedTenant()).toBe(A);
    expect(rowsOf('verify_destinations', B)).toHaveLength(2);
  });

  it('ignores a \'default\' session tenant', async () => {
    auth.getAuthSession.mockResolvedValue({ user: { id: USER_A }, tenantId: 'default' });
    expect((await callPost()).status).toBe(200);
    expect(deletedTenant()).toBe(A);
  });
});

describe('deleteVerifyAccountData', () => {
  it('refuses a blank tenant id and runs nothing', async () => {
    await expect(deleteVerifyAccountData('')).rejects.toThrow();
    await expect(deleteVerifyAccountData('   ')).rejects.toThrow();
    expect(mem.calls).toEqual([]);
  });

  it('reports the rows it affected per table', async () => {
    const { affected } = await deleteVerifyAccountData(A);
    expect(Object.keys(affected).sort()).toEqual([...ALL_STEP_TABLES].sort());
    expect(affected.verify_destinations).toBe(2);
    for (const table of ALL_STEP_TABLES.filter((t) => t !== 'verify_destinations')) expect(affected[table], table).toBe(1);
  });

  it('is idempotent', async () => {
    await deleteVerifyAccountData(A);
    const { affected } = await deleteVerifyAccountData(A);
    for (const table of ALL_STEP_TABLES) expect(affected[table], table).toBe(0);
  });

  it('runs no DDL: nothing is created during an account deletion', async () => {
    await deleteVerifyAccountData(A);
    expect(mem.calls.some((c) => /^(CREATE|ALTER) /.test(c.sql))).toBe(false);
  });
});
