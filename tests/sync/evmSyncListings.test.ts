import { describe, it, expect, vi } from 'vitest';

/**
 * How Wallet Watcher's EVM sync reads its three listings (src/lib/sync/syncTransactions.ts):
 *   - an explorer answer that is not a list of rows (NOTOK, a rate limit) throws, so the cursor never
 *     moves past rows that were not read; "No transactions found" is an empty listing;
 *   - a listing cut short by the page limit keeps only the blocks before its last one, for every
 *     listing, so a transaction's rows are read whole and its legs keep their names.
 * No network, no database.
 */
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [] }) } }));

import { listingRows, readThroughBlock } from '../../src/lib/sync/syncTransactions';

const rows = (...blocks: number[]) => blocks.map((b) => ({ blockNumber: String(b) }));

describe('listingRows', () => {
  it('a list of rows is the listing', () => {
    expect(listingRows({ status: '1', message: 'OK', result: rows(1, 2) }, 'ethereum', 'txlist')).toHaveLength(2);
  });

  it('no transactions, or a call skipped for a missing key, is an empty listing', () => {
    expect(listingRows({ status: '0', message: 'No transactions found', result: [] }, 'ethereum', 'tokentx')).toEqual([]);
    expect(listingRows({ status: '0', message: 'No transactions found', result: null }, 'ethereum', 'tokentx')).toEqual([]);
    expect(listingRows({ status: '0', message: 'skipped', result: [] }, 'polygon', 'txlistinternal')).toEqual([]);
  });

  it('anything else throws, naming the listing, with the rate-limit words the retry looks for', () => {
    expect(() => listingRows({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' }, 'ethereum', 'txlistinternal'))
      .toThrow(/Scan API error \(ethereum txlistinternal\): NOTOK: Max rate limit reached/);
    expect(() => listingRows(null, 'avalanche', 'txlist')).toThrow(/Scan API error/);
  });
});

describe('readThroughBlock', () => {
  it('is null when every listing was read to the end', () => {
    expect(readThroughBlock([
      { action: 'txlist', rows: rows(1, 5), complete: true },
      { action: 'tokentx', rows: [], complete: true },
    ])).toBeNull();
  });

  it('stops before the last block of a listing cut short, the earliest such block across listings', () => {
    expect(readThroughBlock([
      { action: 'txlist', rows: rows(1, 9, 9), complete: false },
      { action: 'txlistinternal', rows: rows(2), complete: true },
      { action: 'tokentx', rows: rows(3, 7), complete: false },
    ])).toBe(6);
  });
});
