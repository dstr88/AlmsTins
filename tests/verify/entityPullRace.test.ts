import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * pullEntity reads a platform's entity row, fetches its published address list over the
 * network, then replaces the mirrored rows. It used to do the replace as separate
 * statements with no check that the entity still existed, so an account deleted during
 * the fetch got its mirror rows (tenant id, addresses, domain) written back afterwards.
 * These pin the fix: the replace is one transaction that starts on the entity row, and
 * every insert is conditional on the entity still existing (and proven).
 *
 * No database or network: '@/lib/db' is an in-memory stand-in, the list fetch and the key
 * decryption are stubbed.
 */

type Row = Record<string, any>;

const mem = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  unexpected: [] as string[],
  batches: [] as string[][],
}));

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function run(sqlIn: string, args: any[] = []): { rows: Row[]; rowsAffected: number } {
  const sql = oneLine(sqlIn);
  const t = (name: string): Row[] => (mem.tables[name] ??= []);

  if (sql === 'SELECT id, domain, proof_status, api_endpoint, api_key_encrypted FROM verified_entities WHERE id = ? AND tenant_id = ?') {
    return { rows: t('verified_entities').filter((r) => r.id === args[0] && r.tenant_id === args[1]), rowsAffected: 0 };
  }
  if (sql === "UPDATE verified_entities SET last_pull_status = 'ok', last_pull_count = ?, last_pulled_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?") {
    const hit = t('verified_entities').filter((r) => r.id === args[3] && r.tenant_id === args[4]);
    for (const r of hit) Object.assign(r, { last_pull_status: 'ok', last_pull_count: args[0], last_pulled_at: args[1] });
    return { rows: [], rowsAffected: hit.length };
  }
  if (sql === 'DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?') {
    const before = t('verified_address_mirror').length;
    mem.tables.verified_address_mirror = t('verified_address_mirror').filter((r) => !(r.entity_id === args[0] && r.tenant_id === args[1]));
    return { rows: [], rowsAffected: before - mem.tables.verified_address_mirror.length };
  }
  if (sql === "INSERT INTO verified_address_mirror (id, entity_id, tenant_id, address, chain, entity_domain, status, source, refreshed_at) SELECT ?, ?, ?, ?, ?, ?, 'verified', 'api_endpoint', ? WHERE EXISTS (SELECT 1 FROM verified_entities WHERE id = ? AND tenant_id = ? AND proof_status = 'proven')") {
    const [id, entityId, tenantId, address, chain, domain, refreshedAt, eId, eTenant] = args;
    const live = t('verified_entities').some((e) => e.id === eId && e.tenant_id === eTenant && e.proof_status === 'proven');
    if (!live) return { rows: [], rowsAffected: 0 };
    t('verified_address_mirror').push({
      id, entity_id: entityId, tenant_id: tenantId, address, chain, entity_domain: domain,
      status: 'verified', source: 'api_endpoint', refreshed_at: refreshedAt,
    });
    return { rows: [], rowsAffected: 1 };
  }
  if (/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /.test(sql)) return { rows: [], rowsAffected: 0 };
  if (sql === 'DELETE FROM verified_entities WHERE id = ? AND tenant_id = ?') {
    const before = t('verified_entities').length;
    mem.tables.verified_entities = t('verified_entities').filter((r) => !(r.id === args[0] && r.tenant_id === args[1]));
    return { rows: [], rowsAffected: before - mem.tables.verified_entities.length };
  }
  if (sql === 'SELECT address FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?') {
    return { rows: t('verified_address_mirror').filter((r) => r.entity_id === args[0] && r.tenant_id === args[1]), rowsAffected: 0 };
  }

  mem.unexpected.push(sql);
  throw new Error(`unexpected statement: ${sql}`);
}

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => run(stmt.sql, (stmt.args ?? []) as any[]),
    batch: async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
      mem.batches.push(stmts.map((s) => oneLine(s.sql)));
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

import { pullEntity, monitorEntity, deleteEntity } from '../../src/lib/verifyEntities';

const T = 'tenant-platform';
const OTHER = 'tenant-other';
const E = 'entity-1';
const OLD = '0x' + '11'.repeat(20);
const NEW_1 = '0x' + '22'.repeat(20);
const NEW_2 = '0x' + '33'.repeat(20);
const OTHER_ADDR = '0x' + '44'.repeat(20);

/** What account deletion does to this tenant's platform rows (see verifyAccountDelete.ts). */
function deleteTenantPlatformRows(tenant: string): void {
  mem.tables.verified_entities = mem.tables.verified_entities.filter((r) => r.tenant_id !== tenant);
  mem.tables.verified_address_mirror = mem.tables.verified_address_mirror.filter((r) => r.tenant_id !== tenant);
}

beforeEach(() => {
  // Platform lists publish only for approved tenants (verifyEntityAccess); these fixtures
  // model approved platforms, so approve their tenants.
  vi.stubEnv('VERIFY_ENTITY_TENANTS', `${T},${OTHER}`);
  mem.unexpected = [];
  mem.batches = [];
  mem.tables = {
    verified_entities: [
      { id: E, tenant_id: T, domain: 'platform.example', proof_status: 'proven', api_endpoint: 'https://platform.example/addresses', api_key_encrypted: 'enc' },
      { id: 'entity-2', tenant_id: OTHER, domain: 'other.example', proof_status: 'proven', api_endpoint: 'https://other.example/a', api_key_encrypted: 'enc' },
    ],
    verified_address_mirror: [
      { id: 'm-old', entity_id: E, tenant_id: T, address: OLD, chain: 'ethereum', entity_domain: 'platform.example', status: 'verified', refreshed_at: '2026-09-01 00:00:00' },
      { id: 'm-other', entity_id: 'entity-2', tenant_id: OTHER, address: OTHER_ADDR, chain: 'ethereum', entity_domain: 'other.example', status: 'verified', refreshed_at: '2026-09-01 00:00:00' },
    ],
  };
  fetchList.mockReset();
  fetchList.mockResolvedValue({ ok: true, addresses: [{ address: NEW_1, chain: 'ethereum' }, { address: NEW_2, chain: 'polygon' }] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  expect(mem.unexpected).toEqual([]);
});

const mirrorOf = (tenant: string) => mem.tables.verified_address_mirror.filter((r) => r.tenant_id === tenant);

describe('pullEntity: replacing the mirror', () => {
  it('replaces the entity\'s mirrored list in one transaction', async () => {
    expect(await pullEntity(T, E)).toEqual({ ok: true, count: 2 });
    expect(mirrorOf(T).map((r) => r.address).sort()).toEqual([NEW_1, NEW_2].sort());
    expect(mirrorOf(OTHER).map((r) => r.address)).toEqual([OTHER_ADDR]);
    expect(mem.tables.verified_entities.find((r) => r.id === E)).toMatchObject({ last_pull_status: 'ok', last_pull_count: 2 });

    // One batch: the entity row first (the lock), then the delete, then guarded inserts.
    expect(mem.batches).toHaveLength(1);
    const [first, second, ...inserts] = mem.batches[0];
    expect(first).toMatch(/^UPDATE verified_entities .* WHERE id = \? AND tenant_id = \?$/);
    expect(second).toBe('DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?');
    expect(inserts).toHaveLength(2);
    for (const sql of inserts) expect(sql).toMatch(/WHERE EXISTS \(SELECT 1 FROM verified_entities WHERE id = \? AND tenant_id = \? AND proof_status = 'proven'\)$/);
  });

  it('writes nothing back when the account is deleted while the list is being fetched', async () => {
    fetchList.mockImplementation(async () => {
      deleteTenantPlatformRows(T); // the account delete commits mid-fetch
      return { ok: true, addresses: [{ address: NEW_1, chain: 'ethereum' }] };
    });

    expect(await pullEntity(T, E)).toEqual({ ok: false, code: 'not_found' });
    expect(mirrorOf(T)).toEqual([]);
    expect(mem.tables.verified_entities.some((r) => r.tenant_id === T)).toBe(false);
    // The other tenant's platform is untouched.
    expect(mirrorOf(OTHER).map((r) => r.address)).toEqual([OTHER_ADDR]);
  });

  it('writes nothing back when the owner removes the entity while the list is being fetched', async () => {
    fetchList.mockImplementation(async () => {
      await deleteEntity(T, E);
      return { ok: true, addresses: [{ address: NEW_1, chain: 'ethereum' }] };
    });

    expect(await pullEntity(T, E)).toEqual({ ok: false, code: 'not_found' });
    expect(mirrorOf(T)).toEqual([]);
    // deleteEntity: one transaction, entity row first (the lock order pullEntity shares).
    expect(mem.batches[0]).toEqual([
      'DELETE FROM verified_entities WHERE id = ? AND tenant_id = ?',
      'DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?',
    ]);
    expect(mirrorOf(OTHER).map((r) => r.address)).toEqual([OTHER_ADDR]);
  });

  it('reports no revocations to the monitor for an entity that vanished mid-pull', async () => {
    fetchList.mockImplementation(async () => {
      deleteTenantPlatformRows(T);
      return { ok: true, addresses: [{ address: NEW_1, chain: 'ethereum' }] };
    });
    const r = await monitorEntity(T, E);
    expect(r.pull).toEqual({ ok: false, code: 'not_found' });
    expect(r.removed).toEqual([]);
    expect(mirrorOf(T)).toEqual([]);
  });
});
