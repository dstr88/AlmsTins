/**
 * A request that is not answered in time counts as one that got no answer. The browser's own wait for a
 * stalled connection is long (minutes on a phone that changed networks), and the feed's poll and wallet
 * reads each keep one request in flight at a time, so a stalled one would freeze them. The timers are
 * parameters, so the rule is a unit test with a clock that never runs by itself.
 *
 * The request is not canceled (a Send cannot be); its answer, if it comes later, is dropped.
 */
import type { ApiResult } from './client';

export interface Timers {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** What a request that timed out answers: the same as one that never reached the server (status 0). */
export const TIMED_OUT: ApiResult = { status: 0, ok: false, body: null };

export function answerWithin(request: Promise<ApiResult>, ms: number, timers: Timers): Promise<ApiResult> {
  return new Promise((resolve) => {
    const handle = timers.setTimer(() => resolve({ ...TIMED_OUT }), ms);
    request.then(
      (r) => {
        timers.clearTimer(handle);
        resolve(r);
      },
      () => {
        timers.clearTimer(handle);
        resolve({ ...TIMED_OUT });
      },
    );
  });
}
