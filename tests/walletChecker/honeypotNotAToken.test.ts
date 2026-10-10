import { describe, it, expect, vi, beforeEach } from 'vitest';

// walletChecker.ts -> threatLists.ts -> '@/lib/db' opens a Postgres pool at import time.
// Stub the client and the OFAC mirror lookup, so this suite needs no database, no network
// and no secrets.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));

import { checkWallet, resolveNoPairs } from '../../src/lib/walletChecker';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * honeypot.is tests tokens that trade. It answers HTTP 404 {"code":404,"error":"No pairs
 * found"} for an ordinary wallet (checked live 2026-10-10; USDC got a full answer), and the
 * checker counted that as a failed primary source: nearly every EVM wallet check read
 * "Limited check — not a clean bill" and said the main databases had not run, even when
 * GoPlus had.
 *
 * The same 404 also comes back for a token with no market, the Sapien case (a fake coin sold
 * through a website, not an exchange). That must stay cautious. So "nothing to test" applies
 * only when GoPlus saw no contract code on every chain asked (Ethereum, BNB Chain, Polygon,
 * plus a contract-only probe of Base and Arbitrum).
 */

const ADDR = '0x1111111111111111111111111111111111111111';

type HoneypotAnswer = { status: number; body: string };
let honeypotAnswer: HoneypotAnswer;
let goplusCode: number;
/** contract_address GoPlus reports per chain id; a chain set to 'fail' answers HTTP 500. */
let contractByChain: Record<string, '0' | '1' | 'fail'>;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('api.gopluslabs.io')) {
    const chainId = new URL(url).searchParams.get('chain_id') ?? '';
    const contract = contractByChain[chainId] ?? '0';
    if (contract === 'fail') return new Response('error', { status: 500 });
    return new Response(JSON.stringify({
      code: goplusCode, message: 'ok',
      result: { blacklist_doubt: '0', sanctioned: '0', mixer: '0', contract_address: contract },
    }), { status: 200 });
  }
  if (url.includes('api.honeypot.is')) return new Response(honeypotAnswer.body, { status: honeypotAnswer.status });
  return new Response('not found', { status: 404 });
});

const NO_PAIRS: HoneypotAnswer = { status: 404, body: JSON.stringify({ code: 404, error: 'No pairs found' }) };

beforeEach(() => {
  for (const k of ['ETHERSCAN_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) vi.stubEnv(k, '');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  honeypotAnswer = NO_PAIRS;
  goplusCode = 1;
  contractByChain = {}; // no code anywhere: an ordinary wallet
});

describe('an ordinary wallet: honeypot.is "No pairs found"', () => {
  it('is a full scan with nothing to test, not "Limited check"', async () => {
    const r = await checkWallet(ADDR);
    expect(r.coverage.honeypot).toBe('ran');
    expect(r.partialCoverage).toBe(false);
    expect(r.honeypot).toEqual({ checked: true, isHoneypot: null, reason: null, notAToken: true });
    expect(r.errors.some((e) => /honeypot/i.test(e))).toBe(false);
  });

  it('asks GoPlus about Base and Arbitrum too, for contract code only', async () => {
    await checkWallet(ADDR);
    const asked = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('gopluslabs'))
      .map((u) => new URL(u).searchParams.get('chain_id')).sort();
    expect(asked).toEqual(['1', '137', '42161', '56', '8453']);
  });

  it('GoPlus failing still makes it partial', async () => {
    goplusCode = 0;
    const r = await checkWallet(ADDR);
    expect(r.coverage.goplus).toBe('error');
    expect(r.partialCoverage).toBe(true);
  });
});

describe('a contract with no market stays cautious (the Sapien case)', () => {
  it.each([
    ['Ethereum', '1'], ['BNB Chain', '56'], ['Polygon', '137'], ['Base', '8453'], ['Arbitrum', '42161'],
  ])('code on %s → partial, honeypot unavailable with the no-market note', async (_name, chainId) => {
    contractByChain = { [chainId]: '1' };
    const r = await checkWallet(ADDR);
    expect(r.coverage.honeypot).toBe('error');
    expect(r.partialCoverage).toBe(true);
    expect(r.honeypot).toMatchObject({ checked: false, noMarket: true });
    expect(r.honeypot.notAToken).toBeUndefined();
  });

  it('a Base or Arbitrum lookup that fails → partial, never "nothing to test"', async () => {
    contractByChain = { '8453': 'fail' };
    const r = await checkWallet(ADDR);
    expect(r.partialCoverage).toBe(true);
    expect(r.honeypot.notAToken).toBeUndefined();
    expect(r.honeypot.noMarket).toBeUndefined(); // unknown, not known to be a contract
    expect(r.coverage.goplus).toBe('ran'); // the probe never counts against GoPlus coverage
  });
});

describe('resolveNoPairs', () => {
  it('needs a definite "no code" from both lookups', () => {
    expect(resolveNoPairs(false, false).honeypot.notAToken).toBe(true);
    expect(resolveNoPairs(false, null).honeypot.notAToken).toBeUndefined();
    expect(resolveNoPairs(null, false).honeypot.notAToken).toBeUndefined();
    expect(resolveNoPairs(undefined, false).honeypot.notAToken).toBeUndefined();
    expect(resolveNoPairs(true, false).honeypot.noMarket).toBe(true);
    expect(resolveNoPairs(false, true).honeypot.noMarket).toBe(true);
  });
});

describe('honeypot.is failures still count as failures', () => {
  it.each([
    ['a 404 with another message', { status: 404, body: JSON.stringify({ code: 404, error: 'Unsupported chain' }) }],
    ['a 500', { status: 500, body: 'server error' }],
    ['a 429', { status: 429, body: 'rate limited' }],
  ])('%s → partial, honeypot unavailable', async (_name, answer) => {
    honeypotAnswer = answer;
    const r = await checkWallet(ADDR);
    expect(r.coverage.honeypot).toBe('error');
    expect(r.partialCoverage).toBe(true);
    expect(r.honeypot.notAToken).toBeUndefined();
  });
});

describe('a real honeypot answer is unchanged', () => {
  it('isHoneypot true still raises the honeypot flag', async () => {
    honeypotAnswer = { status: 200, body: JSON.stringify({ isHoneypot: true, honeypotReason: 'Sell tax 100%' }) };
    const r = await checkWallet(ADDR);
    expect(r.honeypot).toMatchObject({ checked: true, isHoneypot: true, reason: 'Sell tax 100%' });
    expect(r.flags.honeypotRelated).toBe(true);
    expect(r.coverage.honeypot).toBe('ran');
  });
});

describe('copy', () => {
  it('explains both cases in all three languages', () => {
    expect(en.checker.honeypotNotAToken).toMatch(/^Nothing to test: honeypot\.is found no trading pair/);
    expect(es.checker.honeypotNotAToken).toMatch(/^Nada que probar: honeypot\.is no encontró/);
    expect(fr.checker.honeypotNotAToken).toMatch(/^Rien à tester : honeypot\.is n’a trouvé/);
    expect(en.checker.honeypotNoMarket).toMatch(/no trading pair for this contract.*extra caution\.$/);
    expect(es.checker.honeypotNoMarket).toMatch(/este contrato.*precaución adicional\.$/);
    expect(fr.checker.honeypotNoMarket).toMatch(/ce contrat.*prudence accrue\.$/);
  });
});
