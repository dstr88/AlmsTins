import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { explorerAddressUrl, explorerName, explorerTxUrl, evmExplorerLinks } from '../../src/lib/explorerLinks';

/**
 * Every explorer link opens the explorer of the value's own chain, or there is no link. The values
 * below are invented; they only have each chain's shape.
 */

const EVM_ADDR = `0x${'ab12'.repeat(10)}`;
const EVM_TX = `0x${'cd34'.repeat(16)}`;
const HEX_TXID = 'ef56'.repeat(16);
const BTC_BECH32 = `bc1q${'x3'.repeat(19)}`;
const BTC_LEGACY = `1${'Ex4mp'.repeat(6)}`;
const LTC_BECH32 = `ltc1q${'w7'.repeat(19)}`;
const LTC_LEGACY = `L${'Ex4mp'.repeat(6)}`;
const SOL_ADDR = `So1${'Ex4mpLe'.repeat(5)}`;
const SOL_SIG = `5${'Ex4mpLeSig'.repeat(8)}`;
const SUI_ADDR = `0x${'9a8b'.repeat(16)}`;
const SUI_DIGEST = `D1g${'Ex4mpLe'.repeat(5)}`;

describe('explorerAddressUrl', () => {
  it.each([
    ['ethereum', EVM_ADDR, `https://etherscan.io/address/${EVM_ADDR}`],
    ['polygon', EVM_ADDR, `https://polygonscan.com/address/${EVM_ADDR}`],
    ['avalanche', EVM_ADDR, `https://snowtrace.io/address/${EVM_ADDR}`],
    ['bsc', EVM_ADDR, `https://bscscan.com/address/${EVM_ADDR}`],
    ['bitcoin', BTC_BECH32, `https://blockstream.info/address/${BTC_BECH32}`],
    ['bitcoin', BTC_LEGACY, `https://blockstream.info/address/${BTC_LEGACY}`],
    ['litecoin', LTC_BECH32, `https://litecoinspace.org/address/${LTC_BECH32}`],
    ['litecoin', LTC_LEGACY, `https://litecoinspace.org/address/${LTC_LEGACY}`],
    ['solana', SOL_ADDR, `https://explorer.solana.com/address/${SOL_ADDR}`],
    ['sui', SUI_ADDR, `https://suiscan.xyz/mainnet/account/${SUI_ADDR}`],
    ['xpr', 'testalice1', 'https://explorer.xprnetwork.org/account/testalice1'],
    ['xpr', 'TestAlice1', 'https://explorer.xprnetwork.org/account/testalice1'],
    ['xpr', 'stake.proton', 'https://explorer.xprnetwork.org/account/stake.proton'],
  ])('%s %s', (chain, address, url) => {
    expect(explorerAddressUrl(chain, address)).toBe(url);
  });

  it('lowercases EVM hex and an all-uppercase bech32 address', () => {
    expect(explorerAddressUrl('polygon', EVM_ADDR.toUpperCase().replace('0X', '0x'))).toBe(`https://polygonscan.com/address/${EVM_ADDR}`);
    expect(explorerAddressUrl('bitcoin', BTC_BECH32.toUpperCase())).toBe(`https://blockstream.info/address/${BTC_BECH32}`);
  });

  it('keeps base58 exactly as stored', () => {
    expect(explorerAddressUrl('solana', SOL_ADDR)).toContain(SOL_ADDR);
    expect(explorerAddressUrl('bitcoin', BTC_LEGACY)).toContain(BTC_LEGACY);
  });

  it('tells a Sui address from an EVM value by the chain alone', () => {
    expect(explorerAddressUrl('sui', SUI_ADDR)).toBe(`https://suiscan.xyz/mainnet/account/${SUI_ADDR}`);
    expect(explorerAddressUrl('ethereum', SUI_ADDR)).toBeNull();
  });

  it('gives no link for an unknown or missing chain', () => {
    for (const chain of [null, undefined, '', 'tron', 'eth', 'constructor', '__proto__', 'toString']) {
      expect(explorerAddressUrl(chain as never, EVM_ADDR), String(chain)).toBeNull();
    }
  });

  it('gives no link for a value of the wrong shape', () => {
    const bad: Array<[string, string]> = [
      ['ethereum', 'cex:crypto_com:abc'],
      ['ethereum', 'javascript:alert(1)'],
      ['ethereum', `${EVM_ADDR}"><script>`],
      ['ethereum', `"${EVM_ADDR}"`],
      ['ethereum', `<${EVM_ADDR}>`],
      ['ethereum', `${EVM_ADDR}/../x`],
      ['ethereum', `${EVM_ADDR}?x=1`],
      ['ethereum', '0x123'],
      ['ethereum', ''],
      ['ethereum', BTC_BECH32],
      ['bitcoin', EVM_ADDR],
      ['bitcoin', `bc1Q${'x3'.repeat(19)}`],
      ['bitcoin', LTC_LEGACY],
      ['litecoin', BTC_BECH32],
      ['solana', EVM_ADDR],
      ['solana', `${SOL_ADDR}0`],
      ['solana', 'cex:crypto_com:abc'],
      ['sui', EVM_ADDR],
      ['sui', SOL_ADDR],
      ['xpr', 'abc.'],
      ['xpr', 'has space'],
      ['xpr', 'aaaaaaaaaaaaaaaa'],
      ['xpr', EVM_ADDR],
    ];
    for (const [chain, value] of bad) {
      expect(explorerAddressUrl(chain, value), `${chain} ${value}`).toBeNull();
    }
  });
});

describe('explorerTxUrl', () => {
  it.each([
    ['ethereum', EVM_TX, `https://etherscan.io/tx/${EVM_TX}`],
    ['polygon', EVM_TX, `https://polygonscan.com/tx/${EVM_TX}`],
    ['avalanche', EVM_TX, `https://snowtrace.io/tx/${EVM_TX}`],
    ['bsc', EVM_TX, `https://bscscan.com/tx/${EVM_TX}`],
    ['bitcoin', HEX_TXID, `https://blockstream.info/tx/${HEX_TXID}`],
    ['litecoin', HEX_TXID, `https://litecoinspace.org/tx/${HEX_TXID}`],
    ['solana', SOL_SIG, `https://explorer.solana.com/tx/${SOL_SIG}`],
    ['sui', SUI_DIGEST, `https://suiscan.xyz/mainnet/tx/${SUI_DIGEST}`],
    ['xpr', HEX_TXID, `https://explorer.xprnetwork.org/transaction/${HEX_TXID}`],
    ['xpr', HEX_TXID.toUpperCase(), `https://explorer.xprnetwork.org/transaction/${HEX_TXID}`],
  ])('%s %s', (chain, hash, url) => {
    expect(explorerTxUrl(chain, hash)).toBe(url);
  });

  it('lowercases EVM and Bitcoin hex', () => {
    expect(explorerTxUrl('ethereum', EVM_TX.toUpperCase().replace('0X', '0x'))).toBe(`https://etherscan.io/tx/${EVM_TX}`);
    expect(explorerTxUrl('bitcoin', HEX_TXID.toUpperCase())).toBe(`https://blockstream.info/tx/${HEX_TXID}`);
  });

  it('gives no link for an unknown chain or a hash of the wrong shape', () => {
    const bad: Array<[string | null, string]> = [
      [null, EVM_TX],
      ['tron', EVM_TX],
      ['ethereum', EVM_ADDR],
      ['ethereum', HEX_TXID],
      ['ethereum', `0x${'g'.repeat(64)}`],
      ['ethereum', 'javascript:alert(1)'],
      ['ethereum', '" onmouseover="alert(1)'],
      ['bitcoin', EVM_TX],
      ['litecoin', `${HEX_TXID}00`],
      ['solana', EVM_TX],
      ['solana', 'cex:crypto_com:abc'],
      ['sui', EVM_TX],
      ['xpr', EVM_TX],
      ['xpr', `${HEX_TXID}00`],
      ['xpr', 'testalice1'],
    ];
    for (const [chain, value] of bad) {
      expect(explorerTxUrl(chain, value), `${chain} ${value}`).toBeNull();
    }
  });
});

describe('evmExplorerLinks', () => {
  it('gives one link per EVM chain for an EVM address', () => {
    expect(evmExplorerLinks(EVM_ADDR)).toEqual([
      { chain: 'ethereum', url: `https://etherscan.io/address/${EVM_ADDR}` },
      { chain: 'polygon', url: `https://polygonscan.com/address/${EVM_ADDR}` },
      { chain: 'avalanche', url: `https://snowtrace.io/address/${EVM_ADDR}` },
      { chain: 'bsc', url: `https://bscscan.com/address/${EVM_ADDR}` },
    ]);
  });

  it('gives none for anything else', () => {
    expect(evmExplorerLinks(BTC_BECH32)).toEqual([]);
    expect(evmExplorerLinks(SUI_ADDR)).toEqual([]);
    expect(evmExplorerLinks('cex:crypto_com:abc')).toEqual([]);
  });
});

describe('explorerName', () => {
  it('names each chain\'s explorer, and a generic one otherwise', () => {
    expect(explorerName('polygon')).toBe('Polygonscan');
    expect(explorerName('bitcoin')).toBe('Blockstream');
    expect(explorerName(null)).toBe('block explorer');
  });
});

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('no explorer list outside explorerLinks.ts', () => {
  it('the transaction drawer builds every explorer link with the shared helper', () => {
    const drawer = read('src/components/bookkeeping/TransactionDrawer.tsx');
    expect(drawer).toContain("from '@/lib/explorerLinks'");
    for (const host of ['https://etherscan.io', 'polygonscan.com', 'snowtrace.io', 'bscscan.com', 'blockexplorer.one', 'blockstream.info', 'solana.com', 'suiscan.xyz']) {
      expect(drawer, host).not.toContain(host);
    }
    expect(drawer).not.toMatch(/explorerBaseFor|addrUrl|polygonscanUrl/);
  });

  it('the Agentics ledger and the wallet interactions endpoint use it too', () => {
    for (const rel of ['src/components/agentics/paths.ts', 'src/pages/api/wallets/[id]/interactions.ts']) {
      const src = read(rel);
      expect(src, rel).toContain("from '@/lib/explorerLinks'");
      expect(src, rel).not.toMatch(/EXPLORER_TX|CHAIN_EXPLORERS|https:\/\/etherscan\.io\/(tx|address)\/?['`]/);
    }
  });
});

describe('the wallets page loads every label detail', () => {
  it('selects category, chain, notes and phone_number for Address Labels', () => {
    const page = read('src/pages/dashboard/wallets.astro');
    const query = page.slice(page.indexOf('FROM address_labels') - 200, page.indexOf('FROM address_labels'));
    for (const col of ['category', 'chain', 'notes', 'phone_number']) {
      expect(query, col).toContain(col);
      expect(page, col).toMatch(new RegExp(`${col}:\\s+row\\.${col}`));
    }
  });
});
