import { describe, it, expect } from 'vitest';
import { cleanSymbol, normalizeTransfers, transferTime, NATIVE_SYMBOL, EXPLORER_ACTIONS } from '../../src/lib/agentVault/transfers';
import { addr } from '../helpers/agentVault';
import { internalRow, nativeRow, tokenRow, txHash, units, USDC_ETHEREUM, blockTime } from '../helpers/fakeExplorer';

/**
 * Explorer rows to the movements the Vault records. Every address, hash and amount is invented.
 */

const ME = addr(1);
const THEM = addr(2);
const OTHER = addr(3);

describe('the chain\'s own coin (txlist)', () => {
  it('reads a payment out of the wallet', () => {
    const { transfers, unreadable } = normalizeTransfers('ethereum', ME, 'txlist', [nativeRow({ hash: 1, block: 100, from: ME, to: THEM, value: units('1.5') })]);
    expect(unreadable).toBe(0);
    expect(transfers).toEqual([{
      chain: 'ethereum', hash: txHash(1), leg: `native:${ME}:${THEM}:1500000000000000000:0`, atSec: blockTime(100), blockNumber: 100,
      direction: 'out', wallet: ME, counterparty: THEM, amount: '1.5', asset: 'ETH', assetContract: null, source: 'txlist',
    }]);
  });

  it('reads a payment into the wallet', () => {
    const { transfers } = normalizeTransfers('ethereum', ME, 'txlist', [nativeRow({ hash: 2, block: 101, from: THEM, to: ME, value: units('0.25') })]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ direction: 'in', counterparty: THEM, wallet: ME, amount: '0.25' });
  });

  it('names each chain\'s own coin', () => {
    expect(NATIVE_SYMBOL).toEqual({ ethereum: 'ETH', polygon: 'POL', avalanche: 'AVAX' });
    for (const [chain, symbol] of Object.entries(NATIVE_SYMBOL)) {
      const { transfers } = normalizeTransfers(chain as 'ethereum', ME, 'txlist', [nativeRow({ hash: 3, block: 5, from: ME, to: THEM, value: units('1') })]);
      expect(transfers[0].asset).toBe(symbol);
    }
  });

  it('is case-blind about addresses and hands back lowercase ones', () => {
    const upperMe = `0x${ME.slice(2).toUpperCase()}`;
    const upperThem = `0x${THEM.slice(2).toUpperCase()}`;
    const { transfers } = normalizeTransfers('ethereum', upperMe, 'txlist', [nativeRow({ hash: 4, block: 7, from: upperMe, to: upperThem, value: units('2') })]);
    expect(transfers[0]).toMatchObject({ wallet: ME, counterparty: THEM, direction: 'out' });
  });
});

describe('what is not a movement', () => {
  const rows = (...r: Array<Record<string, string>>) => normalizeTransfers('ethereum', ME, 'txlist', r);

  it('a transaction that failed moved nothing', () => {
    expect(rows(nativeRow({ hash: 1, block: 1, from: ME, to: THEM, value: units('1'), failed: true }))).toEqual({ transfers: [], unreadable: 0 });
    expect(rows({ ...nativeRow({ hash: 1, block: 1, from: ME, to: THEM, value: units('1') }), isError: '0', txreceipt_status: '0' })).toEqual({ transfers: [], unreadable: 0 });
  });

  it('a row of value zero moved nothing (approvals, pokes)', () => {
    expect(rows(nativeRow({ hash: 1, block: 1, from: ME, to: THEM, value: '0' }))).toEqual({ transfers: [], unreadable: 0 });
  });

  it('a send to itself moves nothing between two parties', () => {
    expect(rows(nativeRow({ hash: 1, block: 1, from: ME, to: ME, value: units('1') }))).toEqual({ transfers: [], unreadable: 0 });
  });

  it('a row that does not involve the wallet is not its movement', () => {
    expect(rows(nativeRow({ hash: 1, block: 1, from: THEM, to: OTHER, value: units('1') }))).toEqual({ transfers: [], unreadable: 0 });
  });

  it('a contract creation has no second party', () => {
    expect(rows(nativeRow({ hash: 1, block: 1, from: ME, to: '', value: units('1') }))).toEqual({ transfers: [], unreadable: 0 });
  });
});

describe('unreadable rows are counted and dropped, never guessed', () => {
  const one = (row: Record<string, string>, action: 'txlist' | 'tokentx' = 'txlist') => normalizeTransfers('ethereum', ME, action, [row]);
  const good = nativeRow({ hash: 1, block: 10, from: ME, to: THEM, value: units('1') });

  it.each([
    ['no hash', { ...good, hash: '' }],
    ['a short hash', { ...good, hash: '0x1234' }],
    ['no time', { ...good, timeStamp: '' }],
    ['a time of zero', { ...good, timeStamp: '0' }],
    ['no block', { ...good, blockNumber: 'abc' }],
    ['a value that is not an integer', { ...good, value: '1.5' }],
    ['a negative value', { ...good, value: '-5' }],
    ['no value', { ...good, value: '' }],
    ['a from that is not an address', { ...good, from: '0x123' }],
    ['a to that is not an address', { ...good, to: 'not-an-address' }],
  ])('%s', (_name, row) => {
    expect(one(row as Record<string, string>)).toEqual({ transfers: [], unreadable: 1 });
  });

  const token = tokenRow({ hash: 5, block: 10, from: ME, to: THEM, value: units('3', 6), contract: USDC_ETHEREUM, symbol: 'USDC' });
  it.each([
    ['a token with no contract', { ...token, contractAddress: '' }],
    ['a token with a short contract', { ...token, contractAddress: '0xabc' }],
    ['a token with no decimals', { ...token, tokenDecimal: '' }],
    ['a token with decimals out of range', { ...token, tokenDecimal: '40' }],
    ['a token with decimals that are not a whole number', { ...token, tokenDecimal: '6.5' }],
  ])('%s', (_name, row) => {
    expect(one(row as Record<string, string>, 'tokentx')).toEqual({ transfers: [], unreadable: 1 });
  });

  it('one bad row does not take its neighbours with it', () => {
    const r = normalizeTransfers('ethereum', ME, 'txlist', [{ ...good, hash: 'x' }, good, nativeRow({ hash: 2, block: 11, from: THEM, to: ME, value: units('2') })]);
    expect(r.unreadable).toBe(1);
    expect(r.transfers.map((t) => t.hash)).toEqual([txHash(1), txHash(2)]);
  });
});

describe('amounts are exact', () => {
  const amountOf = (value: string, decimals: number) =>
    normalizeTransfers('ethereum', ME, 'tokentx', [tokenRow({ hash: 1, block: 1, from: ME, to: THEM, value, contract: USDC_ETHEREUM, symbol: 'T', decimals })]).transfers[0].amount;

  it('scales by the token\'s decimals', () => {
    expect(amountOf('250000000', 6)).toBe('250');
    expect(amountOf('1', 6)).toBe('0.000001');
    expect(amountOf('1234567', 6)).toBe('1.234567');
    expect(amountOf('42', 0)).toBe('42');
    expect(amountOf('1500000000000000000', 18)).toBe('1.5');
  });

  it('goes past 2^53 without a float', () => {
    expect(amountOf('123456789012345678901234567890', 18)).toBe('123456789012.34567890123456789');
    expect(amountOf('9007199254740993', 0)).toBe('9007199254740993');
    expect(amountOf('9007199254740993', 6)).toBe('9007199254.740993');
  });

  it('reads a token transfer out and in', () => {
    const t = normalizeTransfers('ethereum', ME, 'tokentx', [
      tokenRow({ hash: 1, block: 1, from: ME, to: THEM, value: units('10', 6), contract: USDC_ETHEREUM, symbol: 'USDC' }),
      tokenRow({ hash: 2, block: 2, from: THEM, to: ME, value: units('4', 6), contract: USDC_ETHEREUM.toUpperCase().replace('0X', '0x'), symbol: 'USDC' }),
    ]).transfers;
    expect(t.map((x) => [x.direction, x.amount, x.asset, x.assetContract])).toEqual([
      ['out', '10', 'USDC', USDC_ETHEREUM],
      ['in', '4', 'USDC', USDC_ETHEREUM],
    ]);
  });
});

describe('a movement keeps its name when the history is read again', () => {
  const twin = (hash: number) => tokenRow({ hash, block: 50, from: ME, to: THEM, value: units('5', 6), contract: USDC_ETHEREUM, symbol: 'USDC' });

  it('two identical token rows in one transaction are two movements with two legs', () => {
    const { transfers } = normalizeTransfers('ethereum', ME, 'tokentx', [twin(9), twin(9)]);
    expect(transfers).toHaveLength(2);
    expect(new Set(transfers.map((t) => `${t.hash}|${t.leg}`)).size).toBe(2);
    expect(transfers.map((t) => t.leg.split(':').pop())).toEqual(['0', '1']);
  });

  it('the same rows always give the same legs', () => {
    const rows = [twin(9), twin(9), twin(10)];
    const a = normalizeTransfers('ethereum', ME, 'tokentx', rows).transfers.map((t) => `${t.hash}|${t.leg}`);
    const b = normalizeTransfers('ethereum', ME, 'tokentx', rows).transfers.map((t) => `${t.hash}|${t.leg}`);
    expect(a).toEqual(b);
  });

  it('rows of different transactions, or different amounts, are told apart', () => {
    const { transfers } = normalizeTransfers('ethereum', ME, 'tokentx', [
      twin(9), twin(10),
      tokenRow({ hash: 9, block: 50, from: ME, to: THEM, value: units('6', 6), contract: USDC_ETHEREUM, symbol: 'USDC' }),
    ]);
    expect(new Set(transfers.map((t) => `${t.hash}|${t.leg}`)).size).toBe(3);
  });

  it('internal transfers are named by their trace', () => {
    const { transfers } = normalizeTransfers('ethereum', ME, 'txlistinternal', [
      internalRow({ hash: 3, block: 9, from: ME, to: THEM, value: units('1'), traceId: '0_1' }),
      internalRow({ hash: 3, block: 9, from: ME, to: THEM, value: units('1'), traceId: '0_2' }),
    ]);
    expect(transfers).toHaveLength(2);
    expect(transfers[0].leg).not.toBe(transfers[1].leg);
    expect(transfers[0]).toMatchObject({ asset: 'ETH', assetContract: null, source: 'txlistinternal', direction: 'out' });
  });

  it('a trace id that is not plain text is left out of the name rather than trusted', () => {
    const { transfers } = normalizeTransfers('ethereum', ME, 'txlistinternal', [
      internalRow({ hash: 3, block: 9, from: ME, to: THEM, value: units('1'), traceId: '<script>' }),
    ]);
    expect(transfers[0].leg).toBe(`internal::${ME}:${THEM}:1000000000000000000:0`);
  });

  it('the three listings never share a leg for the same hash', () => {
    const legs = new Set<string>();
    legs.add(normalizeTransfers('ethereum', ME, 'txlist', [nativeRow({ hash: 1, block: 1, from: ME, to: THEM, value: '5' })]).transfers[0].leg);
    legs.add(normalizeTransfers('ethereum', ME, 'txlistinternal', [internalRow({ hash: 1, block: 1, from: ME, to: THEM, value: '5' })]).transfers[0].leg);
    legs.add(normalizeTransfers('ethereum', ME, 'tokentx', [tokenRow({ hash: 1, block: 1, from: ME, to: THEM, value: '5', contract: USDC_ETHEREUM, symbol: 'X' })]).transfers[0].leg);
    expect(legs.size).toBe(3);
  });
});

describe('small helpers', () => {
  it('cleanSymbol strips control characters, collapses space, cuts to 24 and never answers empty', () => {
    expect(cleanSymbol('USDC')).toBe('USDC');
    expect(cleanSymbol('  US\u0000DC\n ')).toBe('US DC');
    expect(cleanSymbol('x'.repeat(80))).toBe('x'.repeat(24));
    expect(cleanSymbol('')).toBe('UNKNOWN');
    expect(cleanSymbol(null)).toBe('UNKNOWN');
    expect(cleanSymbol('\u0001\u0002')).toBe('UNKNOWN');
  });

  it('transferTime is the block\'s time as ISO with milliseconds', () => {
    expect(transferTime({ atSec: 1_790_812_800 })).toBe('2026-10-01T00:00:00.000Z');
  });

  it('knows the three listings', () => {
    expect([...EXPLORER_ACTIONS]).toEqual(['txlist', 'txlistinternal', 'tokentx']);
  });
});
