import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// walletChecker.ts -> threatLists.ts -> '@/lib/db' opens a Postgres pool at import time.
// Stub the client and the OFAC mirror: no database, no network, no secrets.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));

/**
 * The activity read with the REAL rate gates (explorerGates.ts) and fake timers: a hung
 * explorer, a gate that is full, and the order in which a shared gate serves the verdict's
 * safety lookups, the activity reads and background sync. Each test imports fresh modules,
 * so it starts with empty gates. Every explorer is a fake; nothing leaves the process.
 */

const ADDR = '0x1111111111111111111111111111111111111111';
const KEY = 'test-etherscan-key';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const EMPTY = { status: '0', message: 'No transactions found', result: [] };

let calls: URL[];
/** Return a Response, or undefined for the default (an empty history everywhere). */
let answer: (url: URL, init?: RequestInit) => Promise<Response> | Response | undefined;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push(url);
  const custom = answer(url, init);
  if (custom) return custom;
  if (url.hostname === 'api.gopluslabs.io') return json({ code: 1, message: 'ok', result: { blacklist_doubt: '0' } });
  if (url.hostname === 'api.honeypot.is') return json({ isHoneypot: false });
  if (url.searchParams.get('action') === 'getsourcecode') return json({ status: '1', message: 'OK', result: [{ ContractName: '' }] });
  if (url.searchParams.get('action') === 'getabi') return json({ status: '0', message: 'NOTOK', result: 'Contract source code not verified' });
  if (url.searchParams.get('action') === 'balance') return json({ status: '1', message: 'OK', result: '0' });
  if (url.hostname === 'api.etherscan.io' || url.hostname === 'api.routescan.io') return json(EMPTY);
  return new Response('not found', { status: 404 });
});

const etherscanActions = () => calls
  .filter((u) => u.hostname === 'api.etherscan.io')
  .map((u) => `${u.searchParams.get('action')}:${u.searchParams.get('chainid')}`);

/** A fetch that never answers, and rejects only when its request is aborted (a hung explorer). */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  calls = [];
  answer = () => undefined;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ETHERSCAN_API_KEY', KEY);
  for (const k of ['SNOWTRACE_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) vi.stubEnv(k, '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('activity read with the real rate gates', () => {
  it('a hung explorer is cut at the request timeout: that chain is unavailable, the others are read, within the budget', async () => {
    const { fetchEvmActivity, ACTIVITY_BUDGET_MS } = await import('../../src/lib/evmActivity');
    answer = (url, init) => (url.searchParams.get('chainid') === '137' ? hang(init) : undefined);

    let settled = false;
    const pending = fetchEvmActivity(ADDR).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS);
    expect(settled).toBe(true);

    const r = await pending;
    const byId = Object.fromEntries((r.activity.chains ?? []).map((c) => [c.id, c]));
    expect(byId.polygon).toMatchObject({ checked: false, reason: 'unavailable' });
    for (const id of ['ethereum', 'arbitrum', 'avalanche']) expect(byId[id].checked).toBe(true);
    expect(r.activity.firstSeenComplete).toBe(false); // never "None found"
    expect(r.activity.txCountIsMinimum).toBe(true);   // "0+", never 0
  });

  it('a gate full of other checks\' lookups: Etherscan chains are "could not be read right now", never empty, and that is not held against the source', async () => {
    const { etherscanGate, GATE_PRIORITY } = await import('../../src/lib/explorerGates');
    const { fetchEvmActivity, ACTIVITY_BUDGET_MS } = await import('../../src/lib/evmActivity');
    const { showNewWalletNote } = await import('../../src/lib/walletActivity');

    // Three congested reads in a row: a source failing three times would be skipped next.
    for (let i = 0; i < 3; i++) {
      // 15 safety lookups fill the next 5 windows (3 per 1.1 s): longer than an activity call waits.
      const others = Array.from({ length: 15 }, () =>
        etherscanGate.schedule(async () => 'lookup', { priority: GATE_PRIORITY.safety, maxWaitMs: 60_000 }));
      const pending = fetchEvmActivity(ADDR);
      await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS);
      const r = await pending;
      await Promise.all(others);

      const byId = Object.fromEntries((r.activity.chains ?? []).map((c) => [c.id, c]));
      for (const id of ['ethereum', 'polygon', 'arbitrum']) {
        expect(byId[id]).toMatchObject({ checked: false, reason: 'unavailable', firstSeen: null, txCount: null });
      }
      expect(byId.avalanche.checked).toBe(true); // Routescan has its own gate
      expect(r.activity.firstSeen).toBeNull();
      expect(r.activity.firstSeenComplete).toBe(false);
      expect(r.activity.txCount).toBe(0);
      expect(r.activity.txCountIsMinimum).toBe(true);
      expect(showNewWalletNote(r.activity)).toBe(false);
      // Etherscan was never asked for a history.
      expect(etherscanActions().filter((a) => /^(txlist|tokentx)/.test(a))).toEqual([]);
    }

    // A free gate: every chain is read again (the queue timeouts did not trip the skip).
    const pending = fetchEvmActivity(ADDR);
    await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS);
    const r = await pending;
    expect((r.activity.chains ?? []).filter((c) => c.checked).map((c) => c.id))
      .toEqual(['ethereum', 'polygon', 'arbitrum', 'avalanche']);
  });

  it('under load, each check gets its Ethereum pages before any check\'s later chains', async () => {
    const { fetchEvmActivity, ACTIVITY_BUDGET_MS } = await import('../../src/lib/evmActivity');
    const first = fetchEvmActivity(ADDR);
    const second = fetchEvmActivity('0x3333333333333333333333333333333333333333');
    await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS);
    await Promise.all([first, second]);

    const ethereumPages = calls
      .filter((u) => u.hostname === 'api.etherscan.io')
      .map((u, i) => ({ i, chain: u.searchParams.get('chainid'), address: u.searchParams.get('address') }));
    const lastEthereum = Math.max(...ethereumPages.filter((p) => p.chain === '1').map((p) => p.i));
    const firstOther = Math.min(...ethereumPages.filter((p) => p.chain !== '1').map((p) => p.i));
    expect(lastEthereum).toBeLessThan(firstOther);
  });

  it('the verdict\'s safety lookups go ahead of activity reads already queued', async () => {
    const { checkWallet, fetchWalletActivity } = await import('../../src/lib/walletChecker');
    const { ACTIVITY_BUDGET_MS } = await import('../../src/lib/evmActivity');

    const activity = fetchWalletActivity(ADDR);
    await vi.advanceTimersByTimeAsync(0); // the activity read takes the first window
    const verdict = checkWallet(ADDR);
    await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS + 1_000);
    await Promise.all([activity, verdict]);

    const order = etherscanActions();
    expect(order.slice(0, 3).every((a) => /^(txlist|tokentx):/.test(a))).toBe(true);
    expect(order.slice(3, 5).map((a) => a.split(':')[0]).sort()).toEqual(['getabi', 'getsourcecode']);
  });

  // Verify proofs, wallet sync and holdings go through etherscan.ts: they must not wait
  // behind anonymous Activity-tab reads, so they rank right after the safety lookups.
  it('etherscan.ts calls share the gate and go ahead of queued activity pages', async () => {
    const { buildEtherscanV2Url, requestEtherscan } = await import('../../src/lib/etherscan');
    const { fetchEvmActivity, ACTIVITY_BUDGET_MS } = await import('../../src/lib/evmActivity');

    const background = requestEtherscan(buildEtherscanV2Url(1, { module: 'account', action: 'txlistinternal', address: ADDR }));
    const activity = fetchEvmActivity(ADDR);
    await vi.advanceTimersByTimeAsync(ACTIVITY_BUDGET_MS);
    await Promise.all([background, activity]);

    const order = etherscanActions();
    expect(order.indexOf('txlistinternal:1')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('txlistinternal:1')).toBeLessThan(3); // in the first window, not after the activity pages
    expect(order).toHaveLength(8); // 6 history pages + the balance + the background call
  });
});
