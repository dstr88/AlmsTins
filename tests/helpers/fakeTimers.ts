/**
 * A clock for the tests of code that takes its timers as parameters (the live feed's poller and reader): a timer
 * is recorded, never run by itself, and a test runs it when it means the time to have passed. Nothing waits.
 * The clock the code reads (`now`) moves by a timer's delay when that timer is fired, so a poll every three seconds
 * is three seconds on it.
 */
import type { ApiResult, Send } from '../../src/components/agentics/client';

/** Lets the promises a fired timer started run to the end. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

export function fakeTimers() {
  let next = 1;
  let clock = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    /** The page's own clock for a test, in milliseconds: it moves only when a timer is fired (by that timer's delay) or when a test moves it. */
    now: (): number => clock,
    advance: (ms: number): void => {
      clock += ms;
    },
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    /** How long each waiting timer was asked to wait, oldest first. */
    delays: (): number[] => [...pending.values()].map((p) => p.ms),
    count: (): number => pending.size,
    /** Runs the oldest waiting timer, and lets what it started finish. */
    async fire(): Promise<void> {
      const first = [...pending.entries()][0];
      if (!first) throw new Error('no timer is waiting');
      pending.delete(first[0]);
      clock += first[1].ms;
      first[1].fn();
      await settle();
    },
  };
}

export interface SentRequest {
  method: string;
  url: string;
  body: unknown;
}

/**
 * A Send that answers from a script: each call takes the next answer (or the last one again when the script is
 * out), and every call is recorded. An answer may be a function of the request.
 */
export function scriptedSend(script: Array<ApiResult | ((r: SentRequest) => ApiResult | Promise<ApiResult>)>) {
  const sent: SentRequest[] = [];
  let i = 0;
  const send: Send = async (method, url, body) => {
    const request = { method, url, body };
    sent.push(request);
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    return typeof step === 'function' ? step(request) : step;
  };
  return { send, sent };
}

export const okBody = (body: Record<string, unknown>): ApiResult => ({ status: 200, ok: true, body: { ok: true, ...body } });
export const failed = (status: number, error = 'server_error'): ApiResult => ({ status, ok: false, body: status === 0 ? null : { ok: false, error } });
