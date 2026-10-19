/**
 * The live feed's poll: ask /api/agentics/feed every few seconds for what the Vault has written since the
 * last answer, and hand each new row to the page once.
 *
 * Everything outside the logic is a parameter (the request, the timers, whether the tab is visible), so
 * the rules are unit tests with a fake clock and no network:
 *
 *   - It asks from the newest second it has seen (`since`). The server starts a few seconds earlier, on
 *     purpose, and this drops what it already has by id.
 *   - An answer that says `more` is followed at once with the cursor it gave, so a backlog (a burst, or a
 *     tab that was asleep) is read to its end in the same turn, up to MAX_PAGES. A backlog longer than that
 *     is not started over from `since` (which, with the server's overlap, could land on the same first
 *     MAX_PAGES pages again and never get past them): the next turn CONTINUES from the cursor, and soon.
 *   - A request that is not answered in REQUEST_TIMEOUT_MS counts as a failure (./withTimeout.ts).
 *   - A hidden tab does not poll. When it is shown again it asks at once.
 *   - A failure waits longer each time (6, 12, 24, then 30 seconds) and says so; a rate limit waits half a
 *     minute; losing the sign-in or the Vault (401, 404) stops for good and says so.
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
/** Ids kept to drop repeats; the oldest are forgotten past this. */
export const SEEN_MAX = 5000;
const SEEN_KEEP = 2000;

const EPOCH = '1970-01-01 00:00:00';
const WRITTEN_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

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
}

export interface FeedPoller {
  start(): void;
  stop(): void;
  /** Ask now instead of waiting (after a read of the chain, say). */
  pollNow(): void;
  /** Tell it the tab was shown or hidden. */
  visibilityChanged(): void;
}

export function createFeedPoller(deps: PollerDeps, begin: { since: string; seen?: Iterable<string> }): FeedPoller {
  let since = WRITTEN_AT.test(begin.since) ? begin.since : EPOCH;
  let seen = new Set<string>(begin.seen ?? []);
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
  const remember = (ids: string[]) => {
    for (const id of ids) seen.add(id);
    if (seen.size > SEEN_MAX) seen = new Set([...seen].slice(seen.size - SEEN_KEEP));
  };

  async function poll(): Promise<void> {
    if (!running || closed || inFlight) return;
    if (!deps.visible()) {
      deps.onState('hidden', lastGoodAt);
      return;
    }
    inFlight = true;
    try {
      const fresh: FeedRow[] = [];
      let nextSince = since;
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
          if (seen.has(row.id)) continue;
          fresh.push(row);
        }
        const answered = r.body.since;
        if (typeof answered === 'string' && WRITTEN_AT.test(answered) && answered > nextSince) nextSince = answered;
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
      since = nextSince;
      failures = 0;
      resetOnce = false;
      lastGoodAt = serverNow ?? lastGoodAt;
      if (fresh.length) {
        remember(fresh.map((r) => r.id));
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
