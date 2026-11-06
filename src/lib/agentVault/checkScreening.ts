/**
 * The screening a keyed pre-send check runs on the address it was asked about (decided Nov 5, 2026:
 * "screen each check"): the public wallet checker's own screening, checkWallet in walletChecker.ts,
 * which asks the OFAC sanctions mirror, Chainalysis when a key is set, and the security screening
 * (GoPlus flags, known mixers and compromised contracts). The rules for what its answer adds up to
 * are trustPolicy.ts's summarizeChecks, the same ones "Add + Trust" uses; only the sanctions and
 * screening parts are taken here, because the check answers the Verify registry part itself.
 *
 *   pass     both ran and neither found anything.
 *   fail     either found something (a partial answer with a hit is still a hit).
 *   limited  something could not run: a source was down, the answer did not come within
 *            SCREEN_TIMEOUT_MS, the account's budget of checks (./checkBudget.ts) was used up, or the
 *            screening threw. Never read as a pass.
 *
 * In front of it sits the warm-address cache (./warmCache.ts). A hit answers `pass` at once, with
 * `cached: true` and the time of the screening it reuses; a miss screens fresh, and a fresh pass is
 * put in the cache. A fail or a limited answer is never put there, and a fail evicts the address.
 *
 * Never throws: a cache that cannot be read is a miss, a cache that cannot be written keeps nothing,
 * and a screening that fails is `limited`. Nothing here is logged about the address. The calls out
 * are injected (ScreeningDeps) so tests run with no network and no database.
 */
import type { WalletCheckResult } from '@/lib/walletChecker';
import { defaultCheckBudget } from './checkBudget';
import { summarizeChecks, type TrustHit, type TrustLimit, type TrustReadout } from './trustPolicy';

/** What one check's screening came to. */
export interface CheckScreening {
  result: 'pass' | 'fail' | 'limited';
  /** What the screening found: 'sanctioned' and the security flag names. Empty unless `fail`. */
  hits: TrustHit[];
  /** What could not run: 'sanctions' and/or 'screening'. */
  limits: TrustLimit[];
  /** When the screening was made: now for a fresh one, the original time for a cached one. Null when none ran. */
  checkedAt: string | null;
  /** True when this answer reused a screening from the warm-address cache. */
  cached: boolean;
  /** The full readout of a fresh screening, for writing a flag to the registry. Absent on a cached answer. */
  readout?: TrustReadout;
}

/** How long a check waits for a fresh screening before answering limited. */
export const SCREEN_TIMEOUT_MS = 12_000;

export interface ScreeningDeps {
  /** A fresh screening of one address: the public checker's checkWallet, never a remembered answer. */
  screen(address: string): Promise<WalletCheckResult>;
  /** The warm-address cache. */
  warm: {
    take(tenantId: string, address: string, now: Date): Promise<{ screenedAt: string } | null>;
    put(tenantId: string, address: string, screenedAt: string, now: Date): Promise<void>;
    evict(tenantId: string, address: string): Promise<void>;
  };
  /** Takes one check from the account's budget; false when it is used up. Accounts without a cap always get true. */
  spend(tenantId: string): Promise<boolean>;
  timeoutMs?: number;
}

const walletChecker = () => import('@/lib/walletChecker');
const warmCache = () => import('./warmCache');

export const defaultScreeningDeps: ScreeningDeps = {
  async screen(address) {
    const { checkWallet } = await walletChecker();
    return checkWallet(address);
  },
  warm: {
    take: async (t, a, now) => (await warmCache()).takeWarm(t, a, now),
    put: async (t, a, at, now) => (await warmCache()).putWarm(t, a, at, now),
    evict: async (t, a) => (await warmCache()).evictWarm(t, a),
  },
  async spend(tenantId) {
    const { getEntitlements } = await import('./entitlements');
    const { limits } = await getEntitlements(tenantId);
    return limits.addresses === null || defaultCheckBudget.spend(tenantId, 1);
  },
};

const SCREEN_LIMITS: ReadonlySet<TrustLimit> = new Set(['sanctions', 'screening']);

/**
 * The screening's part of a readout: hits and limits from sanctions and screening only. Pure. The
 * Verify part of summarizeChecks is left out (the check answers it from the registry it already read).
 */
export function screeningOf(wallet: WalletCheckResult | null, checkedAt: string): { result: CheckScreening['result']; hits: TrustHit[]; limits: TrustLimit[]; readout: TrustReadout } {
  const readout = summarizeChecks({ wallet, verify: null, checkedAt });
  const hits = readout.hits.filter((h) => h !== 'claimedElsewhere');
  const limits = readout.limits.filter((l) => SCREEN_LIMITS.has(l));
  return { result: hits.length ? 'fail' : limits.length ? 'limited' : 'pass', hits, limits, readout };
}

/** The time a fresh screening says it was made, if it is a real time no later than now; else now. */
function screenedTime(raw: unknown, now: Date): string {
  const t = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t).toISOString() : now.toISOString();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('screening timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const NOT_RUN: CheckScreening = { result: 'limited', hits: [], limits: ['sanctions', 'screening'], checkedAt: null, cached: false };

/** The screening for one keyed check on one account. Never throws. */
export async function screenForCheck(tenantId: string, address: string, now: Date, deps: ScreeningDeps = defaultScreeningDeps): Promise<CheckScreening> {
  try {
    const warm = await deps.warm.take(tenantId, address, now);
    if (warm) return { result: 'pass', hits: [], limits: [], checkedAt: warm.screenedAt, cached: true };
  } catch {
    // A cache that cannot be read is a miss: screen fresh.
  }

  let spent: boolean;
  try {
    spent = await deps.spend(tenantId);
  } catch {
    spent = false;
  }
  if (!spent) return { ...NOT_RUN };

  let wallet: WalletCheckResult | null = null;
  try {
    wallet = await withTimeout(deps.screen(address), deps.timeoutMs ?? SCREEN_TIMEOUT_MS);
  } catch {
    wallet = null;
  }
  const checkedAt = wallet ? screenedTime(wallet.checkedAt, now) : now.toISOString();
  let screening: ReturnType<typeof screeningOf>;
  try {
    screening = screeningOf(wallet, checkedAt);
  } catch {
    // An answer in a shape we do not recognize is an answer we cannot use: the screening did not run.
    screening = screeningOf(null, checkedAt);
  }
  const out: CheckScreening = { result: screening.result, hits: screening.hits, limits: screening.limits, checkedAt: wallet ? checkedAt : null, cached: false, readout: screening.readout };

  try {
    if (out.result === 'pass') await deps.warm.put(tenantId, address, checkedAt, now);
    else if (out.result === 'fail') await deps.warm.evict(tenantId, address);
  } catch {
    // Nothing kept, or nothing to forget: the answer stands either way.
  }
  return out;
}
