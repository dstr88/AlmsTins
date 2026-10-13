/**
 * walletActivity.ts — the shape of a wallet check's "Activity" facts, and the pure rules
 * for summarizing them. No imports and no I/O, so the browser (WalletChecker.tsx) and the
 * server (walletChecker.ts, evmActivity.ts) share one definition.
 *
 * Activity is a FACT shown to the person. It never feeds the scam score or the verdict:
 * a new wallet is not a bad one (exchange deposit addresses are fresh) and an old one is
 * not a safe one (aged wallets are bought, and build-then-burn exists). Nothing here may
 * be read by calculateScamScore() or the flags. Activity is served by its own endpoint
 * (/api/wallet-activity), so the verdict never waits for it.
 *
 * Honesty rule: a chain we could not read is "not checked", never "no activity". A dash
 * in the UI means unknown; "none found" is only shown when every chain we have a source
 * for was read. While a chain with a source is unread, the first activity found is only
 * "on or before", the last only "on or after", and a count only a minimum.
 */

/**
 * Why a chain was not checked.
 *   - 'no_source': we have no free source for it (Base, OP Mainnet, BNB Chain).
 *   - 'not_on_plan': the source refuses this chain for our API plan (a free Etherscan key
 *     on a paid-only chain) or does not support it. Retrying will not help.
 *   - 'not_configured': no API key, or the source rejected the key.
 *   - 'unavailable': the source failed this time (rate limit, timeout, outage). A later
 *     check may read it.
 * The first two are coverage gaps ("not covered yet"). The last two are reads that did not
 * happen ("could not be read right now"), so that chain's history is unknown.
 */
export type ActivityGapReason = 'no_source' | 'not_on_plan' | 'not_configured' | 'unavailable';

/**
 * Activity on one chain. `checked` is true when its history was read; a partial read is
 * still checked, with firstSeenComplete or lastActivityComplete set to false.
 */
export interface ActivityChain {
  /** Stable key, e.g. 'ethereum', 'polygon', 'sui'. */
  id: string;
  /** Display name (a proper noun, not translated), e.g. 'Ethereum', 'BNB Chain'. */
  name: string;
  checked: boolean;
  /** Set when not checked. A missing reason counts as 'unavailable' (fail closed). */
  reason?: ActivityGapReason;
  firstSeen: string | null;
  lastActivity: string | null;
  /** Transactions sent (EVM) or all transactions (Sui); null when it could not be read. */
  txCount: number | null;
  /** True when txCount is a lower bound (a capped query). */
  txCountIsMinimum?: boolean;
  /**
   * False when only part of the history was read (a capped query), so the true first
   * activity may be earlier than firstSeen. Absent means complete.
   */
  firstSeenComplete?: boolean;
  /**
   * False when the newest entries could not be read, so the true last activity may be
   * later than lastActivity. Absent means complete.
   */
  lastActivityComplete?: boolean;
}

/** WalletCheckResult['activity']. The optional fields are additive; older results lack them. */
export interface WalletActivity {
  /** Earliest activity across the chains checked. */
  firstSeen: string | null;
  /** Latest activity across the chains checked. */
  lastActivity: string | null;
  /** See txCountBasis. Summed over the chains checked. */
  txCount: number | null;
  totalReceivedEth: string | null;
  totalSentEth: string | null;
  /** Native balance: ETH on Ethereum for EVM addresses, "… SUI" for Sui. */
  ethBalance: string | null;
  /** Chain name where firstSeen was found. */
  firstSeenChain?: string | null;
  /** Chain name where lastActivity was found. */
  lastActivityChain?: string | null;
  /**
   * False when the true first activity may be earlier than firstSeen (or exist although
   * firstSeen is null): a chain with a source was not read, or a read was capped.
   */
  firstSeenComplete?: boolean;
  /** False when the true last activity may be later than lastActivity, for the same reasons. */
  lastActivityComplete?: boolean;
  /** 'sent' = transactions sent from the address (account nonce); 'all' = every transaction found. */
  txCountBasis?: 'sent' | 'all';
  /**
   * True when txCount is a lower bound: a capped query, a checked chain whose count was
   * unreadable, or a chain with a source that could not be read at all.
   */
  txCountIsMinimum?: boolean;
  /** Every chain considered, checked or not, in display order. */
  chains?: ActivityChain[];
}

export const NEW_WALLET_DAYS = 30;
const DAY_MS = 86_400_000;

export function emptyActivity(): WalletActivity {
  return {
    firstSeen: null, lastActivity: null, txCount: null,
    totalReceivedEth: null, totalSentEth: null, ethBalance: null,
  };
}

/** A chain we have no usable source for. Listed, but it never qualifies the facts found. */
export function isNotCovered(c: ActivityChain): boolean {
  return !c.checked && (c.reason === 'no_source' || c.reason === 'not_on_plan');
}

/** A chain with a source that was not read this time: its history is unknown. */
export function isUnread(c: ActivityChain): boolean {
  return !c.checked && !isNotCovered(c);
}

/**
 * Folds per-chain results into the headline facts: the earliest first activity and the
 * latest last activity (each with the chain it was found on), the summed count and whether
 * each is complete. Only checked chains contribute values; an unread chain with a source
 * makes them bounds. With no checked chain every headline value is null.
 */
export function summarizeChains(
  chains: ActivityChain[],
  basis: 'sent' | 'all',
): Pick<WalletActivity,
  'firstSeen' | 'firstSeenChain' | 'firstSeenComplete' |
  'lastActivity' | 'lastActivityChain' | 'lastActivityComplete' |
  'txCount' | 'txCountBasis' | 'txCountIsMinimum' | 'chains'> {
  let firstSeen: string | null = null;
  let firstSeenChain: string | null = null;
  let lastActivity: string | null = null;
  let lastActivityChain: string | null = null;
  let txCount: number | null = null;

  // An unread chain may hold earlier, later and more activity than the chains read.
  const unread = chains.some(isUnread);
  let firstSeenComplete = !unread;
  let lastActivityComplete = !unread;
  let txCountIsMinimum = unread;

  for (const c of chains) {
    if (!c.checked) continue;
    if (c.firstSeen && (!firstSeen || Date.parse(c.firstSeen) < Date.parse(firstSeen))) {
      firstSeen = c.firstSeen;
      firstSeenChain = c.name;
    }
    if (c.lastActivity && (!lastActivity || Date.parse(c.lastActivity) > Date.parse(lastActivity))) {
      lastActivity = c.lastActivity;
      lastActivityChain = c.name;
    }
    if (c.firstSeenComplete === false) firstSeenComplete = false;
    if (c.lastActivityComplete === false) lastActivityComplete = false;
    if (c.txCount === null) {
      txCountIsMinimum = true; // checked, but its count could not be read
    } else {
      txCount = (txCount ?? 0) + c.txCount;
      if (c.txCountIsMinimum) txCountIsMinimum = true;
    }
  }
  if (txCount === null) txCountIsMinimum = false; // nothing to qualify

  return {
    firstSeen, firstSeenChain, firstSeenComplete,
    lastActivity, lastActivityChain, lastActivityComplete,
    txCount, txCountBasis: basis, txCountIsMinimum, chains,
  };
}

/**
 * Whether to show the "first activity less than 30 days ago" caution. A fact, never part
 * of the verdict. Shown only when at least one chain was actually read, every chain we have
 * a source for was read (an unread one may hold older activity), every read reached the
 * first transaction (a capped read cannot tell new from busy), and the earliest activity
 * found is under 30 days old. Chains with no source (Base, OP Mainnet, BNB Chain) do not
 * hold it back, or it could never be shown. Results from before the per-chain fields
 * existed fall back to their single firstSeen.
 */
export function showNewWalletNote(activity: WalletActivity | null | undefined, nowMs: number = Date.now()): boolean {
  if (!activity?.firstSeen) return false;
  if (activity.chains) {
    if (!activity.chains.some((c) => c.checked)) return false;
    if (activity.chains.some(isUnread)) return false;
    if (activity.chains.some((c) => c.checked && c.firstSeenComplete === false)) return false;
  }
  const first = Date.parse(activity.firstSeen);
  if (!Number.isFinite(first)) return false;
  return nowMs - first < NEW_WALLET_DAYS * DAY_MS;
}
