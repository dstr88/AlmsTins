/**
 * Almstins Verify — the cross-account guard for platform lists.
 *
 * A platform list (verifyEntities.ts) is a domain's own say-so: "these addresses are mine." A
 * merchant's proven destination (verifyRegistry.ts) is a control proof, usually a self-send, and
 * claim-once lets only one account hold it. Before this guard, a pulled list was mirrored as
 * Verified address by address, whatever anyone else had proven, and the public lookup answered the
 * platform first. So an approved platform that listed a merchant's proven address made the check
 * API say "proven, published by the platform" for an address the merchant proved control of.
 *
 * The rules (verify-platform-guard-spec.claude.md, decided Nov 8, 2026):
 *   G1  A control proof outranks a listing. A listed address that another account holds as a proven
 *       destination is a conflict with that merchant; the merchant's proof stands.
 *   G2  Two platforms, one address: the earlier-proven entity keeps it, the later entry is a conflict.
 *       Earlier is verified_entities.proven_at ascending, then entity id, the order the lookup uses.
 *   G3  A conflict answers as nobody (the lookup returns a disputed hit; verifyEntities.ts).
 *   G5  Nothing is deleted and nobody is named: a conflicted row stays, with a word for what it
 *       conflicts with ('merchant' or 'platform'), never a tenant id or a domain.
 *
 * The pure classifier is here with the identity helpers it reuses. classifyPulledList is the one
 * database read, two prefilter queries and the canonical compare in code, the same shape as
 * isClaimedElsewhere. It throws on a database error so a pull that cannot check writes nothing.
 */
import { db } from '@/lib/db';
import { addressKey, canAnchor, claimIdentity, sameClaimIdentity, type ClaimIdentity } from './verifyRegistry';
import { publishingTenantIds } from './verifyEntityAccess';

export type MirrorStatus = 'verified' | 'conflict';
export type ConflictWith = 'merchant' | 'platform';

export interface Classified {
  status: MirrorStatus;
  /** Set only when status is 'conflict'. A word, never a party. */
  conflictWith: ConflictWith | null;
}

export const VERIFIED: Classified = { status: 'verified', conflictWith: null };

/** The classifier, pure. `merchants` are other accounts' proven destinations; `earlierPlatforms` are
 *  verified entries of entities proven before this one. The merchant check comes first (G1). */
export function classifyListed(mine: ClaimIdentity, merchants: ClaimIdentity[], earlierPlatforms: ClaimIdentity[]): Classified {
  if (!mine.canonical) return VERIFIED;
  if (!canAnchor(mine, merchants)) return { status: 'conflict', conflictWith: 'merchant' };
  if (earlierPlatforms.some((p) => sameClaimIdentity(mine, p))) return { status: 'conflict', conflictWith: 'platform' };
  return VERIFIED;
}

/** The most addresses one prefilter query names, the same bound the roster editor pastes in. */
export const GUARD_CHUNK = 500;

export interface PulledAddress {
  address: string;
  chain: string;
}

export interface PullContext {
  tenantId: string;
  entityId: string;
  /** verified_entities.proven_at of the entity being pulled; null reads as the latest of all. */
  provenAt: string | null;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Other accounts' proven destinations whose stored value matches one of the pulled keys. The SQL
 * is a coarse prefilter on the lowercased value; the canonical compare in classifyListed decides.
 */
async function merchantIdentities(ctx: PullContext, keys: string[]): Promise<ClaimIdentity[]> {
  const out: ClaimIdentity[] = [];
  for (const part of chunks(keys, GUARD_CHUNK)) {
    const res = await db.execute({
      sql: `SELECT value FROM verify_destinations
            WHERE kind = 'address' AND proof_status = 'proven' AND tenant_id <> ?
              AND lower(value) IN (${part.map(() => '?').join(', ')})`,
      args: [ctx.tenantId, ...part.map((k) => k.toLowerCase())],
    });
    for (const r of res.rows as any[]) out.push(claimIdentity('address', String(r.value)));
  }
  return out;
}

/**
 * Verified entries of other, approved entities proven before this one (G2), matching one of the
 * pulled keys. An entity with no proven_at is treated as the latest, so every other list is earlier.
 */
async function earlierPlatformIdentities(ctx: PullContext, keys: string[]): Promise<ClaimIdentity[]> {
  const publishers = publishingTenantIds();
  const provenAt = ctx.provenAt ?? '9999-12-31 23:59:59';
  const out: ClaimIdentity[] = [];
  for (const part of chunks(keys, GUARD_CHUNK)) {
    const res = await db.execute({
      sql: `SELECT m.address AS address FROM verified_address_mirror m
            JOIN verified_entities e ON e.id = m.entity_id
            WHERE m.status = 'verified' AND m.entity_id <> ? AND e.proof_status = 'proven'
              AND (e.proven_at < ? OR (e.proven_at = ? AND m.entity_id < ?))
              AND lower(e.tenant_id) IN (${publishers.map(() => '?').join(', ')})
              AND lower(m.address) IN (${part.map(() => '?').join(', ')})`,
      args: [ctx.entityId, provenAt, provenAt, ctx.entityId, ...publishers, ...part.map((k) => k.toLowerCase())],
    });
    for (const r of res.rows as any[]) out.push(claimIdentity('address', String(r.address)));
  }
  return out;
}

/**
 * Classify every address of a pulled list, in the list's order. Reads the other parties once each
 * (two queries per 500 addresses), then decides in code. Throws on a database error: the caller
 * (pullEntity) then writes nothing, so a list that could not be checked never reaches the mirror.
 */
export async function classifyPulledList(ctx: PullContext, addresses: PulledAddress[]): Promise<Classified[]> {
  if (!addresses.length) return [];
  const mine = addresses.map((a) => claimIdentity('address', a.address));
  const keys = [...new Set(mine.map((m) => m.canonical).filter(Boolean))];
  if (!keys.length) return addresses.map(() => VERIFIED);
  const [merchants, earlier] = await Promise.all([
    merchantIdentities(ctx, keys),
    earlierPlatformIdentities(ctx, keys),
  ]);
  return mine.map((m) => classifyListed(m, merchants, earlier));
}

/** The canonical key of a looked-up address, exported so the lookup and the guard agree. */
export const guardKey = (value: string): string => addressKey(value);
