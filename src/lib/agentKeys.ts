/**
 * Agent API keys — self-serve, domain-proven, nobody approves anybody.
 *
 * A key raises /api/verify/check from the anonymous per-IP budget to a fleet-scale
 * per-key budget. Issuance is the product's own ceremony pointed at its customers:
 * claim a domain, publish a DNS TXT record carrying an account-bound challenge
 * (root or _almstins-verify.<domain>), and the key mints itself. No KYB, no review,
 * no human gate — the domain IS the identity (see price.ppp.contract.claude.md law 5).
 *
 * Keys read only public proof state, so a leaked key is a rate-quota nuisance, not a
 * security event. We store only the sha256 of the key; the plaintext is shown once.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { generateChallenge, verifyDnsTxt } from '@/lib/verifyProof';

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS verify_agent_keys (
    id              TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    domain          TEXT NOT NULL,
    challenge_token TEXT NOT NULL,
    key_hash        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at       TEXT,
    revoked_at      TEXT,
    last_used_at    TEXT
  )
`;
const ENSURE_IDX = `CREATE INDEX IF NOT EXISTS verify_agent_keys_tenant ON verify_agent_keys (tenant_id)`;
const ENSURE_HASH_IDX = `CREATE INDEX IF NOT EXISTS verify_agent_keys_hash ON verify_agent_keys (key_hash)`;

let ensured = false;
async function ensureAgentKeyTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_IDX, args: [] });
  await db.execute({ sql: ENSURE_HASH_IDX, args: [] });
  ensured = true;
}

export interface AgentKeyMeta {
  id: string;
  domain: string;
  status: 'pending' | 'active' | 'revoked';
  createdAt: string;
  provenAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  /** Present only while pending — what the TXT record must contain. */
  challenge: string | null;
}

function rowMeta(r: any): AgentKeyMeta {
  const status = ['pending', 'active', 'revoked'].includes(String(r.status))
    ? (String(r.status) as AgentKeyMeta['status']) : 'revoked';
  return {
    id: String(r.id),
    domain: String(r.domain),
    status,
    createdAt: String(r.created_at),
    provenAt: r.proven_at != null ? String(r.proven_at) : null,
    revokedAt: r.revoked_at != null ? String(r.revoked_at) : null,
    lastUsedAt: r.last_used_at != null ? String(r.last_used_at) : null,
    challenge: status === 'pending' ? String(r.challenge_token) : null,
  };
}

function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function normDomain(raw: string): string | null {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^https?:\/\//.test(s)) { try { s = new URL(s).hostname; } catch { return null; } }
  s = s.replace(/^www\./, '').replace(/\.+$/, '').split('/')[0].split(':')[0];
  if (!s || !s.includes('.') || s.length > 253 || /[^a-z0-9.-]/.test(s)) return null;
  return s;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Start (or resume) a claim on a domain: one pending row per tenant+domain. */
export async function startAgentKey(
  tenantId: string, rawDomain: string,
): Promise<{ ok: true; key: AgentKeyMeta } | { ok: false; error: string }> {
  await ensureAgentKeyTables();
  const domain = normDomain(rawDomain);
  if (!domain) return { ok: false, error: 'invalid_domain' };
  // Resume an existing pending claim rather than minting a new challenge each click —
  // the merchant may have already published the TXT record.
  const existing = await db.execute({
    sql: `SELECT * FROM verify_agent_keys WHERE tenant_id = ? AND domain = ? AND status = 'pending' LIMIT 1`,
    args: [tenantId, domain],
  });
  if (existing.rows.length) return { ok: true, key: rowMeta(existing.rows[0]) };
  const id = randomBytes(12).toString('hex');
  const challenge = generateChallenge();
  await db.execute({
    sql: `INSERT INTO verify_agent_keys (id, tenant_id, domain, challenge_token, status) VALUES (?, ?, ?, ?, 'pending')`,
    args: [id, tenantId, domain, challenge],
  });
  const r = await db.execute({ sql: `SELECT * FROM verify_agent_keys WHERE id = ? LIMIT 1`, args: [id] });
  return { ok: true, key: rowMeta(r.rows[0]) };
}

/**
 * Check the DNS TXT record and, on match, mint the key. The plaintext key is returned
 * exactly once and never stored — only its hash is.
 */
export async function activateAgentKey(
  tenantId: string, id: string,
): Promise<{ ok: true; key: AgentKeyMeta; plaintextKey: string } | { ok: false; error: string }> {
  await ensureAgentKeyTables();
  const r = await db.execute({
    sql: `SELECT * FROM verify_agent_keys WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(id ?? '').trim(), tenantId],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (String(row.status) !== 'pending') return { ok: false, error: 'not_pending' };

  const dns = await verifyDnsTxt(String(row.domain), String(row.challenge_token));
  if (!dns.ok) return { ok: false, error: dns.code };

  const plaintextKey = 'avk_' + randomBytes(24).toString('hex');
  await db.execute({
    sql: `UPDATE verify_agent_keys SET key_hash = ?, status = 'active', proven_at = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
    args: [sha256(plaintextKey), nowUtc(), String(row.id), tenantId],
  });
  const fresh = await db.execute({ sql: `SELECT * FROM verify_agent_keys WHERE id = ? LIMIT 1`, args: [String(row.id)] });
  return { ok: true, key: rowMeta(fresh.rows[0]), plaintextKey };
}

/** The tenant's keys, hashes never included. */
export async function listAgentKeys(tenantId: string): Promise<AgentKeyMeta[]> {
  await ensureAgentKeyTables();
  const r = await db.execute({
    sql: `SELECT * FROM verify_agent_keys WHERE tenant_id = ? ORDER BY created_at ASC`,
    args: [tenantId],
  });
  return r.rows.map(rowMeta);
}

export async function revokeAgentKey(tenantId: string, id: string): Promise<boolean> {
  await ensureAgentKeyTables();
  const r = await db.execute({
    sql: `UPDATE verify_agent_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND tenant_id = ? AND status != 'revoked'`,
    args: [nowUtc(), String(id ?? '').trim(), tenantId],
  });
  return (r.rowsAffected ?? 0) > 0;
}

// Hot-path cache so every keyed check doesn't hit the DB. Entries live 60s; a
// revocation takes effect within that window, which is acceptable for a read-only key.
const KEY_CACHE = new Map<string, { hit: { id: string; domain: string } | null; expiresAt: number }>();
const KEY_CACHE_TTL_MS = 60_000;

/** Resolve a Bearer token to an active key, or null. Touches last_used_at lazily. */
export async function authenticateAgentKey(bearer: string): Promise<{ id: string; domain: string } | null> {
  const token = String(bearer ?? '').trim();
  if (!/^avk_[0-9a-f]{48}$/.test(token)) return null;
  const hash = sha256(token);
  const cached = KEY_CACHE.get(hash);
  if (cached && Date.now() < cached.expiresAt) return cached.hit;
  await ensureAgentKeyTables();
  const r = await db.execute({
    sql: `SELECT id, domain FROM verify_agent_keys WHERE key_hash = ? AND status = 'active' LIMIT 1`,
    args: [hash],
  });
  const hit = r.rows.length
    ? { id: String((r.rows[0] as any).id), domain: String((r.rows[0] as any).domain) }
    : null;
  KEY_CACHE.set(hash, { hit, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  if (hit) {
    // Fire-and-forget usage touch; the check response never waits on it.
    void db.execute({
      sql: `UPDATE verify_agent_keys SET last_used_at = ? WHERE id = ?`,
      args: [nowUtc(), hit.id],
    }).catch(() => {});
  }
  return hit;
}
