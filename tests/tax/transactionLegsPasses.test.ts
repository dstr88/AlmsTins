import { describe, it, expect } from 'vitest';
import { detectLoans, matchTransfers } from '../../src/lib/yearEnd/pass2';
import { classifyFeesPass3 } from '../../src/lib/yearEnd/pass3';
import type { RawOnchainTx } from '../../src/lib/yearEnd/types';

/**
 * The year-end passes with several rows per transaction (src/lib/sync/evmSyncRows.ts):
 *   - a fee-only row (value 0, the chain's coin, sent by the row's own wallet) is a fee in Pass 3,
 *     not an unknown left for review, and not a loan or collateral row in Pass 2;
 *   - a transfer between two of the customer's wallets reads out on the sender's row and in on the
 *     receiver's, so the two rows pair as a transfer.
 * Every address, hash and amount is invented.
 */
const A = `0x${'1'.repeat(40)}`;
const B = `0x${'5'.repeat(40)}`;
const POOL = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';

const row = (o: Partial<RawOnchainTx>): RawOnchainTx => ({
  id: 'r', timestamp: '2026-04-01T10:00:00.000Z', token_symbol: 'native', value: '0', from_address: A, to_address: POOL,
  tx_type: 'outgoing', usd_value: null, chain: 'ethereum', wallet_address: A, wallet_id: 'w-1', token_decimals: 18, hash: `0x${'2'.repeat(64)}`, ...o,
});

describe('a fee-only row', () => {
  it('is a fee in Pass 3', () => {
    const results = classifyFeesPass3([row({ id: 'fee', tx_type: 'aave_supply' })], new Set());
    expect(results.map((r) => [r.sourceId, r.category])).toEqual([['fee', 'fee']]);
  });

  it('only when the row\'s own wallet sent it, and only for the coin', () => {
    const results = classifyFeesPass3([
      row({ id: 'incoming-zero', from_address: B, to_address: A }),
      row({ id: 'token-zero', token_symbol: 'USDC' }),
      row({ id: 'moved', value: '5' }),
    ], new Set());
    expect(results).toEqual([]);
  });

  it('is not a collateral deposit in Pass 2, though it was sent to the pool', () => {
    const { results, reviewItems } = detectLoans([row({ id: 'fee', tx_type: 'aave_supply' })], new Set([A]), new Set());
    expect(results).toEqual([]);
    expect(reviewItems).toEqual([]);
  });
});

describe('a transfer between two of the customer\'s wallets', () => {
  it('reads out on the sender\'s row and in on the receiver\'s, and the two pair', () => {
    const out = row({ id: 'out', value: '500000000000000000', from_address: A, to_address: B, wallet_address: A, wallet_id: 'w-1' });
    const into = row({ id: 'in', value: '500000000000000000', from_address: A, to_address: B, wallet_address: B, wallet_id: 'w-2', tx_type: 'incoming' });
    const { results } = matchTransfers([], [out, into], new Set([A, B]), new Set());
    const byId = new Map(results.map((r) => [r.sourceId, r.category]));
    expect(byId.get('out')).toBeDefined();
    expect(byId.get('in')).toBeDefined();
    expect(byId.get('out')).toBe(byId.get('in'));
  });
});
