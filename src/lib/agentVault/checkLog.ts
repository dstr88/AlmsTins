/**
 * What a keyed pre-send check leaves behind on the owner's tin.
 *
 * GET /api/verify/check already answers an agent about an address from Verify's proof registry.
 * When the agent presents an API key and that key is linked to one of the owner's tins, this adds
 * two things, and changes nothing else about the answer:
 *
 *   1. A `checked` event in the tin's ledger (./events.ts): this address, this time, what was
 *      answered and why. Every keyed check is written, including one for an address that is NOT in
 *      the tin's registry. That records that the agent asked; it does not watch the address, it
 *      costs no slot, and it is how an attempted swap leaves evidence.
 *   2. A `vault` block in the answer: whether the address is in this tin's registry, what the
 *      tin's own history says, and whether it is `cleared`.
 *
 * The registry is the owner's vetted list. An address that is not in it never clears, whatever the
 * public proof says: the public `status` is a fact about the address, `cleared` is about this tin.
 * "Cleared" here means what a Pass pill means in the registry: the address is on the owner's
 * trusted list and nothing we ran flagged it. It is never a statement that an address is safe.
 *
 * Anonymous calls and keys that are not linked to a tin never reach this code. A failure here
 * never changes the check's own answer: the caller gets `logged: false`, or an answer of nulls
 * when the registry could not even be read, and the failure is logged by name and code only (a
 * database error message can carry the values it was given).
 */
import { db } from '@/lib/db';
import { normalizeAddress, type VaultChain } from './addresses';
import { hasPriorCheck, insertCheckedEvent, type RegistryVerdict, type VaultAnswer } from './events';
import { findLiveTinByKey, listDestinationsByAddress } from './store';
import type { TrustStatus } from './trustPolicy';

/** The public check's own statuses (GET /api/verify/check), as it answers them. */
export type CheckStatus = 'proven' | 'mismatch' | 'unanchored' | 'unknown';

export type AnswerBasis =
  | 'registry_flagged'
  | 'domain_mismatch'
  | 'not_in_registry'
  | 'registry_pending'
  | 'domain_proof'
  | 'registered_and_checked_before'
  | 'registered_first_check';

/** The registry's word for an address across the chains the owner may have listed it on: a flag wins, then trusted, then pending. */
export function registryVerdict(rows: ReadonlyArray<{ trustStatus: TrustStatus }>): RegistryVerdict {
  if (rows.some((r) => r.trustStatus === 'flagged')) return 'flagged';
  if (rows.some((r) => r.trustStatus === 'trusted')) return 'trusted';
  return rows.length ? 'pending' : 'none';
}

export interface DerivedAnswer {
  answer: VaultAnswer;
  basis: AnswerBasis;
  /** On the owner's trusted list and nothing we ran flagged it. Not a statement that the address is safe. */
  cleared: boolean;
  /** `consistent` when the tin's own record supports the address: trusted, and asked about before. */
  history: 'consistent' | 'none';
}

/**
 * The tin's answer for one check, from the public status, the registry's word and the tin's own
 * record. Pure, so every row of the table is unit-tested.
 *
 *   flagged in the registry          -> flagged (a flag is a ratchet; nothing else outranks it)
 *   public status mismatch           -> flagged (proven by a different domain than the one expected)
 *   not in the registry              -> unknown, not cleared
 *   in the registry, still pending   -> unknown, not cleared
 *   trusted and domain-proven        -> proven, cleared
 *   trusted and asked about before   -> consistent-with-history, cleared (sameness, never ownership)
 *   trusted, first check             -> unknown, cleared (the owner's say-so is the only support yet)
 */
export function deriveAnswer(input: { status: CheckStatus; registry: RegistryVerdict; checkedBefore: boolean }): DerivedAnswer {
  const { status, registry, checkedBefore } = input;
  if (registry === 'flagged') return { answer: 'flagged', basis: 'registry_flagged', cleared: false, history: 'none' };
  if (status === 'mismatch') return { answer: 'flagged', basis: 'domain_mismatch', cleared: false, history: 'none' };
  if (registry === 'none') return { answer: 'unknown', basis: 'not_in_registry', cleared: false, history: 'none' };
  if (registry === 'pending') return { answer: 'unknown', basis: 'registry_pending', cleared: false, history: 'none' };
  const history = checkedBefore ? 'consistent' : 'none';
  if (status === 'proven') return { answer: 'proven', basis: 'domain_proof', cleared: true, history };
  if (checkedBefore) return { answer: 'consistent-with-history', basis: 'registered_and_checked_before', cleared: true, history };
  return { answer: 'unknown', basis: 'registered_first_check', cleared: true, history };
}

/** The ledger's form of an address: lowercase for an EVM address, as given (trimmed) for any other. */
export function eventAddress(raw: string): string {
  const s = String(raw ?? '').trim();
  return normalizeAddress('ethereum', s) ?? s;
}

// A key's account never changes, so the lookup is cached; a miss is held only briefly.
const TENANT_CACHE = new Map<string, { tenantId: string | null; expiresAt: number }>();
const HIT_TTL_MS = 10 * 60_000;
const MISS_TTL_MS = 5_000;
const CACHE_LIMIT = 5_000;

async function keyTenant(keyId: string): Promise<string | null> {
  const cached = TENANT_CACHE.get(keyId);
  if (cached && Date.now() < cached.expiresAt) return cached.tenantId;
  const r = await db.execute({ sql: `SELECT tenant_id FROM verify_agent_keys WHERE id = ? LIMIT 1`, args: [keyId] });
  const tenantId = r.rows.length ? String((r.rows[0] as any).tenant_id) : null;
  if (TENANT_CACHE.size >= CACHE_LIMIT) TENANT_CACHE.clear();
  TENANT_CACHE.set(keyId, { tenantId, expiresAt: Date.now() + (tenantId ? HIT_TTL_MS : MISS_TTL_MS) });
  return tenantId;
}

/** For tests: forget cached key-to-account lookups. */
export function _clearKeyTenantCache(): void {
  TENANT_CACHE.clear();
}

export interface KeyedCheckInput {
  /** The authenticated key's id. */
  keyId: string;
  /** The address as the agent asked about it. */
  value: string;
  status: CheckStatus;
  level: string | null;
  domain: string | null;
  proofAgeDays: number | null;
  sourceIp: string | null;
  now: Date;
}

/** The block added to a keyed answer. Nulls mean "no answer": treat it as not cleared. */
export interface VaultBlock {
  cleared: boolean | null;
  answer: VaultAnswer | null;
  registry: RegistryVerdict | null;
  history: 'consistent' | 'none' | null;
  /** The ledger event this check was written as, or null when it could not be written. */
  eventId: string | null;
  logged: boolean;
}

const NO_ANSWER: VaultBlock = { cleared: null, answer: null, registry: null, history: null, eventId: null, logged: false };

function logFailure(stage: 'read' | 'write', err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-vault] keyed check not logged', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/**
 * Records a keyed check on the tin its key is linked to. Null when there is nothing to add (the
 * key is not linked to a live tin). Never throws.
 */
export async function recordKeyedCheck(input: KeyedCheckInput): Promise<VaultBlock | null> {
  let tenantId: string;
  let tinId: string;
  let address: string;
  let chain: VaultChain | null;
  let derived: DerivedAnswer;
  let registry: RegistryVerdict;
  try {
    const owner = await keyTenant(input.keyId);
    if (!owner) return null;
    const tin = await findLiveTinByKey(owner, input.keyId);
    if (!tin) return null;
    tenantId = owner;
    tinId = tin.id;
    address = eventAddress(input.value);
    const rows = await listDestinationsByAddress(tenantId, tinId, address);
    registry = registryVerdict(rows);
    chain = rows[0]?.chain ?? null;
    const checkedBefore = await hasPriorCheck(tenantId, tinId, address);
    derived = deriveAnswer({ status: input.status, registry, checkedBefore });
  } catch (err) {
    logFailure('read', err);
    return { ...NO_ANSWER };
  }

  const block = { cleared: derived.cleared, answer: derived.answer, registry, history: derived.history };
  try {
    const event = await insertCheckedEvent(tenantId, {
      tinId,
      address,
      chain,
      answer: derived.answer,
      registry,
      status: input.status,
      keyId: input.keyId,
      sourceIp: input.sourceIp ? input.sourceIp.slice(0, 64) : null,
      detail: {
        basis: derived.basis,
        cleared: derived.cleared,
        history: derived.history,
        level: input.level,
        domain: input.domain,
        proofAgeDays: input.proofAgeDays,
      },
      at: input.now.toISOString(),
    });
    return { ...block, eventId: event.id, logged: true };
  } catch (err) {
    logFailure('write', err);
    return { ...block, eventId: null, logged: false };
  }
}
