/**
 * API key management for the Almstins public API.
 *
 * Key format: alm_ + 32 random hex chars
 * Storage: SHA-256 hash of the raw key is stored — raw key is never persisted.
 * Rate limiting: module-level Map keyed by keyId (same pattern as walletChecker.ts).
 */

import { randomBytes, createHash, randomUUID } from 'crypto';
import { db } from '@/lib/db';

// ── Table bootstrap ──────────────────────────────────────────────────────────

let ensured = false;

export async function ensureApiKeysTable(): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT NOT NULL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      key_hash TEXT NOT NULL,
      rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
      last_used_at TEXT,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS api_keys_tenant ON api_keys (tenant_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys (key_hash)`);
  ensured = true;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  label: string;
  keyHash: string;
  rateLimitPerMin: number;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateKey(): string {
  return 'alm_' + randomBytes(16).toString('hex');
}

// ── Rate limiter ─────────────────────────────────────────────────────────────

const _keyRateLimiter = new Map<string, { count: number; resetAt: number }>();

export function checkKeyRateLimit(keyId: string, limitPerMin: number): boolean {
  const now = Date.now();
  const entry = _keyRateLimiter.get(keyId);
  if (!entry || now >= entry.resetAt) {
    _keyRateLimiter.set(keyId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limitPerMin;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Creates a new API key. Returns keyId + the raw key value.
 * The raw key is shown once — never stored and never returned again.
 */
export async function createApiKey(
  tenantId: string,
  label: string,
): Promise<{ keyId: string; key: string }> {
  await ensureApiKeysTable();
  const keyId = randomUUID();
  const key = generateKey();
  const keyHash = hashKey(key);

  await db.execute({
    sql: `INSERT INTO api_keys (id, tenant_id, label, key_hash, rate_limit_per_min, active)
          VALUES (?, ?, ?, ?, 60, 1)`,
    args: [keyId, tenantId, label.slice(0, 100), keyHash],
  });

  return { keyId, key };
}

/**
 * Validates a raw key from the X-Api-Key header.
 * Returns keyId + rateLimit on success, null if invalid/inactive.
 * Fires a background last_used_at update (fire-and-forget, never throws).
 */
export async function validateApiKey(
  rawKey: string,
): Promise<{ keyId: string; rateLimitPerMin: number } | null> {
  if (!rawKey || !rawKey.startsWith('alm_')) return null;

  await ensureApiKeysTable();
  const keyHash = hashKey(rawKey);

  const result = await db.execute({
    sql: `SELECT id, rate_limit_per_min FROM api_keys WHERE key_hash = ? AND active = 1 LIMIT 1`,
    args: [keyHash],
  });

  const row = result.rows[0];
  if (!row) return null;

  const keyId = String(row['id']);
  const rateLimitPerMin = Number(row['rate_limit_per_min']) || 60;

  // Fire-and-forget background update — never blocks the response, never throws
  void db
    .execute({
      sql: `UPDATE api_keys SET last_used_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id = ?`,
      args: [keyId],
    })
    .catch(() => {});

  return { keyId, rateLimitPerMin };
}

/**
 * Lists all API keys for a tenant. Never returns key_hash.
 */
export async function listApiKeys(
  tenantId: string,
): Promise<Omit<ApiKeyRecord, 'keyHash'>[]> {
  await ensureApiKeysTable();

  const result = await db.execute({
    sql: `SELECT id, tenant_id, label, rate_limit_per_min, created_at, last_used_at, active
          FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC`,
    args: [tenantId],
  });

  return result.rows.map((r) => ({
    id: String(r['id']),
    tenantId: String(r['tenant_id']),
    label: String(r['label'] ?? ''),
    rateLimitPerMin: Number(r['rate_limit_per_min']) || 60,
    createdAt: String(r['created_at']),
    lastUsedAt: r['last_used_at'] != null ? String(r['last_used_at']) : null,
    active: Boolean(r['active']) && r['active'] !== 0 && r['active'] !== '0' && r['active'] !== 'f' && r['active'] !== 'false',
  }));
}

/**
 * Revokes an API key. Returns true if a row was affected.
 */
export async function revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
  await ensureApiKeysTable();

  const result = await db.execute({
    sql: `UPDATE api_keys SET active = 0 WHERE id = ? AND tenant_id = ?`,
    args: [keyId, tenantId],
  });

  return (result.rowsAffected ?? 0) > 0;
}
