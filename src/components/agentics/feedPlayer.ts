/**
 * The cards of the live feed: one at a time, each on screen for three seconds, a burst waiting its turn.
 * "The operator should be able to watch this ... as one transaction pops up and lasts for three seconds."
 *
 * A pure state machine. Every function takes the time it is called at and returns the next state, so the
 * page only has to say "this arrived" and "this much time passed", and each rule is a unit test with no
 * clock and no timer.
 *
 * What happens in a burst. Cards wait in order. Once more than QUEUE_FOLD_AT are waiting, the OLDEST quiet
 * checks fold into one "+N more checks" card, so the feed does not fall minutes behind an agent that asks
 * thirty times a minute. A check that came back flagged, and every transfer, is never folded: each gets its
 * turn. Even those are bounded (QUEUE_HARD_MAX): past that the oldest waiting cards are skipped and the
 * page says how many. Nothing is lost by folding or skipping: every row is in the list under the stage, in
 * order, the moment it arrives. The cards are a highlight, the list is the record.
 *
 * Pausing keeps what is left of the card on screen and holds the queue, so a person can read one.
 */
import type { FeedRow } from './feedRows';

/** How long a card stays on screen. */
export const DWELL_MS = 3000;
/** Cards waiting before quiet checks start to fold into one. */
export const QUEUE_FOLD_AT = 20;
/** The most cards that wait, whatever they are. */
export const QUEUE_HARD_MAX = 100;

export type Card = { kind: 'row'; row: FeedRow } | { kind: 'folded'; count: number };

export interface PlayerState {
  /** The card on screen, and when it appeared (the caller's clock, in milliseconds). */
  current: { card: Card; shownAt: number } | null;
  /** Waiting, oldest first. */
  queue: Card[];
  paused: boolean;
  /** While paused: how much of the card's time was left. */
  left: number | null;
  /** Cards dropped because more than QUEUE_HARD_MAX were waiting. */
  skipped: number;
}

export const initialPlayer: PlayerState = { current: null, queue: [], paused: false, left: null, skipped: 0 };

/** The stage starts over (another agent was chosen): no card on it and nothing waiting, and a pause stays as the person left it. */
export function clearStage(state: PlayerState): PlayerState {
  return { ...initialPlayer, paused: state.paused };
}

/** A check that came back flagged, or one about an address the owner's registry has flagged. */
export const isFlagged = (row: FeedRow): boolean => row.answer === 'flagged' || row.registry === 'flagged';

/** A card that gets its own turn and is never folded: a flag, or funds that moved. */
export const mustShow = (row: FeedRow): boolean => row.kind === 'transaction' || isFlagged(row);

const weight = (c: Card): number => (c.kind === 'folded' ? c.count : 1);

/** Folds the oldest quiet cards into one until the queue is no longer than QUEUE_FOLD_AT (or there is nothing left to fold). */
function fold(queue: Card[]): Card[] {
  const excess = queue.length - QUEUE_FOLD_AT;
  if (excess <= 0) return queue;
  const foldable: number[] = [];
  queue.forEach((c, i) => {
    if (c.kind === 'folded' || !mustShow(c.row)) foldable.push(i);
  });
  if (foldable.length < 2) return queue;
  // Folding m cards into one removes m - 1.
  const chosen = foldable.slice(0, Math.min(foldable.length, excess + 1));
  const first = chosen[0];
  const drop = new Set(chosen);
  const count = chosen.reduce((n, i) => n + weight(queue[i]), 0);
  const out: Card[] = [];
  queue.forEach((c, i) => {
    if (i === first) out.push({ kind: 'folded', count });
    else if (!drop.has(i)) out.push(c);
  });
  return out;
}

function bounded(state: PlayerState): PlayerState {
  let queue = fold(state.queue);
  let skipped = state.skipped;
  if (queue.length > QUEUE_HARD_MAX) {
    skipped += queue.length - QUEUE_HARD_MAX;
    queue = queue.slice(queue.length - QUEUE_HARD_MAX);
  }
  return queue === state.queue && skipped === state.skipped ? state : { ...state, queue, skipped };
}

/** Rows that have just arrived, oldest first: the first takes the stage if it is empty, the rest wait. */
export function enqueue(state: PlayerState, rows: readonly FeedRow[], now: number): PlayerState {
  if (!rows.length) return state;
  let s: PlayerState = { ...state, queue: [...state.queue] };
  for (const row of rows) {
    const card: Card = { kind: 'row', row };
    if (!s.current && !s.paused && s.queue.length === 0) s = { ...s, current: { card, shownAt: now } };
    else s.queue.push(card);
  }
  return bounded(s);
}

/** Time has passed: a card whose three seconds are up gives way to the next. One step at a time, so a long absence never flushes the queue. */
export function tick(state: PlayerState, now: number): PlayerState {
  if (state.paused) return state;
  if (state.current && now - state.current.shownAt < DWELL_MS) return state;
  const [next, ...rest] = state.queue;
  if (!state.current && !next) return state;
  return { ...state, current: next ? { card: next, shownAt: now } : null, queue: rest };
}

/** Holds the card on screen and the queue behind it. */
export function pause(state: PlayerState, now: number): PlayerState {
  if (state.paused) return state;
  const left = state.current ? Math.max(0, DWELL_MS - (now - state.current.shownAt)) : null;
  return { ...state, paused: true, left };
}

/** Lets the card finish the time it had left, then the queue moves on. */
export function resume(state: PlayerState, now: number): PlayerState {
  if (!state.paused) return state;
  const running: PlayerState = {
    ...state,
    paused: false,
    left: null,
    current: state.current ? { card: state.current.card, shownAt: now - (DWELL_MS - (state.left ?? DWELL_MS)) } : null,
  };
  return running.current || !running.queue.length ? running : tick(running, now);
}

/** How long until the player next needs a tick, or null when it needs none (paused, or nothing on stage and nothing waiting). */
export function nextDelay(state: PlayerState, now: number): number | null {
  if (state.paused) return null;
  if (state.current) return Math.max(0, DWELL_MS - (now - state.current.shownAt));
  return state.queue.length ? 0 : null;
}

/** How many cards are waiting, counting a folded card as the checks it stands for. */
export function waiting(state: PlayerState): number {
  return state.queue.reduce((n, c) => n + weight(c), 0);
}
