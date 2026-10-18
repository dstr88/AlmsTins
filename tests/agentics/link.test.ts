import { describe, it, expect } from 'vitest';
import { LINK_LOOKUP_LIMIT, LINK_TOLERANCE_MS, LINK_WINDOW_MS, linkTransactionToCheck } from '../../src/lib/agentVault/link';
import type { CheckForLink } from '../../src/lib/agentVault/events';

/**
 * The link from a transfer to the check that came before it. A wrong stamp is the failure to design
 * against, so most of this file is about what must NOT be stamped.
 */

const T = Date.UTC(2026, 9, 18, 12, 0, 0, 0); // the transfer's block time
const at = (offsetMs: number) => new Date(T + offsetMs).toISOString();
const check = (id: string, offsetMs: number, over: Partial<CheckForLink> = {}): CheckForLink => ({
  id, at: at(offsetMs), answer: 'consistent-with-history', status: 'unknown', keyId: 'a1'.repeat(12), ...over,
});

describe('which check a transfer inherits from', () => {
  it('no check at all: unknown, with the reason', () => {
    expect(linkTransactionToCheck(T, [])).toEqual({ linked: false, answer: 'unknown', status: null, reason: 'no_preceding_check' });
  });

  it('the check just before it: its answer, its status, its key, and how long before', () => {
    const r = linkTransactionToCheck(T, [check('c1', -5_000, { answer: 'proven', status: 'proven' })]);
    expect(r).toEqual({ linked: true, answer: 'proven', status: 'proven', check: { eventId: 'c1', at: at(-5_000), gapMs: 5_000, keyId: 'a1'.repeat(12) } });
  });

  it('a check whose answer was unknown still links: the transfer is unknown WITH the evidence of the ask', () => {
    const r = linkTransactionToCheck(T, [check('c1', -1_000, { answer: 'unknown', status: 'unknown' })]);
    expect(r).toMatchObject({ linked: true, answer: 'unknown', check: { eventId: 'c1' } });
  });

  it('a flagged answer carries through: the transfer is flagged', () => {
    expect(linkTransactionToCheck(T, [check('c1', -2_000, { answer: 'flagged', status: 'mismatch' })])).toMatchObject({ linked: true, answer: 'flagged', status: 'mismatch' });
  });

  it('the latest check wins over an earlier one', () => {
    const r = linkTransactionToCheck(T, [check('old', -50_000, { answer: 'proven' }), check('new', -10_000, { answer: 'flagged' })]);
    expect(r).toMatchObject({ linked: true, answer: 'flagged', check: { eventId: 'new' } });
  });

  it('one check can stamp many transfers', () => {
    const checks = [check('c1', -30_000)];
    for (const later of [0, 60_000, 600_000]) {
      expect(linkTransactionToCheck(T + later, checks)).toMatchObject({ linked: true, check: { eventId: 'c1' } });
    }
  });
});

describe('what is not a preceding check', () => {
  it('a check answered AFTER the funds moved does not vouch for them', () => {
    expect(linkTransactionToCheck(T, [check('late', 30_000)])).toMatchObject({ linked: false, reason: 'no_preceding_check' });
    expect(linkTransactionToCheck(T, [check('late', LINK_TOLERANCE_MS + 1)])).toMatchObject({ linked: false });
  });

  it('block times are whole seconds, so a check up to a second after the stamp still counts as before it', () => {
    const r = linkTransactionToCheck(T, [check('c1', 900)]);
    expect(r).toMatchObject({ linked: true, check: { eventId: 'c1', gapMs: 0 } });
    expect(linkTransactionToCheck(T, [check('c1', LINK_TOLERANCE_MS)])).toMatchObject({ linked: true });
  });

  it('a check older than the window is stale evidence', () => {
    expect(linkTransactionToCheck(T, [check('stale', -(LINK_WINDOW_MS + 1))])).toMatchObject({ linked: false, reason: 'no_preceding_check' });
    expect(linkTransactionToCheck(T, [check('edge', -LINK_WINDOW_MS)])).toMatchObject({ linked: true });
  });

  it('the window is an hour and the tolerance a second', () => {
    expect(LINK_WINDOW_MS).toBe(3_600_000);
    expect(LINK_TOLERANCE_MS).toBe(1000);
    expect(LINK_LOOKUP_LIMIT).toBeGreaterThanOrEqual(10);
  });

  it('a check with a time that is not a time is ignored', () => {
    expect(linkTransactionToCheck(T, [check('bad', 0, { at: 'yesterday' })])).toMatchObject({ linked: false });
  });

  it('the window and the tolerance can be set for a tin', () => {
    expect(linkTransactionToCheck(T, [check('c1', -5 * 60_000)], { windowMs: 60_000 })).toMatchObject({ linked: false });
    expect(linkTransactionToCheck(T, [check('c1', 4_000)], { toleranceMs: 5_000 })).toMatchObject({ linked: true });
  });
});

describe('ambiguity stamps nothing', () => {
  it('two checks in the same millisecond that disagree on the answer', () => {
    const r = linkTransactionToCheck(T, [check('a', -1_000, { answer: 'proven' }), check('b', -1_000, { answer: 'flagged' })]);
    expect(r).toEqual({ linked: false, answer: 'unknown', status: null, reason: 'ambiguous_checks' });
  });

  it('or on the public status', () => {
    const r = linkTransactionToCheck(T, [check('a', -1_000, { status: 'proven' }), check('b', -1_000, { status: 'unanchored' })]);
    expect(r).toMatchObject({ linked: false, reason: 'ambiguous_checks' });
  });

  it('two that agree are not ambiguous: the lowest id is named', () => {
    const r = linkTransactionToCheck(T, [check('b', -1_000), check('a', -1_000)]);
    expect(r).toMatchObject({ linked: true, check: { eventId: 'a' } });
  });

  it('a disagreement further back does not matter once a later check is clear', () => {
    const r = linkTransactionToCheck(T, [check('a', -9_000, { answer: 'proven' }), check('b', -9_000, { answer: 'flagged' }), check('c', -2_000, { answer: 'consistent-with-history' })]);
    expect(r).toMatchObject({ linked: true, answer: 'consistent-with-history', check: { eventId: 'c' } });
  });
});

describe('the answer does not depend on the order the checks arrive in', () => {
  const permutations = <X,>(xs: X[]): X[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

  it('every ordering of a mixed set gives one result', () => {
    const checks = [
      check('a', -40_000, { answer: 'proven' }),
      check('b', -20_000, { answer: 'consistent-with-history' }),
      check('c', -20_000, { answer: 'consistent-with-history' }),
      check('d', -3_600_001, { answer: 'flagged' }),
      check('e', 5_000, { answer: 'flagged' }),
    ];
    const results = permutations(checks).map((p) => JSON.stringify(linkTransactionToCheck(T, p)));
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0])).toMatchObject({ linked: true, answer: 'consistent-with-history', check: { eventId: 'b' } });
  });

  it('and an ambiguous set is ambiguous in every ordering', () => {
    const checks = [check('a', -1_000, { answer: 'proven' }), check('b', -1_000, { answer: 'unknown' }), check('c', -9_000, { answer: 'proven' })];
    const results = permutations(checks).map((p) => JSON.stringify(linkTransactionToCheck(T, p)));
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0])).toMatchObject({ linked: false, reason: 'ambiguous_checks' });
  });

  it('the amount is not part of the match: a check carries none, and the function is never given one', () => {
    expect(linkTransactionToCheck.length).toBeLessThanOrEqual(3);
  });
});
