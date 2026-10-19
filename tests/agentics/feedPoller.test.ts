import { describe, it, expect } from 'vitest';
import { BACKOFF_MAX_MS, MAX_PAGES, MAX_PAGES as PAGES, POLL_MS, RATE_LIMITED_WAIT_MS, SEEN_MAX, createFeedPoller, type ConnState } from '../../src/components/agentics/feedPoller';
import type { FeedRow } from '../../src/components/agentics/feedRows';
import { addr } from '../helpers/agentVault';
import { failed, fakeTimers, okBody, scriptedSend, settle } from '../helpers/fakeTimers';

/**
 * The live feed's poll with a clock that never runs by itself and a request that answers from a script. What is
 * checked: it asks from where the last answer left off, hands over each row once, follows a backlog to its end,
 * stays quiet in a hidden tab, waits longer after each failure, and stops for good when the sign-in is gone.
 */

const ev = (id: string, writtenAt: string) => ({
  id, tinId: 'tin-1', kind: 'checked', at: '2026-10-19T11:00:00.000Z', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown',
  keyId: null, keyStatus: null, tx: null, detail: { basis: 'not_in_registry' }, writtenAt, agent: 'Agent', label: null,
});
const NOW = '2026-10-19T12:00:00.000Z';
const answer = (events: unknown[], since: string, extra: Record<string, unknown> = {}) => okBody({ events, since, cursor: null, more: false, now: NOW, ...extra });

function setup(script: Parameters<typeof scriptedSend>[0], opts: { since?: string; seen?: string[]; visible?: () => boolean } = {}) {
  const timers = fakeTimers();
  const { send, sent } = scriptedSend(script);
  const rows: FeedRow[][] = [];
  const states: Array<[ConnState, string | null]> = [];
  let visible = true;
  const poller = createFeedPoller(
    { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: opts.visible ?? (() => visible), onRows: (r) => rows.push(r), onState: (s, at) => states.push([s, at]) },
    { since: opts.since ?? '2026-10-19 11:00:00', seen: opts.seen },
  );
  return { poller, timers, sent, rows, states, show: (v: boolean) => { visible = v; } };
}

describe('asking', () => {
  it('waits three seconds, then asks from where it began, and hands over what is new once', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:05'), ev('b', '2026-10-19 11:00:06')], '2026-10-19 11:00:06')]);
    t.poller.start();
    expect(t.timers.delays()).toEqual([POLL_MS]);
    expect(t.sent).toHaveLength(0);
    await t.timers.fire();
    expect(t.sent).toEqual([{ method: 'GET', url: `/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}`, body: undefined }]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].map((r) => r.id)).toEqual(['a', 'b']);
    expect(t.states.at(-1)).toEqual(['live', NOW]);
    expect(t.timers.delays()).toEqual([POLL_MS]);
  });

  it('asks the next time from the newest second the last answer reached', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([], '2026-10-19 11:00:06')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.sent[1].url).toBe(`/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:06')}`);
  });

  it('never goes back, even if an answer says an earlier time', async () => {
    const t = setup([answer([], '2026-10-19 10:00:00'), answer([], '2026-10-19 10:00:00')], { since: '2026-10-19 11:00:00' });
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.sent[1].url).toContain(encodeURIComponent('2026-10-19 11:00:00'));
  });

  it('drops a row it has already given, the five seconds the server repeats and the rows the page opened with', async () => {
    const t = setup([answer([ev('seen-on-open', '2026-10-19 11:00:05'), ev('new', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([ev('new', '2026-10-19 11:00:06'), ev('newer', '2026-10-19 11:00:09')], '2026-10-19 11:00:09')], { seen: ['seen-on-open'] });
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.rows.map((r) => r.map((x) => x.id))).toEqual([['new'], ['newer']]);
  });

  it('hands over nothing when nothing is new, and says it is live', async () => {
    const t = setup([answer([], '2026-10-19 11:00:00')]);
    t.poller.start();
    await t.timers.fire();
    expect(t.rows).toEqual([]);
    expect(t.states.at(-1)?.[0]).toBe('live');
  });

  it('ignores an event that is not one, and a `since` that is not a time', async () => {
    const t = setup([answer([ev('good', '2026-10-19 11:00:05'), { id: 'bad' }, 'junk'], 'not a time'), answer([], '2026-10-19 11:00:05')]);
    t.poller.start();
    await t.timers.fire();
    expect(t.rows[0].map((r) => r.id)).toEqual(['good']);
    await t.timers.fire();
    expect(t.sent[1].url).toContain(encodeURIComponent('2026-10-19 11:00:00'));
  });
});

describe('a backlog', () => {
  it('is followed at once with the cursor, to its end, in the same turn', async () => {
    const t = setup([
      answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: '2026-10-19 11:00:05|a' }),
      answer([ev('b', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: '2026-10-19 11:00:05|b' }),
      answer([ev('c', '2026-10-19 11:00:07')], '2026-10-19 11:00:07'),
    ]);
    t.poller.start();
    await t.timers.fire();
    expect(t.sent.map((s) => s.url)).toEqual([
      `/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}`,
      `/api/agentics/feed?after=${encodeURIComponent('2026-10-19 11:00:05|a')}`,
      `/api/agentics/feed?after=${encodeURIComponent('2026-10-19 11:00:05|b')}`,
    ]);
    // One hand-over, in order, and the next ask is from the newest second reached.
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].map((r) => r.id)).toEqual(['a', 'b', 'c']);
    await t.timers.fire();
    expect(t.sent[3].url).toContain(encodeURIComponent('2026-10-19 11:00:07'));
  });

  it('stops following after ten answers, and carries on in the next turn from where it got to', async () => {
    let n = 0;
    const t = setup([() => {
      n += 1;
      return answer([ev(`e${n}`, '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: `2026-10-19 11:00:05|e${n}` });
    }]);
    t.poller.start();
    await t.timers.fire();
    expect(t.sent).toHaveLength(MAX_PAGES);
    expect(PAGES).toBe(10);
    expect(t.rows[0]).toHaveLength(MAX_PAGES);
    expect(t.timers.delays()).toEqual([POLL_MS]);
  });

  it('does not loop on an answer that says more and gives no cursor', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: null })]);
    t.poller.start();
    await t.timers.fire();
    expect(t.sent).toHaveLength(1);
  });
});

describe('a tab that is hidden', () => {
  it('does not ask while it is hidden, says so, and asks at once when it is shown again', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')]);
    t.poller.start();
    t.show(false);
    await t.timers.fire();
    expect(t.sent).toHaveLength(0);
    expect(t.states.at(-1)?.[0]).toBe('hidden');
    t.show(true);
    t.poller.visibilityChanged();
    await settle();
    expect(t.sent).toHaveLength(1);
    expect(t.rows).toHaveLength(1);
  });

  it('cancels the next ask when the tab is hidden, and asks nothing while it stays so', async () => {
    const t = setup([answer([], '2026-10-19 11:00:00')]);
    t.poller.start();
    t.show(false);
    t.poller.visibilityChanged();
    expect(t.timers.count()).toBe(0);
    expect(t.states.at(-1)?.[0]).toBe('hidden');
    t.poller.visibilityChanged();
    expect(t.sent).toHaveLength(0);
  });

  it('starts hidden without asking', () => {
    const t = setup([answer([], '2026-10-19 11:00:00')], { visible: () => false });
    t.poller.start();
    expect(t.timers.count()).toBe(0);
    expect(t.states.at(-1)?.[0]).toBe('hidden');
  });
});

describe('failing', () => {
  it('waits longer each time (6, 12, 24, then 30 seconds), says so, and starts over after one that works', async () => {
    const t = setup([failed(0), failed(500), failed(503), failed(0), failed(500), answer([], '2026-10-19 11:00:00')]);
    t.poller.start();
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await t.timers.fire();
      waits.push(t.timers.delays()[0]);
      expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    }
    expect(waits).toEqual([6000, 12_000, 24_000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
    await t.timers.fire();
    expect(t.states.at(-1)?.[0]).toBe('live');
    expect(t.timers.delays()).toEqual([POLL_MS]);
  });

  it('a failure after one that worked starts the wait over at six seconds, not where the last run of failures left off', async () => {
    const t = setup([failed(0), failed(0), failed(0), answer([], '2026-10-19 11:00:00'), failed(0)]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([24_000]);
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([POLL_MS]);
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([6000]);
  });

  it('keeps what it had: a failure hands over nothing and does not move the time it asks from', async () => {
    const t = setup([failed(0), answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.sent[1].url).toBe(t.sent[0].url);
    expect(t.rows[0].map((r) => r.id)).toEqual(['a']);
  });

  it('a failure in the middle of a backlog hands over nothing from it and asks again from the same place', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: '2026-10-19 11:00:05|a' }), failed(500), answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')]);
    t.poller.start();
    await t.timers.fire();
    expect(t.rows).toEqual([]);
    await t.timers.fire();
    expect(t.rows[0].map((r) => r.id)).toEqual(['a']);
  });

  it('waits half a minute when told it asks too often', async () => {
    const t = setup([failed(429, 'rate_limited')]);
    t.poller.start();
    await t.timers.fire();
    expect(t.states.at(-1)?.[0]).toBe('slow');
    expect(t.timers.delays()).toEqual([RATE_LIMITED_WAIT_MS]);
  });

  it.each([401, 404])('stops for good on %i: the sign-in or the Vault is gone', async (status) => {
    const t = setup([failed(status, 'nope')]);
    t.poller.start();
    await t.timers.fire();
    expect(t.states.at(-1)?.[0]).toBe('closed');
    expect(t.timers.count()).toBe(0);
    t.poller.pollNow();
    t.poller.visibilityChanged();
    await settle();
    expect(t.sent).toHaveLength(1);
  });

  it('starts again from the beginning once if a time it made is refused, then treats it as any failure', async () => {
    const t = setup([failed(400, 'invalid_cursor'), failed(400, 'invalid_cursor'), answer([], '1970-01-01 00:00:00')], { since: '2026-10-19 11:00:00' });
    t.poller.start();
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([0]);
    await t.timers.fire();
    expect(t.sent[1].url).toContain(encodeURIComponent('1970-01-01 00:00:00'));
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    expect(t.timers.delays()).toEqual([6000]);
  });
});

describe('stopping and asking now', () => {
  it('stop cancels the next ask and drops an answer that arrives afterwards', async () => {
    let release: (v: unknown) => void = () => {};
    const t = setup([() => new Promise((resolve) => { release = resolve; }) as never]);
    t.poller.start();
    const firing = t.timers.fire();
    await settle();
    t.poller.stop();
    release(answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05'));
    await firing;
    await settle();
    expect(t.rows).toEqual([]);
    expect(t.timers.count()).toBe(0);
  });

  it('pollNow asks at once instead of waiting, once', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05'), answer([], '2026-10-19 11:00:05')]);
    t.poller.start();
    t.poller.pollNow();
    await settle();
    expect(t.sent).toHaveLength(1);
    expect(t.rows).toHaveLength(1);
    expect(t.timers.delays()).toEqual([POLL_MS]);
  });

  it('does not ask twice at once: a pollNow while an ask is out waits for it', async () => {
    let release: (v: unknown) => void = () => {};
    const t = setup([() => new Promise((resolve) => { release = resolve; }) as never]);
    t.poller.start();
    t.poller.pollNow();
    await settle();
    t.poller.pollNow();
    t.poller.visibilityChanged();
    await settle();
    expect(t.sent).toHaveLength(1);
    release(answer([], '2026-10-19 11:00:00'));
    await settle();
  });

  it('starting twice does not double the asking', async () => {
    const t = setup([answer([], '2026-10-19 11:00:00')]);
    t.poller.start();
    t.poller.start();
    expect(t.timers.count()).toBe(1);
  });
});

describe('what it remembers', () => {
  it('forgets the oldest ids once it holds more than the limit, so a long session does not grow without end', async () => {
    const batches = 6;
    const per = 1000;
    let b = 0;
    const script = Array.from({ length: batches + 1 }, (_, i) => () => {
      if (i === batches) return answer([ev('r0', '2026-10-19 11:00:00'), ev(`r${batches * per - 1}`, '2026-10-19 11:00:00')], '2026-10-19 11:00:00');
      const events = Array.from({ length: per }, (_, j) => ev(`r${i * per + j}`, '2026-10-19 11:00:00'));
      b += 1;
      return answer(events, '2026-10-19 11:00:00');
    });
    const t = setup(script);
    t.poller.start();
    for (let i = 0; i < batches + 1; i += 1) await t.timers.fire();
    expect(b).toBe(batches);
    expect(batches * per).toBeGreaterThan(SEEN_MAX);
    const last = t.rows.at(-1)!;
    // The very first id was forgotten and is handed over again; the newest is still remembered and is not.
    expect(last.map((r) => r.id)).toEqual(['r0']);
  });
});
