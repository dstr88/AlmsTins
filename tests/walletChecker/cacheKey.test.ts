import { describe, it, expect, vi } from 'vitest';

// walletChecker.ts -> threatLists.ts -> '@/lib/db' opens a Postgres pool at import time.
// Stub both so this suite needs no database, no network and no secrets.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));

import { cacheKeyFor, getCached, setCache } from '../../src/lib/walletChecker';

/**
 * The wallet checker's 5-minute result cache (read by /api/wallet-check and mail scanning).
 *
 * Bug: every key was lowercased, but base58 addresses (Solana, Tron, legacy Bitcoin and
 * Litecoin) are case-sensitive. Checking a case-flipped copy of a sanctioned Solana address
 * (a different address, not on the sanctions list, so clean) cached that clean result under
 * the real address's key, and the real address then read clean until the entry expired.
 */

// A fake result: the cache only stores and returns it.
const result = (label: string) => ({ label }) as never;

const SOL_REAL    = 'So11111111111111111111111111111111111111112';
const SOL_FLIPPED = 'sO11111111111111111111111111111111111111112'; // two letters' case flipped
const TRON_REAL   = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BTC_LEGACY  = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const EVM_CHECKSUM = '0x52908400098527886E0F7030069857D2E4169EE7'; // EIP-55 example
const BTC_BECH32  = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('cacheKeyFor', () => {
  it('keeps base58 addresses exactly as typed (Solana, Tron, legacy Bitcoin)', () => {
    expect(cacheKeyFor(SOL_REAL)).toBe(SOL_REAL);
    expect(cacheKeyFor(SOL_FLIPPED)).toBe(SOL_FLIPPED);
    expect(cacheKeyFor(TRON_REAL)).toBe(TRON_REAL);
    expect(cacheKeyFor(BTC_LEGACY)).toBe(BTC_LEGACY);
  });

  it('lowercases hex and segwit addresses, where case carries no meaning', () => {
    expect(cacheKeyFor(EVM_CHECKSUM)).toBe(EVM_CHECKSUM.toLowerCase());
    expect(cacheKeyFor('0x' + 'AB'.repeat(32))).toBe('0x' + 'ab'.repeat(32)); // Sui
    expect(cacheKeyFor(BTC_BECH32.toUpperCase())).toBe(BTC_BECH32);
  });

  it('ignores surrounding whitespace', () => {
    expect(cacheKeyFor(`  ${SOL_REAL}\n`)).toBe(SOL_REAL);
  });
});

describe('the result cache', () => {
  it('a case-flipped Solana copy never answers for the real address', () => {
    setCache(SOL_FLIPPED, result('clean copy'));
    expect(getCached(SOL_REAL)).toBeNull();
    expect(getCached(SOL_FLIPPED)).toEqual({ label: 'clean copy' });
  });

  it('a case-flipped Tron copy never answers for the real address', () => {
    const flipped = 'tR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    setCache(flipped, result('copy'));
    expect(getCached(TRON_REAL)).toBeNull();
  });

  it('an EVM address is one entry whatever its case', () => {
    setCache(EVM_CHECKSUM, result('evm'));
    expect(getCached(EVM_CHECKSUM.toLowerCase())).toEqual({ label: 'evm' });
  });

  it('a segwit address is one entry in upper or lower case', () => {
    setCache(BTC_BECH32.toUpperCase(), result('segwit'));
    expect(getCached(BTC_BECH32)).toEqual({ label: 'segwit' });
  });
});
