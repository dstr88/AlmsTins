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
 */
import { listAgentKeys } from '@/lib/agentKeys';
import { fail, idOf, type Failure } from './errors';
import { eventsWrittenAfter, eventsWrittenSince, latestEventsWritten, type WrittenEvent } from './events';
import { getTin, listDestinations, listTins, nowUtc } from './store';
import type { EventView } from './vault';

/** Events an opening page shows, and the most one may ask for. */
export const FEED_HISTORY = 30;
export const FEED_HISTORY_MAX = 100;
/** Events one live answer carries, and the most one may ask for. */
export const FEED_POLL_LIMIT = 100;
export const FEED_POLL_LIMIT_MAX = 200;
/** How far before the newest second it has seen a live poll starts, in seconds. */
export const FEED_OVERLAP_S = 5;
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

  // Names and statuses, read only when there is something to name.
  const [tins, keys] = await Promise.all([listTins(tenantId), listAgentKeys(tenantId)]);
  const tinById = new Map(tins.map((t) => [t.id, t] as const));
  const keyStatus = new Map(keys.map((k) => [k.id, k.status] as const));
  const labels = new Map<string, Map<string, string>>();
  for (const id of new Set(raw.map((e) => e.tinId))) {
    if (!tinById.has(id)) continue;
    const byAddress = new Map<string, string>();
    for (const d of await listDestinations(tenantId, id)) {
      if (d.label && !byAddress.has(d.address)) byAddress.set(d.address, d.label);
    }
    labels.set(id, byAddress);
  }

  for (const e of raw) {
    const tin = tinById.get(e.tinId);
    if (!tin) continue; // an agent that has been removed leaves no card
    const { sourceIp: _hash, ...event } = e;
    answer.events.push({
      ...event,
      keyStatus: e.keyId ? (keyStatus.get(e.keyId) ?? 'unknown') : null,
      agent: tin.label,
      label: labels.get(e.tinId)?.get(e.address) ?? null,
    });
  }
  return answer;
}
