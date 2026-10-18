import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The explorer layer: how an Etherscan-style answer is read, and what the default explorer asks.
 * The client in src/lib/etherscan.ts is replaced (no network, no API key).
 */
const etherscan = vi.hoisted(() => ({ build: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/etherscan', async () => ({
  ...(await vi.importActual<object>('@/lib/etherscan')),
  buildEtherscanV2Url: etherscan.build,
  requestEtherscan: etherscan.request,
}));

let explorer: typeof import('../../src/lib/agentVault/explorer');

beforeEach(async () => {
  vi.resetModules();
  etherscan.build.mockReset().mockImplementation((chainId: number, params: Record<string, unknown>) => `https://explorer.test/${chainId}?${new URLSearchParams(params as Record<string, string>)}`);
  etherscan.request.mockReset();
  explorer = await import('../../src/lib/agentVault/explorer');
});

describe('readRows: an empty listing is not a failure, and a failure is not an empty listing', () => {
  it('reads a list of rows', () => {
    expect(explorer.readRows({ status: '1', message: 'OK', result: [{ hash: 'x' }] })).toEqual([{ hash: 'x' }]);
  });

  it('"No transactions found" is an empty list, from either field', () => {
    expect(explorer.readRows({ status: '0', message: 'No transactions found', result: [] })).toEqual([]);
    expect(explorer.readRows({ status: '0', message: 'NOTOK', result: 'No transactions found' })).toEqual([]);
  });

  it.each([
    ['a rate limit', { status: '0', message: 'NOTOK', result: 'Max rate limit reached' }],
    ['a skipped call (no API key)', { status: '0', message: 'skipped', result: [] }],
    ['an error message', { status: '0', message: 'NOTOK', result: 'Invalid API Key' }],
    ['status 1 without a list', { status: '1', message: 'OK', result: 'oops' }],
    ['null', null],
    ['text', 'hello'],
    ['an empty object', {}],
  ])('%s is unavailable (null)', (_name, payload) => {
    expect(explorer.readRows(payload)).toBeNull();
  });
});

describe('readBlockNumber', () => {
  it('reads a number from the result, as a string or inside an object', () => {
    expect(explorer.readBlockNumber({ status: '1', result: '12345' })).toBe(12345);
    expect(explorer.readBlockNumber({ status: '1', result: { blockNumber: '777' } })).toBe(777);
    expect(explorer.readBlockNumber({ status: '1', result: '0' })).toBe(0);
  });

  it.each([
    [{ status: '0', result: '12345' }],
    [{ status: '1', result: 'Error! Block does not exist' }],
    [{ status: '1', result: '-4' }],
    [{ status: '1', result: '1.5' }],
    [{ status: '1', result: {} }],
    [null],
  ])('%j is null', (payload) => {
    expect(explorer.readBlockNumber(payload)).toBeNull();
  });
});

describe('the default explorer', () => {
  const q = { chain: 'ethereum' as const, action: 'tokentx' as const, address: `0x${'ab'.repeat(20)}`, startBlock: 100, endBlock: 200, page: 2, offset: 1000 };

  it('asks for one listing, oldest first, inside the block range, on the chain\'s id', async () => {
    etherscan.request.mockResolvedValue({ status: '1', message: 'OK', result: [{ hash: 'a' }] });
    expect(await explorer.defaultExplorer.page(q)).toEqual([{ hash: 'a' }]);
    const [chainId, params] = etherscan.build.mock.calls[0];
    expect(chainId).toBe(1);
    expect(params).toEqual({ module: 'account', action: 'tokentx', address: q.address, startblock: 100, endblock: 200, page: 2, offset: 1000, sort: 'asc' });
  });

  it('uses each chain\'s own id', async () => {
    etherscan.request.mockResolvedValue({ status: '1', result: [] });
    await explorer.defaultExplorer.page({ ...q, chain: 'polygon' });
    await explorer.defaultExplorer.page({ ...q, chain: 'avalanche' });
    expect(etherscan.build.mock.calls.map((c) => c[0])).toEqual([137, 43114]);
  });

  it('says null when the explorer cannot be read: no API key, a failed request, a refusal', async () => {
    etherscan.build.mockReturnValueOnce(null);
    expect(await explorer.defaultExplorer.page(q)).toBeNull();
    etherscan.request.mockRejectedValueOnce(new Error('network down'));
    expect(await explorer.defaultExplorer.page(q)).toBeNull();
    etherscan.request.mockResolvedValueOnce({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
    expect(await explorer.defaultExplorer.page(q)).toBeNull();
  });

  it('finds the block at or before a time, and remembers it', async () => {
    etherscan.request.mockResolvedValue({ status: '1', result: '4242' });
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_001)).toBe(4242);
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_001)).toBe(4242);
    expect(etherscan.request).toHaveBeenCalledTimes(1);
    expect(etherscan.build.mock.calls[0][1]).toEqual({ module: 'block', action: 'getblocknobytime', timestamp: 1_790_000_001, closest: 'before' });
    expect(await explorer.defaultExplorer.blockAt('polygon', 1_790_000_001)).toBe(4242); // a different chain is a different question
    expect(etherscan.request).toHaveBeenCalledTimes(2);
  });

  it('does not remember a block it could not find', async () => {
    etherscan.request.mockResolvedValueOnce({ status: '0', result: 'Error' });
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_002)).toBeNull();
    etherscan.request.mockResolvedValueOnce({ status: '1', result: '9' });
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_002)).toBe(9);
  });

  it('a block lookup with no API key or a failed request is null, never a throw', async () => {
    etherscan.build.mockReturnValueOnce(null);
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_003)).toBeNull();
    etherscan.request.mockRejectedValueOnce(new Error('boom'));
    expect(await explorer.defaultExplorer.blockAt('ethereum', 1_790_000_004)).toBeNull();
  });
});
