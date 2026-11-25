import { describe, it, expect } from 'vitest';
import { normalizeTransfers, readGasFees, readTransfers } from '../../src/lib/evmTransfers';
import * as vaultTransfers from '../../src/lib/agentVault/transfers';
import { addr } from '../helpers/agentVault';
import { internalRow, nativeRow, tokenRow, txHash, units, blockTime } from '../helpers/fakeExplorer';

/**
 * The shared EVM transfer reader (src/lib/evmTransfers.ts): what it adds for Wallet Watcher, and
 * that Agentics still reads exactly what it read before. Every address, hash and amount is invented.
 */

const ME = addr(1);
const THEM = addr(2);
const ROUTER = addr(4);
const TOKEN = `0x${'c'.repeat(40)}`;

const withGas = (row: Record<string, string>, gasUsed: string, gasPrice: string, input = '0x') => ({ ...row, gasUsed, gasPrice, input });

describe('one reader for both products', () => {
  it('Agentics reads the shared functions themselves, not copies', () => {
    expect(vaultTransfers.normalizeTransfers).toBe(normalizeTransfers);
  });

  it('normalizeTransfers is readTransfers without the bookkeeping fields', () => {
    const rows = [
      tokenRow({ hash: 1, block: 10, from: ME, to: THEM, value: '2500000', contract: TOKEN, symbol: 'USDC' }),
      tokenRow({ hash: 1, block: 10, from: ME, to: THEM, value: '2500000', contract: TOKEN, symbol: 'USDC' }),
    ];
    const full = readTransfers('ethereum', ME, 'tokentx', rows);
    const vault = normalizeTransfers('ethereum', ME, 'tokentx', rows);
    expect(vault.transfers).toEqual(full.transfers.map(({ rawValue: _r, decimals: _d, assetName: _n, selector: _s, ...t }) => t));
    expect(vault.transfers.every((t) => !('rawValue' in t) && !('decimals' in t))).toBe(true);
  });
});

describe('the raw value and scale beside the amount', () => {
  it('a coin payment carries its wei and the coin\'s decimals', () => {
    const [t] = readTransfers('avalanche', ME, 'txlist', [nativeRow({ hash: 1, block: 5, from: ME, to: THEM, value: units('0.75') })]).transfers;
    expect(t).toMatchObject({ amount: '0.75', rawValue: '750000000000000000', decimals: 18, asset: 'AVAX', assetName: null });
  });

  it('a token transfer carries the token\'s own decimals and name', () => {
    const [t] = readTransfers('polygon', ME, 'tokentx', [tokenRow({ hash: 2, block: 5, from: THEM, to: ME, value: '1234500', contract: TOKEN, symbol: 'USDC', decimals: 6 })]).transfers;
    expect(t).toMatchObject({ amount: '1.2345', rawValue: '1234500', decimals: 6, asset: 'USDC', assetName: 'USDC', assetContract: TOKEN });
  });

  it('an internal transfer is the coin, with its decimals', () => {
    const [t] = readTransfers('ethereum', ME, 'txlistinternal', [internalRow({ hash: 3, block: 5, from: ROUTER, to: ME, value: units('0.4') })]).transfers;
    expect(t).toMatchObject({ direction: 'in', rawValue: units('0.4'), decimals: 18, asset: 'ETH', source: 'txlistinternal' });
  });

  it('a call\'s four-byte selector is kept, lowercase, for the caller to read', () => {
    const [t] = readTransfers('ethereum', ME, 'txlist', [withGas(nativeRow({ hash: 4, block: 5, from: ME, to: ROUTER, value: units('1') }), '21000', '1', '0x7FF36AB5000000')]).transfers;
    expect(t.selector).toBe('0x7ff36ab5');
  });
});

describe('the gas the wallet paid', () => {
  it('one fee per transaction the wallet sent: gasUsed times gasPrice, exact', () => {
    const { fees, unreadable } = readGasFees('ethereum', ME, [withGas(nativeRow({ hash: 1, block: 7, from: ME, to: THEM, value: units('1') }), '21000', '30000000000')]);
    expect(unreadable).toBe(0);
    expect(fees).toEqual([{
      chain: 'ethereum', hash: txHash(1), atSec: blockTime(7), blockNumber: 7, wallet: ME, to: THEM,
      feeRaw: '630000000000000', fee: '0.00063', failed: false, selector: null,
    }]);
  });

  it('a failed transaction and a zero-value call still paid', () => {
    const { fees } = readGasFees('ethereum', ME, [
      withGas(nativeRow({ hash: 1, block: 7, from: ME, to: THEM, value: units('1'), failed: true }), '25000', '2'),
      withGas(nativeRow({ hash: 2, block: 8, from: ME, to: TOKEN, value: '0' }), '46000', '3', '0x095ea7b3'),
    ]);
    expect(fees.map((f) => [f.hash, f.feeRaw, f.failed, f.selector])).toEqual([
      [txHash(1), '50000', true, null],
      [txHash(2), '138000', false, '0x095ea7b3'],
    ]);
  });

  it('a transaction someone else sent cost the wallet nothing', () => {
    expect(readGasFees('ethereum', ME, [withGas(nativeRow({ hash: 1, block: 7, from: THEM, to: ME, value: units('1') }), '21000', '1')]).fees).toEqual([]);
  });

  it('a send to itself still paid, and is matched case-blind', () => {
    const upper = `0x${ME.slice(2).toUpperCase()}`;
    const { fees } = readGasFees('ethereum', upper, [withGas(nativeRow({ hash: 1, block: 7, from: upper, to: upper, value: units('1') }), '21000', '1')]);
    expect(fees).toHaveLength(1);
    expect(fees[0].wallet).toBe(ME);
  });

  it('a row whose gas cannot be read is counted, never guessed', () => {
    const { fees, unreadable } = readGasFees('ethereum', ME, [
      withGas(nativeRow({ hash: 1, block: 7, from: ME, to: THEM, value: '1' }), '', '1'),
      withGas(nativeRow({ hash: 2, block: 7, from: ME, to: THEM, value: '1' }), '21000', '1.5'),
    ]);
    expect(fees).toEqual([]);
    expect(unreadable).toBe(2);
  });

  it('the same hash twice is one fee', () => {
    const row = withGas(nativeRow({ hash: 1, block: 7, from: ME, to: THEM, value: '1' }), '21000', '1');
    expect(readGasFees('ethereum', ME, [row, { ...row }]).fees).toHaveLength(1);
  });
});
