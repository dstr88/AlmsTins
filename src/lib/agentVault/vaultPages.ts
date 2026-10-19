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
import { getPlanSummary, type PlanSummary } from './entitlements';
import { idOf } from './errors';
import { latestEventTime, sumTransactions, type TinTotals } from './events';
import { parseLedgerRows, type LedgerRow } from './ledgerView';
import { utcDay } from './report';
import { createdDay } from './reports';
import { getTin, listDestinations, listTins, listWallets, type AgentWallet, type Destination, type Tin } from './store';
import { listTinEvents } from './vault';

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
  };
}
