/**
 * The live feed's read side: an account's ledger events in the order the Vault WROTE them, so a page
 * can ask "what is new since I last looked" every few seconds and show each event as it arrives.
 *
 * Why the order of writing and not the time of the event. A check is written the moment the agent asks,
 * but a transfer is written minutes after its block: the watcher reads only blocks old enough that a
 * reorganization is unlikely to undo them (src/lib/agentVault/watcher.ts), then records the transfer with
 * the time of its block. A feed that followed the time of the event would never show a transfer: it
 * would be recorded "in the past" of everything the feed had already seen. The table's own created_at
 * is the moment of writing, and that is what the feed follows.
 *
 * created_at has one-second resolution and the ids that break a tie are random, so no single position is
 * safe to resume from: two events written in the same second can become visible one after the other. A
 * live poll therefore starts a few seconds BEFORE the newest second it has seen (FEED_OVERLAP_S) and the
 * page drops what it already has by id. A backlog that is longer than one answer is read with a strict
 * (writtenAt, id) cursor, so a burst of events in one second still ends.
 *
 * Three ways to ask, all for the account in the session:
 *   - nothing: the newest events, for a page that is just opening;
 *   - `since`: a live poll (inclusive, with the overlap above);
 *   - `after`: the next page of a backlog (strict), from the `cursor` the last answer gave.
 *
 * What an event carries is what the ledger endpoint (/api/agentics/events) gives its owner, plus the
 * agent's name and the owner's own label for the address, so a card can say whose it is. Never the
 * caller's address hash, and nothing of an agent that has been removed.
 *
 * What a poll costs. Every poll returns the newest second again (the overlap above), so a poll is almost never
 * empty once the ledger has anything in it, and each one would otherwise look up the agents, the keys and the labels.
 * Those change rarely and polls come every few seconds, so they are remembered per account for FEED_NAMES_TTL_MS.
 * A poll that finds them remembered is one query: about every other poll of one page, and more of them when an
 * account has several pages open, since the memory is the account's and not the page's.
 *
 * What the memory costs in honesty: a rename, a changed label, a revoked key, or an agent removed in the last
 * FEED_NAMES_TTL_MS seconds shows on the cards that arrive in that time as it was. It is never wrong about whose an
 * event is (that is the event's own tin_id, read fresh), and an agent or a key ADDED since is noticed at once: its
 * events name one the remembered lists do not have, so the lists are read again (a key the page would otherwise call
 * "no longer on this account" a moment after it was linked).
 */
import { listAgentKeys } from '@/lib/agentKeys';
import { fail, idOf, type Failure } from './errors';
import { eventsWrittenAfter, eventsWrittenSince, latestEventsWritten, type WrittenEvent } from './events';
import { getTin, listDestinations, listTins, nowUtc, type Tin } from './store';
import type { EventView } from './vault';

/** Events an opening page shows, and the most one may ask for. */
export const FEED_HISTORY = 30;
export const FEED_HISTORY_MAX = 100;
/** Events one live answer carries, and the most one may ask for. */
export const FEED_POLL_LIMIT = 100;
export const FEED_POLL_LIMIT_MAX = 200;
/** How far before the newest second it has seen a live poll starts, in seconds. */
export const FEED_OVERLAP_S = 5;
/** How long the names on a card (agents, keys, labels) are remembered per account. */
export const FEED_NAMES_TTL_MS = 5_000;
/** What an account may ask of the feed: this many requests in one window, counted per account in this process only. */
export const FEED_REQUESTS_PER_WINDOW = 120;
export const FEED_REQUEST_WINDOW_MS = 60_000;

/** Before every event: where a feed that has seen nothing starts. */
export const FEED_EPOCH = '1970-01-01 00:00:00';

/** One event for the feed: the event, when it was written, whose it is and what the owner calls the address. */
export interface FeedEvent extends EventView {
  writtenAt: string;
  /** The agent's name, as its owner wrote it. Untrusted text. */
  agent: string;
  /** The owner's label for the address, or null. Untrusted text. */
  label: string | null;
}

export interface FeedAnswer {
  ok: true;
  /** Oldest first. */
  events: FeedEvent[];
  /** Where the next live poll starts (`since`): the newest second this answer reached, or the one it was asked from. */
  since: string;
  /** The position to continue a backlog from (`after`), or null when there is nothing more. */
  cursor: string | null;
  /** There are more events than this answer carries: ask again with `after`. */
  more: boolean;
  /** The server's clock, UTC ISO-8601. */
  now: string;
}

const WRITTEN_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;

/** A `since`, or null when it is not a time this code wrote. */
function parseSince(raw: unknown): string | null {
  if (typeof raw !== 'string' || !WRITTEN_AT.test(raw)) return null;
  return Number.isFinite(Date.parse(`${raw.replace(' ', 'T')}Z`)) ? raw : null;
}

/** The cursor of an event: where a backlog continues from. */
export const cursorOfWritten = (e: Pick<WrittenEvent, 'writtenAt' | 'id'>): string => `${e.writtenAt}|${e.id}`;

/** An `after`, or null when it is not a cursor this code made. */
function parseAfter(raw: unknown): { writtenAt: string; id: string } | null {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf('|');
  if (at < 0) return null;
  const writtenAt = parseSince(raw.slice(0, at));
  const id = raw.slice(at + 1);
  return writtenAt && EVENT_ID.test(id) ? { writtenAt, id } : null;
}

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/** What a card needs to name, for one account, as of `at` (milliseconds). */
interface Names {
  at: number;
  tins: Map<string, Tin>;
  keys: Map<string, string>;
  /** The owner's labels, by agent and then by address, read the first time an agent's events are shown. */
  labels: Map<string, Map<string, string>>;
  /** Agents and keys that events name and the lists did not have when they were read (an agent removed, a key no longer there): not looked for again until the lists are read afresh. */
  goneTins: Set<string>;
  goneKeys: Set<string>;
}

// Per account, in this process, bounded. Never shared between accounts: the key is the tenant, and everything in an entry was read for it.
const NAMES = new Map<string, Names>();
/** The most accounts whose names are remembered at once; past it the memory starts over. */
export const FEED_NAMES_MAX_TENANTS = 1_000;

/** For tests: how many accounts' names are remembered, and the most there can be. */
export function _debugFeedNames(): { tenants: number; max: number } {
  return { tenants: NAMES.size, max: FEED_NAMES_MAX_TENANTS };
}

async function namesFor(tenantId: string, tinIds: ReadonlySet<string>, keyIds: ReadonlySet<string>, nowMs: number): Promise<Names> {
  let names = NAMES.get(tenantId);
  const expired = !names || nowMs - names.at >= FEED_NAMES_TTL_MS || nowMs < names.at;
  // An agent or a key the lists did not have when they were read: added since, or gone. Read them again once to tell which.
  const unknown =
    names !== undefined &&
    ([...tinIds].some((id) => !names!.tins.has(id) && !names!.goneTins.has(id)) || [...keyIds].some((id) => !names!.keys.has(id) && !names!.goneKeys.has(id)));
  if (!names || expired || unknown) {
    const [tins, keys] = await Promise.all([listTins(tenantId), listAgentKeys(tenantId)]);
    names = {
      at: nowMs,
      tins: new Map(tins.map((t) => [t.id, t] as const)),
      keys: new Map(keys.map((k) => [k.id, k.status] as const)),
      labels: new Map(),
      goneTins: new Set(),
      goneKeys: new Set(),
    };
    for (const id of tinIds) if (!names.tins.has(id)) names.goneTins.add(id);
    for (const id of keyIds) if (!names.keys.has(id)) names.goneKeys.add(id);
    // Full: start over, but only for an account the memory does not have yet (a refresh of one it has replaces it in place).
    if (!NAMES.has(tenantId) && NAMES.size >= FEED_NAMES_MAX_TENANTS) NAMES.clear();
    NAMES.set(tenantId, names);
  }
  for (const id of tinIds) {
    if (!names.tins.has(id) || names.labels.has(id)) continue;
    const byAddress = new Map<string, string>();
    for (const d of await listDestinations(tenantId, id)) {
      if (d.label && !byAddress.has(d.address)) byAddress.set(d.address, d.label);
    }
    names.labels.set(id, byAddress);
  }
  return names;
}

/** A time `seconds` earlier, in the form created_at is stored in. */
function secondsBefore(writtenAt: string, seconds: number): string {
  return nowUtc(new Date(Date.parse(`${writtenAt.replace(' ', 'T')}Z`) - seconds * 1000));
}

export async function readFeed(
  tenantId: string,
  q: { since?: unknown; after?: unknown; limit?: unknown; tinId?: unknown },
  now: () => Date = () => new Date(),
): Promise<FeedAnswer | Failure> {
  const hasSince = present(q.since);
  const hasAfter = present(q.after);
  if (hasSince && hasAfter) return fail('invalid_cursor');
  const since = hasSince ? parseSince(q.since) : null;
  const after = hasAfter ? parseAfter(q.after) : null;
  if ((hasSince && !since) || (hasAfter && !after)) return fail('invalid_cursor');

  let tinId: string | null = null;
  if (present(q.tinId)) {
    tinId = idOf(q.tinId);
    if (!tinId) return fail('invalid_id');
    if (!(await getTin(tenantId, tinId))) return fail('tin_not_found');
  }

  const live = since !== null || after !== null;
  const asked = Number(q.limit);
  const cap = live ? FEED_POLL_LIMIT_MAX : FEED_HISTORY_MAX;
  const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, cap) : live ? FEED_POLL_LIMIT : FEED_HISTORY;

  let raw: WrittenEvent[];
  let more = false;
  if (after) {
    ({ events: raw, more } = await eventsWrittenAfter(tenantId, { ...after, limit, tinId }));
  } else if (since) {
    ({ events: raw, more } = await eventsWrittenSince(tenantId, { writtenAt: secondsBefore(since, FEED_OVERLAP_S), limit, tinId }));
  } else {
    raw = await latestEventsWritten(tenantId, { limit, tinId });
  }

  const last = raw.length ? raw[raw.length - 1] : null;
  const answer: FeedAnswer = {
    ok: true,
    events: [],
    // Never earlier than the position it was asked from, so a poll that finds nothing does not slide back.
    since: last ? (since && last.writtenAt < since ? since : last.writtenAt) : (since ?? after?.writtenAt ?? FEED_EPOCH),
    cursor: more && last ? cursorOfWritten(last) : null,
    more,
    now: now().toISOString(),
  };
  if (!raw.length) return answer;

  // Names and statuses, from the account's remembered ones (see the top of this file: a quiet poll is one query).
  const names = await namesFor(tenantId, new Set(raw.map((e) => e.tinId)), new Set(raw.flatMap((e) => (e.keyId ? [e.keyId] : []))), now().getTime());
  for (const e of raw) {
    const tin = names.tins.get(e.tinId);
    if (!tin) continue; // an agent that has been removed leaves no card
    const { sourceIp: _hash, ...event } = e;
    answer.events.push({
      ...event,
      keyStatus: e.keyId ? ((names.keys.get(e.keyId) as EventView['keyStatus']) ?? 'unknown') : null,
      agent: tin.label,
      label: names.labels.get(e.tinId)?.get(e.address) ?? null,
    });
  }
  return answer;
}
