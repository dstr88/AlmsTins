import { describe, it, expect } from 'vitest';
import {
  READ_FAILURE_WAIT_MS, READ_FIRST_MS, READ_MAX_WAIT_MS, READ_MIN_WAIT_MS, READ_RATE_LIMITED_WAIT_MS, createFeedReader, type ReadResult, type ReaderState,
} from '../../src/components/agentics/feedReader';
import { failed, fakeTimers, okBody, scriptedSend, settle } from '../helpers/fakeTimers';

/**
 * Reading the wallets while the Live page is open: when the page asks the Vault to read, and how it slows down.
 * The Vault sets the pace (`waitMs`); the page keeps it between 10 seconds and 5 minutes, adds a little so two
 * pages do not ask in step, backs off after a failure, and asks nothing for a tab nobody is looking at or when
 * the person has turned it off. A clock that never runs by itself and a request that answers from a script.
 */

const pass = (statuses: string[], recorded = 0) => ({
  tinId: 'tin-1', startedAt: '2026-10-19T12:00:00.000Z', watchedDestinations: 2, notWatched: { pending: 0, flagged: 0, overLimit: 0 },
  wallets: statuses.map((status) => ({ status })), recorded,
});
const read = (statuses = ['complete'], recorded = 0, waitMs = 30_000) => okBody({ status: 'read', tinId: 'tin-1', pass: pass(statuses, recorded), waitMs });
const other = (status: 'recent' | 'busy' | 'nothing', waitMs: number) => okBody({ status, tinId: null, pass: null, waitMs });

function setup(script: Parameters<typeof scriptedSend>[0], opts: { enabled?: boolean; tinId?: string | null; random?: number } = {}) {
  const timers = fakeTimers();
  const { send, sent } = scriptedSend(script);
  const results: ReadResult[] = [];
  const states: ReaderState[] = [];
  const flags = { enabled: opts.enabled ?? true, visible: true, tinId: opts.tinId ?? null };
  const reader = createFeedReader({
    send, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    visible: () => flags.visible, enabled: () => flags.enabled, tinId: () => flags.tinId,
    onResult: (r) => results.push(r), onState: (s) => states.push(s), random: () => opts.random ?? 0,
  });
  return { reader, timers, sent, results, states, flags };
}

describe('asking', () => {
  it('asks once, soon after it starts, for any agent when none is chosen', async () => {
    const t = setup([read()]);
    t.reader.start();
    expect(t.timers.delays()).toEqual([READ_FIRST_MS]);
    await t.timers.fire();
    expect(t.sent).toEqual([{ method: 'POST', url: '/api/agentics/feed/read', body: {} }]);
  });

  it('asks for the agent the page is filtered to', async () => {
    const t = setup([read()], { tinId: 'tin-9' });
    t.reader.start();
    await t.timers.fire();
    expect(t.sent[0].body).toEqual({ tinId: 'tin-9' });
  });

  it('after a read, says what happened in plain sentences, and waits what the Vault said', async () => {
    const t = setup([read(['complete', 'partial'], 2, 30_000)]);
    t.reader.start();
    await t.timers.fire();
    expect(t.results).toHaveLength(1);
    expect(t.results[0]).toMatchObject({ status: 'read', tinId: 'tin-1', recorded: 2 });
    expect(t.results[0].lines.join(' ')).toContain('wallet read up to the newest confirmed block');
    expect(t.results[0].lines.join(' ')).toContain('2 new transfers recorded');
    expect(t.states.at(-1)).toBe('waiting');
    expect(t.timers.delays()).toEqual([30_000]);
  });

  it('keeps the wait between ten seconds and five minutes, and adds up to a tenth so pages do not ask in step', async () => {
    for (const [asked, expected] of [[1, READ_MIN_WAIT_MS], [30_000, 30_000], [10_000_000, READ_MAX_WAIT_MS], [Number.NaN, READ_MIN_WAIT_MS]] as const) {
      const t = setup([read(['complete'], 0, asked)]);
      t.reader.start();
      await t.timers.fire();
      expect(t.timers.delays()).toEqual([expected]);
    }
    const jittered = setup([read(['complete'], 0, 30_000)], { random: 0.5 });
    jittered.reader.start();
    await jittered.timers.fire();
    expect(jittered.timers.delays()).toEqual([31_500]);
  });

  it('is told "recent" or "busy" without a fuss: it says so to the page and waits as told', async () => {
    const t = setup([other('recent', 20_000), other('busy', 15_000)]);
    t.reader.start();
    await t.timers.fire();
    expect(t.results[0]).toEqual({ status: 'recent', tinId: null, lines: [], recorded: 0 });
    expect(t.timers.delays()).toEqual([20_000]);
    await t.timers.fire();
    expect(t.results[1].status).toBe('busy');
    expect(t.timers.delays()).toEqual([15_000]);
    expect(t.states.at(-1)).toBe('waiting');
  });

  it('has nothing to read: says so and asks again in five minutes', async () => {
    const t = setup([other('nothing', 300_000)]);
    t.reader.start();
    await t.timers.fire();
    expect(t.states.at(-1)).toBe('nothing');
    expect(t.timers.delays()).toEqual([300_000]);
  });

  it('says it is reading while the request is out', async () => {
    const t = setup([read()]);
    t.reader.start();
    await t.timers.fire();
    expect(t.states).toContain('reading');
    expect(t.states.indexOf('reading')).toBeLessThan(t.states.lastIndexOf('waiting'));
  });
});

describe('failing', () => {
  it('waits 30 seconds, then 1, 2 and 5 minutes, and starts over after one that works', async () => {
    const t = setup([failed(0), failed(500), failed(503), failed(0), failed(500), read()]);
    t.reader.start();
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await t.timers.fire();
      waits.push(t.timers.delays()[0]);
      expect(t.states.at(-1)).toBe('failing');
    }
    expect(waits).toEqual([READ_FAILURE_WAIT_MS, 2 * READ_FAILURE_WAIT_MS, 4 * READ_FAILURE_WAIT_MS, 8 * READ_FAILURE_WAIT_MS, READ_MAX_WAIT_MS]);
    await t.timers.fire();
    expect(t.states.at(-1)).toBe('waiting');
    expect(t.timers.delays()).toEqual([30_000]);
  });

  it('counts a read in which no wallet could be read as a failure, so an explorer that is down is not hammered', async () => {
    const t = setup([read(['unavailable', 'failed']), read(['unavailable']), read(['complete'])]);
    t.reader.start();
    await t.timers.fire();
    expect(t.results[0].lines.join(' ')).toContain('could not be read');
    expect(t.states.at(-1)).toBe('failing');
    expect(t.timers.delays()).toEqual([READ_FAILURE_WAIT_MS]);
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([2 * READ_FAILURE_WAIT_MS]);
    await t.timers.fire();
    expect(t.states.at(-1)).toBe('waiting');
  });

  it('does not count a read in which only some wallets could not be read', async () => {
    const t = setup([read(['complete', 'unavailable'])]);
    t.reader.start();
    await t.timers.fire();
    expect(t.states.at(-1)).toBe('waiting');
  });

  it('treats an answer it does not understand as a failure', async () => {
    const t = setup([okBody({ status: 'maybe' }), okBody({}), { status: 200, ok: true, body: null }]);
    t.reader.start();
    for (let i = 0; i < 3; i += 1) {
      await t.timers.fire();
      expect(t.states.at(-1)).toBe('failing');
    }
    expect(t.results).toEqual([]);
  });

  it('waits a minute when told it asks too often, and says nothing is wrong', async () => {
    const t = setup([failed(429, 'rate_limited')]);
    t.reader.start();
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([READ_RATE_LIMITED_WAIT_MS]);
    expect(t.states.at(-1)).toBe('waiting');
  });

  it.each([401, 404])('stops for good on %i', async (status) => {
    const t = setup([failed(status, 'nope')]);
    t.reader.start();
    await t.timers.fire();
    expect(t.states.at(-1)).toBe('closed');
    expect(t.timers.count()).toBe(0);
    t.reader.changed();
    expect(t.timers.count()).toBe(0);
    expect(t.sent).toHaveLength(1);
  });
});

describe('only while someone is looking and has it on', () => {
  it('asks nothing when it is switched off, says so, and asks soon after it is switched on', async () => {
    const t = setup([read()], { enabled: false });
    t.reader.start();
    expect(t.timers.count()).toBe(0);
    expect(t.states.at(-1)).toBe('off');
    t.flags.enabled = true;
    t.reader.changed();
    expect(t.timers.delays()).toEqual([READ_FIRST_MS]);
    await t.timers.fire();
    expect(t.sent).toHaveLength(1);
  });

  it('cancels the next ask when it is switched off', async () => {
    const t = setup([read()]);
    t.reader.start();
    t.flags.enabled = false;
    t.reader.changed();
    expect(t.timers.count()).toBe(0);
    expect(t.states.at(-1)).toBe('off');
  });

  it('asks nothing for a tab that is hidden, and asks soon when it is shown', async () => {
    const t = setup([read()]);
    t.reader.start();
    t.flags.visible = false;
    t.reader.changed();
    expect(t.timers.count()).toBe(0);
    expect(t.states.at(-1)).toBe('waiting');
    t.flags.visible = true;
    t.reader.changed();
    expect(t.timers.delays()).toEqual([READ_FIRST_MS]);
  });

  it('does not ask when its timer fires into a tab that has since been hidden or a switch that has since been turned off', async () => {
    const hidden = setup([read()]);
    hidden.reader.start();
    hidden.flags.visible = false;
    await hidden.timers.fire();
    expect(hidden.sent).toHaveLength(0);
    const off = setup([read()]);
    off.reader.start();
    off.flags.enabled = false;
    await off.timers.fire();
    expect(off.sent).toHaveLength(0);
    expect(off.states.at(-1)).toBe('off');
  });

  it('starts hidden without asking', () => {
    const t = setup([read()]);
    t.flags.visible = false;
    t.reader.start();
    expect(t.timers.count()).toBe(0);
  });

  it('does not stack asks: a change while one is waiting or running adds none', async () => {
    const t = setup([read()]);
    t.reader.start();
    t.reader.changed();
    t.reader.changed();
    expect(t.timers.count()).toBe(1);
    let release: (v: unknown) => void = () => {};
    const slow = setup([() => new Promise((resolve) => { release = resolve; }) as never]);
    slow.reader.start();
    const firing = slow.timers.fire();
    await settle();
    slow.reader.changed();
    expect(slow.timers.count()).toBe(0);
    release(read());
    await firing;
    await settle();
    expect(slow.timers.count()).toBe(1);
  });

  it('moving the filter asks soon for the agent now chosen', async () => {
    const t = setup([read(), read()]);
    t.reader.start();
    await t.timers.fire();
    t.flags.tinId = 'tin-2';
    t.reader.changed();
    await t.timers.fire();
    expect(t.sent.map((s) => s.body)).toEqual([{}, { tinId: 'tin-2' }]);
  });
});

describe('stopping', () => {
  it('cancels the next ask and drops an answer that arrives afterwards', async () => {
    let release: (v: unknown) => void = () => {};
    const t = setup([() => new Promise((resolve) => { release = resolve; }) as never]);
    t.reader.start();
    const firing = t.timers.fire();
    await settle();
    t.reader.stop();
    release(read());
    await firing;
    await settle();
    expect(t.results).toEqual([]);
    expect(t.timers.count()).toBe(0);
  });

  it('starting twice does not double the asking', () => {
    const t = setup([read()]);
    t.reader.start();
    t.reader.start();
    expect(t.timers.count()).toBe(1);
  });
});
