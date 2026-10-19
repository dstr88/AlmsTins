/**
 * Runs the checks behind "Add + Trust". It reuses the checks the app already has and adds none:
 *
 *   - the public wallet checker (checkWallet in walletChecker.ts): the OFAC sanctions mirror,
 *     Chainalysis when a key is set, and the security screening (GoPlus flags, known mixers and
 *     compromised contracts, community scam reports);
 *   - the Verify registry, the same lookup the pre-send check answers from
 *     (lookupVerifiedAddress) plus the claim guard (isClaimedElsewhere), so an address another
 *     account has already proved control of is seen.
 *
 * What the answers add up to is decided by the pure ./trustPolicy.ts. This module only asks, with
 * bounded concurrency, and it never throws: a check that errors becomes a check that did not run
 * (the readout says Limited), never a pass. It logs nothing about the addresses it checks.
 *
 * The screening is the public checker's. A complete answer the Vault gets is kept in a memory of the
 * Vault's own for five minutes, for one account only (an account never reads what another's screenings
 * left behind), so adding the same address under a second agent does not ask the screening sources
 * again. An answer the public checker already holds (checked in the last five minutes, by anyone) may be
 * used too, and of the two the newer wins. A person asking to check an address again always gets a new
 * screening (`fresh`), and removing an address or an agent forgets the account's remembered answers, so
 * adding an address back, which is how a flagged one is checked again, is a new screening as well. Adds
 * and re-checks are paced by the budget of checks (./checkBudget.ts). The public checker's cache is read
 * and never written: anyone can ask /api/wallet-check about an address and is told when it was last
 * checked, so an address written there would show when an account added or re-checked it. The memory is
 * per account for the same reason: an answer carries the time of its screening, and one account must not
 * learn from it when another asked. Only a complete answer is kept (every source the Vault relies on
 * ran); a partial one is never kept, so "Check again" asks again. A readout carries the time the
 * screening was made, not the time it was asked for, so an answer that came from memory says how old it is.
 *
 * The checks are injected (TrustDeps) so tests run with no network and no database; the defaults
 * load the real modules lazily, so the Vault's plain list and edit endpoints never pull in the
 * checker stack.
 */
import type { WalletCheckResult } from '@/lib/walletChecker';
import { defaultCheckBudget, type CheckBudget } from './checkBudget';
import { summarizeChecks, type TrustReadout, type VerifyLookup } from './trustPolicy';

export interface TrustDeps {
  /**
   * The public checker's answer for one normalized address. `fresh` asks for a new screening whatever
   * is remembered: it is what a person asking to check an address again means. `tenantId` is whose check
   * it is: what the Vault remembers is kept per account, and without one nothing is remembered or read
   * from memory.
   */
  wallet(address: string, opts?: { fresh?: boolean; tenantId?: string }): Promise<WalletCheckResult>;
  /** The Verify registry's answer for one address, as seen from this tenant. Throws if it cannot answer. */
  verify(tenantId: string, address: string): Promise<VerifyLookup>;
  now?(): Date;
  /**
   * How many addresses an account may have checked in a minute (./checkBudget.ts). Left out, nothing
   * is counted, which is what a test with no network wants; the defaults carry the real one.
   */
  budget?: CheckBudget;
}

/**
 * A public-checker answer that the Vault may keep and reuse: both checks it relies on ran for it,
 * the sanctions lists and the security screening. An answer missing either is a limited answer, and a
 * limited answer is asked for again each time rather than remembered for five minutes.
 */
export function isCompleteAnswer(r: Pick<WalletCheckResult, 'coverage'> | null | undefined): boolean {
  const c = r?.coverage;
  return !!c && c.sanctions === 'ran' && c.chainalysis !== 'error' && c.goplus === 'ran';
}

/** How long the Vault remembers a complete answer, and how many answers it remembers at once (all accounts together). */
export const REMEMBER_MS = 5 * 60_000;
export const REMEMBER_MAX = 500;
/** Keyed by account and address: an account only ever reads its own screenings. */
const remembered = new Map<string, { answer: WalletCheckResult; until: number }>();
const memoryKey = (tenantId: string, address: string): string => `${tenantId}\u0000${address}`;

/** Forgets every remembered answer. For tests. */
export function forgetAnswers(): void {
  remembered.clear();
}

/** Forgets what is remembered for one account. Called when the account removes an address or an agent. */
export function forgetAnswersOf(tenantId: string): void {
  const prefix = `${tenantId}\u0000`;
  for (const key of remembered.keys()) if (key.startsWith(prefix)) remembered.delete(key);
}

function remember(tenantId: string, address: string, answer: WalletCheckResult, now: number): void {
  const key = memoryKey(tenantId, address);
  if (remembered.size >= REMEMBER_MAX && !remembered.has(key)) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  remembered.delete(key); // a fresh entry goes to the back of the line
  remembered.set(key, { answer, until: now + REMEMBER_MS });
}

/** When an answer was made, as a number; -Infinity for one that does not say. */
function madeAt(answer: WalletCheckResult): number {
  const t = Date.parse(answer.checkedAt);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Of the two answers the Vault may reuse, the one made later; the account's own when they were made together. */
function newer(own: WalletCheckResult | null, shared: WalletCheckResult | null): WalletCheckResult | null {
  if (own && shared) return madeAt(shared) > madeAt(own) ? shared : own;
  return own ?? shared;
}

/** Loads a module on first use and shares that one load with every caller. A failed load is not remembered. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((e: unknown) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}

const walletChecker = lazy(() => import('@/lib/walletChecker'));
const verifyEntities = lazy(() => import('@/lib/verifyEntities'));
const verifyRegistry = lazy(() => import('@/lib/verifyRegistry'));

export const defaultTrustDeps: TrustDeps = {
  async wallet(address, opts) {
    const { checkWallet, getCached } = await walletChecker();
    const now = Date.now();
    const tenantId = opts?.tenantId;
    if (!opts?.fresh) {
      const mine = tenantId ? remembered.get(memoryKey(tenantId, address)) : undefined;
      const shared = getCached(address);
      const reuse = newer(mine && now < mine.until ? mine.answer : null, shared && isCompleteAnswer(shared) ? shared : null);
      if (reuse) return reuse;
    }
    const answer = await checkWallet(address);
    if (tenantId && isCompleteAnswer(answer)) remember(tenantId, address, answer, now);
    return answer;
  },
  async verify(tenantId, address) {
    const [{ lookupVerifiedAddress }, { isClaimedElsewhere }] = await Promise.all([verifyEntities(), verifyRegistry()]);
    const [hit, claimedElsewhere] = await Promise.all([
      lookupVerifiedAddress(address),
      isClaimedElsewhere(tenantId, 'address', address),
    ]);
    return {
      level: hit ? hit.level : null,
      domain: hit && hit.level === 'verified' ? hit.provingDomain : null,
      claimedElsewhere,
    };
  },
  budget: defaultCheckBudget,
};

/** How many addresses are checked at once. Each check makes several outside calls. */
export const CHECK_CONCURRENCY = 4;

/**
 * The time to put on a readout: when the screening was made, if that is stated and is not in the
 * future, else now. An answer that came from memory is up to five minutes old and says so; a fresh one
 * was made seconds ago, so the two read alike.
 */
function readoutTime(screened: unknown, now: Date): string {
  const t = typeof screened === 'string' ? Date.parse(screened) : Number.NaN;
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t).toISOString() : now.toISOString();
}

async function checkOne(tenantId: string, address: string, deps: TrustDeps, fresh: boolean): Promise<TrustReadout> {
  const [wallet, verify] = await Promise.allSettled([deps.wallet(address, fresh ? { fresh: true, tenantId } : { tenantId }), deps.verify(tenantId, address)]);
  const checkedAt = readoutTime(wallet.status === 'fulfilled' ? wallet.value?.checkedAt : null, deps.now ? deps.now() : new Date());
  const answers = {
    wallet: wallet.status === 'fulfilled' ? wallet.value : null,
    verify: verify.status === 'fulfilled' ? verify.value : null,
    checkedAt,
  };
  try {
    return summarizeChecks(answers);
  } catch {
    // An answer in a shape we do not recognize is an answer we cannot use: the check did not run.
    return summarizeChecks({ wallet: null, verify: null, checkedAt });
  }
}

/**
 * The readout for each distinct address, keyed by the address as given. Never throws; an address
 * whose checks fail comes back Limited. `fresh` asks for a new screening of every address, whatever
 * is remembered (a person asking to check them again); left out, a recent complete answer is used.
 */
export async function runTrustChecks(
  tenantId: string,
  addresses: readonly string[],
  deps: TrustDeps = defaultTrustDeps,
  opts: { fresh?: boolean } = {},
): Promise<Map<string, TrustReadout>> {
  const unique = [...new Set(addresses)];
  const readouts = new Map<string, TrustReadout>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= unique.length) return;
      const address = unique[index];
      readouts.set(address, await checkOne(tenantId, address, deps, opts.fresh === true));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, unique.length) }, worker));
  return readouts;
}
