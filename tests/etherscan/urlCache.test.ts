import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The explorer client's response cache and its request timeout (src/lib/etherscan.ts). The cache used to keep every
 * response it ever fetched until the process restarted, and a wallet read that asks every minute for a new block range
 * asks for a new URL every time. Now it is bounded, and a request that is never answered is cut off. The gate is a
 * pass-through and fetch is a stand-in: no network, no secrets.
 */
vi.mock('../../src/lib/explorerGates', () => ({
  BACKGROUND_MAX_WAIT_MS: 30_000,
  GATE_PRIORITY: { safety: 0, background: 1, activityFirst: 10, activityLater: 20 },
  gateForUrl: () => ({ schedule: async (fn: () => Promise<unknown>) => fn() }),
}));

const fetchMock = vi.fn();
let etherscan: typeof import('../../src/lib/etherscan');
const body = (chars: number, tag = 'x') => JSON.stringify({ status: '1', message: 'OK', result: [{ pad: tag.repeat(Math.max(0, chars - 60)) }] });
const url = (n: number) => `https://api.etherscan.io/v2/api?module=account&action=txlist&address=0x${String(n).padStart(40, '0')}&apikey=test`;

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
  etherscan = await import('../../src/lib/etherscan');
  etherscan._debugClearCaches();
});

afterEach(() => {
  vi.useRealTimers();
});

const ask = (n: number, over: Record<string, unknown> = {}) => etherscan.requestEtherscan(url(n), { minIntervalMs: 0, attempts: 1, ...over });
const answers = (text: string) => fetchMock.mockImplementation(async () => new Response(text, { status: 200 }));

describe('the response cache is bounded', () => {
  it('keeps no more than its entry limit, however many different URLs are asked for', async () => {
    answers(body(1000));
    const { maxEntries } = etherscan._debugCacheStats();
    for (let n = 0; n < maxEntries + 150; n += 1) await ask(n);
    expect(etherscan._debugCacheStats().entries).toBeLessThanOrEqual(maxEntries);
  });

  it('keeps no more than its byte budget: a thousand-row listing is a big response, and thirty of them used to stay for good', async () => {
    const { maxBytes } = etherscan._debugCacheStats();
    const big = Math.floor(maxBytes / 10);
    answers(body(big));
    for (let n = 0; n < 40; n += 1) await ask(n);
    const stats = etherscan._debugCacheStats();
    expect(stats.bytes).toBeLessThanOrEqual(maxBytes);
    expect(stats.entries).toBeLessThan(40);
    // The newest are the ones kept: asking for the last one again does not go back to the network.
    fetchMock.mockClear();
    await ask(39);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not keep one response that is larger than a quarter of the budget', async () => {
    const { maxBytes } = etherscan._debugCacheStats();
    answers(body(Math.floor(maxBytes / 4) + 1000));
    await ask(1);
    expect(etherscan._debugCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('drops an entry when its time is up, and gives the memory back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    answers(body(5000));
    await ask(1);
    expect(etherscan._debugCacheStats().entries).toBe(1);
    vi.setSystemTime(new Date('2026-10-19T12:00:20Z')); // past the 15 s memo
    fetchMock.mockClear();
    await ask(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // asked again, not served stale
    expect(etherscan._debugCacheStats().entries).toBe(1);
  });

  it('still reuses a response inside its fifteen seconds, which is what the cache is for', async () => {
    answers(body(1000));
    await ask(1);
    await ask(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts the bytes it holds exactly: asking for the same URL again does not add them twice', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    answers(body(2000));
    await ask(1);
    const once = etherscan._debugCacheStats().bytes;
    vi.setSystemTime(new Date('2026-10-19T12:01:00Z'));
    await ask(1);
    expect(etherscan._debugCacheStats().bytes).toBe(once);
  });

  it('_debugClearCaches empties it and the count', async () => {
    answers(body(1000));
    await ask(1);
    etherscan._debugClearCaches();
    expect(etherscan._debugCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});

describe('a request that is never answered', () => {
  it('is cut off after thirty seconds instead of waiting as long as the network allows', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    });
    vi.useFakeTimers();
    const pending = ask(1).then(() => 'answered', (e) => String((e as Error).message));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signal?.aborted).toBe(true);
    expect(await pending).toMatch(/aborted|Provider fetch failed/);
  });

  it('is asked with a signal at all (every call, not only a slow one)', async () => {
    answers(body(500));
    await ask(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
