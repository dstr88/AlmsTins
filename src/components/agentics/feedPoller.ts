/**
 * The live feed's poll: ask /api/agentics/feed every few seconds for what the Vault has written since the
 * last answer, and hand each new row to the page once.
 *
 * Everything outside the logic is a parameter (the request, the timers, the clock, whether the tab is visible),
 * so the rules are unit tests with a fake clock and no network:
 *
 *   - It asks from `since`. The server starts five seconds before it, on purpose (the ledger stamps events to
 *     the second, and a write can show a moment after its stamp), and this drops what it already has by id.
 *   - An answer that says `more` is followed at once with the cursor it gave, so a backlog (a burst, or a
 *     tab that was asleep) is read to its end in the same turn, up to MAX_PAGES. A backlog longer than that
 *     is not started over from `since` (which, with the server's overlap, could land on the same first
 *     MAX_PAGES pages again and never get past them): the next turn CONTINUES from the cursor, and soon.
 *   - A request that is not answered in REQUEST_TIMEOUT_MS counts as a failure (./withTimeout.ts).
 *   - A hidden tab does not poll. When it is shown again it asks at once.
 *   - A failure waits longer each time (6, 12, 24, then 30 seconds) and says so; a rate limit waits half a
 *     minute; losing the sign-in or the Vault (401, 404) stops for good and says so.
 *
 * Where `since` goes, and why it is not simply "the newest second seen". Two things go wrong if it is:
 *
 *   1. After a burst the ledger goes quiet, `since` stays at the burst's last second, and every poll for as long
 *      as the page is open re-reads the burst's last five seconds (hundreds of rows, several requests, for nothing).
 *   2. A write that shows late (its stamp is up to five seconds older than the moment it shows) and lands BEHIND
 *      the cursor of a backlog being read is never returned by that read, and once the backlog is done `since`
 *      has moved past it.
 *
 * So `since` moves only past what has SETTLED. A newest-second value is settled SETTLE_MS after it was first
 * seen: anything stamped at or before it that has not shown by then never will (a late write shows within five
 * seconds). The poll remembers when each newest value was first seen, and a pass (one read from `since` to the
 * end of its backlog) moves `since` to the value that had settled when the pass BEGAN (plus
 * SINCE_PAST_FINAL_S, because the server subtracts its five seconds): whatever showed during the pass, behind
 * its cursor or not, is stamped after that value and is read again by the next pass. Only the page's own clock
 * is used, never a comparison between the page's clock, the server's and the database's.
 */
import { parseFeedRows, type FeedRow } from './feedRows';
import type { Send } from './client';
import { answerWithin } from './withTimeout';

/** How often a visible page asks. */
export const POLL_MS = 3000;
/** The longest it waits after failures. */
export const BACKOFF_MAX_MS = 30_000;
/** What it waits after being told it asks too often. */
export const RATE_LIMITED_WAIT_MS = 30_000;
/** Answers followed in one turn when each says there is more. */
export const MAX_PAGES = 10;
/** A turn that left a backlog unread asks again this soon, from the cursor it left off at. */
export const CATCH_UP_MS = 250;
/** A request not answered in this long counts as a failure. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** A newest-second value is final this long after it was first seen (a late write shows within five seconds of its stamp). */
export const SETTLE_MS = 6_000;
/** `since` goes this many seconds past a settled value: the server starts five seconds before `since`, so the window begins one second after it. */
export const SINCE_PAST_FINAL_S = 6;
/** An id can come back only while its second is inside the server's window; it is kept this many seconds longer than that. */
export const SEEN_MARGIN_S = 5;
/** Ids are looked over for forgetting only once there are more than this many. */
export const SEEN_SWEEP_AT = 1000;
/** The most ids ever kept, whatever their age: the oldest go first. */
export const SEEN_HARD_MAX = 50_000;

const EPOCH = '1970-01-01 00:00:00';
const WRITTEN_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** The server's own overlap, in seconds (FEED_OVERLAP_S in src/lib/agentVault/feed.ts). */
const SERVER_OVERLAP_S = 5;

export type ConnState = 'live' | 'reconnecting' | 'slow' | 'hidden' | 'closed';

export interface PollerDeps {
  send: Send;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Whether the tab is showing. */
  visible: () => boolean;
  /** Rows not seen before, oldest first. */
  onRows: (rows: FeedRow[]) => void;
  /** The connection's state, and the time of the last answer that worked (ISO-8601, from the server's clock), or null. */
  onState: (state: ConnState, lastGoodAt: string | null) => void;
  /** The page's own clock in milliseconds; Date.now when omitted. */
  now?: () => number;
}

export interface FeedPoller {
  start(): void;
  stop(): void;
  /** Ask now instead of waiting (after a read of the chain, say). */
  pollNow(): void;
  /** Tell it the tab was shown or hidden. */
  visibilityChanged(): void;
}

/** "YYYY-MM-DD HH:MM:SS" (UTC) moved by `seconds`. */
function shift(stamp: string, seconds: number): string {
  return new Date(Date.parse(`${stamp.replace(' ', 'T')}Z`) + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export function createFeedPoller(deps: PollerDeps, begin: { since: string; seen?: Iterable<string | { id: string; writtenAt: string }> }): FeedPoller {
  const clock = deps.now ?? Date.now;
  let since = WRITTEN_AT.test(begin.since) ? begin.since : EPOCH;
  /** The newest second any answer has reached, and when each such value was first seen (oldest first, both rising). */
  let newest = since;
  let observed: Array<{ stamp: string; at: number }> = [{ stamp: since, at: clock() }];
  /** The value that had settled when the pass in progress began (null: none had), while a pass is in progress. */
  let passSettled: string | null = null;
  /** Ids handed over, with their second. */
  const seen = new Map<string, string>();
  for (const s of begin.seen ?? []) {
    if (typeof s === 'string') seen.set(s, since);
    else seen.set(s.id, WRITTEN_AT.test(s.writtenAt) ? s.writtenAt : since);
  }
  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let closed = false;
  let failures = 0;
  let lastGoodAt: string | null = null;
  let resetOnce = false;
  /** Where a backlog that did not fit in one turn continues from (a cursor), or null. */
  let resume: string | null = null;

  const cancel = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    cancel();
    timer = deps.setTimer(() => {
      timer = null;
      void poll();
    }, ms);
  };

  /** The newest-second value that had settled by now (the latest one first seen SETTLE_MS ago or more), or null. */
  const settledNow = (): string | null => {
    const cutoff = clock() - SETTLE_MS;
    let at = -1;
    for (let i = 0; i < observed.length; i += 1) {
      if (observed[i].at <= cutoff) at = i;
      else break;
    }
    if (at < 0) return null;
    // The settled one stays as the base; the older ones are of no use any more.
    if (at > 0) observed = observed.slice(at);
    return observed[0].stamp;
  };

  /** A pass has reached the end of its backlog: `since` moves past what had settled when it began, never back. */
  const finishPass = () => {
    if (passSettled !== null) {
      const next = shift(passSettled, SINCE_PAST_FINAL_S);
      if (next > since) since = next;
    }
    passSettled = null;
  };

  const remember = (rows: FeedRow[]) => {
    for (const r of rows) seen.set(r.id, r.writtenAt);
    if (seen.size <= SEEN_SWEEP_AT) return;
    // What the server can no longer send (its second is before its window, with a margin) need not be remembered.
    const cutoff = shift(since, -(SERVER_OVERLAP_S + SEEN_MARGIN_S));
    for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
    if (seen.size > SEEN_HARD_MAX) {
      let drop = seen.size - SEEN_HARD_MAX;
      for (const id of seen.keys()) {
        if (drop <= 0) break;
        seen.delete(id);
        drop -= 1;
      }
    }
  };

  async function poll(): Promise<void> {
    if (!running || closed || inFlight) return;
    if (!deps.visible()) {
      deps.onState('hidden', lastGoodAt);
      return;
    }
    inFlight = true;
    try {
      // A read from `since` is a new pass; a read from a cursor carries on the pass a turn before began.
      if (resume === null) passSettled = settledNow();
      const fresh: FeedRow[] = [];
      const inTurn = new Set<string>();
      let reached = newest;
      let url = resume ? `/api/agentics/feed?after=${encodeURIComponent(resume)}` : `/api/agentics/feed?since=${encodeURIComponent(since)}`;
      let serverNow: string | null = null;
      let leftOff: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const r = await answerWithin(deps.send('GET', url), REQUEST_TIMEOUT_MS, deps);
        if (!running) return;
        if (r.status === 401 || r.status === 404) {
          closed = true;
          deps.onState('closed', lastGoodAt);
          return;
        }
        if (r.status === 429) {
          deps.onState('slow', lastGoodAt);
          schedule(RATE_LIMITED_WAIT_MS);
          return;
        }
        if (!r.ok || !r.body) {
          // A cursor this code made is refused only if something is wrong with ours: start over once from the beginning (the ids drop repeats), then treat it as any failure.
          if (r.status === 400 && !resetOnce) {
            resetOnce = true;
            since = EPOCH;
            newest = EPOCH;
            observed = [{ stamp: EPOCH, at: clock() }];
            passSettled = null;
            resume = null;
            schedule(0);
            return;
          }
          failures += 1;
          deps.onState('reconnecting', lastGoodAt);
          schedule(Math.min(BACKOFF_MAX_MS, POLL_MS * 2 ** failures));
          return;
        }
        for (const row of parseFeedRows(r.body.events)) {
          if (row.writtenAt > reached) reached = row.writtenAt;
          if (seen.has(row.id) || inTurn.has(row.id)) continue;
          inTurn.add(row.id);
          fresh.push(row);
        }
        if (typeof r.body.now === 'string') serverNow = r.body.now;
        const cursor = r.body.cursor;
        if (r.body.more === true && typeof cursor === 'string' && cursor) {
          url = `/api/agentics/feed?after=${encodeURIComponent(cursor)}`;
          leftOff = cursor;
          continue;
        }
        leftOff = null;
        break;
      }
      // Ended by the page limit with more to read: the next turn continues from where this one stopped.
      resume = leftOff;
      if (reached > newest) {
        newest = reached;
        observed.push({ stamp: newest, at: clock() });
      }
      if (resume === null) finishPass();
      failures = 0;
      resetOnce = false;
      lastGoodAt = serverNow ?? lastGoodAt;
      if (fresh.length) {
        remember(fresh);
        deps.onRows(fresh);
      }
      deps.onState('live', lastGoodAt);
      schedule(resume ? CATCH_UP_MS : POLL_MS);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      closed = false;
      if (deps.visible()) schedule(POLL_MS);
      else deps.onState('hidden', lastGoodAt);
    },
    stop() {
      running = false;
      cancel();
    },
    pollNow() {
      if (!running || closed || inFlight) return;
      cancel();
      void poll();
    },
    visibilityChanged() {
      if (!running || closed) return;
      if (deps.visible()) {
        if (!inFlight && timer === null) void poll();
      } else {
        cancel();
        deps.onState('hidden', lastGoodAt);
      }
    },
  };
}
