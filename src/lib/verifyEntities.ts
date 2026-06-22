/**
 * Almstins Verify — Verified Entity (hosted-API-endpoint variant).
 *
 * A large entity (exchange, institution) proves control of its domain, then hands us
 * an authenticated endpoint on that domain + an API key. We pull its live address
 * list and mirror it as "published by <domain>". Owner→world self-disclosure:
 *  - the entity asserts its OWN addresses on its OWN domain — no attribution, no KYC.
 *  - the mirror carries the DOMAIN, never a legal identity.
 *  - the API key is read-only (reads a public list) and stored ENCRYPTED, never hashed
 *    (we replay it on every pull).
 * Tenant isolation is app-enforced (WHERE tenant_id), like the rest of Verify.
 */
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import {
  generateChallenge, verifyDomainProof, normalizeProofDomain,
  validateEntityEndpoint, pullEntityList, type EntityPullCode,
} from './verifyProof';
import { encryptSecret, decryptSecret, encryptionAvailable } from './verifyCrypto';

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

export type EntityProofStatus = 'unproven' | 'proven';

export interface VerifiedEntity {
  id: string;
  domain: string;
  proofStatus: EntityProofStatus;
  challenge: string;            // the challenge token, so the UI can rebuild the .well-known file
  hasEndpoint: boolean;
  hasKey: boolean;              // whether an (encrypted) API key is stored — never the key itself
  apiEndpoint: string | null;
  lastPulledAt: string | null;
  lastPullStatus: string | null;
  lastPullCount: number;
}

const ENSURE_ENTITIES = `
  CREATE TABLE IF NOT EXISTS verified_entities (
    id                TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    domain            TEXT NOT NULL,
    challenge_token   TEXT NOT NULL,
    proof_status      TEXT NOT NULL DEFAULT 'unproven',
    api_endpoint      TEXT,
    api_key_encrypted TEXT,
    last_pulled_at    TEXT,
    last_pull_status  TEXT,
    last_pull_count   INTEGER NOT NULL DEFAULT 0,
    proven_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_ENTITIES_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verified_entities_tenant_domain
  ON verified_entities (tenant_id, domain)`;

// Global-by-design (address-keyed): the future public lookup reads address → entity_domain
// and NEVER exposes tenant_id or any identity. Tenant_id is here for management only.
const ENSURE_MIRROR = `
  CREATE TABLE IF NOT EXISTS verified_address_mirror (
    id            TEXT NOT NULL PRIMARY KEY,
    entity_id     TEXT NOT NULL,
    tenant_id     TEXT NOT NULL,
    address       TEXT NOT NULL,
    chain         TEXT NOT NULL DEFAULT '',
    entity_domain TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'verified',
    source        TEXT NOT NULL DEFAULT 'api_endpoint',
    refreshed_at  TEXT
  )
`;
const ENSURE_MIRROR_ADDR_IDX = `CREATE INDEX IF NOT EXISTS verified_address_mirror_address
  ON verified_address_mirror (address)`;
const ENSURE_MIRROR_UNIQUE = `CREATE UNIQUE INDEX IF NOT EXISTS verified_address_mirror_entity_addr
  ON verified_address_mirror (entity_id, address, chain)`;

let ensured = false;
export async function ensureEntityTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_ENTITIES, args: [] });
  await db.execute({ sql: ENSURE_ENTITIES_IDX, args: [] });
  await db.execute({ sql: ENSURE_MIRROR, args: [] });
  await db.execute({ sql: ENSURE_MIRROR_ADDR_IDX, args: [] });
  await db.execute({ sql: ENSURE_MIRROR_UNIQUE, args: [] });
  ensured = true;
}

const ENTITY_COLS = `id, domain, challenge_token, proof_status, api_endpoint, api_key_encrypted,
  last_pulled_at, last_pull_status, last_pull_count`;

function mapEntity(r: any): VerifiedEntity {
  return {
    id: String(r.id),
    domain: String(r.domain),
    proofStatus: (String(r.proof_status) === 'proven' ? 'proven' : 'unproven'),
    challenge: String(r.challenge_token),
    hasEndpoint: !!r.api_endpoint,
    hasKey: !!r.api_key_encrypted,
    apiEndpoint: r.api_endpoint ? String(r.api_endpoint) : null,
    lastPulledAt: r.last_pulled_at ? String(r.last_pulled_at) : null,
    lastPullStatus: r.last_pull_status ? String(r.last_pull_status) : null,
    lastPullCount: Number(r.last_pull_count ?? 0),
  };
}

export async function listEntities(tenantId: string): Promise<VerifiedEntity[]> {
  await ensureEntityTables();
  const res = await db.execute({
    sql: `SELECT ${ENTITY_COLS} FROM verified_entities WHERE tenant_id = ? ORDER BY created_at ASC`,
    args: [tenantId],
  });
  return (res.rows as any[]).map(mapEntity);
}

export async function getEntity(tenantId: string, id: string): Promise<VerifiedEntity | null> {
  await ensureEntityTables();
  const res = await db.execute({
    sql: `SELECT ${ENTITY_COLS} FROM verified_entities WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return res.rows.length ? mapEntity(res.rows[0]) : null;
}

/** Internal: fetch the encrypted key column (never exposed via the mapped entity). */
async function getEntityRaw(tenantId: string, id: string): Promise<any | null> {
  const res = await db.execute({
    sql: `SELECT id, domain, proof_status, api_endpoint, api_key_encrypted FROM verified_entities
          WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return res.rows.length ? res.rows[0] : null;
}

export type CreateEntityResult =
  | { ok: true; entity: VerifiedEntity }
  | { ok: false; code: 'invalid_domain' };

/** Register an entity for a domain (idempotent per tenant+domain), issuing a challenge. */
export async function createEntity(tenantId: string, rawDomain: string): Promise<CreateEntityResult> {
  await ensureEntityTables();
  const domain = normalizeProofDomain(rawDomain);
  if (!domain) return { ok: false, code: 'invalid_domain' };

  const existing = await db.execute({
    sql: `SELECT ${ENTITY_COLS} FROM verified_entities WHERE tenant_id = ? AND domain = ? LIMIT 1`,
    args: [tenantId, domain],
  });
  if (existing.rows.length) return { ok: true, entity: mapEntity(existing.rows[0]) };

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO verified_entities (id, tenant_id, domain, challenge_token, proof_status)
          VALUES (?, ?, ?, ?, 'unproven')`,
    args: [id, tenantId, domain, generateChallenge()],
  });
  const entity = await getEntity(tenantId, id);
  return { ok: true, entity: entity! };
}

export type EntityOutcome = { ok: true } | { ok: false; code: string };

/** Prove the entity's domain via the published .well-known challenge (reuses Phase 3). */
export async function proveEntity(tenantId: string, id: string): Promise<EntityOutcome> {
  const entity = await getEntity(tenantId, id);
  if (!entity) return { ok: false, code: 'not_found' };
  const result = await verifyDomainProof(entity.domain, entity.challenge);
  if (!result.ok) return { ok: false, code: result.code };
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verified_entities SET proof_status = 'proven', proven_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [now, now, id, tenantId],
  });
  return { ok: true };
}

/** Store the entity's hosted endpoint + API key (encrypted). Requires a proven domain. */
export async function setEntityEndpoint(
  tenantId: string, id: string, endpoint: string, apiKey: string,
): Promise<EntityOutcome> {
  const entity = await getEntity(tenantId, id);
  if (!entity) return { ok: false, code: 'not_found' };
  if (entity.proofStatus !== 'proven') return { ok: false, code: 'not_proven' };
  if (!validateEntityEndpoint(endpoint, entity.domain)) return { ok: false, code: 'invalid_endpoint' };
  if (!encryptionAvailable()) return { ok: false, code: 'encryption_unavailable' };
  const enc = encryptSecret(apiKey);
  if (!enc) return { ok: false, code: 'encryption_unavailable' };
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verified_entities SET api_endpoint = ?, api_key_encrypted = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [endpoint.trim(), enc, now, id, tenantId],
  });
  return { ok: true };
}

export type PullResult = { ok: true; count: number } | { ok: false; code: EntityPullCode | string };

/** Pull the entity's live list and replace its mirrored addresses. */
export async function pullEntity(tenantId: string, id: string): Promise<PullResult> {
  const raw = await getEntityRaw(tenantId, id);
  if (!raw) return { ok: false, code: 'not_found' };
  if (String(raw.proof_status) !== 'proven') return { ok: false, code: 'not_proven' };
  if (!raw.api_endpoint || !raw.api_key_encrypted) return { ok: false, code: 'no_endpoint' };

  const apiKey = decryptSecret(String(raw.api_key_encrypted));
  if (apiKey === null) return { ok: false, code: 'encryption_unavailable' };

  const result = await pullEntityList(String(raw.api_endpoint), apiKey, String(raw.domain));
  const now = nowUtc();
  if (!result.ok) {
    await db.execute({
      sql: `UPDATE verified_entities SET last_pull_status = ?, last_pulled_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [result.code, now, now, id, tenantId],
    });
    return { ok: false, code: result.code };
  }

  // Replace the entity's mirrored set with the current published list.
  await db.execute({
    sql: `DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  for (const a of result.addresses) {
    await db.execute({
      sql: `INSERT INTO verified_address_mirror (id, entity_id, tenant_id, address, chain, entity_domain, status, source, refreshed_at)
            VALUES (?, ?, ?, ?, ?, ?, 'verified', 'api_endpoint', ?)`,
      args: [randomUUID(), id, tenantId, a.address, a.chain, String(raw.domain), now],
    });
  }
  await db.execute({
    sql: `UPDATE verified_entities SET last_pull_status = 'ok', last_pull_count = ?, last_pulled_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [result.addresses.length, now, now, id, tenantId],
  });
  return { ok: true, count: result.addresses.length };
}

/** Set endpoint + key, then immediately pull. One action for the "connect" UI. */
export async function connectEntity(
  tenantId: string, id: string, endpoint: string, apiKey: string,
): Promise<PullResult> {
  const set = await setEntityEndpoint(tenantId, id, endpoint, apiKey);
  if (!set.ok) return { ok: false, code: set.code };
  return pullEntity(tenantId, id);
}

/** Remove an entity and its mirrored addresses. */
export async function deleteEntity(tenantId: string, id: string): Promise<void> {
  await ensureEntityTables();
  await db.execute({
    sql: `DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  await db.execute({
    sql: `DELETE FROM verified_entities WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
}
