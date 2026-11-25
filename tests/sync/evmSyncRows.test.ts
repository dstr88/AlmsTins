import { describe, it, expect } from 'vitest';
import { walletSyncRows, FEE_LEG } from '../../src/lib/sync/evmSyncRows';
import type { NewTransaction } from '../../src/lib/transactions';
import { addr } from '../helpers/agentVault';
import { internalRow, nativeRow, tokenRow, txHash, units } from '../helpers/fakeExplorer';

/**
 * Wallet Watcher's EVM rows (src/lib/sync/evmSyncRows.ts): every movement of a transaction is its
 * own row, so a swap keeps both sides and its fee. Each case was a lost or merged row before: the
 * table kept one row per account, hash and chain, and the internal listing was never read.
 *
 * `stored` applies the table's unique key, (account, hash, chain, wallet, leg), the way the upsert
 * does: a second row with the same key replaces the first. Every address, hash and amount is invented.
 */

const ME = addr(1);
const MINE_TOO = addr(5);
const ROUTER = addr(4);
const USDC = `0x${'c'.repeat(40)}`;
const DAI = `0x${'d'.repeat(40)}`;
const WALLET = { id: 'w-1', address: ME };
const OTHER_WALLET = { id: 'w-2', address: MINE_TOO };

const sent = (row: Record<string, string>, gasUsed: string, gasPrice: string, input = '0x') => ({ ...row, gasUsed, gasPrice, input });
const none = { txlist: [], txlistinternal: [], tokentx: [] };

function stored(rows: NewTransaction[]): NewTransaction[] {
  const byKey = new Map<string, NewTransaction>();
  for (const r of rows) byKey.set(`${r.hash}|${r.chain}|${r.walletId}|${r.leg ?? ''}`, r);
  return [...byKey.values()];
}

const brief = (r: NewTransaction) => [r.tokenSymbol, r.txType, r.value, r.feePaid ?? null];

describe('a swap keeps both sides', () => {
  it('ETH to USDC: the ETH out (with the fee) and the USDC in', () => {
    const { rows } = walletSyncRows('ethereum', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 1, block: 10, from: ME, to: ROUTER, value: units('1') }), '150000', '20', '0x7ff36ab5')],
      tokentx: [tokenRow({ hash: 1, block: 10, from: ROUTER, to: ME, value: '3000000000', contract: USDC, symbol: 'USDC' })],
    });
    const kept = stored(rows);
    expect(kept.map(brief)).toEqual([
      ['native', 'outgoing', units('1'), '3000000'],
      ['USDC', 'token_in', '3000000000', null],
    ]);
    expect(kept.every((r) => r.hash === txHash(1) && r.walletId === 'w-1')).toBe(true);
  });

  it('token to token: USDC out, DAI in, and the fee on a row of its own', () => {
    const { rows } = walletSyncRows('polygon', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 2, block: 11, from: ME, to: ROUTER, value: '0' }), '200000', '30', '0x38ed1739')],
      tokentx: [
        tokenRow({ hash: 2, block: 11, from: ME, to: ROUTER, value: '500000000', contract: USDC, symbol: 'USDC' }),
        tokenRow({ hash: 2, block: 11, from: ROUTER, to: ME, value: '499000000000000000000', contract: DAI, symbol: 'DAI', decimals: 18 }),
      ],
    });
    const kept = stored(rows);
    expect(kept.map(brief)).toEqual([
      ['native', 'outgoing', '0', '6000000'],
      ['USDC', 'token_out', '500000000', null],
      ['DAI', 'token_in', '499000000000000000000', null],
    ]);
    expect(kept[0]).toMatchObject({ leg: FEE_LEG, status: 'confirmed', from: ME, to: ROUTER });
    expect(kept[2].tokenDecimals).toBe(18);
  });

  it('USDC to ETH: the ETH the router pays back is read from the internal listing', () => {
    const { rows } = walletSyncRows('ethereum', WALLET, {
      txlist: [sent(nativeRow({ hash: 3, block: 12, from: ME, to: ROUTER, value: '0' }), '180000', '25', '0x18cbafe5')],
      tokentx: [tokenRow({ hash: 3, block: 12, from: ME, to: ROUTER, value: '2000000000', contract: USDC, symbol: 'USDC' })],
      txlistinternal: [internalRow({ hash: 3, block: 12, from: ROUTER, to: ME, value: units('0.6') })],
    });
    const kept = stored(rows);
    expect(kept.map(brief)).toEqual([
      ['native', 'outgoing', '0', '4500000'],
      ['native', 'incoming', units('0.6'), null],
      ['USDC', 'token_out', '2000000000', null],
    ]);
    expect(kept[1].metadata).toEqual({ source: 'scan_internal' });
  });
});

describe('the gas fee', () => {
  it('a swap\'s fee is recorded once, on the coin it sent', () => {
    const { rows } = walletSyncRows('ethereum', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 4, block: 13, from: ME, to: ROUTER, value: units('2') }), '100000', '7', '0x7ff36ab5')],
      tokentx: [tokenRow({ hash: 4, block: 13, from: ROUTER, to: ME, value: '1', contract: USDC, symbol: 'USDC' })],
    });
    const fees = stored(rows).filter((r) => r.feePaid);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ tokenSymbol: 'native', feePaid: '700000' });
  });

  it('a failed transaction moved nothing, but its fee is kept, marked failed', () => {
    const { rows } = walletSyncRows('avalanche', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 5, block: 14, from: ME, to: ROUTER, value: units('3'), failed: true }), '40000', '25000000000')],
    });
    expect(stored(rows)).toEqual([expect.objectContaining({
      leg: FEE_LEG, value: '0', tokenSymbol: 'native', status: 'failed', feePaid: '1000000000000000', txType: 'outgoing',
    })]);
  });

  it('a transaction someone else sent to the wallet costs it no fee', () => {
    const { rows } = walletSyncRows('ethereum', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 6, block: 15, from: ROUTER, to: ME, value: units('1') }), '21000', '9')],
    });
    expect(rows.map(brief)).toEqual([['native', 'incoming', units('1'), null]]);
  });

  it('an Aave pool call is still marked on the row that carries its fee', () => {
    const pool = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
    const { rows } = walletSyncRows('ethereum', WALLET, {
      ...none,
      txlist: [sent(nativeRow({ hash: 7, block: 16, from: ME, to: pool, value: '0' }), '210000', '1', '0x617ba037' + '0'.repeat(64))],
      tokentx: [tokenRow({ hash: 7, block: 16, from: ME, to: ROUTER, value: '1000000', contract: USDC, symbol: 'USDC' })],
    });
    expect(rows[0]).toMatchObject({ leg: FEE_LEG, txType: 'aave_supply', metadata: { source: 'aave', aaveAction: 'supply', feeOnly: true } });
    expect(rows[1]).toMatchObject({ tokenSymbol: 'USDC', txType: 'token_out' });
  });
});

describe('rows that used to merge', () => {
  it('two identical transfers in one transaction stay two rows', () => {
    const same = tokenRow({ hash: 8, block: 17, from: ME, to: ROUTER, value: '250000', contract: USDC, symbol: 'USDC' });
    const { rows } = walletSyncRows('ethereum', WALLET, { ...none, tokentx: [same, { ...same }] });
    const kept = stored(rows);
    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r.leg)).toEqual([`token:${USDC}:${ME}:${ROUTER}:250000:0`, `token:${USDC}:${ME}:${ROUTER}:250000:1`]);
  });

  it('a transfer between two of the customer\'s wallets is a row on each', () => {
    const row = sent(nativeRow({ hash: 9, block: 18, from: ME, to: MINE_TOO, value: units('0.5') }), '21000', '10');
    const out = walletSyncRows('ethereum', WALLET, { ...none, txlist: [row] }).rows;
    const into = walletSyncRows('ethereum', OTHER_WALLET, { ...none, txlist: [{ ...row }] }).rows;
    const kept = stored([...out, ...into]);
    expect(kept.map((r) => [r.walletId, r.txType, r.value, r.feePaid ?? null])).toEqual([
      ['w-1', 'outgoing', units('0.5'), '210000'],
      ['w-2', 'incoming', units('0.5'), null],
    ]);
  });

  it('reading the same history again gives the same rows, so the upsert changes nothing', () => {
    const listings = {
      txlist: [sent(nativeRow({ hash: 10, block: 19, from: ME, to: ROUTER, value: '0' }), '1', '1')],
      txlistinternal: [internalRow({ hash: 10, block: 19, from: ROUTER, to: ME, value: '5' })],
      tokentx: [tokenRow({ hash: 10, block: 19, from: ME, to: ROUTER, value: '7', contract: USDC, symbol: 'USDC' })],
    };
    expect(walletSyncRows('ethereum', WALLET, listings)).toEqual(walletSyncRows('ethereum', WALLET, listings));
  });
});

describe('what the listings carry', () => {
  it('a token row keeps its contract, decimals and name; a coin row the chain\'s decimals', () => {
    const { rows } = walletSyncRows('ethereum', WALLET, {
      ...none,
      tokentx: [tokenRow({ hash: 11, block: 20, from: ROUTER, to: `0x${ME.slice(2).toUpperCase()}`, value: '42', contract: USDC, symbol: 'USDC' })],
    });
    expect(rows[0]).toMatchObject({ contractAddress: USDC, tokenDecimals: 6, txType: 'token_in', metadata: { tokenName: 'USDC', source: 'scan_token' } });
  });

  it('unreadable rows are counted and left out', () => {
    const { rows, unreadable } = walletSyncRows('ethereum', WALLET, {
      ...none,
      tokentx: [{ ...tokenRow({ hash: 12, block: 21, from: ROUTER, to: ME, value: '1', contract: USDC, symbol: 'USDC' }), tokenDecimal: '' }],
    });
    expect(rows).toEqual([]);
    expect(unreadable).toBe(1);
  });
});
