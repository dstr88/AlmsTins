import { describe, it, expect } from 'vitest';
import { FEED_LIST_MAX, mergeRows, newestFirst, parseFeedRows, shortAddress, toFeedRow, type FeedRow } from '../../src/components/agentics/feedRows';
import { addr } from '../helpers/agentVault';

/**
 * What a page makes of the feed's answer. Pure, so every branch is a plain assertion. The feed's events come
 * from the server, but a page still checks what it reads: an event that is not one is dropped, the owner's own
 * words are cut to a length a card can hold, and the order of the list never depends on how rows arrived.
 */

const event = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  tinId: 'tin-1',
  kind: 'checked',
  at: '2026-10-19T11:00:00.000Z',
  address: addr(1),
  chain: null,
  answer: 'unknown',
  registry: 'none',
  status: 'unknown',
  keyId: null,
  keyStatus: null,
  tx: null,
  detail: { basis: 'not_in_registry' },
  writtenAt: '2026-10-19 11:00:01',
  agent: 'Treasury agent',
  label: null,
  ...over,
});

describe('one event as a row', () => {
  it('keeps the ledger\'s row and adds when it was written, whose it is and what the owner calls the address', () => {
    const row = toFeedRow(event({ label: 'Exchange deposit' }));
    expect(row).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'checked',
      address: addr(1),
      answer: 'unknown',
      registry: 'none',
      basis: 'not_in_registry',
      writtenAt: '2026-10-19 11:00:01',
      tinId: 'tin-1',
      agent: 'Treasury agent',
      label: 'Exchange deposit',
    });
  });

  it('reads a transfer with its facts', () => {
    const row = toFeedRow(
      event({ kind: 'transaction', chain: 'ethereum', answer: 'consistent-with-history', tx: { hash: `0x${'ab'.repeat(32)}`, direction: 'out', wallet: addr(9), amount: '1.5', asset: 'ETH', assetContract: null, usd: 4200, blockNumber: 7 }, detail: { link: null, reason: 'no_preceding_check' } }),
    );
    expect(row?.kind).toBe('transaction');
    expect(row?.tx).toMatchObject({ direction: 'out', amount: '1.5', asset: 'ETH', usd: 4200 });
    expect(row?.linkReason).toBe('no_preceding_check');
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['no id', event({ id: '' })],
    ['no time of the event', event({ at: undefined })],
    ['an unknown kind', event({ kind: 'transfer' })],
    ['no writing time', event({ writtenAt: undefined })],
    ['a writing time in another form', event({ writtenAt: '2026-10-19T11:00:01Z' })],
    ['no agent id', event({ tinId: '' })],
    ['no address', event({ address: undefined })],
  ])('drops an event with %s', (_why, item) => {
    expect(toFeedRow(item)).toBeNull();
  });

  it('calls an agent whose name did not arrive "Agent", and drops an empty label', () => {
    expect(toFeedRow(event({ agent: undefined }))?.agent).toBe('Agent');
    expect(toFeedRow(event({ agent: '   ' }))?.agent).toBe('Agent');
    expect(toFeedRow(event({ label: '   ' }))?.label).toBeNull();
    expect(toFeedRow(event({ label: 42 }))?.label).toBeNull();
  });

  it('cuts the owner\'s own words to what a card can hold, and leaves their characters alone', () => {
    const hostile = '"><script>alert(1)</script>';
    const row = toFeedRow(event({ agent: hostile + 'x'.repeat(300), label: hostile }));
    expect(row?.agent).toHaveLength(120);
    expect(row?.agent.startsWith(hostile)).toBe(true);
    expect(row?.label).toBe(hostile);
  });
});

describe('a list of events', () => {
  it('keeps the order given and drops what is not an event', () => {
    const rows = parseFeedRows([event({ id: 'a' }), 'junk', event({ id: 'b', kind: 'nope' }), event({ id: 'c' })]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('is empty for anything that is not a list', () => {
    expect(parseFeedRows(undefined)).toEqual([]);
    expect(parseFeedRows({ events: [] })).toEqual([]);
    expect(parseFeedRows('x')).toEqual([]);
  });
});

const row = (id: string, writtenAt: string): FeedRow => toFeedRow(event({ id, writtenAt })) as FeedRow;

describe('the list on the page', () => {
  it('orders newest written first, and the id breaks a tie the same way every time', () => {
    const a = row('a', '2026-10-19 11:00:01');
    const b = row('b', '2026-10-19 11:00:02');
    const c = row('c', '2026-10-19 11:00:02');
    expect([a, b, c].sort(newestFirst).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect([c, a, b].sort(newestFirst).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('adds rows once each, newest first', () => {
    const first = [row('a', '2026-10-19 11:00:01'), row('b', '2026-10-19 11:00:02')];
    const merged = mergeRows([first[1], first[0]], [row('b', '2026-10-19 11:00:02'), row('c', '2026-10-19 11:00:03')]);
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('hands back the very same list when nothing in what arrived is new, so the page does not redraw', () => {
    const list = [row('b', '2026-10-19 11:00:02'), row('a', '2026-10-19 11:00:01')];
    expect(mergeRows(list, [row('a', '2026-10-19 11:00:01')])).toBe(list);
    expect(mergeRows(list, [])).toBe(list);
  });

  it('keeps the newest hundred, and drops the oldest', () => {
    const many = Array.from({ length: FEED_LIST_MAX + 20 }, (_, i) => row(`r${String(i).padStart(3, '0')}`, `2026-10-19 11:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`));
    const merged = mergeRows([], many);
    expect(merged).toHaveLength(FEED_LIST_MAX);
    expect(merged[0].id).toBe(`r${String(FEED_LIST_MAX + 19).padStart(3, '0')}`);
    expect(merged[merged.length - 1].id).toBe('r020');
  });
});

describe('an address on a card', () => {
  it('is cut in the middle when it is long, and shown whole when it is short', () => {
    expect(shortAddress(addr(1))).toMatch(/^0xc0ffee.{0}…[0-9a-f]{6}$/);
    expect(shortAddress(addr(1)).length).toBeLessThan(addr(1).length);
    expect(shortAddress('0x1234')).toBe('0x1234');
    expect(shortAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toContain('…');
  });
});
