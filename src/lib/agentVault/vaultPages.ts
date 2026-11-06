/**
 * What the Vault's agent pages (src/pages/dashboard/agentics/) load before they render: the home
 * page's agents, and one agent with its wallets, its registered addresses, the first page of its
 * ledger and its totals. The pages call these straight from their frontmatter, never through their
 * own API (a server page does not fetch itself).
 *
 * Every function takes the tenant first, from the session, and never from the request. The shapes
 * are plain objects, so a page can hand them to a component as props. Nothing here is called for a
 * viewer who is not allowed into the Vault: the pages check that first.
 */
import { listAgentKeys, type AgentKeyMeta } from '@/lib/agentKeys';
import { getSigningKey } from '@/lib/recordProof/signing';
import { FLAGGED_LOGGED_PAST_LIMIT, getLoggedChecksPerDay, getPlanSummary, type PlanSummary } from './entitlements';
import { idOf } from './errors';
import { countCheckedSince, latestEventTime, limitMarkerSince, readEventsInRange, sumTransactions, type TinTotals } from './events';
import { parseLedgerRows, type LedgerRow } from './ledgerView';
import { utcDay } from './report';
import { createdDay } from './reports';
import { getTin, listDestinations, listTins, listWallets, type AgentWallet, type Destination, type Tin } from './store';
import { FEED_EPOCH, readFeed, type FeedEvent } from './feed';
import { listTinEvents, listWalletWindow, WALLET_WINDOW_PAGE } from './vault';
import { groupSources, historyYears, yearRange, type IncomingTransfer, type MoneySource, type SourcesTotal } from './moneySources';

/** The ledger rows a page opens with; "load more" pages onward by cursor. */
export const FIRST_LEDGER_PAGE = 50;

/** An agent key as the pages show it: which domain proved it, and whether it can still be used. Never the key, never its hash, never the DNS challenge. */
export interface KeyInfo {
  id: string;
  domain: string;
  status: AgentKeyMeta['status'];
}

const keyInfo = (k: AgentKeyMeta): KeyInfo => ({ id: k.id, domain: k.domain, status: k.status });

/**
 * The keys an agent can be linked to: this account's own, active, and not already linked to another
 * live agent (one agent is one key). `exceptTinId` is the agent being looked at, whose own key is
 * not "taken" from its point of view.
 */
export function linkableKeys(keys: readonly AgentKeyMeta[], tins: readonly Tin[], exceptTinId: string | null = null): KeyInfo[] {
  const taken = new Set(tins.filter((t) => t.id !== exceptTinId && t.agentKeyId).map((t) => t.agentKeyId as string));
  return keys.filter((k) => k.status === 'active' && !taken.has(k.id)).map(keyInfo);
}

// ── The home page ────────────────────────────────────────────────────────────

export interface AgentCard {
  id: string;
  label: string;
  /** The key linked to this agent, or null when none is. A revoked key is still shown, marked. */
  key: KeyInfo | null;
  wallets: number;
  /** The agent's registered addresses by where they stand. */
  destinations: { trusted: number; flagged: number; pending: number };
  /** When the agent last asked about an address (UTC ISO-8601), or null if it never has. */
  lastCheckAt: string | null;
  /** When funds last moved between the agent's wallet and a registered address, or null. */
  lastTransferAt: string | null;
}

export interface HomePageData {
  plan: PlanSummary;
  agents: AgentCard[];
  /** The keys a new agent could be linked to. */
  availableKeys: KeyInfo[];
}

function countByStatus(destinations: readonly Destination[]): AgentCard['destinations'] {
  const out = { trusted: 0, flagged: 0, pending: 0 };
  for (const d of destinations) out[d.trustStatus] += 1;
  return out;
}

export async function loadHomePage(tenantId: string): Promise<HomePageData> {
  const [plan, tins, keys] = await Promise.all([getPlanSummary(tenantId), listTins(tenantId), listAgentKeys(tenantId)]);
  const byId = new Map(keys.map((k) => [k.id, k] as const));
  const agents = await Promise.all(
    tins.map(async (tin): Promise<AgentCard> => {
      const [wallets, destinations, lastCheckAt, lastTransferAt] = await Promise.all([
        listWallets(tenantId, tin.id),
        listDestinations(tenantId, tin.id),
        latestEventTime(tenantId, tin.id, 'checked'),
        latestEventTime(tenantId, tin.id, 'transaction'),
      ]);
      const linked = tin.agentKeyId ? byId.get(tin.agentKeyId) : undefined;
      return {
        id: tin.id,
        label: tin.label,
        key: linked ? keyInfo(linked) : null,
        wallets: wallets.length,
        destinations: countByStatus(destinations),
        lastCheckAt,
        lastTransferAt,
      };
    }),
  );
  return { plan, agents, availableKeys: linkableKeys(keys, tins) };
}

// ── One agent ────────────────────────────────────────────────────────────────

export interface AgentPageData {
  plan: PlanSummary;
  tin: { id: string; label: string; createdAt: string };
  /** The UTC day the agent was created: the first day its ledger can have anything in it. */
  since: string;
  /** Today in UTC. */
  today: string;
  key: KeyInfo | null;
  /** The keys this agent could be linked to instead. */
  availableKeys: KeyInfo[];
  wallets: AgentWallet[];
  destinations: Destination[];
  ledger: { rows: LedgerRow[]; next: string | null };
  totals: TinTotals;
  /** Whether this server can sign an export: with no signing key it cannot, and says so. */
  signing: { available: boolean };
  /**
   * The plan's daily limit on recorded checks for this agent, or null when the plan has none. `reached`: today's is
   * used up; `reachedAt`: when the check that found it full was written (the ledger row carries the same marker), or
   * null when the day filled without one. Past it a check is still answered and is not recorded, except one that
   * comes back flagged, for `flaggedExtra` more.
   */
  logLimit: { perDay: number; flaggedExtra: number; reached: boolean; reachedAt: string | null } | null;
}

/** One agent for its page, or null when there is none on this account (the page answers 404). */
export async function loadAgentPage(tenantId: string, idRaw: string, now: Date = new Date()): Promise<AgentPageData | null> {
  const id = idOf(idRaw);
  if (!id) return null;
  const tin = await getTin(tenantId, id);
  if (!tin) return null;
  const [plan, tins, keys, wallets, destinations, page, totals] = await Promise.all([
    getPlanSummary(tenantId),
    listTins(tenantId),
    listAgentKeys(tenantId),
    listWallets(tenantId, tin.id),
    listDestinations(tenantId, tin.id),
    listTinEvents(tenantId, tin.id, { limit: FIRST_LEDGER_PAGE }),
    sumTransactions(tenantId, tin.id),
  ]);
  const today = utcDay(now);
  const perDay = await getLoggedChecksPerDay(tenantId);
  let logLimit: AgentPageData['logLimit'] = null;
  if (perDay !== null) {
    const since = `${today}T00:00:00.000Z`;
    const reachedAt = await limitMarkerSince(tenantId, tin.id, since);
    const reached = reachedAt !== null || (await countCheckedSince(tenantId, tin.id, since)) >= perDay;
    logLimit = { perDay, flaggedExtra: FLAGGED_LOGGED_PAST_LIMIT, reached, reachedAt };
  }
  const linked = tin.agentKeyId ? keys.find((k) => k.id === tin.agentKeyId) : undefined;
  return {
    plan,
    tin: { id: tin.id, label: tin.label, createdAt: tin.createdAt },
    since: createdDay(tin) ?? today,
    today,
    key: linked ? keyInfo(linked) : null,
    // The key it already has is not on offer again: it is shown as linked.
    availableKeys: linkableKeys(keys, tins, tin.id).filter((k) => k.id !== tin.agentKeyId),
    wallets,
    destinations,
    ledger: page.ok ? { rows: parseLedgerRows(page.events), next: page.next } : { rows: [], next: null },
    totals,
    signing: { available: getSigningKey() !== null },
    logLimit,
  };
}

// ── The live feed ────────────────────────────────────────────────────────────

export interface FeedPageData {
  plan: PlanSummary;
  /** The account's agents, for the filter. */
  agents: Array<{ id: string; label: string }>;
  /** What the page opens with: the newest events of every agent, oldest first, and where its live polls start. */
  initial: { events: FeedEvent[]; since: string };
}

/** The live feed's first screen. The page polls /api/agentics/feed from `initial.since` on. */
export async function loadFeedPage(tenantId: string): Promise<FeedPageData> {
  const [plan, tins, feed] = await Promise.all([getPlanSummary(tenantId), listTins(tenantId), readFeed(tenantId, {})]);
  return {
    plan,
    agents: tins.map((t) => ({ id: t.id, label: t.label })),
    initial: feed.ok ? { events: feed.events, since: feed.since } : { events: [], since: FEED_EPOCH },
  };
}

// ── The wallets page ─────────────────────────────────────────────────────────

/** Wallets on one page of /dashboard/agentics/wallets. */
export const WALLETS_PER_PAGE = 10;

/** One window: the first rows of a wallet in one direction, and the cursor for the next ones. */
export interface WalletWindowData {
  rows: LedgerRow[];
  next: string | null;
}

export interface WalletBox {
  agent: { id: string; label: string };
  wallet: AgentWallet;
  /** What the wallet received, newest first. */
  received: WalletWindowData;
  /** What the wallet sent, newest first. */
  sent: WalletWindowData;
  /** The labels the agent gave its registered addresses, keyed `chain|address`, to name the other side of a row. */
  labels: Record<string, string>;
}

export interface WalletsPageData {
  plan: PlanSummary;
  /** The page shown, from 1, and how many there are (at least 1, even with no wallet). */
  page: number;
  pages: number;
  /** Every wallet of every agent on the account. */
  total: number;
  /** The place of the first wallet on this page among all of them, from 1 (0 when there is none). */
  first: number;
  wallets: WalletBox[];
}

/** A page number from a query string: a whole number from 1, or 1. A number past the last page is the last page. */
export function pageOf(raw: unknown, pages: number): number {
  const n = typeof raw === 'string' && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return Math.min(Math.max(n, 1), Math.max(pages, 1));
}

async function windowOf(tenantId: string, tinId: string, walletId: string, direction: 'in' | 'out'): Promise<WalletWindowData> {
  const r = await listWalletWindow(tenantId, { tinId, walletId, direction, limit: WALLET_WINDOW_PAGE });
  return r.ok ? { rows: parseLedgerRows(r.events), next: r.next } : { rows: [], next: null };
}

/**
 * Every agent's own wallets, ten to a page, in the order the agents and then their wallets were
 * added, each with its two windows. Reads only this account's agents, and only the wallets of the
 * page shown.
 */
export async function loadWalletsPage(tenantId: string, pageRaw: unknown): Promise<WalletsPageData> {
  const [plan, tins] = await Promise.all([getPlanSummary(tenantId), listTins(tenantId)]);
  const perAgent = await Promise.all(tins.map(async (tin) => ({ tin, wallets: await listWallets(tenantId, tin.id) })));
  const all = perAgent.flatMap(({ tin, wallets }) => wallets.map((wallet) => ({ tin, wallet })));
  const pages = Math.max(1, Math.ceil(all.length / WALLETS_PER_PAGE));
  const page = pageOf(pageRaw, pages);
  const shown = all.slice((page - 1) * WALLETS_PER_PAGE, page * WALLETS_PER_PAGE);
  const labelsOf = new Map<string, Promise<Record<string, string>>>();
  const labels = (tinId: string) => {
    let p = labelsOf.get(tinId);
    if (!p) {
      p = listDestinations(tenantId, tinId).then((ds) => Object.fromEntries(ds.filter((d) => d.label).map((d) => [`${d.chain}|${d.address}`, d.label as string])));
      labelsOf.set(tinId, p);
    }
    return p;
  };
  const wallets = await Promise.all(
    shown.map(async ({ tin, wallet }): Promise<WalletBox> => {
      const [received, sent, named] = await Promise.all([windowOf(tenantId, tin.id, wallet.id, 'in'), windowOf(tenantId, tin.id, wallet.id, 'out'), labels(tin.id)]);
      return { agent: { id: tin.id, label: tin.label }, wallet, received, sent, labels: named };
    }),
  );
  return { plan, page, pages, total: all.length, first: shown.length ? (page - 1) * WALLETS_PER_PAGE + 1 : 0, wallets };
}

// ── History: where money came from ───────────────────────────────────────────

/** The most incoming transfers one year's list reads. Past it the list says it stopped there. */
export const MAX_SOURCE_TRANSFERS = 50_000;

export interface MoneySourcesData {
  /** The year shown, and every year the page offers, newest first. */
  year: number;
  years: number[];
  /** The agent the list is narrowed to, or null for every agent. */
  agentId: string | null;
  agents: Array<{ id: string; label: string }>;
  sources: MoneySource[];
  total: SourcesTotal;
  /** True when the year had more than MAX_SOURCE_TRANSFERS incoming transfers and the list stopped there. */
  truncated: boolean;
}

/**
 * Every transfer that reached one of this account's agents' own wallets in a UTC calendar year, grouped
 * by the address that sent it (./moneySources.ts). `yearRaw` and `agentRaw` come from the query string:
 * an unknown year is the newest, and an agent that is not one of this account's live agents is every
 * agent. Reads only this account's agents, one at a time, on the transfers index, with the day prices
 * laid over as on every other read.
 */
export async function loadMoneySources(tenantId: string, yearRaw: unknown, agentRaw: unknown, nowMs: number = Date.now()): Promise<MoneySourcesData> {
  const tins = await listTins(tenantId);
  const firstCreated = tins.reduce<string | null>((min, t) => (min === null || t.createdAt < min ? t.createdAt : min), null);
  const { years, year } = historyYears(firstCreated, new Date(nowMs).getUTCFullYear(), typeof yearRaw === 'string' ? yearRaw : null);
  const agentId = typeof agentRaw === 'string' && tins.some((t) => t.id === agentRaw) ? agentRaw : null;
  const read = agentId ? tins.filter((t) => t.id === agentId) : tins;

  const labels = new Map<string, string>();
  const ownWallets = new Map<string, string>();
  await Promise.all(
    tins.map(async (tin) => {
      const [wallets, destinations] = await Promise.all([listWallets(tenantId, tin.id), listDestinations(tenantId, tin.id)]);
      for (const w of wallets) if (!ownWallets.has(`${w.chain}|${w.address}`)) ownWallets.set(`${w.chain}|${w.address}`, tin.label);
      for (const d of destinations) if (d.label && !labels.has(`${d.chain}|${d.address}`)) labels.set(`${d.chain}|${d.address}`, d.label);
    }),
  );

  const transfers: IncomingTransfer[] = [];
  let truncated = false;
  for (const tin of read) {
    if (truncated) break;
    await readEventsInRange(
      tenantId,
      tin.id,
      yearRange(year),
      (e) => {
        if (transfers.length >= MAX_SOURCE_TRANSFERS) {
          truncated = true;
          return false;
        }
        if (!e.tx || !e.chain) return true;
        transfers.push({
          id: e.id,
          at: e.at,
          tinId: e.tinId,
          chain: e.chain,
          from: e.address,
          wallet: e.tx.wallet,
          amount: e.tx.amount,
          asset: e.tx.asset,
          assetContract: e.tx.assetContract,
          usd: e.tx.usd,
          hash: e.tx.hash,
          registry: e.registry,
          detail: e.detail,
        });
        return true;
      },
      { direction: 'in' },
    );
  }
  const { sources, total } = groupSources(transfers, { labels, ownWallets, agentNames: new Map(tins.map((t) => [t.id, t.label])) });
  return { year, years, agentId, agents: tins.map((t) => ({ id: t.id, label: t.label })), sources, total, truncated };
}
