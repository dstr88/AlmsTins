import { describe, it, expect } from 'vitest';
import {
  DWELL_MS, QUEUE_FOLD_AT, QUEUE_HARD_MAX, clearStage, enqueue, initialPlayer, isFlagged, mustShow, nextDelay, pause, resume, tick, waiting,
  type Card, type PlayerState,
} from '../../src/components/agentics/feedPlayer';
import { toFeedRow, type FeedRow } from '../../src/components/agentics/feedRows';
import { addr } from '../helpers/agentVault';

/**
 * The cards of the live feed: one at a time, three seconds each, a burst waiting its turn. The player is a pure
 * state machine that takes the time as an argument, so every rule here is a plain assertion with no clock.
 */

let n = 0;
const row = (over: Record<string, unknown> = {}): FeedRow => {
  n += 1;
  return toFeedRow({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, tinId: 'tin-1', kind: 'checked', at: '2026-10-19T11:00:00.000Z', address: addr(1), chain: null,
    answer: 'unknown', registry: 'none', status: 'unknown', keyId: null, keyStatus: null, tx: null, detail: { basis: 'not_in_registry' },
    writtenAt: '2026-10-19 11:00:01', agent: 'Agent', label: null, ...over,
  }) as FeedRow;
};
const flagged = () => row({ answer: 'flagged', registry: 'flagged', detail: { basis: 'registry_flagged' } });
const transfer = () =>
  row({ kind: 'transaction', chain: 'ethereum', tx: { hash: `0x${'ab'.repeat(32)}`, direction: 'in', wallet: addr(9), amount: '1', asset: 'ETH', assetContract: null, usd: 10, blockNumber: 1 }, detail: { link: null, reason: 'no_preceding_check' } });
const ids = (cards: Card[]) => cards.map((c) => (c.kind === 'row' ? c.row.id : `folded:${c.count}`));
const cardId = (s: PlayerState) => (s.current?.card.kind === 'row' ? s.current.card.row.id : null);

describe('a card on the stage', () => {
  it('goes up at once when the stage is empty, and stays three seconds', () => {
    const a = row();
    const s = enqueue(initialPlayer, [a], 1000);
    expect(cardId(s)).toBe(a.id);
    expect(s.current?.shownAt).toBe(1000);
    expect(tick(s, 1000 + DWELL_MS - 1)).toBe(s);
    const later = tick(s, 1000 + DWELL_MS);
    expect(later.current).toBeNull();
  });

  it('the others wait in order and each gets its three seconds', () => {
    const [a, b, c] = [row(), row(), row()];
    let s = enqueue(initialPlayer, [a, b, c], 0);
    expect(cardId(s)).toBe(a.id);
    expect(ids(s.queue)).toEqual([b.id, c.id]);
    s = tick(s, 3000);
    expect(cardId(s)).toBe(b.id);
    expect(s.current?.shownAt).toBe(3000);
    s = tick(s, 5999);
    expect(cardId(s)).toBe(b.id);
    s = tick(s, 6000);
    expect(cardId(s)).toBe(c.id);
    s = tick(s, 9000);
    expect(s.current).toBeNull();
    expect(s.queue).toEqual([]);
  });

  it('a row that arrives while one is on stage waits behind the queue', () => {
    const [a, b, c] = [row(), row(), row()];
    let s = enqueue(initialPlayer, [a], 0);
    s = enqueue(s, [b], 500);
    s = enqueue(s, [c], 900);
    expect(ids(s.queue)).toEqual([b.id, c.id]);
  });

  it('takes the stage again when a new row arrives after it was empty', () => {
    const [a, b] = [row(), row()];
    let s = enqueue(initialPlayer, [a], 0);
    s = tick(s, 3000);
    expect(s.current).toBeNull();
    s = enqueue(s, [b], 10_000);
    expect(cardId(s)).toBe(b.id);
    expect(s.current?.shownAt).toBe(10_000);
  });

  it('gives no state back for nothing arriving', () => {
    expect(enqueue(initialPlayer, [], 0)).toBe(initialPlayer);
    expect(tick(initialPlayer, 99_999)).toBe(initialPlayer);
  });

  it('moves one card at a time however long the page was away, so a long absence never flushes the queue', () => {
    const rows = [row(), row(), row(), row()];
    let s = enqueue(initialPlayer, rows, 0);
    s = tick(s, 10 * 60_000);
    expect(cardId(s)).toBe(rows[1].id);
    expect(s.current?.shownAt).toBe(10 * 60_000);
    expect(s.queue).toHaveLength(2);
  });
});

describe('when the player next needs a tick', () => {
  it('is what is left of the three seconds, zero when a card is waiting for the stage, and none when it has nothing to do', () => {
    expect(nextDelay(initialPlayer, 0)).toBeNull();
    const s = enqueue(initialPlayer, [row(), row()], 1000);
    expect(nextDelay(s, 1000)).toBe(3000);
    expect(nextDelay(s, 3500)).toBe(500);
    expect(nextDelay(s, 9000)).toBe(0);
    expect(nextDelay({ ...initialPlayer, queue: [{ kind: 'row', row: row() }] }, 0)).toBe(0);
  });
});

describe('pausing', () => {
  it('holds the card with what was left of its time, and the queue behind it', () => {
    const [a, b] = [row(), row()];
    let s = enqueue(initialPlayer, [a, b], 0);
    s = pause(s, 1000);
    expect(s.paused).toBe(true);
    expect(s.left).toBe(2000);
    expect(tick(s, 60_000)).toBe(s);
    expect(nextDelay(s, 60_000)).toBeNull();
    s = resume(s, 60_000);
    expect(s.paused).toBe(false);
    expect(s.left).toBeNull();
    expect(cardId(s)).toBe(a.id);
    expect(nextDelay(s, 60_000)).toBe(2000);
    expect(tick(s, 61_999)).toBe(s);
    expect(cardId(tick(s, 62_000))).toBe(b.id);
  });

  it('lets rows arrive while paused without showing them, and shows the first when resumed', () => {
    const [a, b] = [row(), row()];
    let s = pause(initialPlayer, 0);
    s = enqueue(s, [a, b], 100);
    expect(s.current).toBeNull();
    expect(ids(s.queue)).toEqual([a.id, b.id]);
    s = resume(s, 5000);
    expect(cardId(s)).toBe(a.id);
    expect(s.current?.shownAt).toBe(5000);
  });

  it('is idempotent either way, and a card whose time was all gone leaves at once when resumed', () => {
    const [a, b] = [row(), row()];
    let s = enqueue(initialPlayer, [a, b], 0);
    const once = pause(s, 1000);
    expect(pause(once, 5000)).toBe(once);
    expect(resume(s, 0)).toBe(s);
    s = pause(enqueue(initialPlayer, [a, b], 0), 3000);
    expect(s.left).toBe(0);
    s = resume(s, 4000);
    expect(nextDelay(s, 4000)).toBe(0);
    expect(cardId(tick(s, 4000))).toBe(b.id);
  });
});

describe('starting the stage over (another agent is chosen)', () => {
  it('empties the stage and the queue', () => {
    const s = enqueue(initialPlayer, [row(), row(), row()], 1000);
    const cleared = clearStage(s);
    expect(cleared.current).toBeNull();
    expect(cleared.queue).toEqual([]);
    expect(cleared.skipped).toBe(0);
    expect(cleared.paused).toBe(false);
  });

  it('keeps a pause as the person left it: the page\'s list holds still with the cards, and the button still says Resume', () => {
    const paused = pause(enqueue(initialPlayer, [row(), row()], 1000), 1500);
    expect(paused.paused).toBe(true);
    const cleared = clearStage(paused);
    expect(cleared.paused).toBe(true);
    expect(cleared.current).toBeNull();
    expect(cleared.queue).toEqual([]);
    expect(cleared.left).toBeNull();
    // Rows that arrive while it is cleared and paused wait; resuming shows the first.
    const a = row();
    const waitingRow = enqueue(cleared, [a], 2000);
    expect(waitingRow.current).toBeNull();
    expect(cardId(resume(waitingRow, 3000))).toBe(a.id);
  });
});

describe('a burst', () => {
  it('lets twenty wait, and folds the oldest quiet checks into one card past that', () => {
    const rows = Array.from({ length: 1 + QUEUE_FOLD_AT + 5 }, () => row());
    const s = enqueue(initialPlayer, rows, 0);
    expect(cardId(s)).toBe(rows[0].id);
    expect(s.queue.length).toBeLessThanOrEqual(QUEUE_FOLD_AT);
    expect(s.queue[0]).toEqual({ kind: 'folded', count: 6 });
    // Everything is still counted.
    expect(waiting(s)).toBe(QUEUE_FOLD_AT + 5);
    // The newest are untouched and in order.
    expect(ids(s.queue.slice(1))).toEqual(rows.slice(1 + 6).map((r) => r.id));
  });

  it('never folds a check that came back flagged, or a transfer: each gets its turn', () => {
    const f = flagged();
    const t = transfer();
    const quiet = Array.from({ length: QUEUE_FOLD_AT + 10 }, () => row());
    const s = enqueue(initialPlayer, [row(), f, ...quiet.slice(0, 5), t, ...quiet.slice(5)], 0);
    const kept = s.queue.filter((c) => c.kind === 'row').map((c) => (c as { row: FeedRow }).row.id);
    expect(kept).toContain(f.id);
    expect(kept).toContain(t.id);
    expect(s.queue.length).toBeLessThanOrEqual(QUEUE_FOLD_AT);
    expect(s.queue.filter((c) => c.kind === 'folded')).toHaveLength(1);
    // The flag comes before the transfer, as they arrived.
    expect(kept.indexOf(f.id)).toBeLessThan(kept.indexOf(t.id));
  });

  it('folds into one card and counts the checks it stands for, again and again as more arrive', () => {
    let s = enqueue(initialPlayer, [row()], 0);
    for (let i = 0; i < 6; i += 1) s = enqueue(s, Array.from({ length: 10 }, () => row()), 100 + i);
    expect(s.queue.length).toBeLessThanOrEqual(QUEUE_FOLD_AT);
    expect(waiting(s)).toBe(60);
    expect(s.queue.filter((c) => c.kind === 'folded')).toHaveLength(1);
  });

  it('leaves a queue of cards that must be shown alone, up to a hard limit, and counts the ones it had to skip', () => {
    const many = Array.from({ length: 1 + QUEUE_HARD_MAX + 7 }, () => flagged());
    const s = enqueue(initialPlayer, many, 0);
    expect(s.queue).toHaveLength(QUEUE_HARD_MAX);
    expect(s.skipped).toBe(7);
    // The newest are the ones kept.
    expect(ids(s.queue)).toEqual(many.slice(8).map((r) => r.id));
  });

  it('does not fold a queue that is not over the limit', () => {
    const rows = Array.from({ length: 1 + QUEUE_FOLD_AT }, () => row());
    const s = enqueue(initialPlayer, rows, 0);
    expect(s.queue.every((c) => c.kind === 'row')).toBe(true);
    expect(s.queue).toHaveLength(QUEUE_FOLD_AT);
  });

  it('a folded card gets its three seconds like any other', () => {
    let s = enqueue(initialPlayer, Array.from({ length: 40 }, () => row()), 0);
    s = tick(s, 3000);
    expect(s.current?.card).toEqual({ kind: 'folded', count: expect.any(Number) });
    expect(nextDelay(s, 3000)).toBe(3000);
  });
});

describe('which cards must be shown alone', () => {
  it('a transfer, a flagged check, and a check about an address the registry has flagged', () => {
    expect(mustShow(transfer())).toBe(true);
    expect(mustShow(flagged())).toBe(true);
    expect(mustShow(row({ registry: 'flagged' }))).toBe(true);
    expect(mustShow(row({ answer: 'flagged' }))).toBe(true);
    expect(mustShow(row())).toBe(false);
    expect(mustShow(row({ answer: 'proven', registry: 'trusted' }))).toBe(false);
  });
  it('a transfer is not "flagged" unless its own status says so', () => {
    expect(isFlagged(transfer())).toBe(false);
    expect(isFlagged(row({ kind: 'transaction', answer: 'flagged', chain: 'ethereum', tx: { hash: 'h', direction: 'out', wallet: 'w', amount: '1', asset: 'ETH', assetContract: null, usd: null, blockNumber: 1 } }))).toBe(true);
  });
});

describe('the numbers', () => {
  it('are three seconds, twenty before folding and a hundred at the most', () => {
    expect(DWELL_MS).toBe(3000);
    expect(QUEUE_FOLD_AT).toBe(20);
    expect(QUEUE_HARD_MAX).toBe(100);
  });
});
