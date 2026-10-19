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
 * The screening is the public checker's, and so is its cache: an address checked in the last five
 * minutes, by anyone, is answered from that cache, so adding, removing and adding an address again
 * does not ask the screening sources each time. Only a complete answer is shared (every source the
 * Vault relies on ran); a partial one is never kept, so "Check again" always asks again.
 *
 * The checks are injected (TrustDeps) so tests run with no network and no database; the defaults
 * load the real modules lazily, so the Vault's plain list and edit endpoints never pull in the
 * checker stack.
 */
import type { WalletCheckResult } from '@/lib/walletChecker';
import { defaultCheckBudget, type CheckBudget } from './checkBudget';
import { summarizeChecks, type TrustReadout, type VerifyLookup } from './trustPolicy';

export interface TrustDeps {
  /** The public checker's answer for one normalized address. */
  wallet(address: string): Promise<WalletCheckResult>;
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
  async wallet(address) {
    const { checkWallet, getCached, setCache } = await walletChecker();
    const kept = getCached(address);
    if (kept && isCompleteAnswer(kept)) return kept;
    const answer = await checkWallet(address);
    if (isCompleteAnswer(answer)) setCache(address, answer);
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

async function checkOne(tenantId: string, address: string, deps: TrustDeps): Promise<TrustReadout> {
  const [wallet, verify] = await Promise.allSettled([deps.wallet(address), deps.verify(tenantId, address)]);
  const checkedAt = (deps.now ? deps.now() : new Date()).toISOString();
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
 * whose checks fail comes back Limited.
 */
export async function runTrustChecks(
  tenantId: string,
  addresses: readonly string[],
  deps: TrustDeps = defaultTrustDeps,
): Promise<Map<string, TrustReadout>> {
  const unique = [...new Set(addresses)];
  const readouts = new Map<string, TrustReadout>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= unique.length) return;
      const address = unique[index];
      readouts.set(address, await checkOne(tenantId, address, deps));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, unique.length) }, worker));
  return readouts;
}
