/**
 * The Agent Vault watcher: verify an address first, then watch what the agent's own wallet does.
 *
 * For each of a tin's own wallets, it reads the explorer's account listings and appends a
 * `transaction` event for every direct transfer with the wallet on one side, in either direction,
 * that it has not recorded yet (./events.ts). Each event carries the exact amount, the asset, the
 * USD value at the time (./pricing.ts), the verify-status it inherits from the check that came
 * before it (./link.ts), and what the tin's registry said about the OTHER side at the moment of
 * writing (./counterparty.ts): trusted, pending or flagged for a registered destination,
 * unregistered for an address that was not on the list. The transaction hash and the other side's
 * address are on every row, the way the tracker's own Vault keeps them for a tracked wallet.
 *
 * What it keeps, and what it never does:
 *
 *   - Every direct transfer of the wallet, from the wallet's registration on. Before slice 8 only
 *     the pair with a trusted destination was kept and the rest of the listing was dropped; now the
 *     rest is the point. A transfer out to an address that was not on the list, with no check asked
 *     about it in the hour before, is the UNMATCHED line: the agent paid someone it never asked
 *     about. It is counted here and marked on the row, and nothing more happens (no alert, by the
 *     owner's decision: one thing at a time).
 *   - The registry verdict is the one at writing. A destination registered or flagged later does
 *     not change a row already written; the Record shows what the Vault knew when it wrote.
 *   - Only the wallet's own history, from its registration. A wallet that was removed and added
 *     again does not pick up what happened in between. The other side's history is never read.
 *   - Only direct transfers. A payment routed through a contract (a swap, a router) is a transfer
 *     between the wallet and the contract, recorded as such and labeled a contract call where the
 *     listing says so (./transfers.ts).
 *
 * Where it stands is kept per wallet in a cursor (./watchState.ts), advanced only after a read that
 * ran to its end, and a read is repeated over an hour of overlap so a block the explorer was slow
 * to index is still seen. Reading the same history twice is harmless because a movement is written
 * once (./events.ts). A read that could not finish says so (`partial`, `unavailable`) and moves
 * nothing it did not reach. The newest few minutes are never read, so a block that is later
 * replaced by a reorganization is not written down.
 *
 * Read-only. It lists transfers; it never signs, sends or holds anything.
 */
import type { VaultChain } from './addresses';
import { counterpartyOf, isUnmatched, registryOf, type CounterpartyStatus } from './counterparty';
import { insertTransactionEvent, listChecksForLink, transactionEventExists, transactionEventId } from './events';
import { defaultExplorer, type ExplorerDeps } from './explorer';
import { LINK_LOOKUP_LIMIT, LINK_TOLERANCE_MS, LINK_WINDOW_MS, linkTransactionToCheck } from './link';
import { fillPendingPrices } from './dailyPrices';
import { defaultPricing, memoizePricing, priceTransfer, type PricingDeps } from './pricing';
import { listDestinations, listWallets, type AgentWallet, type Destination, type Tin } from './store';
import { EXPLORER_ACTIONS, normalizeTransfers, transferTime, type ExplorerAction, type Transfer } from './transfers';
import { advanceWalletCursor, oldestPairCursor, readPairCursors, readWalletCursors } from './watchState';
import { alertCheck, unmatchedAlertDue, type CheckAlertInfo } from './alerts';

/** Rows per explorer page, and pages per read: the explorer allows page times offset up to 10,000. */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 10;
/** A completed read starts the next one this far back, to catch a block the explorer indexed late. */
export const CURSOR_OVERLAP_S = 60 * 60;
/** How old a block must be before it is read, per chain, so a reorganization is unlikely to undo it. */
export const CONFIRMATION_LAG_S: Readonly<Record<VaultChain, number>> = { ethereum: 180, polygon: 600, avalanche: 60 };

export interface WatchDeps {
  explorer: ExplorerDeps;
  pricing: PricingDeps;
  /** The clock, in milliseconds. */
  now: () => number;
  /** Smaller pages for a test; the explorer's own limits (PAGE_SIZE, MAX_PAGES) when omitted. */
  limits?: { pageSize?: number; maxPages?: number };
  /**
   * Tells the operator about an unmatched payment (./alerts.ts alertCheck, kind `unmatched`). Called without
   * waiting, after the transfer is written, so a slow mail server never holds a read back. Left out (a test
   * that is not about alerts), nothing is sent.
   */
  alert?: (info: CheckAlertInfo) => Promise<unknown>;
}

export const defaultWatchDeps: WatchDeps = { explorer: defaultExplorer, pricing: defaultPricing, now: () => Date.now(), alert: (info) => alertCheck(info) };

export interface PassOptions {
  /** Stop starting new reads at this time (milliseconds since the epoch). What was read stays, and the cursor says where to resume. */
  deadlineAt?: number;
  /**
   * Read only these of the tin's wallets, in this order (the daily pass, ./syncPass.ts, which reads the least
   * recently read first). A wallet no longer live is skipped. Every live wallet, oldest first, when omitted.
   */
  walletIds?: readonly string[];
}

export type WalletStatus =
  | 'complete' // every listing was read to the newest confirmed block
  | 'partial' //  read part of the way (a page limit or the deadline)
  | 'unavailable' // the explorer could not be read; nothing moved
  | 'failed' //   the ledger could not be written; nothing moved
  | 'idle'; //    nothing to read yet (a wallet registered moments ago, or one with no readable registration time)

export interface WalletReport {
  chain: VaultChain;
  walletId: string;
  address: string;
  status: WalletStatus;
  /** A code for why a wallet is not complete, or null. */
  reason: string | null;
  /** Registered destinations on this wallet's chain, whatever their status: the addresses a transfer can be matched to. */
  destinations: number;
  /** Direct transfers with this wallet on one side, inside the stretch that was read. */
  transfers: number;
  /** Events newly written. */
  recorded: number;
  /** Transfers that were already in the ledger. */
  alreadyRecorded: number;
  /**
   * Transfers newly recorded whose USD value is not available yet (the day's noon price has not come,
   * or did not answer): recorded at once with their token and exact amount, and priced later from the
   * day's price (./dailyPrices.ts). They never hold the read back.
   */
  pricePending: number;
  /** Of the transfers read, the ones whose other side was not on the list. */
  unregistered: number;
  /** Of those, the outflows with no check asked in the hour before: the unmatched lines. */
  unmatched: number;
  /** The wallet was read through this time (UTC ISO-8601), or null when it was not read. */
  throughAt: string | null;
}

export interface TinPassReport {
  tinId: string;
  startedAt: string;
  /** The tin's live registered destinations by where they stand. */
  registered: { trusted: number; pending: number; flagged: number };
  wallets: WalletReport[];
  /** Events newly written, over all wallets. */
  recorded: number;
  /** Transfers read on this pass whose other side was not on the list, over all wallets (recorded or already there). */
  unregistered: number;
  /** Of those, the unmatched lines. */
  unmatched: number;
}

type Row = Record<string, unknown>;

/** A UTC time as the registry tables store it (YYYY-MM-DD HH:MM:SS), or as ISO-8601, in milliseconds; NaN if neither. */
export function storedMs(s: string): number {
  const t = String(s ?? '').trim().replace(' ', 'T');
  return Date.parse(/(z|[+-]\d\d:?\d\d)$/i.test(t) ? t : `${t}Z`);
}

/** The key of a registry lookup: one chain, one lowercase address. */
const registryKey = (chain: VaultChain, address: string): string => `${chain}|${address}`;

/** The tin's live destinations by chain and address, so a transfer's other side is one lookup. */
export function registryIndex(destinations: readonly Destination[]): Map<string, Destination> {
  const out = new Map<string, Destination>();
  for (const d of destinations) {
    const key = registryKey(d.chain, d.address);
    // Two live rows for one address on one chain cannot happen (the store refuses the second); if one ever did, the oldest wins.
    const have = out.get(key);
    if (!have || storedMs(d.createdAt) < storedMs(have.createdAt)) out.set(key, d);
  }
  return out;
}

/**
 * Where a wallet's read starts, in milliseconds: its own cursor; failing that, the oldest of its
 * pair cursors from before slice 8 (the transition, see watchState.ts); failing that, its
 * registration. Never before the registration. NaN when the registration time cannot be read.
 */
export function walletStartMs(wallet: AgentWallet, walletCursors: ReadonlyMap<string, number>, pairCursors: ReadonlyMap<string, number>): number {
  const registeredMs = storedMs(wallet.createdAt);
  if (!Number.isFinite(registeredMs)) return Number.NaN;
  const cursor = walletCursors.get(wallet.id) ?? oldestPairCursor(pairCursors, wallet.id);
  return cursor === null || cursor === undefined ? registeredMs : Math.max(registeredMs, cursor);
}

interface ActionScan {
  action: ExplorerAction;
  rows: Row[];
  complete: boolean;
  /** Every transfer up to this second was read (before the overlap is applied); null when the read got nowhere. */
  reachedSec: number | null;
  reason: string | null;
}

/**
 * One listing for one wallet, oldest first, from `startBlock` to `endBlock`. A read that ends
 * early (the page limit, the deadline, an explorer error) keeps only the blocks it read whole:
 * the rows of its last block may be a few of many, so they are dropped and read again next time.
 */
async function scanAction(
  deps: WatchDeps,
  q: { chain: VaultChain; action: ExplorerAction; address: string; startBlock: number; endBlock: number },
  deadlineAt: number,
): Promise<ActionScan> {
  const rows: Row[] = [];
  const pageSize = deps.limits?.pageSize ?? PAGE_SIZE;
  const maxPages = deps.limits?.maxPages ?? MAX_PAGES;
  let ended: 'complete' | 'page_limit' | 'explorer_unavailable' | 'deadline' = 'page_limit';
  for (let page = 1; page <= maxPages; page += 1) {
    if (deps.now() >= deadlineAt) {
      ended = 'deadline';
      break;
    }
    const got = await deps.explorer.page({ ...q, page, offset: pageSize });
    if (got === null) {
      ended = 'explorer_unavailable';
      break;
    }
    rows.push(...got);
    if (got.length < pageSize) {
      ended = 'complete';
      break;
    }
  }
  if (ended === 'complete') return { action: q.action, rows, complete: true, reachedSec: null, reason: null };

  const blocks = rows.map((r) => Number(r.blockNumber)).filter((b) => Number.isSafeInteger(b));
  if (!blocks.length) return { action: q.action, rows: [], complete: false, reachedSec: null, reason: ended };
  const lastBlock = Math.max(...blocks);
  const kept = rows.filter((r) => Number(r.blockNumber) < lastBlock);
  const cutSec = Number(rows.find((r) => Number(r.blockNumber) === lastBlock)?.timeStamp);
  if (!kept.length || !Number.isSafeInteger(cutSec)) {
    return { action: q.action, rows: [], complete: false, reachedSec: null, reason: ended === 'page_limit' ? 'dense_block' : ended };
  }
  return { action: q.action, rows: kept, complete: false, reachedSec: cutSec - 1, reason: ended };
}

interface WalletContext {
  tenantId: string;
  tin: Tin;
  wallet: AgentWallet;
  /** Where this wallet's read starts, in milliseconds (walletStartMs). */
  startMs: number;
  registry: ReadonlyMap<string, Destination>;
  /** Registered destinations on this wallet's chain. */
  destinations: number;
  walletCursors: ReadonlyMap<string, number>;
  deps: WatchDeps;
  pricing: PricingDeps;
  deadlineAt: number;
  horizonBlock: (chain: VaultChain, horizonSec: number) => Promise<number | null>;
  /** The addresses this pass wrote a new, emailable unmatched payment to (./alerts.ts unmatchedAlertDue). */
  unmatchedDue: Set<string>;
}

const emptyReport = (wallet: AgentWallet, destinations: number): WalletReport => ({
  chain: wallet.chain,
  walletId: wallet.id,
  address: wallet.address,
  status: 'idle',
  reason: null,
  destinations,
  transfers: 0,
  recorded: 0,
  alreadyRecorded: 0,
  pricePending: 0,
  unregistered: 0,
  unmatched: 0,
  throughAt: null,
});

async function watchWallet(ctx: WalletContext): Promise<WalletReport> {
  const { tenantId, tin, wallet, deps } = ctx;
  const report = emptyReport(wallet, ctx.destinations);
  const nowMs = deps.now();
  const horizonSec = Math.floor(nowMs / 1000) - CONFIRMATION_LAG_S[wallet.chain];
  const fromSec = Math.floor(ctx.startMs / 1000);
  if (fromSec >= horizonSec) return { ...report, status: 'idle', reason: 'too_new' };

  const startBlock = await deps.explorer.blockAt(wallet.chain, fromSec);
  const endBlock = await ctx.horizonBlock(wallet.chain, horizonSec);
  if (startBlock === null || endBlock === null) return { ...report, status: 'unavailable', reason: 'explorer_unavailable' };
  if (startBlock > endBlock) return { ...report, status: 'idle', reason: 'too_new' };

  const scans: ActionScan[] = [];
  for (const action of EXPLORER_ACTIONS) {
    scans.push(await scanAction(deps, { chain: wallet.chain, action, address: wallet.address, startBlock, endBlock }, ctx.deadlineAt));
  }

  const transfers: Transfer[] = [];
  let unreadable = 0;
  for (const scan of scans) {
    const normalized = normalizeTransfers(wallet.chain, wallet.address, scan.action, scan.rows);
    transfers.push(...normalized.transfers);
    unreadable += normalized.unreadable;
  }
  // Malformed rows are a data-quality signal for the log, not a count the owner is shown.
  if (unreadable > 0) console.warn('[agent-vault] explorer rows could not be read', { chain: wallet.chain, rows: unreadable });
  transfers.sort((a, b) => a.atSec - b.atSec || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.leg < b.leg ? -1 : a.leg > b.leg ? 1 : 0));

  for (const t of transfers) {
    // The wallet's history begins at its registration; the explorer's block range is coarser than that.
    if (t.atSec * 1000 < ctx.startMs && t.atSec * 1000 < storedMs(wallet.createdAt)) continue;
    report.transfers += 1;

    const id = transactionEventId(tenantId, tin.id, t.chain, t.hash, t.leg);
    // The other side, as the registry stands now. Looked up before the "already recorded" check so the
    // pass can count what it read; the row itself keeps the verdict it was written with.
    const destination = ctx.registry.get(registryKey(t.chain, t.counterparty)) ?? null;
    const counterparty: CounterpartyStatus = destination ? destination.trustStatus : 'unregistered';

    // Already in the ledger (the overlap re-reads the last hour): nothing to price, link or write.
    if (await transactionEventExists(tenantId, id)) {
      report.alreadyRecorded += 1;
      if (counterparty === 'unregistered') report.unregistered += 1;
      continue;
    }

    // The transfer is recorded now, priced or not: a value that is not available yet is filled in later
    // from the day's price, so a missing price never holds the transfer or the read back.
    const price = await priceTransfer(t, nowMs, ctx.pricing);

    const atMs = t.atSec * 1000;
    const checks = await listChecksForLink(tenantId, tin.id, t.counterparty, {
      fromIso: new Date(atMs - LINK_WINDOW_MS).toISOString(),
      toIso: new Date(atMs + LINK_TOLERANCE_MS).toISOString(),
      limit: LINK_LOOKUP_LIMIT,
    });
    const link = linkTransactionToCheck(atMs, checks);
    const unmatched = isUnmatched({ direction: t.direction, counterparty, linked: link.linked });
    if (counterparty === 'unregistered') report.unregistered += 1;
    if (unmatched) report.unmatched += 1;

    const written = await insertTransactionEvent(tenantId, {
      tinId: tin.id,
      address: t.counterparty,
      chain: t.chain,
      registry: registryOf(counterparty),
      leg: t.leg,
      answer: link.answer,
      status: link.status,
      tx: {
        hash: t.hash,
        direction: t.direction,
        wallet: t.wallet,
        amount: t.amount,
        asset: t.asset,
        assetContract: t.assetContract,
        usd: price.kind === 'priced' ? price.usd : null,
        blockNumber: t.blockNumber,
      },
      detail: {
        source: t.source,
        walletId: wallet.id,
        // The other side as the registry stood at writing (./counterparty.ts), and the unmatched mark.
        counterparty,
        unmatched,
        // Whether the other side is a contract, as far as the listing could say (./transfers.ts).
        contract: t.contract,
        destinationId: destination ? destination.id : null,
        // When the destination was registered and last checked, so a reader can see how the transfer
        // sits against its verification. Null for an address that was not on the list.
        destinationRegisteredAt: destination ? destination.createdAt : null,
        destinationCheckedAt: destination ? destination.trustCheckedAt : null,
        link: link.linked ? link.check : null,
        reason: link.linked ? null : link.reason,
        price:
          price.kind === 'priced'
            ? { basis: price.basis, day: price.day, unitUsd: price.unitUsd }
            : price.kind === 'pending'
              ? { basis: null, pending: true, coinId: price.coinId, day: price.day }
              : { basis: null, reason: price.reason },
      },
      at: transferTime(t),
    });
    if (written.inserted) {
      report.recorded += 1;
      if (price.kind === 'pending') report.pricePending += 1;
      // A payment the agent never asked about is emailed once the whole pass is written (runTinPass), so the
      // email can count every payment the pass found; only when it is new: a read catching up on old history
      // records it and marks it, and sends nothing.
      if (unmatched && unmatchedAlertDue(atMs, nowMs)) ctx.unmatchedDue.add(t.counterparty);
    } else {
      report.alreadyRecorded += 1;
    }
  }

  // How far this read got. A listing that ran to its end reached the newest confirmed block (and
  // the next read starts an overlap earlier); one that stopped early reached the block before the
  // one it cut. A missing price never holds it back: the transfer was recorded and is priced later.
  let reached: number | null = Number.POSITIVE_INFINITY;
  for (const scan of scans) {
    const at = scan.complete ? horizonSec - CURSOR_OVERLAP_S : scan.reachedSec;
    reached = at === null || reached === null ? null : Math.min(reached, at);
  }

  const everyListingComplete = scans.every((s) => s.complete);
  const firstShortfall = scans.find((s) => !s.complete)?.reason ?? null;
  if (reached === null) {
    const status = firstShortfall === 'deadline' ? 'partial' : 'unavailable';
    return { ...report, status, reason: firstShortfall ?? 'explorer_unavailable' };
  }
  await advanceWalletCursor(tenantId, tin.id, wallet.id, reached * 1000, ctx.walletCursors);
  const throughAt = new Date(reached * 1000).toISOString();
  if (everyListingComplete) return { ...report, status: 'complete', throughAt };
  return { ...report, status: 'partial', reason: firstShortfall ?? 'page_limit', throughAt };
}

function logFailure(stage: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-vault] watch pass failed', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/**
 * One pass over one tin: read each of its own wallets, and match each transfer's other side against
 * the tin's registry as it stands. Wallets are read one after another (the explorer's rate limit is
 * shared and the calls are paced), and a wallet that cannot be read does not stop the next one.
 */
export async function runTinPass(
  tenantId: string,
  tin: Tin,
  deps: WatchDeps = defaultWatchDeps,
  opts: PassOptions = {},
): Promise<TinPassReport> {
  const startedMs = deps.now();
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const [live, destinations, walletCursors, pairCursors] = await Promise.all([
    listWallets(tenantId, tin.id),
    listDestinations(tenantId, tin.id),
    readWalletCursors(tenantId, tin.id),
    readPairCursors(tenantId, tin.id),
  ]);
  const registry = registryIndex(destinations);
  const byId = new Map(live.map((w) => [w.id, w]));
  const wallets = opts.walletIds ? opts.walletIds.flatMap((id) => byId.get(id) ?? []) : live;

  const report: TinPassReport = {
    tinId: tin.id,
    startedAt: new Date(startedMs).toISOString(),
    registered: {
      trusted: destinations.filter((d) => d.trustStatus === 'trusted').length,
      pending: destinations.filter((d) => d.trustStatus === 'pending').length,
      flagged: destinations.filter((d) => d.trustStatus === 'flagged').length,
    },
    wallets: [],
    recorded: 0,
    unregistered: 0,
    unmatched: 0,
  };

  const pricing = memoizePricing(deps.pricing);
  const horizonBlocks = new Map<string, Promise<number | null>>();
  const horizonBlock = (chain: VaultChain, horizonSec: number) => {
    const key = `${chain}:${horizonSec}`;
    let hit = horizonBlocks.get(key);
    if (!hit) horizonBlocks.set(key, (hit = deps.explorer.blockAt(chain, horizonSec)));
    return hit;
  };

  const unmatchedDue = new Set<string>();
  for (const wallet of wallets) {
    const onChain = destinations.filter((d) => d.chain === wallet.chain).length;
    const startMs = walletStartMs(wallet, walletCursors, pairCursors);
    let walletReport: WalletReport;
    if (!Number.isFinite(startMs)) {
      // No registration time, no history to claim: say so rather than read from the beginning of time.
      walletReport = { ...emptyReport(wallet, onChain), status: 'idle', reason: 'no_registration_time' };
    } else if (deps.now() >= deadlineAt) {
      walletReport = { ...emptyReport(wallet, onChain), status: 'partial', reason: 'deadline' };
    } else {
      try {
        walletReport = await watchWallet({ tenantId, tin, wallet, startMs, registry, destinations: onChain, walletCursors, deps, pricing, deadlineAt, horizonBlock, unmatchedDue });
      } catch (err) {
        logFailure('wallet', err);
        walletReport = { ...emptyReport(wallet, onChain), status: 'failed', reason: 'write_failed' };
      }
    }
    report.wallets.push(walletReport);
    report.recorded += walletReport.recorded;
    report.unregistered += walletReport.unregistered;
    report.unmatched += walletReport.unmatched;
  }

  // One unmatched-payment email per address the pass found one for, now that every wallet's transfers are
  // written, so the email counts them all (./alerts.ts). Not waited for: a slow mail server never holds a read.
  if (deps.alert) {
    for (const address of unmatchedDue) deps.alert({ tenantId, tinId: tin.id, address, kind: 'unmatched' }).catch(() => {});
  }

  // The day prices this tin's pending transfers need, looked up once each now that the pass is done (a
  // day's price exists once noon UTC of that day has passed). A failure here never undoes the pass: the
  // transfers stay recorded with their price pending, and the next pass tries again.
  if (deps.now() < deadlineAt) {
    try {
      await fillPendingPrices(tenantId, tin.id, pricing, deps.now());
    } catch (err) {
      logFailure('prices', err);
    }
  }
  return report;
}

export { counterpartyOf };
