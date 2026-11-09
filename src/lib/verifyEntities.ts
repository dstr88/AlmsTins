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
 *
 * Publishing is by approval (verifyEntityAccess.ts): create, prove, set-endpoint and pull
 * refuse a tenant that is not approved, the monitor only refreshes approved tenants, and the
 * public lookup ignores mirror rows whose tenant is not approved. Delete is never gated.
 *
 * The cross-account guard (verifyMirrorGuard.ts, Nov 2026): a pulled entry that another account
 * holds as a proven destination, or that an earlier-proven platform already lists, is mirrored
 * with status 'conflict' and answers nobody; the lookup returns a disputed hit for it, and for a
 * merchant's proven address that a fresh platform list also carries. Nothing is deleted, nobody
 * is named.
 */
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import {
  generateChallenge, verifyDomainProof, normalizeProofDomain,
  validateEntityEndpoint, pullEntityList, type EntityPullCode,
} from './verifyProof';
import { encryptSecret, decryptSecret, encryptionAvailable } from './verifyCrypto';
import { normalizeDestinationValue, addressKey, ensureVerifyTables } from './verifyRegistry';
import { canPublishEntities, publishingTenantIds, ENTITY_NOT_APPROVED } from './verifyEntityAccess';
import { merchantAddressAssurance, staleCutoffUtc } from './verifyAnchor';
import { classifyPulledList, type Classified } from './verifyMirrorGuard';

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
  /** Entries of the last pull that conflict with another account's proof or an earlier list. */
  lastPullConflicts: number;
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
// Account deletion clears a tenant's mirror rows by tenant_id (verifyAccountDelete.ts).
const ENSURE_MIRROR_TENANT_IDX = `CREATE INDEX IF NOT EXISTS verified_address_mirror_tenant
  ON verified_address_mirror (tenant_id)`;

/**
 * The guard's columns and index (verifyMirrorGuard.ts), added to the tables above. Lazily here,
 * durably in migrations-pg/0072_verify_mirror_conflicts.sql; tests/verify/mirrorGuard.test.ts keeps
 * the two identical. Every statement is safe to run again.
 */
export const MIRROR_GUARD_DDL: readonly string[] = [
  `ALTER TABLE verified_address_mirror ADD COLUMN IF NOT EXISTS conflict_with TEXT`,
  `ALTER TABLE verified_address_mirror ADD COLUMN IF NOT EXISTS conflict_seen_at TEXT`,
  `ALTER TABLE verified_entities ADD COLUMN IF NOT EXISTS last_pull_conflicts INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS verified_address_mirror_address_status ON verified_address_mirror (address, status)`,
];

let ensured = false;
export async function ensureEntityTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_ENTITIES, args: [] });
  await db.execute({ sql: ENSURE_ENTITIES_IDX, args: [] });
  await db.execute({ sql: ENSURE_MIRROR, args: [] });
  await db.execute({ sql: ENSURE_MIRROR_ADDR_IDX, args: [] });
  await db.execute({ sql: ENSURE_MIRROR_UNIQUE, args: [] });
  await db.execute({ sql: ENSURE_MIRROR_TENANT_IDX, args: [] });
  for (const sql of MIRROR_GUARD_DDL) await db.execute({ sql, args: [] });
  ensured = true;
}

const ENTITY_COLS = `id, domain, challenge_token, proof_status, api_endpoint, api_key_encrypted,
  last_pulled_at, last_pull_status, last_pull_count, last_pull_conflicts`;

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
    lastPullConflicts: Number(r.last_pull_conflicts ?? 0),
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
    sql: `SELECT id, domain, proof_status, api_endpoint, api_key_encrypted, proven_at FROM verified_entities
          WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return res.rows.length ? res.rows[0] : null;
}

export type CreateEntityResult =
  | { ok: true; entity: VerifiedEntity }
  | { ok: false; code: 'invalid_domain' | typeof ENTITY_NOT_APPROVED };

/** Register an entity for a domain (idempotent per tenant+domain), issuing a challenge. */
export async function createEntity(tenantId: string, rawDomain: string): Promise<CreateEntityResult> {
  if (!canPublishEntities(tenantId)) return { ok: false, code: ENTITY_NOT_APPROVED };
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
  if (!canPublishEntities(tenantId)) return { ok: false, code: ENTITY_NOT_APPROVED };
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
  if (!canPublishEntities(tenantId)) return { ok: false, code: ENTITY_NOT_APPROVED };
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

export type PullResult = { ok: true; count: number; conflicts: number } | { ok: false; code: EntityPullCode | string };

/**
 * Pull the entity's live list and replace its mirrored addresses. Refuses (before any read
 * or write) a tenant that is not approved, so neither connect nor the monitor can add
 * addresses for one.
 *
 * Every pulled entry is classified first (verifyMirrorGuard.ts): one another account has proven,
 * or an earlier-proven platform lists, is written as a conflict rather than verified. A classifier
 * that cannot read answers 'guard_unavailable' and the mirror is left as it was: a list that could
 * not be checked never replaces one that was.
 */
export async function pullEntity(tenantId: string, id: string): Promise<PullResult> {
  if (!canPublishEntities(tenantId)) return { ok: false, code: ENTITY_NOT_APPROVED };
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

  // The guard: classify every entry against other accounts' proofs and earlier lists before
  // anything is written. A classifier that throws (a database error) leaves the mirror as it was.
  let classified: Classified[];
  try {
    classified = await classifyPulledList(
      { tenantId, entityId: id, provenAt: raw.proven_at ? String(raw.proven_at) : null },
      result.addresses,
    );
  } catch (err) {
    console.error('[verify-entities] guard could not classify the list', err instanceof Error ? err.name : err);
    return { ok: false, code: 'guard_unavailable' };
  }
  const conflicts = classified.filter((c) => c.status === 'conflict').length;

  // Replace the entity's mirrored set with the current published list, in one transaction.
  // The entity row may have gone while the fetch ran (its account was deleted, or the
  // owner removed it), so the transaction starts by updating (and so locking) that row,
  // and every insert is conditional on the entity still existing. A pull that lost that
  // race changes nothing; account deletion takes the same entity lock before it clears the
  // mirror (see verifyAccountDelete.ts), so it also removes anything a pull committed first.
  const replaced = await db.batch([
    {
      sql: `UPDATE verified_entities SET last_pull_status = 'ok', last_pull_count = ?, last_pull_conflicts = ?, last_pulled_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [result.addresses.length, conflicts, now, now, id, tenantId],
    },
    {
      sql: `DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
      args: [id, tenantId],
    },
    ...result.addresses.map((a, i) => ({
      sql: `INSERT INTO verified_address_mirror (id, entity_id, tenant_id, address, chain, entity_domain, status, source, refreshed_at, conflict_with, conflict_seen_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, 'api_endpoint', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM verified_entities WHERE id = ? AND tenant_id = ? AND proof_status = 'proven')`,
      args: [
        randomUUID(), id, tenantId, a.address, a.chain, String(raw.domain), classified[i].status, now,
        classified[i].conflictWith, classified[i].status === 'conflict' ? now : null, id, tenantId,
      ],
    })),
  ], 'write');
  if (!Number(replaced[0]?.rowsAffected ?? 0)) return { ok: false, code: 'not_found' };
  return { ok: true, count: result.addresses.length, conflicts };
}

/** Set endpoint + key, then immediately pull. One action for the "connect" UI. */
export async function connectEntity(
  tenantId: string, id: string, endpoint: string, apiKey: string,
): Promise<PullResult> {
  const set = await setEntityEndpoint(tenantId, id, endpoint, apiKey);
  if (!set.ok) return { ok: false, code: set.code };
  return pullEntity(tenantId, id);
}

/**
 * Remove an entity and its mirrored addresses, in one transaction. The entity row goes
 * first, the same lock order as pullEntity, so a pull in flight either finishes before
 * this (and its rows are removed by the mirror DELETE that follows) or finds the entity
 * gone and writes nothing.
 */
export async function deleteEntity(tenantId: string, id: string): Promise<void> {
  await ensureEntityTables();
  await db.batch([
    { sql: `DELETE FROM verified_entities WHERE id = ? AND tenant_id = ?`, args: [id, tenantId] },
    { sql: `DELETE FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`, args: [id, tenantId] },
  ], 'write');
}

// ── Phase 4: public address lookup ───────────────────────────────────────────

export interface VerifiedAddressHit {
  /** An entity's published address, a merchant's proven self-listing, or 'conflict': two accounts
   *  stand behind the same address (a platform list and a merchant's proof, or two platform lists)
   *  and the answer names neither (verifyMirrorGuard.ts, G3). */
  source: 'entity' | 'merchant' | 'conflict';
  /**
   * Assurance level (the customer-facing grade):
   *  - 'verified' — the destination is anchored to a PROVEN DOMAIN that would catch a
   *    swap: an entity's domain-published mirror, or a merchant address proven via its
   *    own domain (proof_domain). This is the strong signal.
   *  - 'claimed' — CONTROL was proven (e.g. micro-deposit) but the address is NOT tied
   *    to an accountable domain. Control alone is not a safety signal — a scammer can
   *    prove control of their own address — so this is shown as caution, not endorsement.
   *  - 'disputed' — two accounts stand behind the address (source 'conflict'). Nothing
   *    vouches for it until one withdraws: no domain, no name, no date.
   */
  level: 'claimed' | 'verified' | 'disputed';
  /** ISO datetime (UTC) behind the level — the "verified/claimed since" date. For 'verified' it is
   *  when the domain anchor was attached; for 'claimed', when control was proven. Null if unknown. */
  since: string | null;
  /** DISPLAY domain: an entity's publishing domain, or (merchant path) the account's
   *  domain-verified business name's domain if it has one, else the domain that actually
   *  anchors THIS destination. Prefers the business name for a nicer badge, so it can
   *  differ from provingDomain below — see that field before matching against it. */
  domain: string | null;
  /** MACHINE domain: the domain that actually vouches for this exact destination right
   *  now — an entity's own list, or (merchant path) the destination's own proof_domain,
   *  never the account's business-name domain. Null whenever level isn't 'verified', so
   *  it is always safe to compare directly against an agent's `expect` (check.ts) or to
   *  decide "Listed on" vs "verified via" (verifyPublicCard.ts) — domain above is not. */
  provingDomain: string | null;
  /** The account's domain-verified business name (merchant path, verify_claimed_names), or
   *  null. Never the freeform label the account typed: that can be a person's name, and this
   *  answers the public. */
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

  // 1) Entity mirror (exchanges / platforms) — domain-published, fresh, and published by an
  //    approved tenant. A row whose tenant is not (or no longer) approved never answers, so
  //    withdrawing approval takes effect at once instead of waiting out the stale TTL. The
  //    approval filter runs in SQL (so unapproved rows can never crowd an approved one out
  //    of the page), and the order is fixed: when several approved lists carry the address,
  //    the earliest-proven domain answers. The tenant_id is read only to re-check approval
  //    below and is never returned.
  const publishers = publishingTenantIds();
  const ent = await db.execute({
    sql: `SELECT m.chain AS chain, m.entity_domain AS entity_domain, e.proven_at AS proven_at,
                 e.tenant_id AS tenant_id
          FROM verified_address_mirror m
          JOIN verified_entities e ON e.id = m.entity_id
          WHERE m.status = 'verified' AND m.address = ?
            AND m.refreshed_at IS NOT NULL AND m.refreshed_at >= ?
            AND lower(e.tenant_id) IN (${publishers.map(() => '?').join(', ')})
          ORDER BY e.proven_at ASC, m.entity_id ASC
          LIMIT 1`,
    args: [normalized, staleCutoffUtc(), ...publishers],
  });
  const approvedRow = (ent.rows as any[])[0];
  const key = addressKey(rawValue);
  if (approvedRow && canPublishEntities(String(approvedRow.tenant_id ?? ''))) {
    const r = approvedRow;
    // The guard's read-side half (G4): a merchant proof that landed after the platform's last
    // pull is not yet marked on the mirror, so ask once more here. Another account's proven
    // destination with the same claim identity makes this a dispute, answered as nobody (G3).
    // The platform's own account may prove and list the same address: that is one party.
    if (await provenByAnotherAccount(key, String(r.tenant_id))) return disputedHit(r.chain);
    // Entity mirror = domain-published by definition → Verified. "Since" = when the
    // entity proved its domain (verified_entities.proven_at).
    return {
      source: 'entity', level: 'verified', since: r.proven_at ? String(r.proven_at) : null,
      domain: String(r.entity_domain), provingDomain: String(r.entity_domain),
      label: null, chain: r.chain ? String(r.chain) : null,
    };
  }

  // 2) Proven merchant destinations (self-send / domain proof). Claim-once (the index, and the
  //    canonical claim guard on every flip and anchor) lets only one account prove a wallet, so
  //    the match is normally one account. The freeform label is not even read: only the
  //    account's domain-verified business name can leave here, never tenant_id or any identity.
  //    Matched on addressKey, the key the claim guard uses: an EVM or segwit address in any
  //    letter case is one wallet ('BC1Q…', the QR form, is 'bc1q…'); base58 stays exact. The SQL
  //    finds every case spelling (lower(value) = key) and the key compare in code decides.
  await ensureVerifyTables();
  const dest = await db.execute({
    sql: `SELECT tenant_id, rail, value, proof_method, proof_domain, proven_at, domain_anchored_at, last_confirmed_at FROM verify_destinations
          WHERE kind = 'address' AND proof_status = 'proven' AND (value = ? OR lower(value) = ?)
          ORDER BY proven_at ASC, id ASC`,
    args: [key, key],
  });
  const matches = (dest.rows as any[]).filter((r) => addressKey(String(r.value)) === key);
  if (matches.length) {
    // The guard's other direction: a fresh list of an approved platform, another account's,
    // carries this address (as verified before its next pull, or already marked a conflict by
    // it). Two parties stand behind the address, so it answers as nobody (G3) until the listing
    // is withdrawn or the proof released. A stale list stops answering anything, as always.
    const holder = String(matches[0].tenant_id);
    if (await listedByAnotherPlatform(normalized, holder)) return disputedHit(String(matches[0].rail));
    // Fail-closed freshness: 'verified' also requires the anchor to have been POSITIVELY
    // re-confirmed by a domain proof within the max-stale window (Pass B still finds it in the
    // domain's file, or the owner proved the domain again; a published-page check never counts
    // for an address, see recordMonitorResult). If it has gone stale (file unreachable or
    // gone, or the monitor cron stalled), degrade verified→claimed: keep the proven-control
    // fact, drop the current-confirmation claim.
    // Under-claim, never over-claim — the same rule the entity mirror already enforces.
    // "Since" follows the level: a 'verified' address is as old as its domain anchor, never
    // its (possibly older) self-send proof — see merchantAddressAssurance.
    const str = (v: unknown): string | null => (v ? String(v) : null);
    const cutoff = staleCutoffUtc();
    const rate = (r: any) => merchantAddressAssurance({
      proofMethod: String(r.proof_method ?? ''),
      proofDomain: str(r.proof_domain),
      provenAt: str(r.proven_at),
      domainAnchoredAt: str(r.domain_anchored_at),
      lastConfirmedAt: str(r.last_confirmed_at),
    }, cutoff);
    // The answer is the earliest-proven account's (the claim-once holder), in a fixed order so
    // identical calls give identical answers. Within that account, its own rows for the same
    // wallet (another rail, case or URI wrapping) are all its claim: a Verified one answers.
    // Rows from two accounts are a claim the guard would not allow today (proven before it
    // existed): nothing can say whose domain stands behind the wallet, so no row lifts it to
    // Verified and no listing domain is shown.
    const ambiguous = matches.some((r) => String(r.tenant_id) !== holder);
    const own = matches.filter((r) => String(r.tenant_id) === holder);
    const hit = ambiguous ? own[0] : (own.find((r) => rate(r).level === 'verified') ?? own[0]);
    const { level, since } = ambiguous
      ? { level: 'claimed' as const, since: str(hit.proven_at) }
      : rate(hit);
    // The tenant's domain-verified business name (+ its anchor domain), if any. It is the
    // only name this answer carries: a freeform label can be a person's name. We expose only
    // the public name + domain — never tenant_id or any key.
    const vn = await verifiedNameForTenant(holder);
    // Verified iff THIS address is anchored to a proven domain (proof_domain set) — a
    // swapped address on a spoofed page would then fail the comparison. Control-only
    // proof (micro-deposit, no proof_domain) is Claimed, even if the operating business
    // is otherwise domain-known: the address itself isn't published anywhere to swap-check.
    const publishedDomain = !ambiguous && hit.proof_domain ? String(hit.proof_domain) : null;
    // C5: the domain that actually vouches for THIS wallet, never the account's business
    // name. Set only when the answer is truly 'verified' (fresh + anchored to
    // publishedDomain) — an agent (check.ts) or a public card (verifyPublicCard.ts) can
    // then compare against it directly without knowing any of the levels above.
    const provingDomain = level === 'verified' ? publishedDomain : null;
    return {
      source: 'merchant',
      level,
      since,
      domain: vn?.domain ?? publishedDomain,
      provingDomain,
      label: vn?.name ?? null,
      chain: String(hit.rail),
    };
  }
  return null;
}

/** The answer for an address two accounts stand behind: nothing vouches, nobody is named. */
function disputedHit(chain: unknown): VerifiedAddressHit {
  return { source: 'conflict', level: 'disputed', since: null, domain: null, provingDomain: null, label: null, chain: chain ? String(chain) : null };
}

/**
 * Does an account other than `exceptTenant` hold a proven destination with this address's claim
 * identity? The same prefilter-then-canonical-compare as isClaimedElsewhere; here the key is the
 * lookup's own (addressKey), so the guard can never see two wallets where the lookup sees one.
 */
async function provenByAnotherAccount(key: string, exceptTenant: string): Promise<boolean> {
  if (!key) return false;
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT value FROM verify_destinations
          WHERE kind = 'address' AND proof_status = 'proven' AND tenant_id <> ? AND lower(value) = ?`,
    args: [exceptTenant, key.toLowerCase()],
  });
  return (res.rows as any[]).some((r) => addressKey(String(r.value)) === key);
}

/**
 * Does a fresh list of an approved platform, other than `exceptTenant`'s, carry this address,
 * whether it is still mirrored as verified or already marked a conflict? Reads the same rows the
 * platform branch reads, with the conflict rows added.
 */
async function listedByAnotherPlatform(normalized: string, exceptTenant: string): Promise<boolean> {
  const publishers = publishingTenantIds();
  const res = await db.execute({
    sql: `SELECT 1 AS one FROM verified_address_mirror m
          JOIN verified_entities e ON e.id = m.entity_id
          WHERE m.address = ? AND m.status IN ('verified', 'conflict')
            AND m.refreshed_at IS NOT NULL AND m.refreshed_at >= ?
            AND lower(e.tenant_id) IN (${publishers.map(() => '?').join(', ')})
            AND e.tenant_id <> ?
          LIMIT 1`,
    args: [normalized, staleCutoffUtc(), ...publishers, exceptTenant],
  });
  return res.rows.length > 0;
}

/**
 * PUBLIC, login-free lookup for a payment LINK / QR (kind='qr'): has a merchant
 * proven this URL is theirs by registering it in their own account (account_claim)?
 *
 * Same no-attribution rules as the address lookup: returns only the account's
 * domain-verified business name and its domain (never the freeform label) —
 * never the link's own host, which names the payment processor, not the merchant, and
 * never tenant_id or any legal identity. Claim-once guarantees at most one account owns a
 * proven URL, so the customer-scan match is unambiguous. The stored value is already
 * normalized on save; we normalize the query the same way and compare canonical forms.
 *
 * D6, still open: nothing here separately anchors a link to a domain the way an address's
 * .well-known file does (recordProofResult), so `level` rests entirely on the account
 * holding SOME verified business name — not on that name's domain vouching for THIS link.
 * A future anchor step (listing the link's canonical value in the file, the same as an
 * address) would let `provingDomain` diverge from `domain` here the way it already can
 * for an address.
 */
export async function lookupVerifiedUrl(rawUrl: string): Promise<VerifiedAddressHit | null> {
  const normalized = normalizeDestinationValue(rawUrl);
  if (!normalized) return null;
  await ensureVerifyTables();
  const dest = await db.execute({
    sql: `SELECT tenant_id, rail, value, proven_at, monitor_url, last_confirmed_at FROM verify_destinations
          WHERE kind = 'qr' AND proof_status = 'proven'`,
    args: [],
  });
  const hit = (dest.rows as any[]).find((r) => normalizeDestinationValue(String(r.value)) === normalized);
  if (!hit) return null;
  const vn = await verifiedNameForTenant(String(hit.tenant_id));
  // A claimed link is control-proven (account_claim — and D6 already requires the account
  // to have had a proven domain before that could happen; see createDestination). Verified
  // only when the operating merchant is ITSELF domain-verified (an accountable anchor);
  // otherwise Claimed. Fail-closed: if the link is monitored (Pass C watches its published
  // page) and that check has gone stale, downgrade verified→claimed rather than keep
  // vouching a link we can no longer confirm is live.
  const monitored = hit.monitor_url != null;
  const confirmedAt = hit.last_confirmed_at ? String(hit.last_confirmed_at) : (hit.proven_at ? String(hit.proven_at) : null);
  const fresh = confirmedAt !== null && confirmedAt >= staleCutoffUtc();
  const level: 'verified' | 'claimed' = (vn?.domain && (!monitored || fresh)) ? 'verified' : 'claimed';
  // D6: never the link's own host (buy.stripe.com vouches for nobody in particular — it's
  // Stripe's domain, not the merchant's). domain/provingDomain are the SAME thing for a
  // link, because nothing yet separately anchors a link to a domain the way an address's
  // .well-known file does (see the deferred note where this function is documented).
  return {
    source: 'merchant', level,
    since: hit.proven_at ? String(hit.proven_at) : null,
    domain: vn?.domain ?? null, provingDomain: level === 'verified' ? (vn?.domain ?? null) : null,
    label: vn?.name ?? null, chain: 'url',
  };
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
 * stored endpoint + key, and whose tenant is approved to publish (a tenant that is not
 * approved is never refreshed, so its mirror lapses at the stale TTL). NOT tenant-scoped:
 * this is a privileged maintenance job (like monthly-digest), so it deliberately spans all
 * tenants. It returns only management fields, never the key.
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
  return (res.rows as any[])
    .filter(r => canPublishEntities(String(r.tenant_id ?? '')))
    .map(r => ({
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
  /** The guard's conflicts: entries newly marked a conflict by this pull, and ones no longer marked. */
  conflicts: { added: string[]; cleared: string[] };
}

/**
 * Re-pull one entity's live list (refreshing its mirror + `refreshed_at`) and report
 * which addresses were revoked vs added. On a failed pull the mirror is left intact —
 * the public lookup's max-stale TTL is what fails it safe, not a destructive delete.
 */
export async function monitorEntity(tenantId: string, id: string): Promise<EntityMonitorResult> {
  const none = { added: [] as string[], cleared: [] as string[] };
  if (!canPublishEntities(tenantId)) return { pull: { ok: false, code: ENTITY_NOT_APPROVED }, removed: [], added: [], conflicts: none };
  const read = async () => {
    const res = await db.execute({
      sql: `SELECT address, status FROM verified_address_mirror WHERE entity_id = ? AND tenant_id = ?`,
      args: [id, tenantId],
    });
    const all = new Set<string>();
    const conflicted = new Set<string>();
    for (const r of res.rows as any[]) {
      all.add(String(r.address));
      if (String(r.status) === 'conflict') conflicted.add(String(r.address));
    }
    return { all, conflicted };
  };
  const before = await read();
  const pull = await pullEntity(tenantId, id);
  if (!pull.ok) return { pull, removed: [], added: [], conflicts: none };
  const after = await read();
  const removed = [...before.all].filter(a => !after.all.has(a));
  const added = [...after.all].filter(a => !before.all.has(a));
  const conflicts = {
    added: [...after.conflicted].filter(a => !before.conflicted.has(a)),
    cleared: [...before.conflicted].filter(a => !after.conflicted.has(a)),
  };
  return { pull, removed, added, conflicts };
}
