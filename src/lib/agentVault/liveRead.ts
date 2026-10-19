/**
 * Reading an account's wallets while its Live page is open. The page asks, about once a minute, "read
 * something now"; this decides what, and whether, so that a transfer reaches the feed soon after the
 * Vault is allowed to record it (the confirmation lag in ./watcher.ts still applies) and the explorer is
 * not worn out in the meantime.
 *
 * It is the same pass the daily job and the "Read the chain now" button run (./vault.ts refreshTin,
 * ./watcher.ts runTinPass): the same wallets, the same trusted addresses, the same cursor. It adds no new
 * way of reading and no new thing to read. What it adds is WHEN: while a person has the Live page open and
 * visible, and not otherwise. Nothing here starts on its own; with no page asking, nothing runs.
 *
 * Why it is careful. The explorer's rate limit is one budget for the whole process, shared with the public
 * wallet checker and with every other feature that reads a chain, and each call is spaced (src/lib/etherscan.ts),
 * so one wallet takes several seconds to read. So:
 *
 *   - A tin is read at most once in LIVE_READ_MIN_GAP_MS, however many pages ask (two tabs, a phone and a
 *     laptop): the second ask is told "recent" and nothing is read.
 *   - One live read runs at a time in a process. A request that finds one running is told "busy" and when
 *     to ask again; it does not queue behind it.
 *   - Asked for no agent in particular, it reads the one that has waited longest and has something to
 *     read, so an account with several agents is read in turn, not all at once.
 *   - Every answer says how long the page should wait before asking again (`waitMs`), so the pace is the
 *     server's to set and a page that ignores it is only told "recent" again.
 *   - An account gets LIVE_READS_PER_DAY of them in a UTC day (a page left open on a second monitor all day
 *     is not a reason to read a wallet every minute for ever). After that the answer is "limit" until the next
 *     day; the daily job and the "Read the chain now" button are not counted and still work. What counts is a
 *     read that was TRIED: one that found wallets, one that failed, and one that ran past the hold below. It
 *     is the explorer that the limit protects, so a failing read counts too (an outage must not turn the limit
 *     off). Not counted: an agent with nothing to read, and one whose read was already running.
 *   - One read that never ends cannot hold the single place for ever: after LIVE_READ_HOLD_MS the place is
 *     given up (the read itself carries on). An explorer call is cut off after 30 seconds and tried up to three
 *     times (src/lib/etherscan.ts), so in an outage one call can take a minute and a half: the page gives up on
 *     its request at 45 seconds, the server gives up the place at 60, and the read finishes in the background.
 *   - One agent that fails does not stand in the way of the account's others: it goes to the back of the line
 *     and the next is tried.
 *
 * Not covered, on purpose: fairness between accounts (the one place goes to whoever asks when it is free; the
 * pages' jitter spreads them), and a transfer whose price is not in yet (the watcher keeps its cursor just before
 * it, so each pass re-lists from there until the price arrives, as the daily job does).
 *
 * Read-only: it lists transfers, it never signs, sends or holds anything. It reads the agent's OWN
 * wallets and keeps only transfers whose other side is a trusted address on the registry; it never reads
 * an address that is not the agent's own wallet.
 */
import { fail, idOf, type Failure } from './errors';
import { listTins } from './store';
import { refreshTin } from './vault';
import type { TinPassReport } from './watcher';

/** A tin is read at most once in this long, by any number of pages. */
export const LIVE_READ_MIN_GAP_MS = 45_000;
/** What a page waits after a read before it asks again. */
export const LIVE_READ_PAUSE_MS = 30_000;
/** What a page waits after being told another read is running. */
export const LIVE_READ_BUSY_WAIT_MS = 15_000;
/** What a page waits when the account has nothing to read (no wallet with a trusted address on its chain). */
export const LIVE_READ_NOTHING_WAIT_MS = 300_000;
/** The least a page is ever told to wait. */
export const LIVE_READ_MIN_WAIT_MS = 5_000;
/** What an account may ask: this many requests in one window, counted per account in this process only. */
export const LIVE_READ_REQUESTS_PER_WINDOW = 6;
export const LIVE_READ_REQUEST_WINDOW_MS = 60_000;
/** Live reads running at once in a process. */
export const LIVE_READS_IN_FLIGHT_MAX = 1;
/** The live reads an account has in one UTC day: four hours of one a minute. Tunable; the daily job and the button are not counted. */
export const LIVE_READS_PER_DAY = 240;
/** The longest one live read keeps the place. A read of a healthy explorer takes about 20 seconds; in an outage a call can take a minute and a half (30 seconds, tried three times), so the read carries on after the place is given up. */
export const LIVE_READ_HOLD_MS = 60_000;

export type LiveReadStatus = 'read' | 'recent' | 'busy' | 'nothing' | 'limit';

export interface LiveReadAnswer {
  ok: true;
  /**
   * read: a tin was read (see `pass`). recent: every agent was read less than LIVE_READ_MIN_GAP_MS ago.
   * busy: another read is running (or one ran too long). nothing: no agent has a wallet and a trusted address on
   * the same chain. limit: the account has had its live reads for today.
   */
  status: LiveReadStatus;
  /** The agent that was read, or null. */
  tinId: string | null;
  /** What the pass did, in the shape "Read the chain now" answers, or null when nothing was read. */
  pass: TinPassReport | null;
  /** How long the page should wait before asking again. */
  waitMs: number;
}

export interface LiveReadDeps {
  now: () => number;
  /** One owner-triggered pass over one tin (src/lib/agentVault/vault.ts refreshTin). */
  read: typeof refreshTin;
}

/** A promise, or the word "held" if it has not settled in `ms` (the timer is cleared as soon as it settles). */
function orHeld<T>(promise: Promise<T>, ms: number): Promise<T | 'held'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('held'), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const defaultLiveReadDeps: LiveReadDeps = { now: () => Date.now(), read: (tenantId, tinId) => refreshTin(tenantId, tinId) };

// When each tin was last read live, in this process. Bounded; a restart forgets it, which only means one early read.
const lastRead = new Map<string, number>();
const LAST_READ_LIMIT = 5_000;
let inFlight = 0;
// The live reads each account has had on the UTC day it last read, in this process: one entry per account, replaced when the day
// changes. A restart forgets them, which only gives a day's budget again.
const dailyReads = new Map<string, { day: string; count: number }>();

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const readsToday = (tenantId: string, ms: number): number => {
  const e = dailyReads.get(tenantId);
  return e && e.day === dayOf(ms) ? e.count : 0;
};
/** One more read tried by this account today. */
function countRead(tenantId: string, ms: number): void {
  const day = dayOf(ms);
  const e = dailyReads.get(tenantId);
  if (e && e.day === day) {
    e.count += 1;
    return;
  }
  if (!e && dailyReads.size >= LAST_READ_LIMIT) {
    // Full: what is left of earlier days is of no use; only if that frees nothing does the count start over for everyone.
    for (const [t, v] of dailyReads) if (v.day !== day) dailyReads.delete(t);
    if (dailyReads.size >= LAST_READ_LIMIT) dailyReads.clear();
  }
  dailyReads.set(tenantId, { day, count: 1 });
}

const keyOf = (tenantId: string, tinId: string): string => `${tenantId}|${tinId}`;

export async function liveRead(
  tenantId: string,
  input: { tinId?: unknown } = {},
  deps: LiveReadDeps = defaultLiveReadDeps,
): Promise<LiveReadAnswer | Failure> {
  const asked = input.tinId === undefined || input.tinId === null || input.tinId === '' ? null : idOf(input.tinId);
  if (input.tinId !== undefined && input.tinId !== null && input.tinId !== '' && !asked) return fail('invalid_id');

  const tins = await listTins(tenantId);
  const candidates = asked ? tins.filter((t) => t.id === asked) : tins;
  if (asked && !candidates.length) return fail('tin_not_found');
  if (!candidates.length) return { ok: true, status: 'nothing', tinId: null, pass: null, waitMs: LIVE_READ_NOTHING_WAIT_MS };

  const now = deps.now();
  // A tin never read live has waited since the epoch: longer than any other, and a number the sort can compare.
  const waited = (id: string) => now - (lastRead.get(keyOf(tenantId, id)) ?? 0);
  // Longest-waiting first; a tin never read live comes before any that was. The list is already in creation order.
  const eligible = candidates.filter((t) => waited(t.id) >= LIVE_READ_MIN_GAP_MS).sort((a, b) => waited(b.id) - waited(a.id));
  if (!eligible.length) {
    const soonest = Math.min(...candidates.map((t) => LIVE_READ_MIN_GAP_MS - waited(t.id)));
    return { ok: true, status: 'recent', tinId: null, pass: null, waitMs: Math.max(LIVE_READ_MIN_WAIT_MS, Math.ceil(soonest)) };
  }
  if (readsToday(tenantId, now) >= LIVE_READS_PER_DAY) {
    return { ok: true, status: 'limit', tinId: null, pass: null, waitMs: LIVE_READ_NOTHING_WAIT_MS };
  }
  if (inFlight >= LIVE_READS_IN_FLIGHT_MAX) return { ok: true, status: 'busy', tinId: null, pass: null, waitMs: LIVE_READ_BUSY_WAIT_MS };

  inFlight += 1;
  try {
    let skipped = 0;
    let firstError: unknown = null;
    for (const tin of eligible) {
      let r: Awaited<ReturnType<typeof refreshTin>> | 'held';
      try {
        r = await orHeld(deps.read(tenantId, tin.id), LIVE_READ_HOLD_MS);
      } catch (err) {
        // This agent failed: it counts as a read tried, it goes to the back of the line, and the account's others are not kept waiting behind it.
        countRead(tenantId, now);
        if (lastRead.size >= LAST_READ_LIMIT) lastRead.clear();
        lastRead.set(keyOf(tenantId, tin.id), deps.now());
        firstError ??= err;
        continue;
      }
      if (lastRead.size >= LAST_READ_LIMIT) lastRead.clear();
      lastRead.set(keyOf(tenantId, tin.id), deps.now());
      // A read that has not ended in a minute lets go of the place (it carries on; the explorer client cuts a call off at 30 seconds).
      if (r === 'held') {
        countRead(tenantId, now);
        return { ok: true, status: 'busy', tinId: null, pass: null, waitMs: LIVE_READ_BUSY_WAIT_MS };
      }
      if (!r.ok) {
        // A read of this tin is already running (the button, the daily job): leave it, try the next.
        if (r.error === 'refresh_in_progress') {
          lastRead.delete(keyOf(tenantId, tin.id));
          skipped += 1;
          continue;
        }
        return r;
      }
      // No wallet with a trusted address on its chain: nothing was read, and the next agent may have something.
      if (r.pass.wallets.length === 0) continue;
      countRead(tenantId, now);
      return { ok: true, status: 'read', tinId: tin.id, pass: r.pass, waitMs: LIVE_READ_PAUSE_MS };
    }
    // Nothing was read. If an agent failed, the failure is the caller's (a plain 500, and the page slows down): saying "nothing"
    // would hide it and wait five minutes as if there were nothing to read.
    if (firstError !== null) throw firstError;
    if (skipped === eligible.length) return { ok: true, status: 'busy', tinId: null, pass: null, waitMs: LIVE_READ_BUSY_WAIT_MS };
    return { ok: true, status: 'nothing', tinId: null, pass: null, waitMs: LIVE_READ_NOTHING_WAIT_MS };
  } finally {
    inFlight -= 1;
  }
}
