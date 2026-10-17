/**
 * Agent Vault trust policy: what a destination's checks add up to. Pure (no database, no
 * network); the checks themselves are run by ./trustChecks.ts and reuse the app's existing ones.
 *
 * Words that mean exactly this and no more:
 *   - A destination is "trusted" when the OWNER asked for it to be and every check we ran came
 *     back without a hit. Trusted is the owner's designation. It is never a statement that the
 *     address is safe, legitimate or solvent.
 *   - The pill is Pass (cleared the checks we ran), Fail (a check we ran came back with a hit) or
 *     Limited (a check could not run, so nothing is claimed either way).
 *   - "Flagged" is a warning for the owner to review. Almstins verifies, warns and flags; the owner
 *     and the agent decide everything that moves.
 *
 * Fail-safe, the same rule walletChecker.ts applies to its own all-clear: a check that did not
 * run is not a check that passed. A sanctions lookup that failed (the OFAC mirror unreadable, or
 * Chainalysis asked and silent), a screening source that errored, or a Verify lookup that threw
 * leaves the pill Limited and the destination pending, never trusted.
 */
import type { WalletCheckResult } from '@/lib/walletChecker';

export type TrustStatus = 'trusted' | 'flagged' | 'pending';
export const TRUST_STATUSES: readonly TrustStatus[] = ['trusted', 'flagged', 'pending'];

/** The pill. */
export type TrustResult = 'pass' | 'fail' | 'limited';
export type CheckState = 'clear' | 'hit' | 'unavailable';
/** What the Verify registry knows about the address: domain-anchored, control-only, nothing, or the lookup failed. */
export type VerifyState = 'proven' | 'claimed' | 'unknown' | 'unavailable';

/** The walletChecker.ts flags that are security findings (sanctions is its own check, reported first). */
export const SECURITY_FLAGS = [
  'blacklisted', 'phishing', 'honeypotRelated', 'stealingAttack', 'darkwebTransactions',
  'cybercrime', 'moneyLaundering', 'financialCrime', 'blackmail', 'mixer',
] as const satisfies ReadonlyArray<keyof WalletCheckResult['flags']>;

export type TrustHit = 'sanctioned' | (typeof SECURITY_FLAGS)[number] | 'claimedElsewhere';
export type TrustLimit = 'sanctions' | 'screening' | 'verify';

const HIT_CODES: ReadonlySet<string> = new Set(['sanctioned', ...SECURITY_FLAGS, 'claimedElsewhere']);
const LIMIT_CODES: ReadonlySet<string> = new Set(['sanctions', 'screening', 'verify']);
const RESULTS: ReadonlySet<string> = new Set(['pass', 'fail', 'limited']);
const CHECK_STATES: ReadonlySet<string> = new Set(['clear', 'hit', 'unavailable']);
const VERIFY_STATES: ReadonlySet<string> = new Set(['proven', 'claimed', 'unknown', 'unavailable']);

/** The full readout behind a pill: which sources were asked, what each said, and what could not run. */
export interface TrustReadout {
  v: 1;
  /** ISO 8601, UTC. */
  checkedAt: string;
  result: TrustResult;
  /** Every check that came back with a hit. */
  hits: TrustHit[];
  /** Every check that could not run. */
  limits: TrustLimit[];
  /** OFAC mirror, plus Chainalysis and the screening source's own sanctions flag. */
  sanctions: CheckState;
  /** The security screening (blacklists, phishing, drainers, mixers, and so on). */
  screening: CheckState;
  /** The Verify registry's own state for this address. */
  verify: VerifyState;
  /** The domain that vouches for the address, only when verify is 'proven' (domain-anchored). */
  provenBy: string | null;
  /** Community scam reports on file (shown, never part of the pill, as in the public checker). */
  communityReports: number | null;
}

/** What the Verify registry says about an address, from the lookups the pre-send check already uses. */
export interface VerifyLookup {
  /** 'verified': anchored to a proven domain. 'claimed': control proven, no domain behind it. null: no record. */
  level: 'verified' | 'claimed' | null;
  /** The domain that vouches for the address (set only when level is 'verified'). */
  domain: string | null;
  /** Another account holds this address as a proven destination (isClaimedElsewhere). */
  claimedElsewhere: boolean;
}

export interface SummarizeInput {
  /** The public checker's answer, or null when it could not be reached. */
  wallet: WalletCheckResult | null;
  /** The Verify registry's answer, or null when the lookup failed. */
  verify: VerifyLookup | null;
  checkedAt: string;
}

/**
 * The readout for one address. The rules, in the order they are applied:
 *
 *   Sanctions   hit if any source says sanctioned; clear only if the OFAC mirror answered and
 *               Chainalysis, when asked, did not fail; otherwise unavailable.
 *   Screening   hit if any security flag fired (even in a partial answer: a hit is never
 *               cleared); clear only if the screening source ran; otherwise unavailable.
 *   Verify      proven (domain-anchored), claimed (control only), unknown, or unavailable. It is
 *               a hit only for "claimedElsewhere": another account proved control of this
 *               address and no domain stands behind it. Verify itself calls control without a
 *               domain a caution, not an endorsement, because a scammer can prove control of
 *               their own address. A domain-anchored address is shown as proven, never failed.
 *
 *   Fail if anything hit, else Limited if anything could not run, else Pass.
 */
export function summarizeChecks({ wallet, verify, checkedAt }: SummarizeInput): TrustReadout {
  const hits: TrustHit[] = [];
  const flags: Partial<WalletCheckResult['flags']> = wallet?.flags ?? {};
  const coverage: Partial<WalletCheckResult['coverage']> = wallet?.coverage ?? {};

  let sanctions: CheckState = 'unavailable';
  if (wallet) {
    if (flags.sanctioned === true) {
      sanctions = 'hit';
      hits.push('sanctioned');
    } else if (coverage.sanctions === 'ran' && coverage.chainalysis !== 'error') {
      sanctions = 'clear';
    }
  }

  let screening: CheckState = 'unavailable';
  if (wallet) {
    const fired = SECURITY_FLAGS.filter((flag) => flags[flag] === true);
    hits.push(...fired);
    screening = fired.length ? 'hit' : coverage.goplus === 'ran' ? 'clear' : 'unavailable';
  }

  let verifyState: VerifyState = 'unavailable';
  let provenBy: string | null = null;
  // An answer that is not the shape the lookup returns is an answer we cannot use: unavailable.
  if (verify && typeof verify.claimedElsewhere === 'boolean' && (verify.level === null || verify.level === 'verified' || verify.level === 'claimed')) {
    if (verify.level === 'verified') {
      verifyState = 'proven';
      provenBy = verify.domain ?? null;
    } else {
      verifyState = verify.level === 'claimed' ? 'claimed' : 'unknown';
    }
    if (verify.claimedElsewhere && verify.level !== 'verified') hits.push('claimedElsewhere');
  }

  const limits: TrustLimit[] = [];
  if (sanctions === 'unavailable') limits.push('sanctions');
  if (screening === 'unavailable') limits.push('screening');
  if (verifyState === 'unavailable') limits.push('verify');

  return {
    v: 1,
    checkedAt,
    result: hits.length ? 'fail' : limits.length ? 'limited' : 'pass',
    hits,
    limits,
    sanctions,
    screening,
    verify: verifyState,
    provenBy,
    communityReports: typeof wallet?.chainabuseReports === 'number' ? wallet.chainabuseReports : null,
  };
}

/**
 * The status a destination takes after a check. A flag is a ratchet: once flagged, a destination
 * stays flagged whatever a later check says, so a flaky or partial "all clear" can never quietly
 * clear a warning. The owner clears it by removing the destination and adding it again, which is
 * a new row and a fresh check.
 *
 *   Fail            -> flagged
 *   already flagged -> flagged
 *   Pass            -> trusted
 *   Limited         -> pending (nothing is claimed; check again)
 */
export function nextTrustStatus(previous: TrustStatus | null, readout: Pick<TrustReadout, 'result'>): TrustStatus {
  if (readout.result === 'fail') return 'flagged';
  if (previous === 'flagged') return 'flagged';
  return readout.result === 'pass' ? 'trusted' : 'pending';
}

/** A stored status, or 'pending' for anything unrecognized: a damaged value is never read as trusted. */
export function statusFromStored(raw: unknown): TrustStatus {
  return TRUST_STATUSES.includes(raw as TrustStatus) ? (raw as TrustStatus) : 'pending';
}

/**
 * A stored readout (trust_detail_json), or null when it is missing or not a readout this code
 * wrote. Rebuilt field by field, so nothing unrecognized is passed on.
 */
export function parseReadout(raw: unknown): TrustReadout | null {
  if (typeof raw !== 'string' || !raw) return null;
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || value.v !== 1) return null;
  const codes = (list: unknown, allowed: ReadonlySet<string>): string[] | null =>
    Array.isArray(list) && list.every((x) => typeof x === 'string' && allowed.has(x)) ? (list as string[]) : null;
  const hits = codes(value.hits, HIT_CODES);
  const limits = codes(value.limits, LIMIT_CODES);
  if (
    !hits || !limits ||
    typeof value.checkedAt !== 'string' ||
    !RESULTS.has(value.result) ||
    !CHECK_STATES.has(value.sanctions) ||
    !CHECK_STATES.has(value.screening) ||
    !VERIFY_STATES.has(value.verify)
  ) return null;
  return {
    v: 1,
    checkedAt: value.checkedAt,
    result: value.result,
    hits: hits as TrustHit[],
    limits: limits as TrustLimit[],
    sanctions: value.sanctions,
    screening: value.screening,
    verify: value.verify,
    provenBy: typeof value.provenBy === 'string' ? value.provenBy : null,
    communityReports: typeof value.communityReports === 'number' ? value.communityReports : null,
  };
}
