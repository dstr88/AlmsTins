/**
 * Where an account's money came from: every transfer that reached one of its agents' own wallets in a
 * year, grouped by the address that sent it. What the History page's "Where money came from" list
 * shows (src/components/agentics/MoneySources.tsx), on the Agentics History page and on Memory Lane.
 *
 * Pure: no database, no network. The reader (./vaultPages.ts loadMoneySources) hands it the year's
 * incoming transfers, already with their day prices laid over (./dailyPrices.ts), and the account's
 * own names for addresses. Nothing here nets one side against another or prices anything after the
 * fact: a sender's USD total is the sum of each transfer's value at its time, in whole micro-dollars
 * (./money.ts), and a transfer with no value on record is counted on its own, never added in as zero.
 * Token amounts are added as exact decimals, never as floats.
 *
 * A sender is one address on one chain. Its status is the one recorded on its latest transfer this
 * year (the registry as it stood then), so a sender that was added to the list partway through the
 * year reads as it reads now, and the earlier transfers keep their own status in the ledger.
 */
import { counterpartyOf, type CounterpartyStatus } from './counterparty';
import { addTransfer, emptySums, toSideTotal, type SideSums, type SideTotal } from './money';
import { pendingPriceOf } from './pricePending';
import type { VaultChain } from './addresses';

/** One incoming transfer, as the reader hands it over. */
export interface IncomingTransfer {
  id: string;
  /** When it happened, UTC ISO-8601. */
  at: string;
  tinId: string;
  chain: VaultChain;
  /** The address that sent it (the event's other side), lowercase for an EVM address. */
  from: string;
  /** The agent's own wallet that received it. */
  wallet: string;
  amount: string;
  asset: string;
  assetContract: string | null;
  usd: number | null;
  hash: string;
  /** The registry column as recorded: trusted, pending, flagged, or none (not on the list). */
  registry: string | null;
  /** The ledger's price detail and the rest, as stored. */
  detail: Record<string, unknown> | null;
}

/** How much of one token a sender sent. */
export interface SourceAsset {
  asset: string;
  assetContract: string | null;
  /** The exact total, as a decimal string. */
  amount: string;
}

/** One of a sender's transfers, as its open row lists it. */
export interface SourceTransfer {
  id: string;
  at: string;
  amount: string;
  asset: string;
  usd: number | null;
  pricePending: boolean;
  hash: string;
  /** The agent whose wallet received it, by name. */
  agent: string;
  wallet: string;
}

/** One sender and everything it sent in the year. */
export interface MoneySource {
  /** `chain|address`: unique in a list. */
  key: string;
  chain: VaultChain;
  address: string;
  /** The label an agent gave this address on its list, if any. */
  label: string | null;
  /** When the sender is one of the account's own agent wallets: that agent's name. */
  ownWalletOf: string | null;
  /** The status recorded on its latest transfer this year. */
  status: CounterpartyStatus | null;
  /** True when the chain's listing showed the sender is a contract (a router, a bridge, a splitter). */
  contract: boolean;
  usd: SideTotal;
  /** Transfers whose USD value is still to come (the day's rate is taken at 12:00 UTC). */
  pendingCount: number;
  assets: SourceAsset[];
  firstAt: string;
  lastAt: string;
  /** The agents whose wallets it paid, by name, in the order first paid. */
  agents: string[];
  /** Its latest transfers, newest first, at most SOURCE_RECENT. */
  recent: SourceTransfer[];
}

/** The year's incoming money over every sender. */
export interface SourcesTotal {
  usd: SideTotal;
  pendingCount: number;
  senders: number;
  /** What came from addresses not on any agent's list. */
  notOnList: { senders: number; usd: SideTotal };
}

/** The most transfers a sender's open row lists. The rest are on the Wallets page. */
export const SOURCE_RECENT = 10;

/** Adds two non-negative decimal strings exactly. A value that does not read as one counts as zero. */
export function addDecimal(a: string, b: string): string {
  const parse = (s: string): { int: bigint; scale: number } => {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) return { int: 0n, scale: 0 };
    const frac = m[2] ?? '';
    return { int: BigInt(m[1] + frac), scale: frac.length };
  };
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  const sum = x.int * 10n ** BigInt(scale - x.scale) + y.int * 10n ** BigInt(scale - y.scale);
  if (scale === 0) return sum.toString();
  const digits = sum.toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, -scale);
  const frac = digits.slice(-scale).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

interface Building {
  source: MoneySource;
  sums: SideSums;
  latestAt: string;
  assets: Map<string, SourceAsset>;
}

/**
 * Groups a year's incoming transfers by sender, biggest first: by USD total, then by how many
 * transfers, then by the latest. `labels` and `ownWallets` are keyed `chain|address`; `agentNames` by
 * agent id. The transfers may come in any order.
 */
export function groupSources(
  transfers: Iterable<IncomingTransfer>,
  names: { labels: ReadonlyMap<string, string>; ownWallets: ReadonlyMap<string, string>; agentNames: ReadonlyMap<string, string> },
): { sources: MoneySource[]; total: SourcesTotal } {
  const by = new Map<string, Building>();
  const all = emptySums();
  let pendingAll = 0;
  for (const t of transfers) {
    const key = `${t.chain}|${t.from}`;
    let b = by.get(key);
    if (!b) {
      b = {
        source: {
          key,
          chain: t.chain,
          address: t.from,
          label: names.labels.get(key) ?? null,
          ownWalletOf: names.ownWallets.get(key) ?? null,
          status: null,
          contract: false,
          usd: toSideTotal(emptySums()),
          pendingCount: 0,
          assets: [],
          firstAt: t.at,
          lastAt: t.at,
          agents: [],
          recent: [],
        },
        sums: emptySums(),
        latestAt: '',
        assets: new Map(),
      };
      by.set(key, b);
    }
    const s = b.source;
    const pending = t.usd === null && pendingPriceOf(t.detail) !== null;
    addTransfer(b.sums, t.usd);
    addTransfer(all, t.usd);
    if (pending) {
      s.pendingCount += 1;
      pendingAll += 1;
    }
    if (t.detail?.contract === true) s.contract = true;
    if (t.at < s.firstAt) s.firstAt = t.at;
    if (t.at > s.lastAt) s.lastAt = t.at;
    if (t.at >= b.latestAt) {
      b.latestAt = t.at;
      s.status = counterpartyOf(t.registry);
    }
    const agent = names.agentNames.get(t.tinId) ?? '';
    if (agent && !s.agents.includes(agent)) s.agents.push(agent);
    const assetKey = `${t.asset}|${t.assetContract ?? ''}`;
    const have = b.assets.get(assetKey);
    if (have) have.amount = addDecimal(have.amount, t.amount);
    else b.assets.set(assetKey, { asset: t.asset, assetContract: t.assetContract, amount: addDecimal('0', t.amount) });
    s.recent.push({ id: t.id, at: t.at, amount: t.amount, asset: t.asset, usd: t.usd, pricePending: pending, hash: t.hash, agent, wallet: t.wallet });
    if (s.recent.length > SOURCE_RECENT * 2) trimRecent(s);
  }

  const sources: MoneySource[] = [];
  const notOnList = emptySums();
  let notOnListSenders = 0;
  for (const b of by.values()) {
    const s = b.source;
    s.usd = toSideTotal(b.sums);
    s.assets = [...b.assets.values()].sort((x, y) => x.asset.localeCompare(y.asset) || (x.assetContract ?? '').localeCompare(y.assetContract ?? ''));
    trimRecent(s);
    if (s.status === 'unregistered') {
      notOnListSenders += 1;
      notOnList.count += b.sums.count;
      notOnList.priced += b.sums.priced;
      notOnList.unpriced += b.sums.unpriced;
      notOnList.micros += b.sums.micros;
    }
    sources.push(s);
  }
  sources.sort((x, y) => y.usd.usd - x.usd.usd || y.usd.count - x.usd.count || y.lastAt.localeCompare(x.lastAt) || x.key.localeCompare(y.key));
  return {
    sources,
    total: { usd: toSideTotal(all), pendingCount: pendingAll, senders: sources.length, notOnList: { senders: notOnListSenders, usd: toSideTotal(notOnList) } },
  };
}

function trimRecent(s: MoneySource): void {
  s.recent.sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));
  if (s.recent.length > SOURCE_RECENT) s.recent.length = SOURCE_RECENT;
}

/** The UTC bounds of a calendar year, in the form `occurred_at` is stored in. The end is exclusive. */
export function yearRange(year: number): { fromIso: string; toIso: string } {
  return { fromIso: `${year}-01-01T00:00:00.000Z`, toIso: `${year + 1}-01-01T00:00:00.000Z` };
}

/**
 * The years a History page offers, newest first: from the year the account's first agent was created
 * to `nowYear`. `requested` is kept when it is a year from 2009 to `nowYear` (a page that shows other
 * history too, such as Memory Lane, may ask for a year before the first agent, and gets it, empty);
 * otherwise the newest is chosen.
 */
export function historyYears(firstCreatedAt: string | null, nowYear: number, requested: string | null): { years: number[]; year: number } {
  const first = firstCreatedAt ? Number(firstCreatedAt.slice(0, 4)) : nowYear;
  const start = Number.isInteger(first) && first >= 2009 && first <= nowYear ? first : nowYear;
  const years: number[] = [];
  for (let y = nowYear; y >= start; y -= 1) years.push(y);
  const asked = requested !== null && /^\d{4}$/.test(requested) ? Number(requested) : NaN;
  return { years, year: Number.isInteger(asked) && asked >= 2009 && asked <= nowYear ? asked : years[0] };
}
