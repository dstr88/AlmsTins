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
 * Every keyed check on a tin is also screened (./checkScreening.ts): the public wallet checker's
 * sanctions and security screening, asked about the address at check time. A screening that finds
 * something flags the answer on the spot (basis `screening_flagged`), and an address in the tin's
 * registry is flagged there too, with the same ratchet a re-check uses. A screening that passed
 * moments ago is reused from the warm-address cache (./warmCache.ts): the check still answers and is
 * still written, and its entry says `cached: true`, when the reused screening was made, and when it
 * was served. A screening that could not run (`limited`) changes no answer; the block and the
 * entry say so, and the address is not cached.
 *
 * When the answer is `flagged` for an address that IS in the tin's registry, the operator is told
 * at once, if the account turned alerts on (./alerts.ts). That starts after the event is written
 * and is not waited for: the answer and the `vault` block are fixed before it runs, and nothing it
 * does, however it fails or however long it takes, can change a byte of either. A flag on an
 * address that is not in the registry does not alert; it shows in the report's "not confirmed"
 * group.
 *
 * On the Free plan an agent has a limit on the checks written to its ledger in one UTC day
 * (FREE_LOGGED_CHECKS_PER_DAY, ./entitlements.ts). Past it the check still answers, in full, and the
 * block says `logged: false` with the reason `log_limit`: nothing is written, so a key looped on cannot
 * fill the ledger, and the operator is still alerted about a flagged registered address. Two things keep
 * that from hiding what happened. The check that finds the day full is written, with a marker in its
 * detail (`limit.reached`), so the ledger, the report and the export show the moment the day was cut. And
 * a check that comes back FLAGGED is still written past the limit, up to FLAGGED_LOGGED_PAST_LIMIT more,
 * so a loop on a key cannot use the day's recording up and leave the real flags unrecorded. The owner's
 * account has no limit.
 *
 * Anonymous calls and keys that are not linked to a tin never reach this code. A failure here
 * never changes the check's own answer: the caller gets `logged: false`, or an answer of nulls
 * when the registry could not even be read, and the failure is logged by name and code only (a
 * database error message can carry the values it was given).
 */
import { hashWithSalt } from '@/lib/analytics/hash';
import { db } from '@/lib/db';
import { normalizeAddress, type VaultChain } from './addresses';
import { alertKindOf, type CheckAlertInfo } from './alerts';
import { FLAGGED_LOGGED_PAST_LIMIT, getLoggedChecksPerDay } from './entitlements';
import { countCheckedSince, hasPriorCheck, insertCheckedEvent, limitMarkerSince, type LedgerEvent, type RegistryVerdict, type VaultAnswer } from './events';
import { defaultScreeningDeps, screenForCheck, type CheckScreening, type ScreeningDeps } from './checkScreening';
import { findLiveTinByKey, listDestinationsByAddress, recordTrust } from './store';
import type { TrustStatus } from './trustPolicy';

/** The public check's own statuses (GET /api/verify/check), as it answers them. */
export type CheckStatus = 'proven' | 'mismatch' | 'unanchored' | 'unknown';

export type AnswerBasis =
  | 'registry_flagged'
  | 'screening_flagged'
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
 *   the check's screening found something -> flagged (sanctions or a security flag, whatever the registry says)
 *   public status mismatch           -> flagged (proven by a different domain than the one expected)
 *   not in the registry              -> unknown, not cleared
 *   in the registry, still pending   -> unknown, not cleared
 *   trusted and domain-proven        -> proven, cleared
 *   trusted and asked about before   -> consistent-with-history, cleared (sameness, never ownership)
 *   trusted, first check             -> unknown, cleared (the owner's say-so is the only support yet)
 */
export function deriveAnswer(input: { status: CheckStatus; registry: RegistryVerdict; checkedBefore: boolean; screening?: CheckScreening['result'] }): DerivedAnswer {
  const { status, registry, checkedBefore } = input;
  if (registry === 'flagged') return { answer: 'flagged', basis: 'registry_flagged', cleared: false, history: 'none' };
  if (input.screening === 'fail') return { answer: 'flagged', basis: 'screening_flagged', cleared: false, history: 'none' };
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

/** The start of the UTC day of `d`, as the ledger stores times: `2026-10-19T00:00:00.000Z`. */
export function utcDayStart(d: Date): string {
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
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

// Whether an agent's day already has its limit marker. Once it does it always will, so a process remembers it
// and asks the ledger only about the first check that finds a day full. Within one process exactly one check
// writes the marker: the callers that find the day full at the same moment share one lookup, and the first to
// continue claims the marker before it writes (no await between the test and the claim). Two processes can each
// write one for a day; the ledger shows the earlier, and an extra marker costs one row.
const MARKED = new Map<string, true>();
const LOOKING = new Map<string, Promise<boolean>>();
const MARKED_LIMIT = 2_000;

/** True for exactly one caller in this process per agent and day: the one that must write the marker. */
async function claimLimitMarker(tenantId: string, tinId: string, day: string): Promise<boolean> {
  const key = `${tinId}|${day}`;
  if (MARKED.has(key)) return false;
  let lookup = LOOKING.get(key);
  if (!lookup) {
    lookup = limitMarkerSince(tenantId, tinId, day).then((at) => at !== null);
    LOOKING.set(key, lookup);
    void lookup.then(
      () => LOOKING.delete(key),
      () => LOOKING.delete(key),
    );
  }
  if (await lookup) {
    rememberLimitMarked(key);
    return false;
  }
  if (MARKED.has(key)) return false; // another caller of this process claimed it while this one waited
  rememberLimitMarked(key);
  return true;
}

function rememberLimitMarked(key: string): void {
  if (MARKED.size >= MARKED_LIMIT) MARKED.clear();
  MARKED.set(key, true);
}

/** For tests: forget cached key-to-account lookups. */
export function _clearKeyTenantCache(): void {
  TENANT_CACHE.clear();
  MARKED.clear();
  LOOKING.clear();
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
  /** The caller's address as the rate limiter sees it. It is kept only as a salted one-way hash, never as the address (see recordKeyedCheck). */
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
  /**
   * The check's screening of the address: `pass`, `fail` or `limited`; when it was made; and whether it
   * was reused from the warm-address cache (`cached: true`, made up to ten minutes before this check).
   */
  screening: { result: CheckScreening['result']; checkedAt: string | null; cached: boolean } | null;
  /** Present only when the check was answered and deliberately not written: the agent's daily limit on recorded checks was reached. */
  reason?: 'log_limit';
}

const NO_ANSWER: VaultBlock = { cleared: null, answer: null, registry: null, history: null, eventId: null, logged: false, screening: null };

function logFailure(stage: 'read' | 'write' | 'flag' | 'evict', err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-vault] keyed check not logged', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/** What recordKeyedCheck calls out to. Replaced in tests; the defaults are the real thing. */
export interface KeyedCheckDeps {
  /** Tells the operator about a check that was not answered proven. Not waited for, and its failure is only logged. */
  onAlert?: (info: CheckAlertInfo) => unknown;
  /** The check's screening and the warm-address cache (./checkScreening.ts). */
  screening?: ScreeningDeps;
  /** Writes a flag to a registered destination (store.ts recordTrust, whose ratchet keeps a flag a flag). */
  recordTrust?: typeof recordTrust;
}

/** A destination's stored check time: `YYYY-MM-DD HH:MM:SS`, as vault.ts writes it. */
const storedTime = (iso: string): string => iso.slice(0, 19).replace('T', ' ');

const sendAlert = (info: CheckAlertInfo): Promise<unknown> => import('./alerts').then((m) => m.alertCheck(info));

/**
 * Starts the alert for a check that was not answered proven (./alerts.ts says which email, and when)
 * and returns at once. A proven answer starts nothing. It never throws and returns nothing the answer
 * depends on: it is called after the event is written, a failure (a rejected promise, a throw, a
 * module that will not load) is logged by name and code only, and a slow one only runs on in the
 * background.
 */
function notifyAlert(at: Omit<CheckAlertInfo, 'kind'>, basis: string, status: string, deps: KeyedCheckDeps): void {
  const logAlertFailure = (err: unknown) => {
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[agent-vault] alert not started', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
  };
  try {
    const kind = alertKindOf(basis, status);
    if (!kind) return;
    const info: CheckAlertInfo = { ...at, kind };
    const run = deps.onAlert ?? sendAlert;
    void Promise.resolve()
      .then(() => run(info))
      .catch(logAlertFailure);
  } catch (err) {
    logAlertFailure(err);
  }
}

/**
 * Records a keyed check on the tin its key is linked to. Null when there is nothing to add (the
 * key is not linked to a live tin). Never throws.
 */
export async function recordKeyedCheck(input: KeyedCheckInput, deps: KeyedCheckDeps = {}): Promise<VaultBlock | null> {
  let tenantId: string;
  let tinId: string;
  let address: string;
  let chain: VaultChain | null;
  let derived: DerivedAnswer;
  let registry: RegistryVerdict;
  let rows: Awaited<ReturnType<typeof listDestinationsByAddress>>;
  let checkedBefore: boolean;
  try {
    const owner = await keyTenant(input.keyId);
    if (!owner) return null;
    const tin = await findLiveTinByKey(owner, input.keyId);
    if (!tin) return null;
    tenantId = owner;
    tinId = tin.id;
    address = eventAddress(input.value);
    rows = await listDestinationsByAddress(tenantId, tinId, address);
    registry = registryVerdict(rows);
    chain = rows[0]?.chain ?? null;
    checkedBefore = await hasPriorCheck(tenantId, tinId, address);
  } catch (err) {
    logFailure('read', err);
    return { ...NO_ANSWER };
  }

  // The screening, from the warm-address cache when it may answer. Never throws.
  const screeningDeps = deps.screening ?? defaultScreeningDeps;
  const screening = await screenForCheck(tenantId, address, input.now, screeningDeps);
  derived = deriveAnswer({ status: input.status, registry, checkedBefore, screening: screening.result });

  // A fresh screening that found something flags a registered address on the spot, as a re-check would.
  // A failure here is logged and changes nothing about the answer, which is already flagged. The readout
  // written with it shows Verify as unavailable: the check answers Verify itself and did not ask it here.
  // This check's own entry keeps the registry's word as it was read, before this flag.
  if (screening.result === 'fail' && screening.readout) {
    const write = deps.recordTrust ?? recordTrust;
    const checkedAt = storedTime(screening.readout.checkedAt);
    for (const row of rows) {
      if (row.trustStatus === 'flagged') continue;
      try {
        await write(tenantId, row.id, { status: 'flagged', readout: screening.readout, checkedAt });
      } catch (err) {
        logFailure('flag', err);
      }
    }
  }
  // Any flag evicts: a flagged answer is never served from the cache, now or on the next check.
  if (derived.answer === 'flagged' && screening.result !== 'fail') {
    try {
      await screeningDeps.warm.evict(tenantId, address);
    } catch (err) {
      logFailure('evict', err);
    }
  }

  const block = {
    cleared: derived.cleared,
    answer: derived.answer,
    registry,
    history: derived.history,
    screening: { result: screening.result, checkedAt: screening.checkedAt, cached: screening.cached },
  };

  // The daily limit on recorded checks. A failure to count it is not a reason to change the answer or to
  // refuse to record: it is logged, and the check is written as it would be without a limit.
  const day = utcDayStart(input.now);
  let overLimit = false;
  let marksLimit = false;
  let perDay: number | null = null;
  try {
    perDay = await getLoggedChecksPerDay(tenantId);
    if (perDay !== null) {
      const recorded = await countCheckedSince(tenantId, tinId, day);
      if (recorded >= perDay) {
        if (await claimLimitMarker(tenantId, tinId, day)) {
          // The first check to find the day full is written, with the marker that says so.
          marksLimit = true;
        } else if (derived.answer === 'flagged' && recorded < perDay + FLAGGED_LOGGED_PAST_LIMIT) {
          // A flag is still recorded (see FLAGGED_LOGGED_PAST_LIMIT).
        } else {
          overLimit = true;
        }
      }
    }
  } catch (err) {
    logFailure('read', err);
  }
  if (overLimit) {
    // Nothing is written, but the operator is still told (the alert has its own hourly claim).
    notifyAlert({ tenantId, tinId, address }, derived.basis, input.status, deps);
    return { ...block, eventId: null, logged: false, reason: 'log_limit' };
  }

  let event: LedgerEvent;
  try {
    event = await insertCheckedEvent(tenantId, {
      tinId,
      address,
      chain,
      answer: derived.answer,
      registry,
      status: input.status,
      keyId: input.keyId,
      // Never the address itself: the same salted one-way hash the public checkers' logs keep (the
      // privacy policy promises no less). It can still tell "the same caller" from "another caller".
      sourceIp: input.sourceIp ? hashWithSalt(input.sourceIp.slice(0, 64)) : null,
      detail: {
        basis: derived.basis,
        cleared: derived.cleared,
        history: derived.history,
        level: input.level,
        domain: input.domain,
        proofAgeDays: input.proofAgeDays,
        // The screening behind this answer. A cached one keeps the time it was made, and says when it was served.
        screening: {
          result: screening.result,
          hits: screening.hits,
          limits: screening.limits,
          checkedAt: screening.checkedAt,
          cached: screening.cached,
          ...(screening.cached ? { servedAt: input.now.toISOString() } : {}),
        },
        ...(marksLimit && perDay !== null ? { limit: { reached: true, perDay } } : {}),
      },
      at: input.now.toISOString(),
    });
  } catch (err) {
    logFailure('write', err);
    if (marksLimit) MARKED.delete(`${tinId}|${day}`); // the marker was not written: the next check that finds the day full writes it
    return { ...block, eventId: null, logged: false };
  }
  // After the event is written, outside the try above, so nothing in the alert can turn a written
  // check into `logged: false` or touch the answer.
  notifyAlert({ tenantId, tinId, address }, derived.basis, input.status, deps);
  return { ...block, eventId: event.id, logged: true };
}
