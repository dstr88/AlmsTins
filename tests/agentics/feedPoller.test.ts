import { describe, it, expect } from 'vitest';
import { BACKOFF_MAX_MS, CATCH_UP_MS, MAX_PAGES, MAX_PAGES as PAGES, POLL_MS, RATE_LIMITED_WAIT_MS, REQUEST_TIMEOUT_MS, SEEN_HARD_MAX, SEEN_SWEEP_AT, SETTLE_MS, createFeedPoller, type ConnState } from '../../src/components/agentics/feedPoller';
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

function setup(script: Parameters<typeof scriptedSend>[0], opts: { since?: string; seen?: Array<string | { id: string; writtenAt: string }>; visible?: () => boolean; onRows?: (r: FeedRow[]) => void } = {}) {
  const timers = fakeTimers();
  const { send, sent } = scriptedSend(script);
  const rows: FeedRow[][] = [];
  const states: Array<[ConnState, string | null]> = [];
  let visible = true;
  const poller = createFeedPoller(
    { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: opts.visible ?? (() => visible), onRows: opts.onRows ?? ((r) => rows.push(r)), onState: (s, at) => states.push([s, at]), now: timers.now },
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

  const since = (n: number, t: { sent: Array<{ url: string }> }) => decodeURIComponent(t.sent[n].url.split('since=')[1] ?? '');

  it('moves `since` only past what has settled: the newest second it saw, six seconds after it first saw it (the server starts five seconds earlier, so the window then begins one second after that second)', async () => {
    // Polls at 3, 6, 9, 12 and 15 seconds on its own clock. 'a' is stamped 11:00:06 and first seen at 3 seconds.
    const t = setup([answer([ev('a', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([], '2026-10-19 11:00:06')]);
    t.poller.start();
    for (let i = 0; i < 5; i += 1) await t.timers.fire();
    expect(t.sent.map((_, i) => since(i, t))).toEqual([
      '2026-10-19 11:00:00', // the first ask: where it began (nothing had settled yet)
      '2026-10-19 11:00:00', // the pass at 3 seconds settled nothing, so this one still starts where it began
      '2026-10-19 11:00:06', // the pass at 6 seconds found the page's opening value (11:00:00) settled: past it, plus six...
      '2026-10-19 11:00:12', // ...the pass at 9 found 'a' (stamped 11:00:06, first seen at 3 seconds) settled: past it, plus six. 'a' is out of the window from here
      '2026-10-19 11:00:12', // and it stays there until something newer has settled
    ]);
    expect(SETTLE_MS).toBe(6000);
  });

  it('leaves `since` where it was while nothing has settled (the first seconds after the page opens)', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([], '2026-10-19 11:00:06')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(since(0, t)).toBe('2026-10-19 11:00:00');
    expect(since(1, t)).toBe('2026-10-19 11:00:00');
  });

  it('never goes back: older rows in an answer do not move it, and a later pass never asks from before an earlier one', async () => {
    const t = setup([answer([ev('old', '2026-10-19 10:00:00')], '2026-10-19 10:00:00')], { since: '2026-10-19 11:00:00' });
    t.poller.start();
    for (let i = 0; i < 6; i += 1) await t.timers.fire();
    const asked = t.sent.map((_, i) => since(i, t));
    expect(asked[0]).toBe('2026-10-19 11:00:00');
    for (let i = 1; i < asked.length; i += 1) expect(asked[i] >= asked[i - 1], `${asked[i - 1]} then ${asked[i]}`).toBe(true);
  });

  it('stops reading a burst again and again once it has settled: a quiet ledger after a burst is asked from past the burst', async () => {
    // A burst stamped 11:00:09 is seen at 3 seconds; after it nothing arrives. Every ask lists the burst while it is inside the window.
    const burst = Array.from({ length: 150 }, (_, i) => ev(`b${i}`, '2026-10-19 11:00:09'));
    const t = setup([answer(burst, '2026-10-19 11:00:09'), () => (since(t.sent.length - 1, t) <= '2026-10-19 11:00:08' ? answer(burst, '2026-10-19 11:00:09') : answer([], '2026-10-19 11:00:09'))]);
    t.poller.start();
    for (let i = 0; i < 8; i += 1) await t.timers.fire();
    const asked = t.sent.map((_, i) => since(i, t));
    // It asks from a time past the burst (its server window starts after 11:00:09) within a few polls, and stays there.
    const pastBurst = asked.findIndex((s) => s >= '2026-10-19 11:00:14');
    expect(pastBurst).toBeGreaterThan(0);
    expect(pastBurst).toBeLessThanOrEqual(5);
    for (const s of asked.slice(pastBurst)) expect(s >= '2026-10-19 11:00:14').toBe(true);
    // And nothing was handed over twice.
    expect(t.rows.flat()).toHaveLength(150);
  });

  it('drops a row it has already given, the five seconds the server repeats and the rows the page opened with', async () => {
    const t = setup([answer([ev('seen-on-open', '2026-10-19 11:00:05'), ev('new', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([ev('new', '2026-10-19 11:00:06'), ev('newer', '2026-10-19 11:00:09')], '2026-10-19 11:00:09')], { seen: ['seen-on-open'] });
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.rows.map((r) => r.map((x) => x.id))).toEqual([['new'], ['newer']]);
  });

  it('hands over a row once even when two answers of the same turn carry it', async () => {
    const t = setup([
      answer([ev('a', '2026-10-19 11:00:05'), ev('dup', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: '2026-10-19 11:00:05|dup' }),
      answer([ev('dup', '2026-10-19 11:00:05'), ev('b', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'),
    ]);
    t.poller.start();
    await t.timers.fire();
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].map((r) => r.id)).toEqual(['a', 'dup', 'b']);
  });

  it('keeps polling when a row\'s time has the right shape but is not a date (the page checks what it reads, and the calendar too)', async () => {
    const t = setup([answer([ev('odd', '2026-13-45 99:99:99'), ev('fine', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([], '2026-10-19 11:00:06')]);
    t.poller.start();
    for (let i = 0; i < 6; i += 1) await t.timers.fire();
    expect(t.sent.length).toBeGreaterThanOrEqual(6);
    expect(t.rows.flat().map((r) => r.id)).toContain('fine');
    expect(t.states.at(-1)?.[0]).toBe('live');
    // And what it asks from is still a real time, the one it would have asked from without that row.
    for (const r of t.sent) {
      const asked = decodeURIComponent(r.url.split('since=')[1] ?? '2026-10-19 11:00:00');
      expect(asked).not.toContain('2026-13');
      expect(Number.isFinite(Date.parse(`${asked.replace(' ', 'T')}Z`)), asked).toBe(true);
    }
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
    // One hand-over, in order. What the backlog read has not settled yet (six seconds), so the next ask is from where the pass began and reads it once more (nothing is handed over twice).
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].map((r) => r.id)).toEqual(['a', 'b', 'c']);
    await t.timers.fire();
    expect(t.sent[3].url).toBe(`/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}`);
    expect(t.rows).toHaveLength(1);
  });

  it('stops following after ten answers, and carries on in the next turn FROM THE CURSOR it left off at, not from `since` again', async () => {
    let n = 0;
    const t = setup([() => {
      n += 1;
      // Ten answers each say there is more; the eleventh (the next turn's first) is the end of the backlog.
      return n <= MAX_PAGES
        ? answer([ev(`e${n}`, '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: `2026-10-19 11:00:05|e${n}` })
        : answer([ev(`e${n}`, '2026-10-19 11:00:07')], '2026-10-19 11:00:07');
    }]);
    t.poller.start();
    await t.timers.fire();
    expect(t.sent).toHaveLength(MAX_PAGES);
    expect(PAGES).toBe(10);
    expect(t.rows[0]).toHaveLength(MAX_PAGES);
    // It does not wait the usual three seconds for the rest of a backlog.
    expect(t.timers.delays()).toEqual([CATCH_UP_MS]);
    await t.timers.fire();
    // The next turn's first request continues after the tenth answer's cursor: it does not start over from `since`.
    expect(t.sent[MAX_PAGES].url).toBe(`/api/agentics/feed?after=${encodeURIComponent(`2026-10-19 11:00:05|e${MAX_PAGES}`)}`);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1].map((r) => r.id)).toEqual([`e${MAX_PAGES + 1}`]);
    // The backlog is done: the usual pace, and the next ask is from where the pass began (what it read has not settled).
    expect(t.timers.delays()).toEqual([POLL_MS]);
    await t.timers.fire();
    expect(t.sent[MAX_PAGES + 1].url).toBe(`/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}`);
  });

  it('keeps the place it had in a long backlog through a failure: the retry continues from the same cursor', async () => {
    let n = 0;
    const t = setup([() => {
      n += 1;
      if (n <= MAX_PAGES) return answer([ev(`e${n}`, '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: `2026-10-19 11:00:05|e${n}` });
      if (n === MAX_PAGES + 1) return failed(500);
      return answer([ev('last', '2026-10-19 11:00:09')], '2026-10-19 11:00:09');
    }]);
    t.poller.start();
    await t.timers.fire(); // ten pages, a backlog left
    await t.timers.fire(); // the continuation fails
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    await t.timers.fire(); // and is retried from the same place, not from `since`
    const cursor = `/api/agentics/feed?after=${encodeURIComponent(`2026-10-19 11:00:05|e${MAX_PAGES}`)}`;
    expect(t.sent[MAX_PAGES].url).toBe(cursor);
    expect(t.sent[MAX_PAGES + 1].url).toBe(cursor);
    expect(t.rows.flat().map((r) => r.id)).toEqual([...Array.from({ length: MAX_PAGES }, (_, i) => `e${i + 1}`), 'last']);
  });


  it('drops a refused cursor and starts the pass again from `since` (not from the beginning of the ledger, which would hand over every row the page had forgotten)', async () => {
    let n = 0;
    const t = setup([() => {
      n += 1;
      if (n <= MAX_PAGES) return answer([ev(`e${n}`, '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: `2026-10-19 11:00:05|e${n}` });
      if (n === MAX_PAGES + 1) return failed(400, 'invalid_cursor');
      return answer([], '1970-01-01 00:00:00');
    }]);
    t.poller.start();
    await t.timers.fire(); // ten pages, a backlog left
    await t.timers.fire(); // the continuation's cursor is refused
    expect(t.timers.delays()).toEqual([0]);
    await t.timers.fire(); // again from where the pass began, with no cursor
    expect(t.sent[MAX_PAGES + 1].url).toBe(`/api/agentics/feed?since=${encodeURIComponent('2026-10-19 11:00:00')}`);
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

  it('asks once more at once when a request is refused (from where it was), then treats a second refusal as any failure', async () => {
    const t = setup([failed(400, 'invalid_cursor'), failed(400, 'invalid_cursor'), answer([], '2026-10-19 11:00:00')], { since: '2026-10-19 11:00:00' });
    t.poller.start();
    await t.timers.fire();
    expect(t.timers.delays()).toEqual([0]);
    await t.timers.fire();
    expect(t.sent[1].url).toBe(t.sent[0].url);
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    expect(t.timers.delays()).toEqual([6000]);
  });

  it('is a failure when an answer says there is more and gives no way to ask for it: it hands nothing over, and does not move `since` past rows it never fetched', async () => {
    // A server that says so every time: no turn is a whole read.
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05', { more: true, cursor: null })]);
    t.poller.start();
    await t.timers.fire();
    expect(t.rows).toEqual([]);
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    expect(t.timers.delays()).toEqual([6000]);
    for (let i = 0; i < 6; i += 1) await t.timers.fire();
    expect(t.rows).toEqual([]);
    // It asked from where it began every time: no pass was finished, so `since` never moved (past rows it never fetched).
    for (const r of t.sent) expect(decodeURIComponent(r.url.split('since=')[1] ?? '')).toBe('2026-10-19 11:00:00');
  });

  it('counts the server\'s own newest second even when none of its rows can be shown (an agent removed in another tab): the window moves past them once they have settled', async () => {
    // Every answer has no event to show, and says its newest raw row is 11:00:20 (the server answers with the second it was asked from when nothing is newer).
    const t = setup([(r) => {
      const asked = decodeURIComponent(r.url.split('since=')[1] ?? '');
      return answer([], asked > '2026-10-19 11:00:20' ? asked : '2026-10-19 11:00:20');
    }]);
    t.poller.start();
    for (let i = 0; i < 8; i += 1) await t.timers.fire();
    const asked = t.sent.map((r) => decodeURIComponent(r.url.split('since=')[1] ?? ''));
    // It asked from past those rows (their server window, five seconds earlier, starts after 11:00:20) within a few polls, and stayed there.
    expect(asked.at(-1)! >= '2026-10-19 11:00:26').toBe(true);
    expect(asked.at(-1)).toBe('2026-10-19 11:00:26');
  });

  it('does not take the second it asked from, echoed back, for news: asked past anything newer it stays where it settled, it does not walk ahead six seconds a pass', async () => {
    const t = setup([(r) => answer([], decodeURIComponent(r.url.split('since=')[1] ?? ''))], { since: '2026-10-19 11:00:00' });
    t.poller.start();
    for (let i = 0; i < 12; i += 1) await t.timers.fire();
    const asked = t.sent.map((r) => decodeURIComponent(r.url.split('since=')[1] ?? ''));
    // Only the page's own opening value ever settles: past it, plus six seconds, and no further.
    expect(asked.at(-1)).toBe('2026-10-19 11:00:06');
  });
});

describe('a request that is never answered', () => {
  it('counts as a failure after the timeout, and the next ask goes ahead (a stalled connection does not freeze the page)', async () => {
    const never = () => new Promise(() => {}) as never;
    const t = setup([never, answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')]);
    t.poller.start();
    const firing = t.timers.fire();
    await settle();
    // The poll timer fired and the request is out: its timeout is waiting.
    expect(t.timers.delays()).toEqual([REQUEST_TIMEOUT_MS]);
    await t.timers.fire();
    await firing;
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    expect(t.timers.delays()).toEqual([6000]);
    await t.timers.fire();
    expect(t.rows[0].map((r) => r.id)).toEqual(['a']);
    expect(t.states.at(-1)?.[0]).toBe('live');
  });

  it('drops the answer that comes after the timeout', async () => {
    let release: (v: unknown) => void = () => {};
    const t = setup([() => new Promise((resolve) => { release = resolve; }) as never, answer([], '2026-10-19 11:00:00')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    release(answer([ev('late', '2026-10-19 11:00:09')], '2026-10-19 11:00:09'));
    await settle();
    expect(t.rows).toEqual([]);
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

describe('the clock it settles by', () => {
  it('counts a value as first seen when its answer ARRIVED, not when the turn began: a slow answer does not make what it carries settle early', async () => {
    // The first ask takes ten seconds to be answered; its row is stamped 11:00:06.
    let t0!: ReturnType<typeof setup>;
    const t = setup([
      () => {
        t0.timers.advance(10_000);
        return answer([ev('a', '2026-10-19 11:00:06')], '2026-10-19 11:00:06');
      },
      answer([], '2026-10-19 11:00:06'),
    ]);
    t0 = t;
    t.poller.start();
    for (let i = 0; i < 5; i += 1) await t.timers.fire();
    const asked = t.sent.map((r) => decodeURIComponent(r.url.split('since=')[1] ?? ''));
    // 'a' arrived at 13 seconds (the poll at 3 took ten seconds to be answered). Polls begin at 3, 16, 19, 22 and 25.
    expect(asked).toEqual([
      '2026-10-19 11:00:00', // the first ask
      '2026-10-19 11:00:00', // the pass at 3 s settled nothing; this one (16 s) finds the opening value settled, and 'a' (seen at 13) only 3 seconds old
      '2026-10-19 11:00:06', // the pass at 19 s finds 'a' settled (six seconds after 13) ...
      '2026-10-19 11:00:12', // ... and the ask after it is from past it. (Counting 'a' as seen when the turn began, at 3, would have made this 11:00:12 a poll earlier.)
      '2026-10-19 11:00:12',
    ]);
  });

  it('starts settling again when the clock goes back (a wall clock set back an hour must not freeze `since` for an hour)', async () => {
    const t = setup([answer([ev('a', '2026-10-19 11:00:06')], '2026-10-19 11:00:06'), answer([], '2026-10-19 11:00:06')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    t.timers.advance(-3_600_000);
    for (let i = 0; i < 6; i += 1) await t.timers.fire();
    const asked = t.sent.map((r) => decodeURIComponent(r.url.split('since=')[1] ?? ''));
    expect(asked.at(-1)! >= '2026-10-19 11:00:12').toBe(true);
  });
});

describe('a callback of the page that fails', () => {
  it('is a failed turn, not the end of the poll: the rows were not taken, so the next turn hands them over again', async () => {
    let calls = 0;
    const delivered: string[] = [];
    const t = setup([answer([ev('a', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')], {
      onRows: (rows) => {
        calls += 1;
        if (calls === 1) throw new Error('the page could not take them');
        delivered.push(...rows.map((r) => r.id));
      },
    });
    t.poller.start();
    await t.timers.fire();
    expect(t.states.at(-1)?.[0]).toBe('reconnecting');
    expect(t.timers.delays()).toEqual([6000]);
    await t.timers.fire();
    expect(delivered).toEqual(['a']);
    expect(t.states.at(-1)?.[0]).toBe('live');
    expect(t.timers.delays()).toEqual([POLL_MS]);
  });

  it('does not stop the poll when the page\'s state callback fails too', async () => {
    const timers = fakeTimers();
    const { send } = scriptedSend([answer([], '2026-10-19 11:00:00')]);
    const poller = createFeedPoller(
      { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: () => true, onRows: () => {}, onState: () => { throw new Error('and the state callback'); }, now: timers.now },
      { since: '2026-10-19 11:00:00' },
    );
    poller.start();
    await timers.fire();
    expect(timers.count()).toBe(1);
  });
});

describe('what it remembers', () => {
  const asked = (t: { sent: Array<{ url: string }> }) => t.sent.map((r) => decodeURIComponent(r.url.split('since=')[1] ?? r.url));

  it('keeps every id inside the server\'s window, however many: a burst bigger than the old count limit is not handed over twice by the overlap', async () => {
    const burst = Array.from({ length: 6000 }, (_, i) => ev(`b${i}`, '2026-10-19 11:00:09'));
    // The same burst comes back on the next ask (the server repeats its window).
    const t = setup([answer(burst, '2026-10-19 11:00:09'), answer(burst, '2026-10-19 11:00:09')]);
    t.poller.start();
    await t.timers.fire();
    await t.timers.fire();
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toHaveLength(6000);
    expect(asked(t)).toHaveLength(2);
  });

  it('forgets an id once its second is out of anything the server can send again, so a long session does not grow without end', async () => {
    const old = Array.from({ length: SEEN_SWEEP_AT + 100 }, (_, i) => ev(`old${i}`, '2026-10-19 11:00:01'));
    let n = 0;
    const t = setup([() => {
      n += 1;
      // The first ask: a burst of old rows. Then a new row each time. Much later the server (wrongly) lists an old row again.
      if (n === 1) return answer(old, '2026-10-19 11:00:01');
      if (n === 12) return answer([old[0]], '2026-10-19 11:00:01');
      return answer([ev(`new${n}`, `2026-10-19 11:00:${String(10 + n).padStart(2, '0')}`)], `2026-10-19 11:00:${String(10 + n).padStart(2, '0')}`);
    }]);
    t.poller.start();
    for (let i = 0; i < 12; i += 1) await t.timers.fire();
    // The old rows' second is far behind `since` by now: they were forgotten, so the stray repeat is handed over again.
    expect(t.rows.at(-1)!.map((r) => r.id)).toEqual(['old0']);
  });

  it('never holds more than SEEN_HARD_MAX ids, whatever their age: the oldest go first', async () => {
    const per = 20_000;
    const batches = 4;
    let n = 0;
    const t = setup([() => {
      n += 1;
      if (n <= batches) return answer(Array.from({ length: per }, (_, j) => ev(`r${(n - 1) * per + j}`, '2026-10-19 11:00:09')), '2026-10-19 11:00:09');
      // The server lists the very first id and the very last again.
      return answer([ev('r0', '2026-10-19 11:00:09'), ev(`r${batches * per - 1}`, '2026-10-19 11:00:09')], '2026-10-19 11:00:09');
    }]);
    t.poller.start();
    for (let i = 0; i < batches + 1; i += 1) await t.timers.fire();
    expect(batches * per).toBeGreaterThan(SEEN_HARD_MAX);
    // The first was forgotten (it was the oldest of more than the limit) and is handed over again; the newest is still remembered.
    expect(t.rows.at(-1)!.map((r) => r.id)).toEqual(['r0']);
  });

  it('knows the rows the page opened with by their second, so they too are forgotten when they are out of reach', async () => {
    const t = setup([answer([ev('opening', '2026-10-19 11:00:05')], '2026-10-19 11:00:05')], { seen: [{ id: 'opening', writtenAt: '2026-10-19 11:00:05' }] });
    t.poller.start();
    await t.timers.fire();
    expect(t.rows).toEqual([]);
  });
});
