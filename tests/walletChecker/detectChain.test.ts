import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// walletChecker.ts -> threatLists.ts -> '@/lib/db' opens a Postgres pool at import time.
// Stub the client (any query throws) and the OFAC mirror lookup, so this suite needs no
// database, no network, and no secrets.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
const sanctioned = vi.hoisted(() => ({ list: new Set<string>(), calls: [] as string[] }));
vi.mock('@/lib/threatLists', () => ({
  lookupSanctionedAddress: async (address: string) => {
    sanctioned.calls.push(address);
    return sanctioned.list.has(address);
  },
}));

import { detectChain, isValidAddress, checkWallet, canonicalAddress } from '../../src/lib/walletChecker';

/**
 * Regression tests for the false all-clear on legacy Bitcoin, legacy Litecoin and Tron.
 *
 * Bug: detectChain tested the Solana pattern (any base58 string of 32-44 chars) before
 * Bitcoin and Litecoin, so 1…/3… Bitcoin, L… Litecoin and T… Tron addresses were scanned
 * as "Solana". GoPlus answered with an error inside an HTTP 200 that was never checked,
 * coverage read "ran", and the scan showed the clean card although no scam source for
 * that chain had run.
 */

// The four addresses from the report (all checksum-valid).
const BTC_P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';   // Bitcoin genesis address
const BTC_P2SH  = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';   // BIP-13 example
const LTC_L     = 'LaMT348PWRnrqeeWArpwQPbuanpXDZGEUz';
const TRON      = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';   // USDT (TRC-20) contract
// Litecoin P2SH (M…): the BIP-13 hash above under version byte 0x32.
const LTC_M     = 'MQMHBtvnBfxTzt3K2bdxgSE7qZPHSXWsGM';

// Real Solana addresses, including ones that start with 1 or T (base58 of a 32-byte key).
const SOL_WSOL   = 'So11111111111111111111111111111111111111112';
const SOL_SYSTEM = '11111111111111111111111111111111';
const SOL_USDC   = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_TOKEN  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const EVM        = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SUI        = '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c';
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_TAPROOT = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
const LTC_BECH32 = 'ltc1qg82tt3n7rnzsxu8ufs7k6aynd6tyx5ksmn4fp6';
// Checksum-valid P2WPKH with no '0' in it, so its uppercase form is also valid base58.
const BTC_BECH32_NO_ZERO = 'bc1qny7cz2rk4dnewenpsgvk6l7t5t3ys6un8sfrka';

// Uppercase segwit (BIP-173 allows it; it is the recommended form inside QR codes). Without
// a '0' the uppercase form is also valid base58 that decodes to 32 bytes, so the old
// detection read it as a Solana key.
const LTC_BECH32_UPPER = LTC_BECH32.toUpperCase();          // 'LTC1QG82TT3N7RNZSXU8UFS7K6AYND6TYX5KSMN4FP6'
const BTC_BECH32_UPPER = BTC_BECH32.toUpperCase();          // contains '0'
const BTC_BECH32_UPPER_NO_ZERO = BTC_BECH32_NO_ZERO.toUpperCase();

/** Deterministic pseudo-random uppercase ltc1q… addresses (bech32 charset, 39 data chars). */
function randomUpperLtc(n: number): string[] {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  let seed = 0x5eed;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  return Array.from({ length: n }, () =>
    ('ltc1q' + Array.from({ length: 38 }, () => CHARSET[next() % 32]).join('')).toUpperCase());
}

// Address-shaped, but valid on no chain we recognize.
const BTC_TYPO   = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb';   // last character changed: bad checksum
const DOGE       = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';

describe('detectChain', () => {
  it('reports the four addresses from the report on their real chains, not Solana', () => {
    expect(detectChain(BTC_P2PKH)).toBe('bitcoin');
    expect(detectChain(BTC_P2SH)).toBe('bitcoin');
    expect(detectChain(LTC_L)).toBe('litecoin');
    expect(detectChain(TRON)).toBe('tron');
  });

  it('detects Litecoin P2SH (M…)', () => {
    expect(detectChain(LTC_M)).toBe('litecoin');
  });

  it('still detects real Solana addresses, including ones starting with 1 or T', () => {
    expect(detectChain(SOL_WSOL)).toBe('solana');
    expect(detectChain(SOL_SYSTEM)).toBe('solana');
    expect(detectChain(SOL_USDC)).toBe('solana');
    expect(detectChain(SOL_TOKEN)).toBe('solana');
  });

  it('detects EVM, Sui and segwit (bech32/bech32m) addresses', () => {
    expect(detectChain(EVM)).toBe('evm');
    expect(detectChain(EVM.toLowerCase())).toBe('evm');
    expect(detectChain(SUI)).toBe('sui');
    expect(detectChain(BTC_BECH32)).toBe('bitcoin');
    expect(detectChain(BTC_TAPROOT)).toBe('bitcoin');
    expect(detectChain(LTC_BECH32)).toBe('litecoin');
  });

  it('detects uppercase segwit addresses on their own chain, never as Solana', () => {
    expect(detectChain(LTC_BECH32_UPPER)).toBe('litecoin');
    expect(detectChain(BTC_BECH32_UPPER)).toBe('bitcoin');
    expect(detectChain(BTC_BECH32_UPPER_NO_ZERO)).toBe('bitcoin');
    expect(detectChain(BTC_BECH32_NO_ZERO)).toBe('bitcoin');
    const wrong = randomUpperLtc(2000).filter((a) => detectChain(a) !== 'litecoin');
    expect(wrong).toEqual([]);
  });

  it('a mixed-case segwit value is not a valid address: unknown, not a guess', () => {
    expect(detectChain('ltc1QG82TT3N7RNZSXU8UFS7K6AYND6TYX5KSMN4FP6')).toBe('unknown');
    expect(detectChain('bc1' + 'Q'.repeat(40))).toBe('unknown');
  });

  it('a base58 Solana key that starts with "bc1" is not read as segwit', () => {
    // 'B' is outside the bech32 charset, so this can only be base58 (it decodes to 32 bytes).
    expect(detectChain('bc1' + 'B'.repeat(40))).toBe('solana');
  });

  it('does not claim a chain for a bad checksum or an unrecognized base58 chain', () => {
    expect(detectChain(BTC_TYPO)).toBe('unknown');
    expect(detectChain(DOGE)).toBe('unknown');
    expect(detectChain('hello world')).toBe('unknown');
    expect(detectChain('')).toBe('unknown');
    // Not bech32 ('b', 'o' and '1' are outside its charset), and not base58 either ('0').
    expect(detectChain('bc1qbtcdemo0wallet000000000000000000000000')).toBe('unknown');
  });
});

describe('canonicalAddress', () => {
  it('lowercases an uppercase segwit address and leaves case-sensitive ones alone', () => {
    expect(canonicalAddress(LTC_BECH32_UPPER)).toBe(LTC_BECH32);
    expect(canonicalAddress(BTC_BECH32_UPPER)).toBe(BTC_BECH32);
    expect(canonicalAddress(BTC_BECH32)).toBe(BTC_BECH32);
    for (const a of [BTC_P2PKH, LTC_L, TRON, SOL_USDC, EVM, SUI, 'ltc1QG82TT3N7RNZSXU8UFS7K6AYND6TYX5KSMN4FP6']) {
      expect(canonicalAddress(a)).toBe(a);
    }
  });
});

describe('isValidAddress accepts exactly what it accepted before', () => {
  // The previous acceptance rule, verbatim. The lookup, check and mail scanners depend on it,
  // so this fix must reclassify addresses without narrowing or widening what is accepted.
  const OLD = [
    /^0x[0-9a-fA-F]{64}$/,
    /^0x[0-9a-fA-F]{40}$/,
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    /^([LM][a-km-zA-HJ-NP-Z1-9]{26,33}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|ltc1[a-zA-HJ-NP-Z0-9]{6,87})$/,
    /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{6,87})$/,
  ];
  const oldIsValid = (a: string) => {
    const t = a.trim();
    return t.length >= 25 && t.length <= 128 && OLD.some((re) => re.test(t));
  };

  const samples = [
    BTC_P2PKH, BTC_P2SH, LTC_L, LTC_M, TRON, SOL_WSOL, SOL_SYSTEM, SOL_USDC, SOL_TOKEN,
    EVM, SUI, BTC_BECH32, BTC_TAPROOT, LTC_BECH32, BTC_TYPO, DOGE,
    LTC_BECH32_UPPER, BTC_BECH32_UPPER, BTC_BECH32_UPPER_NO_ZERO, BTC_BECH32_NO_ZERO,
    'bc1' + 'B'.repeat(40), 'bc1' + 'Q'.repeat(40),
    'bc1qbtcdemo0wallet000000000000000000000000', // not valid bech32, but always accepted
    '1short', 'hello world', '0x1234', 'x'.repeat(200), '', '   ',
    'L' + '1'.repeat(26), '3' + 'z'.repeat(25), 'T' + 'a'.repeat(40),
  ];

  it.each(samples)('%s', (s) => {
    expect(isValidAddress(s)).toBe(oldIsValid(s));
  });
});

describe('checkWallet coverage: a chain no scam source covers is never a clean all-clear', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let goplus: (url: string) => unknown;

  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const goplusClean = () => ({ code: 1, message: 'ok', result: { blacklist_doubt: '0', sanctioned: '0', mixer: '0' } });

  beforeEach(() => {
    for (const k of ['ETHERSCAN_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) {
      vi.stubEnv(k, '');
    }
    sanctioned.list.clear();
    sanctioned.calls.length = 0;
    goplus = goplusClean;
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.gopluslabs.io')) return jsonResponse(goplus(url));
      if (url.includes('api.honeypot.is')) return jsonResponse({ isHoneypot: false });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const goplusCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('gopluslabs'));

  it.each([
    ['legacy BTC 1…', BTC_P2PKH, 'bitcoin'],
    ['legacy BTC 3…', BTC_P2SH, 'bitcoin'],
    ['legacy LTC L…', LTC_L, 'litecoin'],
    ['Tron T…', TRON, 'tron'],
  ])('%s: GoPlus is not asked about Solana, the scan is partial, OFAC still runs', async (_name, address, chain) => {
    const r = await checkWallet(address);
    expect(r.chain).toBe(chain);
    expect(goplusCalls()).toEqual([]);
    expect(r.coverage.goplus).toBe('skipped');
    expect(r.partialCoverage).toBe(true);
    expect(r.scamLevel).toBe('clean'); // no hit, but partial: the UI shows "limited", not green
    expect(sanctioned.calls).toContain(address);
  });

  it('a sanctioned legacy BTC address is still flagged danger by the local OFAC mirror', async () => {
    sanctioned.list.add(BTC_P2PKH);
    const r = await checkWallet(BTC_P2PKH);
    expect(r.flags.sanctioned).toBe(true);
    expect(r.scamLevel).toBe('danger');
  });

  it('an address-shaped value on no recognized chain is partial, never clean-and-complete', async () => {
    const r = await checkWallet(DOGE);
    expect(r.chain).toBe('unknown');
    expect(goplusCalls()).toEqual([]);
    expect(r.partialCoverage).toBe(true);
  });

  it.each([
    ['uppercase LTC1Q…', LTC_BECH32_UPPER, 'litecoin', LTC_BECH32],
    ['uppercase BC1Q… (no 0)', BTC_BECH32_UPPER_NO_ZERO, 'bitcoin', BTC_BECH32_NO_ZERO],
  ])('%s: its own chain, partial, and the OFAC lookup gets the lowercase form', async (_name, address, chain, lower) => {
    const r = await checkWallet(address);
    expect(r.chain).toBe(chain);
    expect(r.address).toBe(address); // echoed as given
    expect(goplusCalls()).toEqual([]);
    expect(r.partialCoverage).toBe(true);
    expect(sanctioned.calls).toContain(lower);
  });

  it('a sanctioned segwit address scanned in uppercase is still flagged danger', async () => {
    sanctioned.list.add(LTC_BECH32);
    const r = await checkWallet(LTC_BECH32_UPPER);
    expect(r.flags.sanctioned).toBe(true);
    expect(r.scamLevel).toBe('danger');
  });

  // Live GoPlus answers {code: 5000, "system error"} for every chain_id=solana query
  // (checked 2026-09-24), so Solana is not asked at all and has no primary source.
  it('Solana: GoPlus is not asked, the scan is partial, OFAC still runs', async () => {
    const r = await checkWallet(SOL_USDC);
    expect(r.chain).toBe('solana');
    expect(goplusCalls()).toEqual([]);
    expect(r.coverage.goplus).toBe('skipped');
    expect(r.partialCoverage).toBe(true);
    expect(r.scamLevel).toBe('clean'); // no hit, but partial: the UI shows "limited", not green
    expect(sanctioned.calls).toContain(SOL_USDC);
  });

  // The cases below model GoPlus answers (the API contract), not a recorded live response.
  it('EVM: GoPlus answering an error inside HTTP 200 counts as did-not-run', async () => {
    goplus = () => ({ code: 2004, message: 'address format error', result: null });
    const r = await checkWallet(EVM);
    expect(goplusCalls()).toHaveLength(3);
    expect(r.coverage.goplus).toBe('error');
    expect(r.partialCoverage).toBe(true);
    expect(r.errors.some((e) => e.includes('GoPlus(Ethereum) error code 2004'))).toBe(true);
  });

  it('EVM: a missing code is also treated as an error (fail safe)', async () => {
    goplus = () => ({ result: {} });
    const r = await checkWallet(EVM);
    expect(r.coverage.goplus).toBe('error');
    expect(r.partialCoverage).toBe(true);
  });

  it('a positive flag in a non-1 (partial) GoPlus answer is kept, and the scan is partial', async () => {
    goplus = (url) => (url.includes('chain_id=137')
      ? { code: 2, message: 'partial data', result: { blacklist_doubt: '1' } }
      : goplusClean());
    const r = await checkWallet(EVM);
    expect(r.flags.blacklisted).toBe(true);
    expect(r.scamLevel).toBe('danger');
    expect(r.coverage.goplus).toBe('error');
  });

  it('EVM: every chain complete and honeypot.is up is a full scan', async () => {
    const r = await checkWallet(EVM);
    expect(goplusCalls()).toHaveLength(3);
    expect(r.coverage).toMatchObject({ goplus: 'ran', honeypot: 'ran' });
    expect(r.partialCoverage).toBe(false);
  });

  it('EVM: one GoPlus chain answering a rate-limit code makes the scan partial', async () => {
    goplus = (url) => (url.includes('chain_id=56') ? { code: 4029, message: 'rate limit', result: {} } : goplusClean());
    const r = await checkWallet(EVM);
    expect(r.coverage.goplus).toBe('error');
    expect(r.partialCoverage).toBe(true);
  });

  it('Chainabuse without a key is reported as skipped, not as checked', async () => {
    const r = await checkWallet(SOL_USDC);
    expect(r.coverage.chainabuse).toBe('skipped');
  });
});
