import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * Privacy audit 2026-10-10 (E-B4): the roster editor's cache (verify_domain_proofs.
 * roster_cache_json) used to hold every decrypted address and label as plain JSON. It is now
 * sealed the way the roster file itself is published (RSA-OAEP + AES-256-GCM to our roster
 * key, verifyEncryption.ts). A cache in any other shape, including the old plain JSON, reads
 * as absent, and the next successful check replaces it sealed. Nothing public reads the
 * cache, so a roster-proven address keeps answering the public lookup while it is absent.
 *
 * The database is an in-memory stand-in for the statements these paths issue.
 */
type ProofRow = { tenant_id: string; domain: string; roster_cache_json: string | null; roster_cached_at: string | null };

const mem = vi.hoisted(() => ({
  proofs: [] as any[],
  dests: [] as any[],
  proofWrites: [] as unknown[][],
  session: { tenantId: 'merchant', isDemo: false } as any,
}));

vi.mock('@/lib/db', () => {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
  const project = (sql: string, rows: any[]) => {
    const cols = sql.slice('SELECT '.length, sql.indexOf(' FROM ')).split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  };
  const execute = async (stmt: { sql: string; args?: unknown[] }) => {
    const sql = flat(stmt.sql);
    const args = (stmt.args ?? []) as any[];
    // The roster proof write: status + the cache, tenant-scoped.
    if (sql.startsWith("UPDATE verify_domain_proofs SET status = 'proven', proven_at = ?, last_checked_at = ?, updated_at = ?, roster_cache_json = ?, roster_cached_at = ?")) {
      mem.proofWrites.push(args);
      const [, , , cache, cachedAt, tenantId, domain] = args;
      const row = mem.proofs.find((p) => p.tenant_id === tenantId && p.domain === domain);
      if (row) { row.roster_cache_json = cache; row.roster_cached_at = cachedAt; }
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }
    // Re-sealing an old plain cache in place, only if it is still the same text.
    if (sql === 'UPDATE verify_domain_proofs SET roster_cache_json = ? WHERE tenant_id = ? AND domain = ? AND roster_cache_json = ?') {
      const [sealed, tenantId, domain, old] = args;
      const row = mem.proofs.find((p) => p.tenant_id === tenantId && p.domain === domain && p.roster_cache_json === old);
      if (row) row.roster_cache_json = sealed;
      return { rows: [], rowsAffected: row ? 1 : 0 };
    }
    if (sql === 'SELECT roster_cache_json, roster_cached_at FROM verify_domain_proofs WHERE tenant_id = ? AND domain = ? LIMIT 1') {
      return { rows: mem.proofs.filter((p) => p.tenant_id === args[0] && p.domain === args[1]).slice(0, 1) };
    }
    // The roster flip of an existing, unproven destination.
    if (sql.startsWith("UPDATE verify_destinations SET proof_status = 'proven', proof_method = 'roster_encrypted'")) {
      const [domain, provenAt, anchoredAt, confirmedAt, , id, tenantId] = args;
      const d = mem.dests.find((x) => x.id === id && x.tenant_id === tenantId && x.proof_status !== 'proven');
      if (d) Object.assign(d, { proof_status: 'proven', proof_method: 'roster_encrypted', proof_domain: domain,
        proven_at: provenAt, domain_anchored_at: anchoredAt, last_confirmed_at: confirmedAt });
      return { rows: [], rowsAffected: d ? 1 : 0 };
    }
    // Schema, cold-start backfills, and the re-confirm stamp.
    if (/^(CREATE|ALTER|UPDATE) /.test(sql)) return { rows: [], rowsAffected: 0 };
    // listDestinations / getProvenAddressDestinations (this tenant only).
    if (/FROM verify_destinations WHERE tenant_id = \? ORDER BY/.test(sql)) {
      return { rows: mem.dests.filter((d) => d.tenant_id === args[0]) };
    }
    if (sql.includes("FROM verify_destinations WHERE tenant_id = ? AND proof_domain = ? AND proof_status = 'proven' AND kind = 'address'")) {
      return { rows: mem.dests.filter((d) => d.tenant_id === args[0] && d.proof_domain === args[1] && d.proof_status === 'proven') };
    }
    // No legacy claims, and no other account holds the wallet.
    if (sql.startsWith('SELECT d.id, d.kind, d.value FROM verify_destinations d')) return { rows: [] };
    if (sql.startsWith('SELECT value FROM verify_destinations WHERE kind = ?')) return { rows: [] };
    // The public lookup.
    if (sql.startsWith('SELECT m.chain AS chain')) return { rows: [] };
    if (sql.includes("FROM verify_destinations WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)")) {
      return { rows: project(sql, mem.dests.filter((d) => d.proof_status === 'proven'
        && (d.value === args[0] || d.value.toLowerCase() === args[1]))) };
    }
    if (sql.startsWith('SELECT display_name, domain FROM verify_claimed_names')) return { rows: [] };
    throw new Error(`unexpected statement: ${sql}`);
  };
  return { db: { execute, batch: async (stmts: any[]) => Promise.all(stmts.map(execute)) } };
});
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => mem.session }));

import {
  sealRosterCache, openRosterCache, getCachedRoster, recordRosterProofResult,
} from '../../src/lib/verifyRegistry';
import { lookupVerifiedAddress } from '../../src/lib/verifyEntities';
import { GET as rosterGet } from '../../src/pages/api/verify/roster/index';

const DOMAIN = 'acme.com';
const WALLET = '0x' + 'cd'.repeat(20);
const LABEL = 'Jane Doe';
const ENTRIES = [{ address: WALLET, label: LABEL }];
const stamp = '2026-10-01 00:00:00';

async function genKeyPair() {
  // 2048 only to keep the suite fast; production uses 4096. Exported exactly as
  // generateVerifyEncryptionKey.mjs does, so the private JWK carries key_ops ['decrypt'].
  const kp = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  return crypto.subtle.exportKey('jwk', kp.privateKey);
}

const proofRow = (cache: string | null): ProofRow =>
  ({ tenant_id: 'merchant', domain: DOMAIN, roster_cache_json: cache, roster_cached_at: cache ? stamp : null });
const unprovenDest = () => ({
  id: 'd1', tenant_id: 'merchant', kind: 'address', rail: 'ethereum', value: WALLET, label: LABEL,
  display_hint: null, proof_method: 'none', proof_status: 'unproven', proof_domain: null,
  domain_anchored_at: null, last_confirmed_at: null, registered_at: stamp, proven_at: null,
  monitor_url: null, monitor_status: null, monitor_checked_at: null,
});

let savedKey: string | undefined;
let savedPub: string | undefined;
let privateJwk: JsonWebKey;
beforeAll(async () => {
  savedKey = process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
  savedPub = process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
  delete process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
  privateJwk = await genKeyPair();
  process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = JSON.stringify(privateJwk);
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
  else process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = savedKey;
  if (savedPub === undefined) delete process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY;
  else process.env.ALMSTINS_VERIFY_ENCRYPTION_PUBKEY = savedPub;
});
beforeEach(() => {
  mem.proofs = [];
  mem.dests = [];
  mem.proofWrites = [];
  mem.session = { tenantId: 'merchant', isDemo: false };
});

describe('the roster cache is sealed', () => {
  it('round trip: sealed text holds no address or label, and opens to the same entries', async () => {
    const sealed = await sealRosterCache(ENTRIES);
    expect(sealed).toBeTypeOf('string');
    expect(sealed).not.toContain(WALLET);
    expect(sealed).not.toContain(LABEL);
    expect(JSON.parse(sealed!)).toMatchObject({ v: 1, alg: 'RSA-OAEP-4096+A256GCM' });
    expect(await openRosterCache(sealed!)).toEqual(ENTRIES);
  });

  it('a roster check stores the cache sealed, and the editor reads it back', async () => {
    mem.proofs = [proofRow(null)];
    mem.dests = [unprovenDest()];
    await recordRosterProofResult('merchant', DOMAIN, ENTRIES);

    expect(mem.proofWrites).toHaveLength(1);
    const stored = mem.proofs[0].roster_cache_json as string;
    expect(stored).not.toContain(WALLET);
    expect(stored).not.toContain(LABEL);
    expect(mem.proofs[0].roster_cached_at).toBeTypeOf('string');
    expect(await getCachedRoster('merchant', DOMAIN)).toEqual({ addresses: ENTRIES, cachedAt: mem.proofs[0].roster_cached_at });
  });

  it('with no roster key configured, nothing is cached (never plain text)', async () => {
    const key = process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
    delete process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY;
    try {
      expect(await sealRosterCache(ENTRIES)).toBeNull();
      mem.proofs = [proofRow(JSON.stringify(ENTRIES))];
      await recordRosterProofResult('merchant', DOMAIN, []);
      expect(mem.proofs[0]).toMatchObject({ roster_cache_json: null, roster_cached_at: null });
    } finally {
      process.env.ALMSTINS_VERIFY_ENCRYPTION_KEY = key;
    }
  });
});

describe('an old plain cache is sealed when read; anything else unsealed reads as absent', () => {
  it('an old plain-JSON cache keeps the owner\'s list and is re-sealed in place', async () => {
    mem.proofs = [proofRow(JSON.stringify(ENTRIES))];
    expect(await getCachedRoster('merchant', DOMAIN)).toMatchObject({ addresses: ENTRIES });
    const stored = mem.proofs[0].roster_cache_json as string;
    expect(stored.trimStart().startsWith('{')).toBe(true);
    expect(stored).not.toContain(WALLET);
    // Read again: now from the sealed copy.
    expect(await getCachedRoster('merchant', DOMAIN)).toMatchObject({ addresses: ENTRIES });
  });

  it('a tampered cache, or one sealed to another key, is absent', async () => {
    const sealed = JSON.parse((await sealRosterCache(ENTRIES))!);
    const tampered = JSON.stringify({ ...sealed, ciphertext: Buffer.from('not the list').toString('base64') });
    expect(await openRosterCache(tampered)).toBeNull();
    expect(await openRosterCache(JSON.stringify({ ...sealed, keyId: 'almstins-enc-0000000000000000' }))).toBeNull();
    expect(await openRosterCache('not json')).toBeNull();
  });

  it('GET /api/verify/roster gives the signed-in owner their list back from an old plain cache, then holds it sealed', async () => {
    mem.proofs = [proofRow(JSON.stringify(ENTRIES))];
    const url = new URL(`https://almstins.com/api/verify/roster?domain=${DOMAIN}`);
    const res = await (rosterGet as any)({ request: new Request(url), url });
    const body = JSON.parse(await res.text());
    expect(body.cached?.addresses).toEqual(ENTRIES);
    expect(String(mem.proofs[0].roster_cache_json)).not.toContain(WALLET);
  });

  it('the public lookup still answers for a roster-proven address while its cache is absent', async () => {
    mem.proofs = [proofRow(null)];
    mem.dests = [unprovenDest()];
    await recordRosterProofResult('merchant', DOMAIN, ENTRIES);
    mem.proofs[0].roster_cache_json = 'not json'; // a damaged cache
    expect(await getCachedRoster('merchant', DOMAIN)).toBeNull();
    // Verified for the domain, and the roster label stays out of the public answer.
    expect(await lookupVerifiedAddress(WALLET)).toMatchObject({
      source: 'merchant', level: 'verified', domain: DOMAIN, provingDomain: DOMAIN, label: null,
    });
  });
});
