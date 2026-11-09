import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The cross-account guard for platform lists (src/lib/verifyMirrorGuard.ts and its seams in
 * verifyEntities.ts). Decided Nov 8, 2026 (verify-platform-guard-spec.claude.md):
 *
 *   G1  a control proof outranks a listing: a pulled entry another account has proven is a
 *       conflict with that merchant, and the merchant's proof stands;
 *   G2  two platforms, one address: the earlier-proven list keeps it, the later entry conflicts;
 *   G3  a conflict answers as nobody: the lookup returns a disputed hit, no domain, no name;
 *   G4  the guard runs at the pull and again at the lookup, for the window between them;
 *   G5  nothing is deleted and nobody is named.
 *
 * No database or network: '@/lib/db' is an in-memory stand-in that understands exactly the
 * statements these paths run, the list fetch and the key decryption are stubbed.
 */

type Row = Record<string, any>;

const mem = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  unexpected: [] as string[],
  failGuard: false,
}));

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** The lowercased IN-list the guard's prefilters carry, positional after the leading args. */
const inList = (args: any[], from: number): Set<string> => new Set(args.slice(from).map((a) => String(a).toLowerCase()));

function run(sqlIn: string, args: any[] = []): { rows: Row[]; rowsAffected: number } {
  const sql = oneLine(sqlIn);
  const t = (name: string): Row[] => (mem.tables[name] ??= []);

  if (/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /.test(sql)) return { rows: [], rowsAffected: 0 };
  if (/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS /.test(sql)) return { rows: [], rowsAffected: 0 };
  // ── guard PR B: the merchant side ──
  if (sql === "UPDATE verify_destinations SET platform_listed_at = COALESCE(platform_listed_at, ?) WHERE kind = 'address' AND proof_status = 'proven' AND tenant_id <> ? AND lower(value) = ?") {
    const hit = t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven' && r.tenant_id !== args[1] && String(r.value).toLowerCase() === args[2]);
    for (const r of hit) r.platform_listed_at = r.platform_listed_at ?? args[0];
    return { rows: [], rowsAffected: hit.length };
  }
  if (sql === 'UPDATE verify_destinations SET platform_listed_at = COALESCE(platform_listed_at, ?) WHERE id = ? AND tenant_id = ?') {
    const hit = t('verify_destinations').filter((r) => r.id === args[1] && r.tenant_id === args[2]);
    for (const r of hit) r.platform_listed_at = r.platform_listed_at ?? args[0];
    return { rows: [], rowsAffected: hit.length };
  }
  if (sql.startsWith("UPDATE verify_destinations d SET platform_listed_at = NULL WHERE d.platform_listed_at IS NOT NULL AND NOT EXISTS (")) {
    const hit = t('verify_destinations').filter((d) => d.platform_listed_at && !t('verified_address_mirror').some((m) =>
      String(m.address).toLowerCase() === String(d.value).toLowerCase() && ['verified', 'conflict'].includes(m.status) && m.tenant_id !== d.tenant_id));
    for (const d of hit) d.platform_listed_at = null;
    return { rows: [], rowsAffected: hit.length };
  }
  if (sql === "SELECT value FROM verify_destinations WHERE kind = ? AND proof_status = 'proven' AND tenant_id <> ? AND strpos(lower(value), ?) > 0") {
    return { rows: t('verify_destinations').filter((r) => r.kind === args[0] && r.proof_status === 'proven' && r.tenant_id !== args[1] && String(r.value).toLowerCase().includes(args[2])).map((r) => ({ value: r.value })), rowsAffected: 0 };
  }
  if (sql.startsWith("SELECT m.address AS address FROM verified_address_mirror m JOIN verified_entities e ON e.id = m.entity_id WHERE lower(m.address) = ? AND m.status IN ('verified', 'conflict')")) {
    const [address, cutoff, exceptTenant, ...publishers] = args;
    const pubs = new Set(publishers.map((p) => String(p).toLowerCase()));
    const rows = t('verified_address_mirror').filter((m) => {
      if (String(m.address).toLowerCase() !== address || !['verified', 'conflict'].includes(m.status) || !m.refreshed_at || m.refreshed_at < cutoff) return false;
      const e = t('verified_entities').find((x) => x.id === m.entity_id);
      return !!e && e.proof_status === 'proven' && e.tenant_id !== exceptTenant && pubs.has(String(e.tenant_id).toLowerCase());
    });
    return { rows: rows.map((m) => ({ address: m.address })), rowsAffected: 0 };
  }
  if (sql === "SELECT tenant_id, value FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND lower(value) = ?") {
    return { rows: t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven' && String(r.value).toLowerCase() === args[0]).map((r) => ({ tenant_id: r.tenant_id, value: r.value })), rowsAffected: 0 };
  }
  if (sql === "SELECT address, chain, conflict_with, conflict_seen_at FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ? AND status = 'conflict' ORDER BY conflict_seen_at ASC, address ASC") {
    return { rows: t('verified_address_mirror').filter((r) => r.entity_id === args[0] && r.tenant_id === args[1] && r.status === 'conflict'), rowsAffected: 0 };
  }
  // The registry's cold-start backfills (ensureVerifyTables): nothing to backfill here.
  if (/^UPDATE verify_destinations (d )?SET /.test(sql) && !sql.includes('WHERE id = ?')) return { rows: [], rowsAffected: 0 };

  // ── the pull ──
  if (sql === 'SELECT id, domain, proof_status, api_endpoint, api_key_encrypted, proven_at FROM verified_entities WHERE id = ? AND tenant_id = ?') {
    return { rows: t('verified_entities').filter((r) => r.id === args[0] && r.tenant_id === args[1]), rowsAffected: 0 };
  }
  if (sql === "UPDATE verified_entities SET last_pull_status = 'ok', last_pull_count = ?, last_pull_conflicts = ?, last_pulled_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?") {
    const hit = t('verified_entities').filter((r) => r.id === args[4] && r.tenant_id === args[5]);
    for (const r of hit) Object.assign(r, { last_pull_status: 'ok', last_pull_count: args[0], last_pull_conflicts: args[1], last_pulled_at: args[2] });
    return { rows: [], rowsAffected: hit.length };
  }
  if (sql === 'DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?') {
    const before = t('verified_address_mirror').length;
    mem.tables.verified_address_mirror = t('verified_address_mirror').filter((r) => !(r.entity_id === args[0] && r.tenant_id === args[1]));
    return { rows: [], rowsAffected: before - mem.tables.verified_address_mirror.length };
  }
  if (sql.startsWith('INSERT INTO verified_address_mirror (id, entity_id, tenant_id, address, chain, entity_domain, status, source, refreshed_at, conflict_with, conflict_seen_at)')) {
    const [id, entityId, tenantId, address, chain, domain, status, refreshedAt, conflictWith, conflictSeenAt, eId, eTenant] = args;
    const live = t('verified_entities').some((e) => e.id === eId && e.tenant_id === eTenant && e.proof_status === 'proven');
    if (!live) return { rows: [], rowsAffected: 0 };
    t('verified_address_mirror').push({ id, entity_id: entityId, tenant_id: tenantId, address, chain, entity_domain: domain, status, source: 'api_endpoint', refreshed_at: refreshedAt, conflict_with: conflictWith, conflict_seen_at: conflictSeenAt });
    return { rows: [], rowsAffected: 1 };
  }
  if (sql === 'SELECT address, status FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?') {
    return { rows: t('verified_address_mirror').filter((r) => r.entity_id === args[0] && r.tenant_id === args[1]), rowsAffected: 0 };
  }

  // ── the guard's prefilters ──
  if (sql.startsWith("SELECT value FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND tenant_id <> ? AND lower(value) IN (")) {
    if (mem.failGuard) throw new Error('db down');
    const keys = inList(args, 1);
    return { rows: t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven' && r.tenant_id !== args[0] && keys.has(String(r.value).toLowerCase())).map((r) => ({ value: r.value })), rowsAffected: 0 };
  }
  if (sql.startsWith("SELECT m.address AS address FROM verified_address_mirror m JOIN verified_entities e ON e.id = m.entity_id WHERE m.status = 'verified' AND m.entity_id <> ? AND e.proof_status = 'proven' AND (e.proven_at < ? OR (e.proven_at = ? AND m.entity_id < ?)) AND lower(e.tenant_id) IN (")) {
    const [entityId, provenAt, , , ...rest] = args;
    const nPub = (sql.match(/lower\(e\.tenant_id\) IN \(([^)]*)\)/)![1].match(/\?/g) ?? []).length;
    const publishers = new Set(rest.slice(0, nPub).map((p) => String(p).toLowerCase()));
    const keys = new Set(rest.slice(nPub).map((k) => String(k).toLowerCase()));
    const rows = t('verified_address_mirror').filter((m) => {
      if (m.status !== 'verified' || m.entity_id === entityId || !keys.has(String(m.address).toLowerCase())) return false;
      const e = t('verified_entities').find((x) => x.id === m.entity_id);
      if (!e || e.proof_status !== 'proven' || !publishers.has(String(e.tenant_id).toLowerCase())) return false;
      return e.proven_at < provenAt || (e.proven_at === provenAt && m.entity_id < entityId);
    });
    return { rows: rows.map((m) => ({ address: m.address })), rowsAffected: 0 };
  }

  // ── the lookup ──
  if (sql.startsWith("SELECT m.chain AS chain, m.entity_domain AS entity_domain, e.proven_at AS proven_at, e.tenant_id AS tenant_id FROM verified_address_mirror m JOIN verified_entities e ON e.id = m.entity_id WHERE m.status = 'verified' AND m.address = ?")) {
    const [address, cutoff, ...publishers] = args;
    const pubs = new Set(publishers.map((p) => String(p).toLowerCase()));
    const rows = t('verified_address_mirror')
      .filter((m) => m.status === 'verified' && m.address === address && m.refreshed_at && m.refreshed_at >= cutoff)
      .map((m) => ({ m, e: t('verified_entities').find((x) => x.id === m.entity_id)! }))
      .filter(({ e }) => e && pubs.has(String(e.tenant_id).toLowerCase()))
      .sort((a, b) => (a.e.proven_at < b.e.proven_at ? -1 : a.e.proven_at > b.e.proven_at ? 1 : a.m.entity_id < b.m.entity_id ? -1 : 1))
      .slice(0, 1)
      .map(({ m, e }) => ({ chain: m.chain, entity_domain: m.entity_domain, proven_at: e.proven_at, tenant_id: e.tenant_id }));
    return { rows, rowsAffected: 0 };
  }
  if (sql === "SELECT value FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND tenant_id <> ? AND lower(value) = ?") {
    return { rows: t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven' && r.tenant_id !== args[0] && String(r.value).toLowerCase() === args[1]).map((r) => ({ value: r.value })), rowsAffected: 0 };
  }
  if (sql.startsWith("SELECT tenant_id, rail, value, proof_method, proof_domain, proven_at, domain_anchored_at, last_confirmed_at FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)")) {
    return { rows: t('verify_destinations').filter((r) => r.kind === 'address' && r.proof_status === 'proven' && (r.value === args[0] || String(r.value).toLowerCase() === args[1])), rowsAffected: 0 };
  }
  if (sql.startsWith("SELECT 1 AS one FROM verified_address_mirror m JOIN verified_entities e ON e.id = m.entity_id WHERE m.address = ? AND m.status IN ('verified', 'conflict')")) {
    const [address, cutoff, ...rest] = args;
    const exceptTenant = rest[rest.length - 1];
    const pubs = new Set(rest.slice(0, -1).map((p) => String(p).toLowerCase()));
    const any = t('verified_address_mirror').some((m) => {
      if (m.address !== address || !['verified', 'conflict'].includes(m.status) || !m.refreshed_at || m.refreshed_at < cutoff) return false;
      const e = t('verified_entities').find((x) => x.id === m.entity_id);
      return !!e && pubs.has(String(e.tenant_id).toLowerCase()) && e.tenant_id !== exceptTenant;
    });
    return { rows: any ? [{ one: 1 }] : [], rowsAffected: 0 };
  }
  if (sql.startsWith('SELECT display_name, domain FROM verify_claimed_names WHERE tenant_id = ?')) {
    return { rows: t('verify_claimed_names').filter((r) => r.tenant_id === args[0]), rowsAffected: 0 };
  }

  mem.unexpected.push(sql);
  throw new Error(`unexpected statement: ${sql}`);
}

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, (stmt.args ?? []) as any[]),
    batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
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

const fetchList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/verifyProof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/verifyProof')>()),
  pullEntityList: fetchList,
}));
vi.mock('@/lib/verifyCrypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/verifyCrypto')>()),
  decryptSecret: () => 'entity-api-key',
}));

import { classifyListed, classifyPulledList, VERIFIED } from '../../src/lib/verifyMirrorGuard';
import { claimIdentity, claimStateElsewhere, clearStalePlatformListed, provenHoldersOf, PLATFORM_LISTED_DDL } from '../../src/lib/verifyRegistry';
import { listEntityConflicts, lookupVerifiedAddress, monitorEntity, pullEntity, MIRROR_GUARD_DDL } from '../../src/lib/verifyEntities';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const PLATFORM = 'tenant-platform';   // proven 2026-09-01
const LATER = 'tenant-later';         // proven 2026-10-01
const MERCHANT = 'tenant-merchant';
const E1 = 'entity-1';
const E2 = 'entity-2';
const SHARED = '0x' + 'ab'.repeat(20);
const SHARED_UPPER = '0x' + 'AB'.repeat(20);
const OWN = '0x' + 'cd'.repeat(20);
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const FRESH = '2099-01-01 00:00:00';
const STALE = '2020-01-01 00:00:00';

const id = (v: string) => claimIdentity('address', v);

beforeEach(() => {
  vi.stubEnv('VERIFY_ENTITY_TENANTS', `${PLATFORM},${LATER}`);
  mem.unexpected = [];
  mem.failGuard = false;
  mem.tables = {
    verified_entities: [
      { id: E1, tenant_id: PLATFORM, domain: 'platform.example', proof_status: 'proven', proven_at: '2026-09-01 00:00:00', api_endpoint: 'https://platform.example/a', api_key_encrypted: 'enc' },
      { id: E2, tenant_id: LATER, domain: 'later.example', proof_status: 'proven', proven_at: '2026-10-01 00:00:00', api_endpoint: 'https://later.example/a', api_key_encrypted: 'enc' },
    ],
    verified_address_mirror: [],
    verify_destinations: [],
    verify_claimed_names: [],
  };
  fetchList.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  expect(mem.unexpected).toEqual([]);
});

const merchantProof = (value: string, tenant = MERCHANT, over: Row = {}): Row => ({
  tenant_id: tenant, kind: 'address', proof_status: 'proven', value, rail: 'ethereum',
  proof_method: 'well_known', proof_domain: 'shop.example', proven_at: '2026-08-01 00:00:00',
  domain_anchored_at: '2026-08-01 00:00:00', last_confirmed_at: FRESH, ...over,
});
const mirrorRow = (entityId: string, tenant: string, address: string, over: Row = {}): Row => ({
  id: `m-${entityId}-${address.slice(-6)}`, entity_id: entityId, tenant_id: tenant, address, chain: 'ethereum',
  entity_domain: entityId === E1 ? 'platform.example' : 'later.example', status: 'verified', source: 'api_endpoint',
  refreshed_at: FRESH, conflict_with: null, conflict_seen_at: null, ...over,
});
const mirror = (tenant: string) => mem.tables.verified_address_mirror.filter((r) => r.tenant_id === tenant);

describe('the schema file and the code add the same columns', () => {
  const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const statementsOf = (file: string) => read(file).replace(/--[^\n]*/g, '').split(';').map((s) => squash(s)).filter(Boolean);
  it('migrations-pg/0072_verify_mirror_conflicts.sql holds exactly the statements ensureEntityTables adds, in order', () => {
    expect(statementsOf('migrations-pg/0072_verify_mirror_conflicts.sql')).toEqual(MIRROR_GUARD_DDL.map(squash));
  });
  it('migrations-pg/0073_verify_destination_platform_listed.sql holds exactly what ensureVerifyTables adds for PR B', () => {
    expect(statementsOf('migrations-pg/0073_verify_destination_platform_listed.sql')).toEqual(PLATFORM_LISTED_DDL.map(squash));
  });
});

describe('PR B, the merchant side (spec 3e, 3g, 3i): the listing is recorded, nobody is named, and it clears', () => {
  const dest = (value: string, tenant = MERCHANT, over: Row = {}): Row => ({ id: `d-${tenant}-${value.slice(-6)}`, ...merchantProof(value, tenant, over) });

  it('claimStateElsewhere: a fresh list of another approved platform reads as listedByPlatform, not as claimed (G1)', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect(await claimStateElsewhere(MERCHANT, 'address', SHARED)).toEqual({ claimedElsewhere: false, listedByPlatform: true });
    expect(await claimStateElsewhere(MERCHANT, 'address', SHARED_UPPER)).toEqual({ claimedElsewhere: false, listedByPlatform: true });
    // A row already marked a conflict still counts as listed; a stale one does not; the platform's own account is not "another".
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED, { status: 'conflict', conflict_with: 'merchant' })];
    expect((await claimStateElsewhere(MERCHANT, 'address', SHARED)).listedByPlatform).toBe(true);
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED, { refreshed_at: STALE })];
    expect((await claimStateElsewhere(MERCHANT, 'address', SHARED)).listedByPlatform).toBe(false);
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect((await claimStateElsewhere(PLATFORM, 'address', SHARED)).listedByPlatform).toBe(false);
    // An unapproved platform's list is not a listing.
    vi.stubEnv('VERIFY_ENTITY_TENANTS', LATER);
    expect((await claimStateElsewhere(MERCHANT, 'address', SHARED)).listedByPlatform).toBe(false);
  });

  it('claimStateElsewhere: another account\'s proof is still a refusal, and the platform read is then skipped', async () => {
    mem.tables.verify_destinations = [dest(SHARED, 'tenant-other')];
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect(await claimStateElsewhere(MERCHANT, 'address', SHARED)).toEqual({ claimedElsewhere: true, listedByPlatform: false });
    // A payment link is never on a platform list.
    expect(await claimStateElsewhere(MERCHANT, 'qr', 'https://buy.stripe.com/abc')).toEqual({ claimedElsewhere: false, listedByPlatform: false });
  });

  it('the pull marks the merchant\'s row with the first date the listing was seen, and only for merchant conflicts', async () => {
    mem.tables.verify_destinations = [dest(SHARED), dest(OWN, 'tenant-other', { platform_listed_at: '2026-01-01 00:00:00' })];
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, OWN)]; // E1 lists OWN earlier, so E2's OWN is a platform conflict
    fetchList.mockResolvedValue({ ok: true, addresses: [{ address: SHARED_UPPER, chain: 'ethereum' }, { address: OWN, chain: 'ethereum' }] });
    expect(await pullEntity(LATER, E2)).toEqual({ ok: true, count: 2, conflicts: 2 });
    const rows = mem.tables.verify_destinations;
    expect(rows.find((r) => r.value === SHARED).platform_listed_at).toBeTruthy();
    expect(rows.find((r) => r.value === OWN).platform_listed_at).toBe('2026-01-01 00:00:00'); // the earlier date stays
    // The mirror still names nobody.
    expect(JSON.stringify(mirror(LATER))).not.toContain(MERCHANT);
  });

  it('the platform\'s own view of its conflicts carries the address, the chain and a word, never a party (case 7)', async () => {
    mem.tables.verify_destinations = [dest(SHARED)];
    fetchList.mockResolvedValue({ ok: true, addresses: [{ address: SHARED, chain: 'ethereum' }, { address: OWN, chain: 'ethereum' }] });
    await pullEntity(PLATFORM, E1);
    const list = await listEntityConflicts(PLATFORM, E1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ address: SHARED, chain: 'ethereum', conflictWith: 'merchant' });
    expect(list[0].since).toBeTruthy();
    expect(Object.keys(list[0]).sort()).toEqual(['address', 'chain', 'conflictWith', 'since']);
    const text = JSON.stringify(list);
    for (const secret of [MERCHANT, 'shop.example']) expect(text).not.toContain(secret);
    // Another tenant reads nothing of it.
    expect(await listEntityConflicts(LATER, E1)).toEqual([]);
  });

  it('provenHoldersOf names every account holding the address proven, matched on the lookup key, for the cron only', async () => {
    mem.tables.verify_destinations = [dest(SHARED), dest(SHARED_UPPER, 'tenant-two'), dest(OWN, 'tenant-three')];
    expect((await provenHoldersOf(SHARED)).sort()).toEqual([MERCHANT, 'tenant-two'].sort());
    expect(await provenHoldersOf(BASE58)).toEqual([]);
  });

  it('the sweep clears platform_listed_at once no other account\'s mirror lists the address (spec 3i)', async () => {
    mem.tables.verify_destinations = [
      dest(SHARED, MERCHANT, { platform_listed_at: FRESH }),            // still listed by E1
      dest(OWN, 'tenant-other', { platform_listed_at: FRESH }),       // listing withdrawn
      dest(BTC, 'tenant-three', { platform_listed_at: FRESH }),       // listed only by its own account's platform
    ];
    mem.tables.verified_address_mirror = [
      mirrorRow(E1, PLATFORM, SHARED, { status: 'conflict', conflict_with: 'merchant' }),
      mirrorRow(E1, 'tenant-three', BTC),
    ];
    expect(await clearStalePlatformListed()).toBe(2);
    const by = (v: string) => mem.tables.verify_destinations.find((r) => r.value === v).platform_listed_at;
    expect(by(SHARED)).toBe(FRESH);
    expect(by(OWN)).toBeNull();
    expect(by(BTC)).toBeNull();
  });
});

describe('classifyListed, pure', () => {
  it('a merchant proof outranks a listing (G1), and the merchant check comes before the platform one', () => {
    expect(classifyListed(id(SHARED), [id(SHARED)], [id(SHARED)])).toEqual({ status: 'conflict', conflictWith: 'merchant' });
    expect(classifyListed(id(SHARED), [], [id(SHARED)])).toEqual({ status: 'conflict', conflictWith: 'platform' });
    expect(classifyListed(id(SHARED), [], [])).toEqual(VERIFIED);
  });

  it('compares the canonical claim identity, not the string: EVM case and segwit case collide, base58 case does not', () => {
    expect(classifyListed(id(SHARED_UPPER), [id(SHARED)], []).status).toBe('conflict');
    expect(classifyListed(id(BTC.toUpperCase()), [id(BTC)], []).status).toBe('conflict');
    expect(classifyListed(id(BASE58.toLowerCase()), [id(BASE58)], []).status).toBe('verified');
    // The same 0x address on another chain is one key, so a merchant proof on ethereum collides with a polygon listing.
    expect(classifyListed(id(SHARED), [claimIdentity('address', SHARED)], []).status).toBe('conflict');
  });

  it('an address with no usable form is never a conflict', () => {
    expect(classifyListed(id(''), [id(SHARED)], [id(SHARED)])).toEqual(VERIFIED);
  });
});

describe('classifyPulledList reads the other parties once and decides in code', () => {
  it('merchant first: the entry is a conflict with the merchant', async () => {
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    const out = await classifyPulledList({ tenantId: PLATFORM, entityId: E1, provenAt: '2026-09-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }, { address: OWN, chain: 'ethereum' }]);
    expect(out).toEqual([{ status: 'conflict', conflictWith: 'merchant' }, VERIFIED]);
  });

  it('the platform\'s own proof is not a conflict: one party', async () => {
    mem.tables.verify_destinations = [merchantProof(SHARED, PLATFORM)];
    const out = await classifyPulledList({ tenantId: PLATFORM, entityId: E1, provenAt: '2026-09-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }]);
    expect(out).toEqual([VERIFIED]);
  });

  it('two platforms: the later-proven entity\'s entry conflicts, the earlier keeps it (G2), and swapping the dates swaps the outcome', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect(await classifyPulledList({ tenantId: LATER, entityId: E2, provenAt: '2026-10-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }]))
      .toEqual([{ status: 'conflict', conflictWith: 'platform' }]);
    // The earlier entity pulling the same address sees no earlier list: verified.
    mem.tables.verified_address_mirror = [mirrorRow(E2, LATER, SHARED)];
    expect(await classifyPulledList({ tenantId: PLATFORM, entityId: E1, provenAt: '2026-09-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }]))
      .toEqual([VERIFIED]);
  });

  it('an unapproved platform\'s list is not a conflict: its rows never answered anyway', async () => {
    vi.stubEnv('VERIFY_ENTITY_TENANTS', LATER);
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect(await classifyPulledList({ tenantId: LATER, entityId: E2, provenAt: '2026-10-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }]))
      .toEqual([VERIFIED]);
  });

  it('a database error is thrown, never read as no conflict', async () => {
    mem.failGuard = true;
    await expect(classifyPulledList({ tenantId: PLATFORM, entityId: E1, provenAt: '2026-09-01 00:00:00' }, [{ address: SHARED, chain: 'ethereum' }])).rejects.toThrow('db down');
  });
});

describe('pullEntity writes the classification (G5: the row stays, with a word)', () => {
  it('merchant first: the pulled entry is written as a conflict with the merchant, the rest verified, and the entity counts it', async () => {
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    fetchList.mockResolvedValue({ ok: true, addresses: [{ address: SHARED, chain: 'ethereum' }, { address: OWN, chain: 'ethereum' }] });
    expect(await pullEntity(PLATFORM, E1)).toEqual({ ok: true, count: 2, conflicts: 1 });
    const rows = mirror(PLATFORM);
    expect(rows.find((r) => r.address === SHARED)).toMatchObject({ status: 'conflict', conflict_with: 'merchant' });
    expect(rows.find((r) => r.address === SHARED).conflict_seen_at).toBeTruthy();
    expect(rows.find((r) => r.address === OWN)).toMatchObject({ status: 'verified', conflict_with: null, conflict_seen_at: null });
    expect(mem.tables.verified_entities.find((r) => r.id === E1)).toMatchObject({ last_pull_count: 2, last_pull_conflicts: 1 });
    // Nothing names the merchant: no tenant id, no domain of theirs, anywhere in the mirror.
    expect(JSON.stringify(rows)).not.toContain(MERCHANT);
    expect(JSON.stringify(rows)).not.toContain('shop.example');
  });

  it('fails closed: when the guard cannot read, nothing is written and the previous mirror stays', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, OWN)];
    mem.failGuard = true;
    fetchList.mockResolvedValue({ ok: true, addresses: [{ address: SHARED, chain: 'ethereum' }] });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await pullEntity(PLATFORM, E1)).toEqual({ ok: false, code: 'guard_unavailable' });
    spy.mockRestore();
    expect(mirror(PLATFORM).map((r) => r.address)).toEqual([OWN]);
    expect(mem.tables.verified_entities.find((r) => r.id === E1).last_pull_conflicts).toBeUndefined();
  });

  it('the monitor reports conflicts added and cleared across a pull', async () => {
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, OWN, { status: 'conflict', conflict_with: 'platform' })];
    fetchList.mockResolvedValue({ ok: true, addresses: [{ address: SHARED, chain: 'ethereum' }, { address: OWN, chain: 'ethereum' }] });
    const r = await monitorEntity(PLATFORM, E1);
    expect(r.pull).toEqual({ ok: true, count: 2, conflicts: 1 });
    expect(r.conflicts).toEqual({ added: [SHARED], cleared: [OWN] });
    expect(r.added).toEqual([SHARED]);
  });
});

describe('the lookup answers a conflict as nobody (G3), in both directions (G4)', () => {
  const disputed = { source: 'conflict', level: 'disputed', since: null, domain: null, provingDomain: null, label: null };

  it('a platform row and another account\'s proof: disputed, even before the next pull marks the row', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject(disputed);
    // In any letter case the payer types it.
    expect(await lookupVerifiedAddress(SHARED_UPPER)).toMatchObject(disputed);
  });

  it('a platform row the platform\'s own account also proved: one party, the platform answers', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    mem.tables.verify_destinations = [merchantProof(SHARED, PLATFORM)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject({ source: 'entity', level: 'verified', domain: 'platform.example' });
  });

  it('a merchant proof and a fresh platform row already marked a conflict: disputed, not the merchant', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED, { status: 'conflict', conflict_with: 'merchant' })];
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject(disputed);
  });

  it('a stale platform row answers nothing, so the merchant answers as before', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED, { refreshed_at: STALE })];
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject({ source: 'merchant', level: 'verified', provingDomain: 'shop.example' });
  });

  it('an unapproved platform\'s row is not a conflict', async () => {
    vi.stubEnv('VERIFY_ENTITY_TENANTS', LATER);
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject({ source: 'merchant', level: 'verified' });
  });

  it('no merchant and no second platform: the platform answers as before', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    expect(await lookupVerifiedAddress(SHARED)).toMatchObject({ source: 'entity', level: 'verified', domain: 'platform.example', provingDomain: 'platform.example' });
  });

  it('the disputed answer carries the chain and nothing that names a party', async () => {
    mem.tables.verified_address_mirror = [mirrorRow(E1, PLATFORM, SHARED)];
    mem.tables.verify_destinations = [merchantProof(SHARED)];
    mem.tables.verify_claimed_names = [{ tenant_id: MERCHANT, display_name: 'Shop', domain: 'shop.example' }];
    const hit = await lookupVerifiedAddress(SHARED);
    expect(hit).toEqual({ ...disputed, chain: 'ethereum' });
    const text = JSON.stringify(hit);
    for (const secret of [MERCHANT, PLATFORM, 'shop.example', 'platform.example', 'Shop']) expect(text).not.toContain(secret);
  });
});
