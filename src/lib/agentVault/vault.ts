/**
 * Agent Vault operations: what the /api/agentics endpoints call. Validation and rules live here;
 * SQL lives in ./store.ts and the checks in ./trustChecks.ts (rules in ./trustPolicy.ts).
 *
 * Every operation takes the tenant first and passes it to every query. Nothing here ever
 * returns, or accepts, a tenant id from a client.
 *
 * A plan's caps (./entitlements.ts) are enforced here: creating an agent, listing an own wallet and
 * registering an address each stop at the account's limit, atomically (the capped inserts in
 * ./store.ts), with `plan_limit` and the cap, its limit and the account's use. A removed row frees
 * its slot.
 *
 * Add + Trust: pasted destinations are stored as pending, then checked in one batch, and a
 * result is written only from a stored readout. A destination that fails a check becomes
 * "flagged", is kept and listed (never silently dropped), and stays flagged. A check that could
 * not run leaves it pending. Almstins verifies, warns and flags; the owner decides.
 */
import { listAgentKeys } from '@/lib/agentKeys';
import {
  dedupeEntries,
  normalizeAddress,
  parseChain,
  parseDestinationText,
  type RejectedLine,
  type VaultChain,
} from './addresses';
import {
  countLiveDestinations,
  countLiveTins,
  countLiveWallets,
  findLiveDestination,
  findLiveTinByKey,
  getDestinations,
  getTin,
  insertDestinationWithinCap,
  insertTin,
  insertTinWithinCap,
  insertWalletWithinCap,
  isUniqueViolation,
  listDestinations,
  listTins,
  listWallets,
  nowUtc,
  recordTrust,
  softDeleteDestination,
  softDeleteTin,
  softDeleteWallet,
  updateTin,
  type AgentWallet,
  type Destination,
  type Tin,
} from './store';
import { getEntitlements } from './entitlements';
import { fail, failLimit, idOf, type Failure, type VaultError } from './errors';
import { listEvents, parseCursor, sumTransactions, type LedgerEvent, type TinTotals } from './events';
import { defaultTrustDeps, runTrustChecks, type TrustDeps } from './trustChecks';
import { nextTrustStatus, type TrustStatus } from './trustPolicy';
import { defaultWatchDeps, runTinPass, type TinPassReport, type WatchDeps } from './watcher';

/**
 * The most destinations one request adds or checks. Each checked address makes about five
 * calls to the screening source (GoPlus), whose free budget the public wallet checker shares,
 * so a request stays small. Raise it only with a shared budget in front of that source.
 */
export const MAX_BATCH = 10;
/** The longest pasted text one request accepts. */
export const MAX_TEXT_CHARS = 50_000;
export const MAX_TIN_LABEL = 80;

export type { Failure, VaultError };

/** A tin's name: control characters out, whitespace collapsed, 1 to 80 characters. */
function cleanTinLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const label = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return null;
  return Array.from(label).slice(0, MAX_TIN_LABEL).join('');
}

/** A linked key id from a client: none (undefined, null, empty), a key id, or unusable. */
function keyIdOf(raw: unknown): { ok: true; id: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, id: null };
  if (typeof raw !== 'string') return { ok: false };
  const id = raw.trim();
  return /^[0-9a-f]{24}$/.test(id) ? { ok: true, id } : { ok: false };
}

/**
 * May this tenant link this key to a tin (other than `exceptTinId`)? The key must be the
 * tenant's own and active, and not already another live tin's: one tin is one agent.
 */
async function checkKeyLinkable(tenantId: string, keyId: string, exceptTinId: string | null): Promise<Failure | null> {
  const key = (await listAgentKeys(tenantId)).find((k) => k.id === keyId);
  if (!key) return fail('key_not_found');
  if (key.status !== 'active') return fail('key_not_active');
  const holder = await findLiveTinByKey(tenantId, keyId);
  if (holder && holder.id !== exceptTinId) return fail('key_in_use');
  return null;
}

// ── Tins ─────────────────────────────────────────────────────────────────────

export async function createTin(
  tenantId: string,
  input: { label?: unknown; agentKeyId?: unknown },
): Promise<{ ok: true; tin: Tin } | Failure> {
  const label = cleanTinLabel(input.label);
  if (!label) return fail('invalid_label');
  const key = keyIdOf(input.agentKeyId);
  if (!key.ok) return fail('key_not_found');
  if (key.id) {
    const refused = await checkKeyLinkable(tenantId, key.id, null);
    if (refused) return refused;
  }
  const { limits } = await getEntitlements(tenantId);
  try {
    if (limits.bots === null) return { ok: true, tin: await insertTin(tenantId, { label, agentKeyId: key.id, at: nowUtc() }) };
    const made = await insertTinWithinCap(tenantId, { label, agentKeyId: key.id, at: nowUtc() }, limits.bots);
    if (made.kind === 'over_limit') return failLimit('bots', limits.bots, await countLiveTins(tenantId));
    return { ok: true, tin: made.tin };
  } catch (e) {
    if (isUniqueViolation(e)) return fail('key_in_use');
    throw e;
  }
}

/** Renames a tin and/or links, relinks or unlinks (null) its agent key. A field left undefined is left alone. */
export async function renameOrRelinkTin(
  tenantId: string,
  id: unknown,
  input: { label?: unknown; agentKeyId?: unknown },
): Promise<{ ok: true; tin: Tin } | Failure> {
  const tinId = idOf(id);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');

  let label = tin.label;
  if (input.label !== undefined) {
    const cleaned = cleanTinLabel(input.label);
    if (!cleaned) return fail('invalid_label');
    label = cleaned;
  }
  let agentKeyId = tin.agentKeyId;
  if (input.agentKeyId !== undefined) {
    const key = keyIdOf(input.agentKeyId);
    if (!key.ok) return fail('key_not_found');
    if (key.id && key.id !== tin.agentKeyId) {
      const refused = await checkKeyLinkable(tenantId, key.id, tin.id);
      if (refused) return refused;
    }
    agentKeyId = key.id;
  }

  try {
    if (!(await updateTin(tenantId, tin.id, { label, agentKeyId }))) return fail('tin_not_found');
  } catch (e) {
    if (isUniqueViolation(e)) return fail('key_in_use');
    throw e;
  }
  return { ok: true, tin: { ...tin, label, agentKeyId } };
}

export async function removeTin(tenantId: string, id: unknown): Promise<{ ok: true } | Failure> {
  const tinId = idOf(id);
  if (!tinId) return fail('invalid_id');
  return (await softDeleteTin(tenantId, tinId, nowUtc())) ? { ok: true } : fail('tin_not_found');
}

export { listTins };

export async function getTinDetail(
  tenantId: string,
  id: unknown,
): Promise<{ ok: true; tin: Tin; wallets: AgentWallet[]; destinations: Destination[] } | Failure> {
  const tinId = idOf(id);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');
  const [wallets, destinations] = await Promise.all([listWallets(tenantId, tin.id), listDestinations(tenantId, tin.id)]);
  return { ok: true, tin, wallets, destinations };
}

// ── The agent's own wallets ──────────────────────────────────────────────────

/** Registers one of the agent's own wallets. Adding one that is already there is not an error (added: false). */
export async function addWallet(
  tenantId: string,
  input: { tinId?: unknown; chain?: unknown; address?: unknown },
): Promise<{ ok: true; added: boolean; wallet: AgentWallet } | Failure> {
  const tinId = idOf(input.tinId);
  if (!tinId) return fail('invalid_id');
  const chain = parseChain(input.chain);
  if (!chain) return fail('invalid_chain');
  const address = normalizeAddress(chain, input.address);
  if (!address) return fail('invalid_address');
  if (!(await getTin(tenantId, tinId))) return fail('tin_not_found');
  const { limits } = await getEntitlements(tenantId);
  // Every account adds through the guarded insert (a plan with no limit has a cap of null): the agent
  // is checked live and the account's lock taken, so a removal racing an add leaves no live row under
  // a removed agent for the owner either.
  const r = await insertWalletWithinCap(tenantId, { tinId, chain, address, at: nowUtc() }, limits.walletsPerBot);
  // Only a plan with a limit can be over it.
  if (r.kind === 'over_limit') return failLimit('wallets', limits.walletsPerBot ?? 0, await countLiveWallets(tenantId, tinId));
  // The agent was removed between the check above and the insert: nothing was written.
  if (r.kind === 'no_tin') return fail('tin_not_found');
  return { ok: true, added: r.kind === 'inserted', wallet: r.wallet };
}

export async function removeWallet(tenantId: string, id: unknown): Promise<{ ok: true } | Failure> {
  const walletId = idOf(id);
  if (!walletId) return fail('invalid_id');
  return (await softDeleteWallet(tenantId, walletId, nowUtc())) ? { ok: true } : fail('wallet_not_found');
}

// ── Destinations: Add + Trust ────────────────────────────────────────────────

export interface SkippedLine {
  line: number;
  chain: VaultChain;
  address: string;
  /** `over_limit`: the account's plan has no slot left for it (nothing was stored). */
  reason: 'already_registered' | 'repeated_in_paste' | 'over_limit';
  /** The destination that already holds the slot, for already_registered. */
  id?: string;
  trustStatus?: TrustStatus;
}

export interface AddDestinationsResult {
  ok: true;
  tinId: string;
  /** Whether the checks were run (the request can ask for destinations to be added without them). */
  checked: boolean;
  /** The headline: every pasted line is in exactly one of added, skipped or rejected. */
  summary: { added: number; trusted: number; flagged: number; pending: number; skipped: number; rejected: number };
  /** The destinations added, in their status after the checks. */
  destinations: Destination[];
  skipped: SkippedLine[];
  rejected: RejectedLine[];
}

/** The stored form of a readout's time: YYYY-MM-DD HH:MM:SS, like every other time in these tables. */
const storedTime = (iso: string): string => iso.slice(0, 19).replace('T', ' ');

/**
 * Adds the destinations in a pasted list to a tin and, unless `trust` is false, checks them.
 *
 *   - A line that is not an address is reported in `rejected` with a reason.
 *   - An address the tin already holds live, or repeats in the paste, is reported in `skipped`.
 *   - An address the account's plan has no slot left for is reported in `skipped` as `over_limit`
 *     and stores nothing. A paste that is longer than the slots left adds what fits and reports
 *     the rest this way. When not one address fits, the whole request is refused: `plan_limit`.
 *   - Every other address is stored as pending, checked in one bounded batch, and then marked:
 *     trusted (every check we ran came back without a hit), flagged (one did), or left pending
 *     (a check could not run, so nothing is claimed).
 *
 * Nothing is dropped without a word, and nothing is trusted without a stored passing readout.
 */
export async function addDestinations(
  tenantId: string,
  input: { tinId?: unknown; text?: unknown; chain?: unknown; trust?: unknown },
  deps: TrustDeps = defaultTrustDeps,
): Promise<AddDestinationsResult | Failure> {
  const tinId = idOf(input.tinId);
  if (!tinId) return fail('invalid_id');
  const defaultChain: VaultChain | null = input.chain === undefined ? 'ethereum' : parseChain(input.chain);
  if (!defaultChain) return fail('invalid_chain');
  if (typeof input.text !== 'string' || !input.text.trim()) return fail('nothing_to_add');
  if (input.text.length > MAX_TEXT_CHARS) return fail('text_too_long', MAX_TEXT_CHARS);
  if (!(await getTin(tenantId, tinId))) return fail('tin_not_found');

  const { entries, rejected } = parseDestinationText(input.text, defaultChain);
  const { unique, repeated } = dedupeEntries(entries);
  if (!unique.length && !rejected.length) return fail('nothing_to_add');
  if (unique.length > MAX_BATCH) return fail('too_many', MAX_BATCH);

  const skipped: SkippedLine[] = repeated.map((r) => ({ ...r, reason: 'repeated_in_paste' as const }));
  let added: Destination[] = [];
  const at = nowUtc();
  const { limits } = await getEntitlements(tenantId);
  // The checks this paste will start are paid for before anything is written. An account on a plan
  // with a cap on addresses has a budget of checks a minute (./checkBudget.ts); over it, nothing is
  // stored and nothing is asked, and the caller is told to wait.
  let charged = 0;
  if (input.trust !== false && limits.addresses !== null && deps.budget) {
    if (!deps.budget.spend(tenantId, unique.length)) return fail('rate_limited');
    charged = unique.length;
  }
  // Once the plan has no slot left, no later address of this paste can take one, so it is not tried:
  // it is reported over the limit, and an address that is already registered is still reported as that.
  let full = false;
  for (const entry of unique) {
    const row = { tinId, chain: entry.chain, address: entry.address, label: entry.label, at };
    let r: Awaited<ReturnType<typeof insertDestinationWithinCap>>;
    if (full) {
      const held = await findLiveDestination(tenantId, tinId, entry.chain, entry.address);
      r = held ? { kind: 'duplicate', destination: held } : { kind: 'over_limit' };
    } else {
      r = await insertDestinationWithinCap(tenantId, row, limits.addresses);
    }
    if (r.kind === 'no_tin') {
      // The agent was removed while this paste was being added: what was added before is removed with it,
      // and nothing was checked, so nothing is charged.
      if (charged > 0) deps.budget?.refund(tenantId, charged);
      return fail('tin_not_found');
    }
    if (r.kind === 'inserted') {
      added.push(r.destination);
    } else if (r.kind === 'over_limit') {
      full = true;
      skipped.push({ line: entry.line, chain: entry.chain, address: entry.address, reason: 'over_limit' });
    } else {
      skipped.push({
        line: entry.line,
        chain: entry.chain,
        address: entry.address,
        reason: 'already_registered',
        id: r.destination.id,
        trustStatus: r.destination.trustStatus,
      });
    }
  }
  // The checks were paid for before anything was written, for every line. Only the addresses that were
  // added are checked: the lines that were already registered or did not fit are given back.
  if (charged > added.length) deps.budget?.refund(tenantId, charged - added.length);
  // Nothing could be added because the plan is full: that is a refusal, not a paste that went through.
  // It still says what became of every line (an address already registered, a repeat, a line that is
  // not an address, and the ones the plan had no place for), exactly as an accepted paste does.
  if (limits.addresses !== null && !added.length && skipped.some((x) => x.reason === 'over_limit')) {
    skipped.sort((a, b) => a.line - b.line);
    return failLimit('addresses', limits.addresses, await countLiveDestinations(tenantId), { skipped, rejected });
  }

  const checked = input.trust !== false && added.length > 0;
  if (checked) {
    const readouts = await runTrustChecks(tenantId, added.map((d) => d.address), deps);
    const settled: Destination[] = [];
    for (const d of added) {
      const readout = readouts.get(d.address);
      if (!readout) {
        settled.push(d);
        continue;
      }
      const status = nextTrustStatus(d.trustStatus, readout);
      const checkedAt = storedTime(readout.checkedAt);
      const written = await recordTrust(tenantId, d.id, { status, readout, checkedAt });
      settled.push(written ? { ...d, trustStatus: status, trustCheckedAt: checkedAt, trust: readout } : d);
    }
    added = settled;
  }

  skipped.sort((a, b) => a.line - b.line);
  const count = (status: TrustStatus) => added.filter((d) => d.trustStatus === status).length;
  return {
    ok: true,
    tinId,
    checked,
    summary: {
      added: added.length,
      trusted: count('trusted'),
      flagged: count('flagged'),
      pending: count('pending'),
      skipped: skipped.length,
      rejected: rejected.length,
    },
    destinations: added,
    skipped,
    rejected,
  };
}

export interface TrustDestinationsResult {
  ok: true;
  tinId: string;
  /** The destinations that were checked, in their status now. */
  destinations: Destination[];
  /** Flagged destinations that stayed flagged: a flag is never cleared by a check. */
  stillFlagged: string[];
  /** Ids asked for that are not live destinations of this tin. */
  notFound: string[];
  /** Pending destinations left for a next call (a call checks at most MAX_BATCH). */
  remaining: number;
}

/**
 * (Re)checks destinations of a tin. With `ids`, exactly those; without, the tin's pending ones
 * (at most MAX_BATCH per call, `remaining` says how many are left). A flagged destination is
 * checked again but stays flagged: its stored readout is only ever replaced by another flag, so
 * a later clean answer, a partial one or a failed lookup cannot clear a warning. To clear one,
 * remove the destination and add it again.
 */
export async function trustDestinations(
  tenantId: string,
  input: { tinId?: unknown; ids?: unknown },
  deps: TrustDeps = defaultTrustDeps,
): Promise<TrustDestinationsResult | Failure> {
  const tinId = idOf(input.tinId);
  if (!tinId) return fail('invalid_id');
  if (!(await getTin(tenantId, tinId))) return fail('tin_not_found');

  let rows: Destination[];
  let notFound: string[] = [];
  let remaining = 0;
  if (input.ids !== undefined) {
    if (!Array.isArray(input.ids)) return fail('invalid_id');
    const wanted: string[] = [];
    for (const raw of input.ids) {
      const id = idOf(raw);
      if (!id) return fail('invalid_id');
      if (!wanted.includes(id)) wanted.push(id);
    }
    if (wanted.length > MAX_BATCH) return fail('too_many', MAX_BATCH);
    rows = await getDestinations(tenantId, tinId, wanted);
    notFound = wanted.filter((id) => !rows.some((r) => r.id === id));
  } else {
    const pending = (await listDestinations(tenantId, tinId)).filter((d) => d.trustStatus === 'pending');
    rows = pending.slice(0, MAX_BATCH);
    remaining = pending.length - rows.length;
  }

  // The same budget as an add: the checks are paid for before they are asked, and over it nothing runs.
  if (rows.length > 0 && deps.budget) {
    const { limits } = await getEntitlements(tenantId);
    if (limits.addresses !== null && !deps.budget.spend(tenantId, rows.length)) return fail('rate_limited');
  }
  // A person asked to check these again: a new screening each, never an answer remembered from a moment ago.
  const readouts = await runTrustChecks(tenantId, rows.map((d) => d.address), deps, { fresh: true });
  const destinations: Destination[] = [];
  const stillFlagged: string[] = [];
  for (const d of rows) {
    const readout = readouts.get(d.address);
    if (!readout) {
      destinations.push(d);
      continue;
    }
    if (d.trustStatus === 'flagged' && readout.result !== 'fail') {
      // Kept as it is, readout and all: the reasons it was flagged stay on record.
      stillFlagged.push(d.id);
      destinations.push(d);
      continue;
    }
    const status = nextTrustStatus(d.trustStatus, readout);
    const checkedAt = storedTime(readout.checkedAt);
    const written = await recordTrust(tenantId, d.id, { status, readout, checkedAt });
    destinations.push(written ? { ...d, trustStatus: status, trustCheckedAt: checkedAt, trust: readout } : d);
  }
  return { ok: true, tinId, destinations, stillFlagged, notFound, remaining };
}

export async function listTinDestinations(
  tenantId: string,
  tinIdRaw: unknown,
): Promise<{ ok: true; destinations: Destination[] } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  if (!(await getTin(tenantId, tinId))) return fail('tin_not_found');
  return { ok: true, destinations: await listDestinations(tenantId, tinId) };
}

/** Takes a destination out of the watched set. The row stays as history; the same address can be added again later. */
export async function removeDestination(tenantId: string, id: unknown): Promise<{ ok: true } | Failure> {
  const destinationId = idOf(id);
  if (!destinationId) return fail('invalid_id');
  return (await softDeleteDestination(tenantId, destinationId, nowUtc())) ? { ok: true } : fail('destination_not_found');
}

// ── The ledger ───────────────────────────────────────────────────────────────

export const DEFAULT_EVENT_PAGE = 50;
export const MAX_EVENT_PAGE = 200;

/**
 * An event as the endpoint answers it: the ledger row, and whether the key that asked is still
 * active. The caller's hash (`sourceIp`) is metadata for the Vault and is not part of the answer.
 */
export interface EventView extends Omit<LedgerEvent, 'sourceIp'> {
  keyStatus: 'active' | 'pending' | 'revoked' | 'unknown' | null;
}

export type EventPage = { ok: true; events: EventView[]; next: string | null };

/**
 * A tin's ledger, newest first. `limit` and `before` come straight from a query string, so both
 * are checked here: a limit that is not a positive integer falls back to the default and is
 * capped, and a cursor that is not one this code made is refused.
 */
export async function listTinEvents(
  tenantId: string,
  tinId: unknown,
  opts: { limit?: unknown; before?: unknown } = {},
): Promise<EventPage | Failure> {
  const id = idOf(tinId);
  if (!id) return fail('invalid_id');
  const tin = await getTin(tenantId, id);
  if (!tin) return fail('tin_not_found');
  const asked = Number(opts.limit);
  const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_EVENT_PAGE) : DEFAULT_EVENT_PAGE;
  let before: { at: string; id: string } | null = null;
  if (opts.before != null && opts.before !== '') {
    before = parseCursor(opts.before);
    if (!before) return fail('invalid_cursor');
  }
  const page = await listEvents(tenantId, tin.id, { limit, before });
  // A rotated key stays on the events it made, marked: the ledger never forgets who asked.
  const statuses = new Map((await listAgentKeys(tenantId)).map((k) => [k.id, k.status]));
  return {
    ok: true,
    events: page.events.map(({ sourceIp: _hash, ...e }) => ({ ...e, keyStatus: e.keyId ? (statuses.get(e.keyId) ?? 'unknown') : null })),
    next: page.next,
  };
}

// ── Watching the destinations ────────────────────────────────────────────────

/** How long one owner-triggered read may keep starting new calls: the web request has to answer well inside the host's limit. */
export const REFRESH_DEADLINE_MS = 20_000;

// A read of one tin at a time per process; a second ask while one runs is told so instead of doubling the explorer calls.
const refreshing = new Set<string>();

/**
 * Reads the chain now for one tin: the same pass the daily job runs, bounded by a deadline, so a
 * tin with many wallets may answer `partial` and finish on the next call or the daily run (the
 * cursor keeps what was read). The answer names the owner's own wallets and says nothing about
 * any address that is not in the registry.
 */
export async function refreshTin(
  tenantId: string,
  tinIdRaw: unknown,
  deps: WatchDeps = defaultWatchDeps,
): Promise<{ ok: true; pass: TinPassReport } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');
  const key = `${tenantId}|${tin.id}`;
  if (refreshing.has(key)) return fail('refresh_in_progress');
  refreshing.add(key);
  try {
    return { ok: true, pass: await runTinPass(tenantId, tin, deps, { deadlineAt: deps.now() + REFRESH_DEADLINE_MS }) };
  } finally {
    refreshing.delete(key);
  }
}

/** What a tin's recorded transfers add up to: raw value in (bought) and out (sold), in USD at the time of each transfer. */
export async function getTinTotals(tenantId: string, tinIdRaw: unknown): Promise<{ ok: true; tinId: string; totals: TinTotals } | Failure> {
  const tinId = idOf(tinIdRaw);
  if (!tinId) return fail('invalid_id');
  const tin = await getTin(tenantId, tinId);
  if (!tin) return fail('tin_not_found');
  return { ok: true, tinId: tin.id, totals: await sumTransactions(tenantId, tin.id) };
}
