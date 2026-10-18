/**
 * The Agent Vault watcher: verify an address first, then watch that address receive the funds.
 *
 * For each trusted destination in a tin's registry, it reads the explorer's account listings for
 * the tin's own wallets on the same chain, and appends a `transaction` event for every movement
 * of funds between a wallet and a destination that it has not recorded yet (./events.ts). Each
 * event carries the exact amount, the asset, the USD value at the time (./pricing.ts) and the
 * verify-status it inherits from the check that came before it (./link.ts).
 *
 * What it watches, and what it never keeps:
 *
 *   - Only destinations that are in the registry, live, and trusted. A pending destination has not
 *     been verified yet; a flagged one failed a check; neither is watched. A removed one is gone.
 *   - Only the pair. The explorer cannot filter a listing by the other side, so it hands over the
 *     wallet's whole history; every row whose other side is not a watched destination is dropped
 *     in memory, in the same function that read it, and nothing about it is stored, counted or
 *     reported. A transfer to an address that was never registered is invisible here, by design.
 *   - Only after the pair existed. A pair's history begins when both ends were registered, so a
 *     wallet or destination that was removed and added again does not pick up what happened in
 *     between.
 *   - Only so many. The oldest trusted destinations of an account, up to a pooled limit, are
 *     watched; the rest are reported as over the limit.
 *   - Only direct transfers. A payment routed through a contract (a swap, a router) is a transfer
 *     between the wallet and the contract, and the contract is not a destination.
 *
 * Where it stands is kept per pair in a cursor (./watchState.ts), advanced only after a read that
 * ran to its end, and a read is repeated over an hour of overlap so a block the explorer was slow
 * to index is still seen. Reading the same history twice is harmless because a movement is written
 * once (./events.ts). A read that could not finish says so (`partial`, `unavailable`) and moves
 * nothing it did not reach. The newest few minutes are never read, so a block that is later
 * replaced by a reorganization is not written down.
 *
 * Read-only. It lists transfers; it never signs, sends or holds anything.
 */
import type { VaultChain } from './addresses';
import { insertTransactionEvent, listChecksForLink, transactionEventExists, transactionEventId } from './events';
import { defaultExplorer, type ExplorerDeps } from './explorer';
import { LINK_LOOKUP_LIMIT, LINK_TOLERANCE_MS, LINK_WINDOW_MS, linkTransactionToCheck } from './link';
import { defaultPricing, memoizePricing, priceTransfer, type PricingDeps } from './pricing';
import {
  getTin,
  listDestinations,
  listWallets,
  listWatchedDestinationIds,
  listWatchTargets,
  type AgentWallet,
  type Destination,
  type Tin,
} from './store';
import { EXPLORER_ACTIONS, normalizeTransfers, transferTime, type ExplorerAction, type Transfer } from './transfers';
import { advanceCursors, pairKey, readCursors } from './watchState';

/** Trusted destinations watched per account, pooled over its agents (the free tier's 15 tracked wallets). */
export const MAX_WATCHED_PER_TENANT = 15;
/** Rows per explorer page, and pages per read: the explorer allows page times offset up to 10,000. */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 10;
/** A completed read starts the next one this far back, to catch a block the explorer indexed late. */
export const CURSOR_OVERLAP_S = 60 * 60;
/** How old a block must be before it is read, per chain, so a reorganization is unlikely to undo it. */
export const CONFIRMATION_LAG_S: Readonly<Record<VaultChain, number>> = { ethereum: 180, polygon: 600, avalanche: 60 };
/** The most registry rows the daily job reads to find its tins. */
export const MAX_TARGET_ROWS = 5_000;

export interface WatchDeps {
  explorer: ExplorerDeps;
  pricing: PricingDeps;
  /** The clock, in milliseconds. */
  now: () => number;
  /** Smaller pages for a test; the explorer's own limits (PAGE_SIZE, MAX_PAGES) when omitted. */
  limits?: { pageSize?: number; maxPages?: number };
}

export const defaultWatchDeps: WatchDeps = { explorer: defaultExplorer, pricing: defaultPricing, now: () => Date.now() };

export interface PassOptions {
  /** Stop starting new reads at this time (milliseconds since the epoch). What was read stays, and the cursor says where to resume. */
  deadlineAt?: number;
  /** Trusted destinations watched per account; MAX_WATCHED_PER_TENANT when omitted. */
  maxWatched?: number;
}

export type WalletStatus =
  | 'complete' // every listing was read to the newest confirmed block
  | 'partial' //  read part of the way (a page limit, the deadline, or a price that is not in yet)
  | 'unavailable' // the explorer could not be read; nothing moved
  | 'failed' //   the ledger could not be written; nothing moved
  | 'idle'; //    nothing to read yet (a pair registered moments ago)

export interface WalletReport {
  chain: VaultChain;
  walletId: string;
  address: string;
  status: WalletStatus;
  /** A code for why a wallet is not complete, or null. */
  reason: string | null;
  /** Watched destinations paired with this wallet. */
  destinations: number;
  /** Transfers between this wallet and a watched destination, inside the pair's history. */
  matched: number;
  /** Events newly written. */
  recorded: number;
  /** Matched transfers that were already in the ledger. */
  alreadyRecorded: number;
  /** Matched transfers left for the next pass because their price is not in yet. */
  deferred: number;
  /** The wallet was read through this time (UTC ISO-8601), or null when it was not read. */
  throughAt: string | null;
}

export interface TinPassReport {
  tinId: string;
  startedAt: string;
  /** Trusted destinations watched on this pass. */
  watchedDestinations: number;
  /** Registered destinations that are not watched, and why. */
  notWatched: { pending: number; flagged: number; overLimit: number };
  wallets: WalletReport[];
  /** Events newly written, over all wallets. */
  recorded: number;
}

type Row = Record<string, unknown>;

/** A UTC time as the registry tables store it (YYYY-MM-DD HH:MM:SS), or as ISO-8601, in milliseconds; NaN if neither. */
export function storedMs(s: string): number {
  const t = String(s ?? '').trim().replace(' ', 'T');
  return Date.parse(/(z|[+-]\d\d:?\d\d)$/i.test(t) ? t : `${t}Z`);
}

interface Pair {
  destination: Destination;
  /** When this pair's history begins: the later of the two registrations, in milliseconds. */
  sinceMs: number;
  /** Where to start reading, in seconds: the cursor if there is one, never earlier than sinceMs. */
  startSec: number;
}

function pairsFor(wallet: AgentWallet, watched: readonly Destination[], cursors: ReadonlyMap<string, number>): Pair[] {
  const walletMs = storedMs(wallet.createdAt);
  const out: Pair[] = [];
  for (const destination of watched) {
    if (destination.chain !== wallet.chain) continue;
    const sinceMs = Math.max(storedMs(destination.createdAt), walletMs);
    if (!Number.isFinite(sinceMs)) continue; // no registration time, no history to claim
    const cursor = cursors.get(pairKey(wallet.id, destination.id));
    out.push({ destination, sinceMs, startSec: Math.floor((cursor === undefined ? sinceMs : Math.max(sinceMs, cursor)) / 1000) });
  }
  return out;
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
  pairs: Pair[];
  cursors: ReadonlyMap<string, number>;
  deps: WatchDeps;
  pricing: PricingDeps;
  deadlineAt: number;
  horizonBlock: (chain: VaultChain, horizonSec: number) => Promise<number | null>;
}

const emptyReport = (wallet: AgentWallet, destinations: number): WalletReport => ({
  chain: wallet.chain,
  walletId: wallet.id,
  address: wallet.address,
  status: 'idle',
  reason: null,
  destinations,
  matched: 0,
  recorded: 0,
  alreadyRecorded: 0,
  deferred: 0,
  throughAt: null,
});

async function watchWallet(ctx: WalletContext): Promise<WalletReport> {
  const { tenantId, tin, wallet, pairs, deps } = ctx;
  const report = emptyReport(wallet, pairs.length);
  const nowMs = deps.now();
  const horizonSec = Math.floor(nowMs / 1000) - CONFIRMATION_LAG_S[wallet.chain];
  const fromSec = Math.min(...pairs.map((p) => p.startSec));
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
  // Malformed rows are a data-quality signal for the log, not a count the owner is shown: the report
  // says nothing about traffic outside the registry.
  if (unreadable > 0) console.warn('[agent-vault] explorer rows could not be read', { chain: wallet.chain, rows: unreadable });
  transfers.sort((a, b) => a.atSec - b.atSec || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.leg < b.leg ? -1 : a.leg > b.leg ? 1 : 0));

  // The registry filter. Everything that is not a movement between this wallet and a watched
  // destination, inside the pair's history, ends here, and nothing about it is kept.
  const byCounterparty = new Map(pairs.map((p) => [p.destination.address, p] as const));
  let holdBackSec = Number.POSITIVE_INFINITY;
  for (const t of transfers) {
    const pair = byCounterparty.get(t.counterparty);
    if (!pair || t.atSec * 1000 < pair.sinceMs) continue;
    report.matched += 1;

    // Already in the ledger (the overlap re-reads the last hour): nothing to price, link or write.
    if (await transactionEventExists(tenantId, transactionEventId(tenantId, tin.id, t.chain, t.hash, t.leg))) {
      report.alreadyRecorded += 1;
      continue;
    }

    const price = await priceTransfer(t, nowMs, ctx.pricing);
    if (price.kind === 'retry') {
      report.deferred += 1;
      holdBackSec = Math.min(holdBackSec, t.atSec);
      continue;
    }

    const atMs = t.atSec * 1000;
    const checks = await listChecksForLink(tenantId, tin.id, t.counterparty, {
      fromIso: new Date(atMs - LINK_WINDOW_MS).toISOString(),
      toIso: new Date(atMs + LINK_TOLERANCE_MS).toISOString(),
      limit: LINK_LOOKUP_LIMIT,
    });
    const link = linkTransactionToCheck(atMs, checks);
    const written = await insertTransactionEvent(tenantId, {
      tinId: tin.id,
      address: t.counterparty,
      chain: t.chain,
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
        destinationId: pair.destination.id,
        // When the destination was registered and last checked, so a reader can see how the transfer
        // sits against its verification. The registry verdict on the event is the one at recording.
        destinationRegisteredAt: pair.destination.createdAt,
        destinationCheckedAt: pair.destination.trustCheckedAt,
        link: link.linked ? link.check : null,
        reason: link.linked ? null : link.reason,
        price: price.kind === 'priced' ? { basis: price.basis, day: price.day, unitUsd: price.unitUsd } : { basis: null, reason: price.reason },
      },
      at: transferTime(t),
    });
    if (written.inserted) {
      report.recorded += 1;
    } else {
      report.alreadyRecorded += 1;
    }
  }

  // How far this read got. A listing that ran to its end reached the newest confirmed block (and
  // the next read starts an overlap earlier); one that stopped early reached the block before the
  // one it cut; and a transfer held back for a missing price pins the cursor just before itself.
  let reached: number | null = Number.POSITIVE_INFINITY;
  for (const scan of scans) {
    const at = scan.complete ? horizonSec - CURSOR_OVERLAP_S : scan.reachedSec;
    reached = at === null || reached === null ? null : Math.min(reached, at);
  }
  if (reached !== null && Number.isFinite(holdBackSec)) reached = Math.min(reached, holdBackSec - 1);

  const everyListingComplete = scans.every((s) => s.complete);
  const firstShortfall = scans.find((s) => !s.complete)?.reason ?? null;
  if (reached === null) {
    const status = firstShortfall === 'deadline' ? 'partial' : 'unavailable';
    return { ...report, status, reason: firstShortfall ?? 'explorer_unavailable' };
  }
  await advanceCursors(tenantId, tin.id, wallet.id, pairs.map((p) => p.destination.id), reached * 1000, ctx.cursors);
  const throughAt = new Date(reached * 1000).toISOString();
  if (everyListingComplete && report.deferred === 0) return { ...report, status: 'complete', throughAt };
  return { ...report, status: 'partial', reason: firstShortfall ?? 'price_not_in_yet', throughAt };
}

function logFailure(stage: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-vault] watch pass failed', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/**
 * One pass over one tin: read each of its wallets against the destinations it may be paid to.
 * Wallets are read one after another (the explorer's rate limit is shared and the calls are
 * paced), and a wallet that cannot be read does not stop the next one.
 */
export async function runTinPass(
  tenantId: string,
  tin: Tin,
  deps: WatchDeps = defaultWatchDeps,
  opts: PassOptions = {},
): Promise<TinPassReport> {
  const startedMs = deps.now();
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const [wallets, destinations, watchedIds, cursors] = await Promise.all([
    listWallets(tenantId, tin.id),
    listDestinations(tenantId, tin.id),
    listWatchedDestinationIds(tenantId, opts.maxWatched ?? MAX_WATCHED_PER_TENANT),
    readCursors(tenantId, tin.id),
  ]);
  const trusted = destinations.filter((d) => d.trustStatus === 'trusted');
  const inBudget = new Set(watchedIds);
  const watched = trusted.filter((d) => inBudget.has(d.id));

  const report: TinPassReport = {
    tinId: tin.id,
    startedAt: new Date(startedMs).toISOString(),
    watchedDestinations: watched.length,
    notWatched: {
      pending: destinations.filter((d) => d.trustStatus === 'pending').length,
      flagged: destinations.filter((d) => d.trustStatus === 'flagged').length,
      overLimit: trusted.length - watched.length,
    },
    wallets: [],
    recorded: 0,
  };

  const pricing = memoizePricing(deps.pricing);
  const horizonBlocks = new Map<string, Promise<number | null>>();
  const horizonBlock = (chain: VaultChain, horizonSec: number) => {
    const key = `${chain}:${horizonSec}`;
    let hit = horizonBlocks.get(key);
    if (!hit) horizonBlocks.set(key, (hit = deps.explorer.blockAt(chain, horizonSec)));
    return hit;
  };

  for (const wallet of wallets) {
    const pairs = pairsFor(wallet, watched, cursors);
    if (!pairs.length) continue;
    let walletReport: WalletReport;
    if (deps.now() >= deadlineAt) {
      walletReport = { ...emptyReport(wallet, pairs.length), status: 'partial', reason: 'deadline' };
    } else {
      try {
        walletReport = await watchWallet({ tenantId, tin, wallet, pairs, cursors, deps, pricing, deadlineAt, horizonBlock });
      } catch (err) {
        logFailure('wallet', err);
        walletReport = { ...emptyReport(wallet, pairs.length), status: 'failed', reason: 'write_failed' };
      }
    }
    report.wallets.push(walletReport);
    report.recorded += walletReport.recorded;
  }
  return report;
}

export interface WatchRunSummary {
  /** Tins visited. */
  tins: number;
  wallets: number;
  complete: number;
  partial: number;
  unavailable: number;
  failed: number;
  /** Events newly written. */
  recorded: number;
  /** True when the deadline ended the run before every tin was visited. */
  truncated: boolean;
}

/**
 * The daily job: every tin that has a trusted destination, one after another. Numbers only, so
 * the summary can be printed in a public log without naming anyone.
 */
export async function runAllTins(deps: WatchDeps = defaultWatchDeps, opts: PassOptions = {}): Promise<WatchRunSummary> {
  const summary: WatchRunSummary = { tins: 0, wallets: 0, complete: 0, partial: 0, unavailable: 0, failed: 0, recorded: 0, truncated: false };
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  for (const target of await listWatchTargets(MAX_TARGET_ROWS)) {
    if (deps.now() >= deadlineAt) {
      summary.truncated = true;
      break;
    }
    try {
      const tin = await getTin(target.tenantId, target.tinId);
      if (!tin) continue;
      const pass = await runTinPass(target.tenantId, tin, deps, opts);
      summary.tins += 1;
      summary.recorded += pass.recorded;
      for (const w of pass.wallets) {
        summary.wallets += 1;
        if (w.status === 'complete' || w.status === 'idle') summary.complete += 1;
        else if (w.status === 'partial') summary.partial += 1;
        else if (w.status === 'unavailable') summary.unavailable += 1;
        else summary.failed += 1;
      }
    } catch (err) {
      logFailure('tin', err);
      summary.failed += 1;
    }
  }
  return summary;
}
