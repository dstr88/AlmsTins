import { describe, it, expect } from 'vitest';
import {
  calculateScamScore,
  computePartialCoverage,
  isCompromisedEntity,
  isMixerAddress,
  isMixerName,
  KNOWN_MIXER_ADDRESSES,
} from '../../src/lib/walletChecker';

/**
 * Consumer-safety regression tests for the wallet checker's fail-safe rules.
 *
 * Bug fixed: the Tornado Cash proxy 0x722122dF...6967 returned a green
 * "score 0 — no known risks" even though the tool identified it as a mixer, and a
 * partial scan (honeypot.is unavailable) still showed green. Green must mean every
 * primary source ran and nothing flagged; a known mixer is at least a caution; a
 * confirmed malicious hit is red.
 */

const NO_FLAGS = {
  blacklisted: false, phishing: false, honeypotRelated: false, stealingAttack: false,
  darkwebTransactions: false, cybercrime: false, moneyLaundering: false,
  financialCrime: false, blackmail: false, mixer: false, sanctioned: false,
};

const TORNADO_PROXY = '0x722122dF12D4e14e13Ac3b6895a86e84145b6967';

describe('known-mixer identification feeds the risk model', () => {
  it('the reported Tornado Cash proxy is a known mixer address (case-insensitive)', () => {
    expect(isMixerAddress(TORNADO_PROXY)).toBe(true);
    expect(isMixerAddress(TORNADO_PROXY.toLowerCase())).toBe(true);
    expect(KNOWN_MIXER_ADDRESSES.has(TORNADO_PROXY.toLowerCase())).toBe(true);
  });

  it('a normal address is not a mixer', () => {
    expect(isMixerAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false); // USDC
  });

  it('recognises mixer contract names (the wider net for explorer-named contracts)', () => {
    expect(isMixerName('TornadoProxy')).toBe(true);
    expect(isMixerName('Tornado.Cash Router')).toBe(true);
    expect(isMixerName('Coin Mixer')).toBe(true);
    expect(isMixerName('Uniswap V3')).toBe(false);
    expect(isMixerName('USDC')).toBe(false);
    expect(isMixerName('Remixer Labs')).toBe(false);
    expect(isMixerName(null)).toBe(false);
    expect(isMixerName('')).toBe(false);
  });

  it('a mixer flag pushes the verdict off green (at least caution, never clean)', () => {
    const mixerResult = calculateScamScore({ ...NO_FLAGS, mixer: true });
    expect(mixerResult.level).toBe('caution');
    expect(mixerResult.score).toBeGreaterThan(0);
  });

  it('a genuinely clean set of flags is still green', () => {
    const clean = calculateScamScore({ ...NO_FLAGS });
    expect(clean.level).toBe('clean');
    expect(clean.score).toBe(0);
  });

  it('a positive honeypot identification is a confirmed hit → danger', () => {
    const hp = calculateScamScore({ ...NO_FLAGS, honeypotRelated: true });
    expect(hp.level).toBe('danger');
    expect(hp.score).toBeGreaterThan(0);
  });
});

describe('graded severity: confirmed hits are red, mixer is yellow', () => {
  it('a blacklisted address is danger (not merely caution)', () => {
    const r = calculateScamScore({ ...NO_FLAGS, blacklisted: true });
    expect(r.level).toBe('danger');
    expect(r.score).toBe(90);
  });

  it('a sanctioned address is danger with a top severity score', () => {
    const r = calculateScamScore({ ...NO_FLAGS, sanctioned: true });
    expect(r.level).toBe('danger');
    expect(r.score).toBe(100);
  });

  it('a mixer alone is caution, never danger', () => {
    const r = calculateScamScore({ ...NO_FLAGS, mixer: true });
    expect(r.level).toBe('caution');
    expect(r.score).toBe(40);
  });

  it('score reflects the single worst signal present', () => {
    const r = calculateScamScore({ ...NO_FLAGS, mixer: true, blacklisted: true });
    expect(r.level).toBe('danger');
    expect(r.score).toBe(90);
  });
});

describe('known-compromised entities feed the verdict', () => {
  const label = (name: string, subLabel: string | null) =>
    ({ name, type: 'bridge' as const, subLabel, url: null, confidence: 'definite' as const });

  it('flags the exploited Multichain bridge', () => {
    expect(isCompromisedEntity(label('Multichain (Compromised)', 'Do not use — exploited 2023'))).toBe(true);
  });

  it('does not flag a normal bridge', () => {
    expect(isCompromisedEntity(label('Wormhole', 'Token Bridge (ETH)'))).toBe(false);
    expect(isCompromisedEntity(null)).toBe(false);
  });
});

describe('partial coverage never reads as a confident all-clear', () => {
  it('EVM with every primary source run is NOT partial', () => {
    expect(computePartialCoverage('evm', { goplus: 'ran', honeypot: 'ran', chainabuse: 'ran' })).toBe(false);
  });

  it('EVM with honeypot.is unavailable IS partial (the reported case)', () => {
    expect(computePartialCoverage('evm', { goplus: 'ran', honeypot: 'error', chainabuse: 'ran' })).toBe(true);
  });

  it('EVM with GoPlus unavailable IS partial', () => {
    expect(computePartialCoverage('evm', { goplus: 'error', honeypot: 'ran', chainabuse: 'ran' })).toBe(true);
  });

  it('Chainabuse alone being down does NOT gate a verdict (it is secondary)', () => {
    expect(computePartialCoverage('evm', { goplus: 'ran', honeypot: 'ran', chainabuse: 'error' })).toBe(false);
  });

  it('Solana (GoPlus ran, honeypot N/A) is NOT partial', () => {
    expect(computePartialCoverage('solana', { goplus: 'ran', honeypot: 'skipped', chainabuse: 'ran' })).toBe(false);
  });

  it('a chain with no primary source at all IS partial', () => {
    expect(computePartialCoverage('bitcoin', { goplus: 'skipped', honeypot: 'skipped', chainabuse: 'ran' })).toBe(true);
  });
});
