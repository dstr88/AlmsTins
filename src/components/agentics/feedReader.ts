/**
 * Reading the wallets while the Live page is open. About once a minute the page asks the Vault to read one
 * of the account's agents (POST /api/agentics/feed/read) so a transfer reaches the feed soon after the
 * Vault is allowed to record it. The Vault decides what is read and says how long to wait before asking
 * again; this schedules the asking and nothing more.
 *
 * Everything outside the logic is a parameter, so each rule is a unit test with a fake clock:
 *
 *   - It runs only while it is switched on, the tab is showing and the page is open. A hidden tab, or the
 *     switch turned off, cancels the next ask; nothing is read for a page nobody is looking at.
 *   - The wait comes from the Vault (`waitMs`), kept between READ_MIN_WAIT_MS and READ_MAX_WAIT_MS, with up
 *     to a tenth added so two pages do not ask in step.
 *   - A failure waits longer each time (30 seconds, then 1, 2 and 5 minutes). A read in which every wallet
 *     could not be read (the explorer is down, or has no key) counts as a failure, so a page does not hammer
 *     it. Losing the sign-in or the Vault (a 401, or a 404 with no answer from the Vault behind it) stops for
 *     good; a 404 the Vault itself answers (the agent the page is filtered to was removed) is only a failure.
 *     A rate limit waits a minute. A request not answered in READ_TIMEOUT_MS counts as a failure.
 */
import type { Send } from './client';
import { describeRefresh, passOf } from './refresh';
import { answerWithin } from './withTimeout';

/** The first ask, after the page opens. */
export const READ_FIRST_MS = 2500;
/** The least and the most it ever waits between asks. */
export const READ_MIN_WAIT_MS = 10_000;
export const READ_MAX_WAIT_MS = 300_000;
/** After a failure: this, doubled each time, up to READ_MAX_WAIT_MS. */
export const READ_FAILURE_WAIT_MS = 30_000;
/** What it waits after being told it asks too often. */
export const READ_RATE_LIMITED_WAIT_MS = 60_000;
/**
 * A request not answered in this long counts as a failure. A read of a healthy explorer takes about 20 seconds; in an outage one
 * explorer call can take a minute and a half (cut off at 30 seconds, tried three times), so the Vault's read carries on in the
 * background after the page has given up on its request.
 */
export const READ_TIMEOUT_MS = 45_000;

export type ReaderState = 'off' | 'waiting' | 'reading' | 'nothing' | 'limit' | 'failing' | 'closed';

/** What one ask came back with, for the status line. */
export interface ReadResult {
  status: 'read' | 'recent' | 'busy' | 'nothing' | 'limit';
  /** The agent that was read, or null. */
  tinId: string | null;
  /** Plain sentences about how the wallets went (the same ones "Read the chain now" gives); empty unless an agent was read. */
  lines: string[];
  /** Transfers newly recorded by this read. */
  recorded: number;
}

export interface ReaderDeps {
  send: Send;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Whether the tab is showing. */
  visible: () => boolean;
  /** Whether the person has it switched on. */
  enabled: () => boolean;
  /** The agent the page is filtered to, or null for all of them (the Vault then takes them in turn). */
  tinId: () => string | null;
  /** A pass ran (or was refused as recent or busy). */
  onResult: (r: ReadResult) => void;
  onState: (s: ReaderState) => void;
  /** 0 to 1; Math.random. */
  random?: () => number;
}

export interface FeedReader {
  start(): void;
  stop(): void;
  /** The tab was shown or hidden, the switch moved, or the filter changed: schedule or cancel accordingly. */
  changed(): void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createFeedReader(deps: ReaderDeps): FeedReader {
  const random = deps.random ?? Math.random;
  let timer: unknown = null;
  let running = false;
  let inFlight = false;
  let closed = false;
  let failures = 0;

  const cancel = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const active = () => running && !closed && deps.enabled() && deps.visible();
  const schedule = (ms: number) => {
    cancel();
    timer = deps.setTimer(() => {
      timer = null;
      void ask();
    }, Math.round(ms * (1 + random() * 0.1)));
  };
  const failed = () => {
    failures += 1;
    deps.onState('failing');
    schedule(Math.min(READ_MAX_WAIT_MS, READ_FAILURE_WAIT_MS * 2 ** (failures - 1)));
  };

  async function ask(): Promise<void> {
    if (!running || closed || inFlight) return;
    if (!deps.enabled()) {
      deps.onState('off');
      return;
    }
    if (!deps.visible()) {
      deps.onState('waiting');
      return;
    }
    inFlight = true;
    deps.onState('reading');
    try {
      const tinId = deps.tinId();
      const r = await answerWithin(deps.send('POST', '/api/agentics/feed/read', tinId ? { tinId } : {}), READ_TIMEOUT_MS, deps);
      if (!running) return;
      // The sign-in is gone (401), or the Vault answers a plain 404 for a page it will not serve: stop for good.
      // A 404 WITH an answer from the Vault behind it (`tin_not_found`: the agent the page is filtered to was removed) is only a failure.
      if (r.status === 401 || (r.status === 404 && r.body === null)) {
        closed = true;
        deps.onState('closed');
        return;
      }
      if (r.status === 429) {
        deps.onState('waiting');
        schedule(READ_RATE_LIMITED_WAIT_MS);
        return;
      }
      const status = r.body?.status;
      if (!r.ok || !r.body || (status !== 'read' && status !== 'recent' && status !== 'busy' && status !== 'nothing' && status !== 'limit')) {
        failed();
        return;
      }
      const pass = status === 'read' ? passOf(r.body) : null;
      // Every wallet unreadable: the explorer is down or has no key. Slow down, as for any failure.
      const unreadable = pass !== null && pass.wallets.length > 0 && pass.wallets.every((w) => w.status === 'unavailable' || w.status === 'failed');
      deps.onResult({
        status,
        tinId: typeof r.body.tinId === 'string' ? r.body.tinId : null,
        lines: pass ? describeRefresh(pass) : [],
        recorded: pass ? pass.recorded : 0,
      });
      if (unreadable) {
        failed();
        return;
      }
      failures = 0;
      const asked = Number(r.body.waitMs);
      const wait = clamp(Number.isFinite(asked) ? asked : READ_MIN_WAIT_MS, READ_MIN_WAIT_MS, READ_MAX_WAIT_MS);
      deps.onState(status === 'nothing' ? 'nothing' : status === 'limit' ? 'limit' : 'waiting');
      schedule(wait);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      closed = false;
      if (active()) schedule(READ_FIRST_MS);
      else deps.onState(deps.enabled() ? 'waiting' : 'off');
    },
    stop() {
      running = false;
      cancel();
    },
    changed() {
      if (!running || closed) return;
      if (!deps.enabled()) {
        cancel();
        deps.onState('off');
        return;
      }
      if (!deps.visible()) {
        cancel();
        deps.onState('waiting');
        return;
      }
      // Shown again, switched on, or the filter moved: ask soon, unless an ask is on its way or already running.
      if (!inFlight && timer === null) schedule(READ_FIRST_MS);
    },
  };
}
