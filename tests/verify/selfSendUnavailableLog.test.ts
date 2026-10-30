import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * An explorer failure reads as 'unavailable' to the user whichever way it failed, so the server
 * log has to say why. Each failure path logs one line, and none logs a URL (it carries the API
 * key) or an address.
 */
const requestEtherscan = vi.hoisted(() => vi.fn());
const buildEtherscanV2Url = vi.hoisted(() => vi.fn());
vi.mock('@/lib/etherscan', () => ({
  requestEtherscan,
  buildEtherscanV2Url,
  CHAIN_IDS: { ethereum: 1, polygon: 137, avalanche: 43114 },
}));

import { detectBoundSelfSend } from '@/lib/verifyDeposit';

const ADDR = '0x1111111111111111111111111111111111111111';
const challenge = { rail: 'avalanche', address: ADDR, expected: 1000n, issuedAt: 1_000_000, expiresAt: 1_086_400 } as any;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  requestEtherscan.mockReset();
  buildEtherscanV2Url.mockReset().mockReturnValue('https://explorer.test/api?apikey=SECRET');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const logged = () => JSON.stringify(warn.mock.calls);

describe('unavailable is logged with its cause', () => {
  it('a missing explorer key', async () => {
    buildEtherscanV2Url.mockReturnValue(null);
    expect(await detectBoundSelfSend(challenge)).toEqual({ found: false, reason: 'unavailable' });
    expect(logged()).toContain('block_lookup');
    expect(logged()).toContain('API key not configured');
  });

  it('the block lookup answering NOTOK', async () => {
    requestEtherscan.mockResolvedValueOnce({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
    expect(await detectBoundSelfSend(challenge)).toEqual({ found: false, reason: 'unavailable' });
    expect(logged()).toContain('block_lookup');
    expect(logged()).toContain('Max rate limit reached');
  });

  it('the transaction list answering NOTOK', async () => {
    requestEtherscan
      .mockResolvedValueOnce({ status: '1', message: 'OK', result: '5000' })
      .mockResolvedValueOnce({ status: '0', message: 'NOTOK', result: 'Invalid API Key' });
    expect(await detectBoundSelfSend(challenge)).toEqual({ found: false, reason: 'unavailable' });
    expect(logged()).toContain('txlist');
    expect(logged()).toContain('Invalid API Key');
  });

  it('a thrown request (timeout, HTTP error, queue wait)', async () => {
    requestEtherscan.mockRejectedValueOnce(new Error('snowtrace HTTP 403: blocked'));
    expect(await detectBoundSelfSend(challenge)).toEqual({ found: false, reason: 'unavailable' });
    expect(logged()).toContain('threw');
    expect(logged()).toContain('snowtrace HTTP 403');
  });

  it('never logs the URL, its key, or the address', async () => {
    requestEtherscan.mockRejectedValueOnce(new Error('boom'));
    await detectBoundSelfSend(challenge);
    requestEtherscan.mockResolvedValueOnce({ status: '0', message: 'NOTOK', result: 'x' });
    await detectBoundSelfSend(challenge);
    expect(logged()).not.toContain('SECRET');
    expect(logged()).not.toContain('explorer.test');
    expect(logged().toLowerCase()).not.toContain(ADDR);
  });
});
