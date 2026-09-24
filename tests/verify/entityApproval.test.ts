import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Platform lists (Verified Entities) are by approval during early access. A list is mirrored
 * into the public lookup as Verified, ahead of merchant proofs, and nothing yet checks it
 * against addresses another account has proven. So only the owner and the tenants listed in
 * VERIFY_ENTITY_TENANTS may publish one. Pinned here:
 *   - canPublishEntities: owner allowed, listed tenant allowed, everyone else refused, and the
 *     env var is read on every call;
 *   - every write route (create, prove, connect) answers 403 not_approved before any database
 *     write or outbound fetch, and lets the owner and a listed tenant through;
 *   - the library refuses the same writes itself (the backstop under the routes and the cron);
 *   - the monitor cron refreshes approved tenants only, and never reports a skipped one;
 *   - the public lookup ignores mirror rows whose tenant is not approved, without touching them;
 *   - delete stays open, so an account can always remove its own rows.
 * No database: '@/lib/db' is an in-memory stand-in for the two entity tables.
 */

type Entity = {
  id: string; tenant_id: string; domain: string; challenge_token: string; proof_status: string;
  api_endpoint: string | null; api_key_encrypted: string | null; last_pulled_at: string | null;
  last_pull_status: string | null; last_pull_count: number; proven_at: string | null; created_at: string;
};
type Mirror = {
  id: string; entity_id: string; tenant_id: string; address: string; chain: string;
  entity_domain: string; status: string; refreshed_at: string | null;
};

const mem = vi.hoisted(() => ({
  entities: [] as Entity[],
  mirror: [] as Mirror[],
  writes: [] as string[],
}));
const session = vi.hoisted(() => ({ current: null as null | { tenantId: string; isDemo?: boolean } }));
const LIST_ADDR = vi.hoisted(() => '0x1111111111111111111111111111111111111111');
const proof = vi.hoisted(() => ({
  verifyDomainProof: vi.fn(async (_domain: string, _challenge: string) => ({ ok: true as const, addresses: [] as string[] })),
  pullEntityList: vi.fn(async (_endpoint: string, _key: string, _domain: string) => ({
    ok: true as const,
    addresses: [{ address: LIST_ADDR, chain: 'ethereum' }],
  })),
}));
const sendMail = vi.hoisted(() => vi.fn(async (_m: unknown) => {}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => session.current }));
vi.mock('@/lib/verifyCrypto', () => ({
  encryptionAvailable: () => true,
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => (s.startsWith('enc:') ? s.slice(4) : null),
}));
vi.mock('@/lib/verifyProof', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyProof')>();
  return { ...orig, verifyDomainProof: proof.verifyDomainProof, pullEntityList: proof.pullEntityList };
});
vi.mock('@/lib/verifyRegistry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyRegistry')>();
  return {
    ...orig,
    ensureVerifyTables: async () => {},
    listProvenDomainsForMonitor: async () => [],
    listMonitoredDestinations: async () => [],
  };
});
vi.mock('@/lib/email', () => ({ sendMail }));
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));
vi.mock('@/lib/cronHeartbeat', () => ({ recordCronSuccess: async () => {} }));

vi.mock('@/lib/db', () => {
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const execute = async (stmt: any) => {
    const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
    const args: any[] = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
    if (/^(CREATE|ALTER)\b/.test(sql)) return { rows: [], rowsAffected: 0 };
    if (/^(INSERT|UPDATE|DELETE)\b/.test(sql)) mem.writes.push(sql);

    const byIdTenant = (id: string, tenant: string) => mem.entities.filter((e) => e.id === id && e.tenant_id === tenant);
    if (sql.startsWith('SELECT id, domain, challenge_token') && sql.includes('WHERE tenant_id = ? AND domain = ?')) {
      return { rows: mem.entities.filter((e) => e.tenant_id === args[0] && e.domain === args[1]).slice(0, 1) };
    }
    if (sql.startsWith('SELECT id, domain, challenge_token') && sql.includes('WHERE tenant_id = ? ORDER BY')) {
      return { rows: mem.entities.filter((e) => e.tenant_id === args[0]) };
    }
    if (sql.startsWith('SELECT id, domain, challenge_token') && sql.includes('WHERE id = ? AND tenant_id = ?')) {
      return { rows: byIdTenant(args[0], args[1]) };
    }
    if (sql.startsWith('SELECT id, domain, proof_status, api_endpoint, api_key_encrypted FROM verified_entities WHERE id = ? AND tenant_id = ?')) {
      return { rows: byIdTenant(args[0], args[1]) };
    }
    if (sql.startsWith('INSERT INTO verified_entities')) {
      const [id, tenant_id, domain, challenge_token] = args;
      mem.entities.push({
        id, tenant_id, domain, challenge_token, proof_status: 'unproven', api_endpoint: null, api_key_encrypted: null,
        last_pulled_at: null, last_pull_status: null, last_pull_count: 0, proven_at: null, created_at: now(),
      });
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith("UPDATE verified_entities SET proof_status = 'proven'")) {
      const [provenAt, , id, tenant] = args;
      for (const e of byIdTenant(id, tenant)) { e.proof_status = 'proven'; e.proven_at = provenAt; }
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith('UPDATE verified_entities SET api_endpoint = ?')) {
      const [endpoint, enc, , id, tenant] = args;
      for (const e of byIdTenant(id, tenant)) { e.api_endpoint = endpoint; e.api_key_encrypted = enc; }
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith("UPDATE verified_entities SET last_pull_status = 'ok'")) {
      const [count, at, , id, tenant] = args;
      const hit = byIdTenant(id, tenant);
      for (const e of hit) { e.last_pull_status = 'ok'; e.last_pull_count = count; e.last_pulled_at = at; }
      return { rows: [], rowsAffected: hit.length }; // 0 when the entity is gone: the pull reports not_found
    }
    if (sql.startsWith('UPDATE verified_entities SET last_pull_status = ?')) {
      const [code, at, , id, tenant] = args;
      for (const e of byIdTenant(id, tenant)) { e.last_pull_status = code; e.last_pulled_at = at; }
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith('DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?')) {
      mem.mirror = mem.mirror.filter((m) => !(m.entity_id === args[0] && m.tenant_id === args[1]));
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith('INSERT INTO verified_address_mirror')) {
      const [id, entity_id, tenant_id, address, chain, entity_domain, refreshed_at] = args;
      // The pull's insert is guarded by WHERE EXISTS (the entity is still there and proven).
      if (/WHERE EXISTS/.test(sql) && !byIdTenant(entity_id, tenant_id).some((e) => e.proof_status === 'proven')) {
        return { rows: [], rowsAffected: 0 };
      }
      mem.mirror.push({ id, entity_id, tenant_id, address, chain, entity_domain, status: 'verified', refreshed_at });
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith('DELETE FROM verified_entities WHERE id = ? AND tenant_id = ?')) {
      mem.entities = mem.entities.filter((e) => !(e.id === args[0] && e.tenant_id === args[1]));
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.startsWith('SELECT address FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?')) {
      return { rows: mem.mirror.filter((m) => m.entity_id === args[0] && m.tenant_id === args[1]) };
    }
    if (sql.startsWith('SELECT id, tenant_id, domain, last_pull_status FROM verified_entities')) {
      return { rows: mem.entities.filter((e) => e.proof_status === 'proven' && e.api_endpoint && e.api_key_encrypted) };
    }
    if (sql.startsWith('SELECT m.chain AS chain')) {
      // Honors what the SQL asks for, so dropping a clause from the query shows up here:
      // the tenant IN (...) filter, ORDER BY proven_at, entity_id, and the LIMIT.
      const [address, cutoff, ...publishers] = args;
      const filtersTenant = /lower\(e\.tenant_id\) IN \(/.test(sql);
      const ordered = /ORDER BY e\.proven_at ASC, m\.entity_id ASC/.test(sql);
      const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? Infinity);
      let rows = mem.mirror
        .filter((m) => m.status === 'verified' && m.address === address && m.refreshed_at && m.refreshed_at >= cutoff)
        .map((m) => {
          const e = mem.entities.find((x) => x.id === m.entity_id);
          return e ? { chain: m.chain, entity_domain: m.entity_domain, proven_at: e.proven_at, tenant_id: e.tenant_id, entity_id: e.id } : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .filter((r) => !filtersTenant || publishers.includes(r.tenant_id.toLowerCase()));
      if (ordered) {
        rows = rows.sort((a, b) =>
          String(a.proven_at ?? '￿').localeCompare(String(b.proven_at ?? '￿')) || a.entity_id.localeCompare(b.entity_id));
      }
      return { rows: rows.slice(0, limit) };
    }
    // No merchant proofs. Matched on the table and filter, not the column list, which the
    // domain-anchor fields (proof_method, domain_anchored_at) extend.
    if (sql.startsWith('SELECT tenant_id, rail, value, label,')
        && sql.includes("FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven'")) return { rows: [] };
    if (sql.startsWith('SELECT au.alert_email, au.lang')) return { rows: [{ alert_email: 'ops@platform.test', lang: 'en' }] };
    throw new Error(`unexpected SQL in test: ${sql}`);
  };
  // A transaction: statements in order (pullEntity replaces the mirror in one batch).
  const batch = async (stmts: Array<{ sql: string; args?: unknown[] }>) => {
    const out = [];
    for (const st of stmts) out.push(await execute(st as any));
    return out;
  };
  return { db: { execute, batch } };
});

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import {
  canPublishEntities, approvedEntityTenants, publishingTenantIds, ENTITY_APPROVAL_ENV,
} from '../../src/lib/verifyEntityAccess';
import {
  createEntity, proveEntity, setEntityEndpoint, pullEntity, connectEntity, monitorEntity,
  listEntitiesForMonitor, lookupVerifiedAddress,
} from '../../src/lib/verifyEntities';
import { POST as CREATE } from '../../src/pages/api/verify/entities/index';
import { POST as PROVE } from '../../src/pages/api/verify/entities/[id]/prove';
import { POST as CONNECT } from '../../src/pages/api/verify/entities/[id]/connect';
import { DELETE as REMOVE } from '../../src/pages/api/verify/entities/[id]/index';
import { GET as MONITOR } from '../../src/pages/api/cron/verify-monitor';

const LISTED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const post = async (handler: any, path: string, body: unknown = {}, params: Record<string, string> = {}) => {
  const request = new Request(`https://almstins.com${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const res: Response = await handler({ request, params });
  return { status: res.status, body: await res.json() };
};

/** Seed a proven entity with a stored endpoint and key, as if it had been published earlier. */
const seedPublished = (tenant: string, id: string, domain: string, address?: string, provenAt?: string) => {
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  mem.entities.push({
    id, tenant_id: tenant, domain, challenge_token: 'c', proof_status: 'proven',
    api_endpoint: `https://${domain}/.well-known/payment-addresses`, api_key_encrypted: 'enc:key',
    last_pulled_at: at, last_pull_status: 'ok', last_pull_count: address ? 1 : 0, proven_at: provenAt ?? at, created_at: at,
  });
  if (address) {
    mem.mirror.push({
      id: `m-${id}`, entity_id: id, tenant_id: tenant, address, chain: 'ethereum',
      entity_domain: domain, status: 'verified', refreshed_at: at,
    });
  }
};

beforeEach(() => {
  mem.entities = [];
  mem.mirror = [];
  mem.writes = [];
  session.current = null;
  proof.verifyDomainProof.mockClear();
  proof.pullEntityList.mockClear();
  sendMail.mockClear();
  vi.stubEnv(ENTITY_APPROVAL_ENV, ` ${LISTED.toUpperCase()} , 33333333-3333-4333-8333-333333333333`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('canPublishEntities (the allowlist)', () => {
  it('allows the owner, in any case', () => {
    expect(canPublishEntities(OWNER_TENANT_ID)).toBe(true);
    expect(canPublishEntities(OWNER_TENANT_ID.toUpperCase())).toBe(true);
  });

  it('allows a tenant listed in VERIFY_ENTITY_TENANTS, ignoring case and spacing', () => {
    expect(canPublishEntities(LISTED)).toBe(true);
    expect(canPublishEntities('33333333-3333-4333-8333-333333333333')).toBe(true);
    expect(approvedEntityTenants().has(LISTED)).toBe(true);
  });

  it('refuses everyone else, and a missing tenant', () => {
    expect(canPublishEntities(OTHER)).toBe(false);
    expect(canPublishEntities('')).toBe(false);
    expect(canPublishEntities('   ')).toBe(false);
    expect(canPublishEntities(null)).toBe(false);
    expect(canPublishEntities(undefined)).toBe(false);
  });

  it('reads the env var on every call', () => {
    vi.stubEnv(ENTITY_APPROVAL_ENV, '');
    expect(canPublishEntities(LISTED)).toBe(false);
    expect(canPublishEntities(OWNER_TENANT_ID)).toBe(true); // the owner needs no listing
    vi.stubEnv(ENTITY_APPROVAL_ENV, `${OTHER}\n${LISTED}`);
    expect(canPublishEntities(OTHER)).toBe(true);
    expect(canPublishEntities(LISTED)).toBe(true);
  });

  it('strips quotes pasted around an ID, but never approves a bare quote', () => {
    vi.stubEnv(ENTITY_APPROVAL_ENV, `"${LISTED}", '${OTHER}'`);
    expect(canPublishEntities(LISTED)).toBe(true);
    expect(canPublishEntities(OTHER)).toBe(true);
    vi.stubEnv(ENTITY_APPROVAL_ENV, `"${LISTED},${OTHER}"`); // the whole value quoted
    expect(canPublishEntities(LISTED)).toBe(true);
    expect(canPublishEntities(OTHER)).toBe(true);
    vi.stubEnv(ENTITY_APPROVAL_ENV, `" , '' ,\`\``);
    expect([...approvedEntityTenants()]).toEqual([]);
    expect(canPublishEntities('"')).toBe(false);
  });

  it('publishingTenantIds is the owner plus the listed tenants, lowercased and deduplicated', () => {
    vi.stubEnv(ENTITY_APPROVAL_ENV, `${LISTED.toUpperCase()},${OWNER_TENANT_ID.toUpperCase()},${LISTED}`);
    expect(publishingTenantIds().sort()).toEqual([OWNER_TENANT_ID, LISTED].sort());
    vi.stubEnv(ENTITY_APPROVAL_ENV, '');
    expect(publishingTenantIds()).toEqual([OWNER_TENANT_ID]);
  });
});

describe('entity write routes refuse an account that is not approved', () => {
  const expectRefused = (r: { status: number; body: any }) => {
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe('not_approved');
    expect(r.body.message).toMatch(/by approval during early access/);
    expect(r.body.message).toContain('support@almstins.com');
  };

  beforeEach(() => {
    session.current = { tenantId: OTHER };
    // A row this account made before the gate existed: the routes must not advance it.
    mem.entities.push({
      id: 'e-old', tenant_id: OTHER, domain: 'other.example', challenge_token: 'c', proof_status: 'unproven',
      api_endpoint: null, api_key_encrypted: null, last_pulled_at: null, last_pull_status: null,
      last_pull_count: 0, proven_at: null, created_at: '2026-09-01 00:00:00',
    });
  });

  it('POST /api/verify/entities (create)', async () => {
    expectRefused(await post(CREATE, '/api/verify/entities', { domain: 'other.example' }));
    expect(mem.writes).toEqual([]);
    expect(mem.entities).toHaveLength(1);
  });

  it('POST /api/verify/entities/:id/prove', async () => {
    expectRefused(await post(PROVE, '/api/verify/entities/e-old/prove', {}, { id: 'e-old' }));
    expect(proof.verifyDomainProof).not.toHaveBeenCalled();
    expect(mem.writes).toEqual([]);
    expect(mem.entities[0].proof_status).toBe('unproven');
  });

  it('POST /api/verify/entities/:id/connect', async () => {
    mem.entities[0].proof_status = 'proven'; // even a proven row cannot be connected
    expectRefused(await post(CONNECT, '/api/verify/entities/e-old/connect',
      { endpoint: 'https://other.example/.well-known/payment-addresses', apiKey: 'k' }, { id: 'e-old' }));
    expect(proof.pullEntityList).not.toHaveBeenCalled();
    expect(mem.writes).toEqual([]);
    expect(mem.mirror).toEqual([]);
    expect(mem.entities[0].api_key_encrypted).toBeNull();
  });

  it('DELETE /api/verify/entities/:id stays open: an account can remove its own rows', async () => {
    const request = new Request('https://almstins.com/api/verify/entities/e-old', { method: 'DELETE' });
    const res: Response = await (REMOVE as any)({ request, params: { id: 'e-old' } });
    expect(res.status).toBe(200);
    expect(mem.entities).toEqual([]);
  });

  it('still answers 401 without a session and 403 demo_readonly for the demo', async () => {
    session.current = null;
    expect((await post(CREATE, '/api/verify/entities', { domain: 'x.example' })).status).toBe(401);
    session.current = { tenantId: OWNER_TENANT_ID, isDemo: true };
    const demo = await post(CREATE, '/api/verify/entities', { domain: 'x.example' });
    expect(demo.status).toBe(403);
    expect(demo.body.error).toBe('demo_readonly');
    expect(mem.writes).toEqual([]);
  });
});

describe.each([
  ['the owner', OWNER_TENANT_ID],
  ['a listed tenant', LISTED],
])('%s can publish a platform list', (_who, tenant) => {
  it('creates, proves and connects through the routes, and the list answers publicly', async () => {
    session.current = { tenantId: tenant };
    const created = await post(CREATE, '/api/verify/entities', { domain: 'platform.example' });
    expect(created.status).toBe(200);
    expect(created.body.entity.domain).toBe('platform.example');
    const id = created.body.entity.id as string;

    const proved = await post(PROVE, `/api/verify/entities/${id}/prove`, {}, { id });
    expect(proved.body).toEqual({ ok: true, outcome: 'proven' });

    const connected = await post(CONNECT, `/api/verify/entities/${id}/connect`,
      { endpoint: 'platform.example', apiKey: 'secret-key' }, { id });
    expect(connected.body).toEqual({ ok: true, outcome: 'pulled', count: 1 });
    expect(mem.mirror.map((m) => m.address)).toEqual([LIST_ADDR]);

    const hit = await lookupVerifiedAddress(LIST_ADDR);
    expect(hit).toMatchObject({ source: 'entity', level: 'verified', domain: 'platform.example' });
    expect(JSON.stringify(hit)).not.toContain(tenant); // never exposes the tenant
  });
});

describe('the library refuses the same writes (backstop under the routes and the cron)', () => {
  beforeEach(() => seedPublished(OTHER, 'e-other', 'other.example'));

  it('create, prove, set-endpoint, pull, connect and monitor all answer not_approved with no writes', async () => {
    expect(await createEntity(OTHER, 'other2.example')).toEqual({ ok: false, code: 'not_approved' });
    expect(await proveEntity(OTHER, 'e-other')).toEqual({ ok: false, code: 'not_approved' });
    expect(await setEntityEndpoint(OTHER, 'e-other', 'https://other.example/x', 'k')).toEqual({ ok: false, code: 'not_approved' });
    expect(await pullEntity(OTHER, 'e-other')).toEqual({ ok: false, code: 'not_approved' });
    expect(await connectEntity(OTHER, 'e-other', 'https://other.example/x', 'k')).toEqual({ ok: false, code: 'not_approved' });
    expect(await monitorEntity(OTHER, 'e-other')).toEqual({ pull: { ok: false, code: 'not_approved' }, removed: [], added: [] });
    expect(mem.writes).toEqual([]);
    expect(proof.verifyDomainProof).not.toHaveBeenCalled();
    expect(proof.pullEntityList).not.toHaveBeenCalled();
  });

  it('lets an approved tenant pull', async () => {
    seedPublished(LISTED, 'e-listed', 'listed.example');
    expect(await pullEntity(LISTED, 'e-listed')).toEqual({ ok: true, count: 1 });
    expect(proof.pullEntityList).toHaveBeenCalledTimes(1);
  });
});

describe('monitor refresh', () => {
  beforeEach(() => {
    seedPublished(OWNER_TENANT_ID, 'e-owner', 'owner.example');
    seedPublished(LISTED, 'e-listed', 'listed.example');
    seedPublished(OTHER, 'e-other', 'other.example', '0x2222222222222222222222222222222222222222');
  });

  it('lists approved tenants only', async () => {
    const targets = await listEntitiesForMonitor();
    expect(targets.map((t) => t.id).sort()).toEqual(['e-listed', 'e-owner']);
  });

  it('the cron re-pulls approved lists only, leaves the rest untouched, and sends no alert for them', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await MONITOR({
      request: new Request('https://almstins.com/api/cron/verify-monitor', { headers: { 'x-cron-secret': 'test-secret' } }),
    } as never);
    log.mockRestore();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entity).toMatchObject({ checked: 2, errors: 0, unreachableAlerts: 0 });

    const pulledDomains = proof.pullEntityList.mock.calls.map((c) => c[2]).sort();
    expect(pulledDomains).toEqual(['listed.example', 'owner.example']);
    // The unapproved list is neither refreshed nor deleted: it keeps its old row and lapses at the TTL.
    expect(mem.mirror.filter((m) => m.entity_id === 'e-other').map((m) => m.address))
      .toEqual(['0x2222222222222222222222222222222222222222']);
    expect(mem.writes.some((w) => w.includes('verified_address_mirror') && w.startsWith('DELETE'))).toBe(true); // approved lists refreshed
    expect(sendMail).not.toHaveBeenCalled();
  }, 10_000);
});

describe('public lookup', () => {
  const ADDR = '0x3333333333333333333333333333333333333333';

  it('ignores a fresh mirror row whose tenant is not approved, without touching the data', async () => {
    seedPublished(OTHER, 'e-other', 'other.example', ADDR);
    const before = JSON.stringify(mem.mirror);
    expect(await lookupVerifiedAddress(ADDR)).toBeNull();
    expect(JSON.stringify(mem.mirror)).toBe(before);
    expect(mem.writes).toEqual([]);
  });

  it('answers with the approved publisher when an unapproved one lists the same address', async () => {
    seedPublished(OTHER, 'e-other', 'other.example', ADDR);
    seedPublished(LISTED, 'e-listed', 'listed.example', ADDR);
    expect(await lookupVerifiedAddress(ADDR)).toMatchObject({ source: 'entity', domain: 'listed.example' });
  });

  it('filters by approval in SQL, so many unapproved rows cannot crowd out an approved one', async () => {
    // 30 older rows from unapproved accounts, all fresh, all listing the same address.
    for (let i = 0; i < 30; i++) {
      const tenant = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`;
      seedPublished(tenant, `e-x${String(i).padStart(2, '0')}`, `x${i}.example`, ADDR, '2026-01-01 00:00:00');
    }
    seedPublished(LISTED, 'e-listed', 'listed.example', ADDR, '2026-09-01 00:00:00');
    expect(await lookupVerifiedAddress(ADDR)).toMatchObject({ source: 'entity', domain: 'listed.example' });
  });

  it('answers with the earliest-proven approved list, whatever the insertion order', async () => {
    seedPublished(LISTED, 'e-listed', 'listed.example', ADDR, '2026-09-10 00:00:00');
    seedPublished(OWNER_TENANT_ID, 'e-owner', 'owner.example', ADDR, '2026-09-01 00:00:00');
    expect(await lookupVerifiedAddress(ADDR)).toMatchObject({
      source: 'entity', domain: 'owner.example', since: '2026-09-01 00:00:00',
    });
  });

  it('stops answering as soon as a tenant is removed from the list', async () => {
    seedPublished(LISTED, 'e-listed', 'listed.example', ADDR);
    expect(await lookupVerifiedAddress(ADDR)).toMatchObject({ source: 'entity', domain: 'listed.example' });
    vi.stubEnv(ENTITY_APPROVAL_ENV, '');
    expect(await lookupVerifiedAddress(ADDR)).toBeNull();
    expect(mem.mirror).toHaveLength(1); // data untouched
  });
});
