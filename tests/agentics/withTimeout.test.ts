import { describe, it, expect } from 'vitest';
import type { ApiResult } from '../../src/components/agentics/client';
import { answerWithin, TIMED_OUT } from '../../src/components/agentics/withTimeout';
import { fakeTimers, okBody, settle } from '../helpers/fakeTimers';

/**
 * The rule that keeps a stalled request from freezing the live page, on its own with a clock that never runs by
 * itself: a request that answers in time gives its own answer; one that does not, or that fails outright, counts as
 * "no answer" (status 0, no body); and no timer is left behind in any of the three cases.
 */
describe('answerWithin', () => {
  it('gives the request\'s own answer when it comes in time, and leaves no timer behind', async () => {
    const timers = fakeTimers();
    const answer = okBody({ events: [] });
    const r = await answerWithin(Promise.resolve(answer), 15_000, timers);
    expect(r).toBe(answer);
    expect(timers.count()).toBe(0);
  });

  it('waits exactly as long as it was told, once', async () => {
    const timers = fakeTimers();
    void answerWithin(new Promise<ApiResult>(() => {}), 15_000, timers);
    expect(timers.delays()).toEqual([15_000]);
  });

  it('answers "no answer" when the time is up, and ignores the answer that comes after', async () => {
    const timers = fakeTimers();
    let release!: (r: ApiResult) => void;
    const slow = new Promise<ApiResult>((resolve) => {
      release = resolve;
    });
    const out = answerWithin(slow, 15_000, timers);
    await timers.fire();
    expect(await out).toEqual({ status: 0, ok: false, body: null });
    release(okBody({}));
    await settle();
    expect(await out).toEqual({ status: 0, ok: false, body: null });
    expect(timers.count()).toBe(0);
  });

  it('answers "no answer" at once when the request itself fails, without waiting for the time to be up, and leaves no timer behind', async () => {
    const timers = fakeTimers();
    const r = await answerWithin(Promise.reject(new Error('the network went away')), 15_000, timers);
    expect(r).toEqual({ status: 0, ok: false, body: null });
    expect(timers.count()).toBe(0);
  });

  it('hands out its own copy of "no answer" each time, never the shared one', async () => {
    const timers = fakeTimers();
    const out = answerWithin(new Promise<ApiResult>(() => {}), 1, timers);
    await timers.fire();
    const r = await out;
    expect(r).not.toBe(TIMED_OUT);
    expect(r).toEqual(TIMED_OUT);
  });
});
