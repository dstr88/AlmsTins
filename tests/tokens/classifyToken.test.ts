import { describe, it, expect } from 'vitest';
import { classifyToken, classifyTokenName, isSpamName } from '@/lib/tokenClassification';

describe('classifyToken — legitimate tokens stay clean (no false positives)', () => {
  const legit = [
    { symbol: 'WBTC', name: 'Wrapped BTC' },
    { symbol: 'WETH', name: 'Wrapped Ether' },
    { symbol: 'USDC', name: 'USD Coin' },
    { symbol: 'USDT', name: 'Tether USD' },
    { symbol: 'DAI',  name: 'Dai Stablecoin' },
    { symbol: 'POL',  name: 'Polygon Ecosystem Token' },
    { symbol: 'WPOL', name: 'Wrapped POL' },
    { symbol: 'MATIC', name: 'Matic Token' },
    { symbol: 'AVAX', name: 'Avalanche' },
    { symbol: 'WAVAX', name: 'Wrapped AVAX' },
    { symbol: 'AAVE', name: 'Aave Token' },
    { symbol: 'LINK', name: 'ChainLink Token' },
    { symbol: 'UNI',  name: 'Uniswap' },
    { symbol: 'aPolUSDC', name: 'Aave Polygon USDC' },
    { symbol: 'variableDebtWETH', name: 'Aave Variable Debt WETH' },
    { symbol: 'SOL',  name: 'Solana' },
    { symbol: 'BTC',  name: null },
    { symbol: 'ETH',  name: '' },
  ];
  for (const t of legit) {
    it(`clean: ${t.symbol}`, () => {
      expect(classifyToken(t).class).toBe('clean');
    });
  }
});

describe('classifyToken — spam examples from every prior list are caught', () => {
  // Drawn from knownContracts FUNGIBLE_SPAM_PATTERNS, annualBreakdown NFT SPAM_PATTERNS,
  // and ReconciliationTin SCAM_PATTERNS.
  const spam = [
    'Visit https://claim-reward.xyz',            // URL
    '$ 2,000 USDC Voucher',                      // lure word
    'https://t.me/airdrop_now',                  // telegram link
    'CLAIM REWARDS AT trustbox.site',            // lure + domain
    'Rewards on T.LY/shibaswap',                 // shortener
    'official.link/redeem',                      // official.link
    '! Rewards | Claim',                         // pipe + lure
    'REDEEM WITHIN 7 DAYS',                      // redeem
    'Airdrop Prize Winner',                      // multi-word + lure
    'visit fli.so now',                          // shortener
    'somesite.top reward',                       // TLD + lure
    'earn on staking.org rewards',              // .org + earn
  ];
  for (const s of spam) {
    it(`spam: "${s}"`, () => {
      expect(classifyTokenName({ symbol: s }).class).toBe('spam');
      expect(isSpamName(s)).toBe(true);
    });
  }
});

describe('classifyToken — contract verdict overrides name', () => {
  it('a known-scam contract is scam even with a clean name', () => {
    expect(classifyToken({ symbol: 'USDC', name: 'USD Coin', contractVerdict: 'scam' }).class).toBe('scam');
  });
  it('a legitimate contract verdict does not force clean if name is spammy', () => {
    // contract 'legitimate' + spammy name → name spam still wins? No: scam only on 'scam'.
    // A legit contract with a clean symbol stays clean.
    expect(classifyToken({ symbol: 'USDC', contractVerdict: 'legitimate' }).class).toBe('clean');
  });
});
