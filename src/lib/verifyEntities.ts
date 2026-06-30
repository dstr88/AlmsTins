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
import { normalizeDestinationValue, ensureVerifyTables } from './verifyRegistry';

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

/**
 * Hard max-stale TTL for a mirrored "verified" row. A row whose `refreshed_at` is
 * older than this is NOT trusted by the public lookup — fail-safe to *unverified*.
 * The Phase-5 monitor cron keeps `refreshed_at` advancing on every successful re-pull;
 * if it stops (entity endpoint down, cron broken), the badge lapses instead of
 * over-claiming a stale "verified." Under-claim, never over-claim. Same column format
 * as `nowUtc()` so a lexical `>=` compare is also chronological.
 */
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
const staleCutoffUtc = (): string =>
  new Date(Date.now() - MAX_STALE_MS).toISOString().replace('T', ' ').slice(0, 19);

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

// ── Phase 4: public address lookup ───────────────────────────────────────────

export interface VerifiedAddressHit {
  /** Whether this is an entity's published address or a merchant's proven self-listing. */
  source: 'entity' | 'merchant';
  /** Publishing domain (entity path), or null for a merchant self-listing. */
  domain: string | null;
  /** The merchant's OWN self-chosen label (merchant path), or null. Never an identity we derived. */
  label: string | null;
  /** Rail the address is on, or null. */
  chain: string | null;
}

/**
 * PUBLIC, GLOBAL, login-free lookup: has a domain-verified entity published this
 * address as one of its own receiving addresses?
 *
 * This is the ONE query in Verify that is intentionally NOT tenant-scoped — the
 * mirror is the public "verified publisher" projection, keyed by address. It returns
 * ONLY the publishing domain. It NEVER exposes `tenant_id`, the managing account, or
 * any legal identity — that would cross the no-attribution boundary. It is the allowed
 * direction of power: an entity self-disclosing its OWN addresses to the world.
 *
 * The mirror stores addresses already canonicalized on ingest (`normalizeEvm`:
 * EVM → lowercased, non-EVM → trimmed-exact). We canonicalize the query the same way
 * (`normalizeDestinationValue`), so an exact, index-assisted `address = ?` match is
 * both correct and fast. Returns null when the address isn't a verified destination.
 */
export async function lookupVerifiedAddress(rawValue: string): Promise<VerifiedAddressHit | null> {
  const normalized = normalizeDestinationValue(rawValue);
  if (!normalized) return null;
  await ensureEntityTables();

  // 1) Entity mirror (exchanges / platforms) — domain-published, fresh.
  const ent = await db.execute({
    sql: `SELECT chain, entity_domain FROM verified_address_mirror
          WHERE status = 'verified' AND address = ?
            AND refreshed_at IS NOT NULL AND refreshed_at >= ?
          LIMIT 1`,
    args: [normalized, staleCutoffUtc()],
  });
  if (ent.rows.length) {
    const r = ent.rows[0] as any;
    return { source: 'entity', domain: String(r.entity_domain), label: null, chain: r.chain ? String(r.chain) : null };
  }

  // 2) Proven merchant destinations (self-send / domain proof). Claim-once guarantees at
  //    most one account can prove a given (rail, value), so the match is unambiguous. We
  //    expose only the merchant's OWN self-chosen label — never tenant_id or any identity.
  await ensureVerifyTables();
  const dest = await db.execute({
    sql: `SELECT tenant_id, rail, value, label, proof_domain FROM verify_destinations
          WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)`,
    args: [normalized, normalized],
  });
  const hit = (dest.rows as any[]).find((r) => normalizeDestinationValue(String(r.value)) === normalized);
  if (hit) {
    // Prefer the tenant's domain-verified business name (+ its anchor domain) over the
    // freeform label. We expose only the public name + domain — never tenant_id or any key.
    const vn = await verifiedNameForTenant(String(hit.tenant_id));
    return {
      source: 'merchant',
      domain: vn?.domain ?? (hit.proof_domain ? String(hit.proof_domain) : null),
      label: vn?.name ?? (hit.label ? String(hit.label) : null),
      chain: String(hit.rail),
    };
  }
  return null;
}

/**
 * PUBLIC, login-free lookup for a payment LINK / QR (kind='qr'): has a merchant
 * proven this URL is theirs by registering it in their own account (account_claim)?
 *
 * Same no-attribution rules as the address lookup: returns only the merchant's
 * self-chosen label plus the URL's host for display — never tenant_id or any legal
 * identity. Claim-once guarantees at most one account owns a proven URL, so the
 * customer-scan match is unambiguous. The stored value is already normalized on save;
 * we normalize the query the same way and compare canonical forms.
 */
export async function lookupVerifiedUrl(rawUrl: string): Promise<VerifiedAddressHit | null> {
  const normalized = normalizeDestinationValue(rawUrl);
  if (!normalized) return null;
  await ensureVerifyTables();
  const dest = await db.execute({
    sql: `SELECT tenant_id, rail, value, label FROM verify_destinations
          WHERE kind = 'qr' AND proof_status = 'proven'`,
    args: [],
  });
  const hit = (dest.rows as any[]).find((r) => normalizeDestinationValue(String(r.value)) === normalized);
  if (!hit) return null;
  const vn = await verifiedNameForTenant(String(hit.tenant_id));
  let host: string | null = null;
  try { host = new URL(normalized).host || null; } catch { host = null; }
  return { source: 'merchant', domain: vn?.domain ?? host, label: vn?.name ?? (hit.label ? String(hit.label) : null), chain: 'url' };
}

/**
 * The tenant's domain-verified business name + its anchor domain, or null. Used to show
 * "Registered to <name> · verified via <domain>" on any of the tenant's proven
 * destinations, regardless of how the destination itself was proven. Returns ONLY the
 * public name + domain — never tenant_id or any key.
 */
async function verifiedNameForTenant(tenantId: string): Promise<{ name: string; domain: string | null } | null> {
  try {
    const vn = await db.execute({
      sql: `SELECT display_name, domain FROM verify_claimed_names WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1`,
      args: [tenantId],
    });
    if (!vn.rows.length) return null;
    const r = vn.rows[0] as any;
    return { name: String(r.display_name), domain: r.domain ? String(r.domain) : null };
  } catch { return null; }
}

// ── Phase 5: monitoring / re-validation (the watchman) ───────────────────────

export interface EntityMonitorTarget {
  id: string;
  tenantId: string;
  domain: string;
  /** Prior pull status — used to alert only on the ok->fail TRANSITION (no repeat spam). */
  lastPullStatus: string | null;
}

/**
 * Cross-tenant enumeration for the monitor cron — every proven entity that has a
 * stored endpoint + key. NOT tenant-scoped: this is a privileged maintenance job
 * (like monthly-digest), so it deliberately spans all tenants. It returns only
 * management fields, never the key.
 */
export async function listEntitiesForMonitor(): Promise<EntityMonitorTarget[]> {
  await ensureEntityTables();
  const res = await db.execute({
    sql: `SELECT id, tenant_id, domain, last_pull_status
          FROM verified_entities
          WHERE proof_status = 'proven'
            AND api_endpoint IS NOT NULL AND api_key_encrypted IS NOT NULL`,
    args: [],
  });
  return (res.rows as any[]).map(r => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    domain: String(r.domain),
    lastPullStatus: r.last_pull_status ? String(r.last_pull_status) : null,
  }));
}

export interface EntityMonitorResult {
  pull: PullResult;
  /** Addresses that were in the mirror before but not after — revocations. */
  removed: string[];
  /** Newly published addresses (informational; no alert). */
  added: string[];
}

/**
 * Re-pull one entity's live list (refreshing its mirror + `refreshed_at`) and report
 * which addresses were revoked vs added. On a failed pull the mirror is left intact —
 * the public lookup's max-stale TTL is what fails it safe, not a destructive delete.
 */
export async function monitorEntity(tenantId: string, id: string): Promise<EntityMonitorResult> {
  const before = await db.execute({
    sql: `SELECT address FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  const beforeSet = new Set((before.rows as any[]).map(r => String(r.address)));
  const pull = await pullEntity(tenantId, id);
  if (!pull.ok) return { pull, removed: [], added: [] };
  const after = await db.execute({
    sql: `SELECT address FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  const afterSet = new Set((after.rows as any[]).map(r => String(r.address)));
  const removed = [...beforeSet].filter(a => !afterSet.has(a));
  const added = [...afterSet].filter(a => !beforeSet.has(a));
  return { pull, removed, added };
}
