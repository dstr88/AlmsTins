/**
 * rateGate.ts — keep our own calls to a rate-limited API under its published limit.
 *
 * An explorer API that allows N calls per second answers the N+1th call in that second
 * with an error, not a delay (Etherscan's free plan: "Max calls per sec rate limit
 * reached"). Firing a burst of lookups in parallel therefore fails some of them. A gate
 * starts at most `limit` calls in any `intervalMs` window and queues the rest.
 *
 * - Lower `priority` runs first. Calls requested in the same tick compete by priority,
 *   because the queue is first drained on the next timer turn, not synchronously.
 * - A call that cannot start within `maxWaitMs` is rejected with RateGateTimeout, so a
 *   busy gate degrades to "not checked" instead of making a request wait without bound.
 * - The gate only spaces call STARTS; it does not cap how many are in flight.
 *
 * One gate per API key, shared by every caller in the process that uses that key.
 */

export class RateGateTimeout extends Error {
  constructor() {
    super('Rate gate: no free slot before the wait limit');
    this.name = 'RateGateTimeout';
  }
}

export interface ScheduleOptions {
  /** Lower runs first. Default 1. */
  priority?: number;
  /** Overrides the gate's maxWaitMs for this call. */
  maxWaitMs?: number;
}

export interface RateGate {
  /** Runs fn once a slot is free; settles with fn's result, or rejects with RateGateTimeout. */
  schedule<T>(fn: () => Promise<T>, opts?: ScheduleOptions): Promise<T>;
}

interface Waiting {
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  priority: number;
  seq: number;
  deadline: number;
}

export function createRateGate({
  limit,
  intervalMs,
  maxWaitMs = Number.POSITIVE_INFINITY,
}: {
  limit: number;
  intervalMs: number;
  maxWaitMs?: number;
}): RateGate {
  if (!(limit >= 1)) throw new Error('createRateGate: limit must be at least 1');

  const starts: number[] = []; // start times inside the current window, oldest first
  const queue: Waiting[] = [];
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm(delayMs: number) {
    timer = setTimeout(pump, Math.max(0, delayMs));
  }

  function pump() {
    timer = null;
    const now = Date.now();
    while (starts.length > 0 && starts[0] <= now - intervalMs) starts.shift();

    // Drop calls that waited too long before granting any slot.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].deadline <= now) queue.splice(i, 1)[0].reject(new RateGateTimeout());
    }

    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    while (queue.length > 0 && starts.length < limit) {
      const item = queue.shift()!;
      starts.push(now);
      Promise.resolve().then(item.fn).then(item.resolve, item.reject);
    }

    if (queue.length > 0) {
      // Wake when the oldest start leaves the window, or when the next call expires.
      const nextFree = starts[0] + intervalMs;
      const nextExpiry = Math.min(...queue.map((q) => q.deadline));
      arm(Math.min(nextFree, nextExpiry) - now);
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>, opts: ScheduleOptions = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          fn,
          resolve: resolve as (v: unknown) => void,
          reject,
          priority: opts.priority ?? 1,
          seq: seq++,
          deadline: Date.now() + (opts.maxWaitMs ?? maxWaitMs),
        });
        if (!timer) arm(0);
      });
    },
  };
}
