import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No database, no network, no secrets: stub the db client, the OFAC mirror, the check
// counter (it writes to the db), and run every rate-gated call at once.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));
vi.mock('@/lib/checkLog', () => ({ recordCheck: () => {} }));
vi.mock('@/lib/rateGate', () => ({
  createRateGate: () => ({ schedule: (fn: () => Promise<unknown>) => fn() }),
  RateGateTimeout: class RateGateTimeout extends Error {},
}));

import { POST as activityPost, GET as activityGet } from '../../src/pages/api/wallet-activity';
import { POST as checkPost } from '../../src/pages/api/wallet-check';
import { isPublicPath } from '../../src/middleware/auth';
import { resetActivitySourceState } from '../../src/lib/evmActivity';

/**
 * POST /api/wallet-activity: the Activity tab's facts, served apart from the verdict
 * (/api/wallet-check) so the verdict never waits on the explorers. Same validation and
 * per-IP limit as wallet-check, counted apart, with its own cache.
 */

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
let calls: URL[];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  calls.push(url);
  if (url.hostname === 'api.gopluslabs.io') return json({ code: 1, message: 'ok', result: { blacklist_doubt: '0' } });
  if (url.hostname === 'api.honeypot.is') return json({ isHoneypot: false });
  if (url.searchParams.get('action') === 'getsourcecode') return json({ status: '1', message: 'OK', result: [{ ContractName: '' }] });
  if (url.searchParams.get('action') === 'balance') return json({ status: '1', message: 'OK', result: '0' });
  if (url.hostname === 'api.etherscan.io' || url.hostname === 'api.routescan.io') {
    return json({ status: '0', message: 'No transactions found', result: [] });
  }
  return new Response('not found', { status: 404 });
});

let ipSeq = 0;
function post(handler: typeof activityPost, body: unknown, ip = `203.0.113.${++ipSeq}`): Promise<Response> {
  const request = new Request('https://almstins.com/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handler({ request, clientAddress: ip } as any) as Promise<Response>;
}

const historyCalls = () => calls.filter((u) => ['txlist', 'tokentx'].includes(u.searchParams.get('action') ?? ''));
// A fresh address per test: the route caches by address.
let addrSeq = 0x100;
const freshAddress = () => `0x${(addrSeq++).toString(16).padStart(40, '0')}`;

beforeEach(() => {
  calls = [];
  resetActivitySourceState();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ETHERSCAN_API_KEY', 'test-etherscan-key');
  for (const k of ['SNOWTRACE_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) vi.stubEnv(k, '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/wallet-activity', () => {
  it('is public, like /api/wallet-check', () => {
    expect(isPublicPath('/api/wallet-activity')).toBe(true);
  });

  it('answers with the chain and the activity facts, then serves the same address from its cache', async () => {
    const address = freshAddress();
    const res = await post(activityPost, { address });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, chain: 'evm', cached: false });
    expect(body.activity.chains.map((c: { id: string }) => c.id))
      .toEqual(['ethereum', 'polygon', 'arbitrum', 'avalanche', 'base', 'optimism', 'bnb']);
    expect(historyCalls().length).toBeGreaterThan(0);

    calls = [];
    const again = await (await post(activityPost, { address })).json();
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(calls).toEqual([]);
  });

  it('a read with a chain that could not be read is cached for a minute only', async () => {
    vi.useFakeTimers();
    try {
      const address = freshAddress();
      fetchMock.mockImplementationOnce(async () => new Response('down', { status: 503 }));
      await post(activityPost, { address });
      await vi.advanceTimersByTimeAsync(61_000);
      calls = [];
      const again = await (await post(activityPost, { address })).json();
      expect(again.cached).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['no address', {}],
    ['an address of the wrong shape', { address: 'hello' }],
    ['an address that is too long', { address: `0x${'a'.repeat(200)}` }],
  ])('rejects %s before any fetch', async (_name, body) => {
    const res = await post(activityPost, body);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('limits each IP to 10 a minute, counted apart from /api/wallet-check', async () => {
    const ip = '198.51.100.7';
    const address = freshAddress();
    for (let i = 0; i < 10; i++) expect((await post(activityPost, { address }, ip)).status).toBe(200);
    expect((await post(activityPost, { address }, ip)).status).toBe(429);
    // The same IP can still run a check.
    expect((await post(checkPost, { address }, ip)).status).toBe(200);
  });

  it('only POST', async () => {
    expect((await (activityGet as any)({})).status).toBe(405);
  });

  it('/api/wallet-check no longer reads activity: its result carries an empty activity field', async () => {
    const res = await post(checkPost, { address: freshAddress() });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.activity).toMatchObject({ firstSeen: null, lastActivity: null, txCount: null });
    expect(historyCalls()).toEqual([]);
  });
});
