import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// walletChecker.ts -> threatLists.ts -> '@/lib/db' opens a Postgres pool at import time.
// Stub the client (any query throws) and the OFAC mirror, so this suite needs no
// database, no network and no secrets (as in detectChain.test.ts).
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});
vi.mock('@/lib/threatLists', () => ({ lookupSanctionedAddress: async () => false }));
// The explorer rate gates space real calls 1.1 s apart; here every call runs at once.
// Their timing, and the activity read under a full gate, are in activityTiming.test.ts.
vi.mock('@/lib/rateGate', () => ({
  createRateGate: () => ({ schedule: (fn: () => Promise<unknown>) => fn() }),
  RateGateTimeout: class RateGateTimeout extends Error {},
}));

import {
  checkWallet, fetchWalletActivity, calculateScamScore, CONTRACT_NAME_UNAVAILABLE,
  type WalletActivityResult,
} from '../../src/lib/walletChecker';
import { showNewWalletNote, summarizeChains, type ActivityChain, type WalletActivity } from '../../src/lib/walletActivity';
import { classifyExplorerError, readExplorerList, resetActivitySourceState } from '../../src/lib/evmActivity';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * Wallet checker "Activity" across EVM chains (fixed 2026-10-08).
 *
 * Before: first/last activity came from Ethereum mainnet normal transactions only, so a
 * wallet used only on Polygon, or one that only RECEIVED tokens (a common collection
 * wallet), showed a dash and never got the new-wallet note; the transaction count was
 * null for every wallet that had transactions. Now: Ethereum, Polygon, Arbitrum
 * (Etherscan v2) and Avalanche (Routescan) are read, with ERC-20 transfers; a chain whose
 * source answers with an error is "not checked", never "no activity"; the count is
 * transactions sent. Age stays a fact: it is served apart from the verdict
 * (/api/wallet-activity) and never moves the score.
 *
 * Every explorer is a fake below; nothing leaves the process.
 */

const ADDR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const KEY = 'test-etherscan-key';
const ALCHEMY_KEY = 'test-alchemy-key';
const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const daysAgoS = (d: number) => nowS() - d * DAY_S;
const isoDaysAgo = (d: number) => new Date(daysAgoS(d) * 1000).toISOString();

interface Row { timeStamp: string; from: string; to: string; nonce: string; hash: string }
interface FakeChain {
  txs?: Row[];
  tokens?: Row[];
  nonce?: number;
  /** eth_getCode answer; '0x' (an externally owned account) when absent. */
  code?: string;
  balanceWei?: string;
  /** Answer every call to this chain with this JSON body (an explorer error). */
  body?: unknown;
  /** Answer every call to this chain with this HTTP status. */
  http?: number;
  /** Answer only newest-first (sort=desc) pages with this JSON body. */
  descBody?: unknown;
}

let seq = 0;
const sent = (daysAgo: number, nonce: number): Row =>
  ({ timeStamp: String(daysAgoS(daysAgo)), from: ADDR, to: OTHER, nonce: String(nonce), hash: `0x${(seq++).toString(16)}` });
const received = (daysAgo: number, nonce = 7): Row =>
  ({ timeStamp: String(daysAgoS(daysAgo)), from: OTHER, to: ADDR, nonce: String(nonce), hash: `0x${(seq++).toString(16)}` });

const RATE_LIMITED = { status: '0', message: 'NOTOK', result: 'Max calls per sec rate limit reached (3/sec)' };
const FREE_PLAN = { status: '0', message: 'NOTOK', result: 'Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage. https://etherscan.io/apis' };

// Fake explorers, keyed by chain id: 1/137/42161 on api.etherscan.io (v2, chainid=…),
// 43114 on api.routescan.io. A chain with no entry has no history.
let chains: Record<string, FakeChain>;
let goplus: Record<string, string>;
let sourceCode: unknown;
let calls: URL[];
/** Alchemy answers by network slug; a number is an HTTP status. Absent: a normal answer from `chains`. */
let alchemy: Record<string, number | undefined>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ALCHEMY_CHAIN: Record<string, string> = {
  'eth-mainnet': '1', 'polygon-mainnet': '137', 'arb-mainnet': '42161', 'avax-mainnet': '43114',
};

function explorer(chainId: string, q: URLSearchParams): Response {
  if (q.get('module') === 'contract') {
    return q.get('action') === 'getsourcecode'
      ? json(sourceCode)
      : json({ status: '0', message: 'NOTOK', result: 'Contract source code not verified' });
  }
  const c = chains[chainId] ?? {};
  if (c.http) return new Response('upstream error', { status: c.http });
  if (c.body) return json(c.body);
  if (c.descBody && q.get('sort') === 'desc') return json(c.descBody);
  if (q.get('module') === 'proxy' && q.get('action') === 'eth_getTransactionCount') {
    return json({ jsonrpc: '2.0', id: 1, result: `0x${(c.nonce ?? 0).toString(16)}` });
  }
  if (q.get('module') === 'proxy' && q.get('action') === 'eth_getCode') {
    return json({ jsonrpc: '2.0', id: 1, result: c.code ?? '0x' });
  }
  if (q.get('action') === 'balance') return json({ status: '1', message: 'OK', result: c.balanceWei ?? '0' });
  const rows = [...((q.get('action') === 'tokentx' ? c.tokens : c.txs) ?? [])]
    .sort((a, b) => Number(a.timeStamp) - Number(b.timeStamp));
  if (q.get('sort') === 'desc') rows.reverse();
  const page = rows.slice(0, Number(q.get('offset') ?? 10000));
  return page.length
    ? json({ status: '1', message: 'OK', result: page })
    : json({ status: '0', message: 'No transactions found', result: [] });
}

function alchemyRpc(network: string, init?: RequestInit): Response {
  const forced = alchemy[network];
  if (forced) return json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'not enabled' } }, forced);
  const c = chains[ALCHEMY_CHAIN[network] ?? ''] ?? {};
  const { method } = JSON.parse(String(init?.body ?? '{}'));
  const result =
    method === 'eth_getTransactionCount' ? `0x${(c.nonce ?? 0).toString(16)}`
    : method === 'eth_getCode' ? (c.code ?? '0x')
    : method === 'eth_getBalance' ? `0x${BigInt(c.balanceWei ?? '0').toString(16)}`
    : null;
  return json({ jsonrpc: '2.0', id: 1, result });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  calls.push(url);
  if (url.hostname === 'api.gopluslabs.io') return json({ code: 1, message: 'ok', result: goplus });
  if (url.hostname === 'api.honeypot.is') return json({ isHoneypot: false });
  if (url.hostname === 'api.etherscan.io') return explorer(url.searchParams.get('chainid') ?? '', url.searchParams);
  if (url.hostname === 'api.routescan.io') {
    return explorer(url.pathname.match(/\/evm\/(\d+)\//)?.[1] ?? '', url.searchParams);
  }
  if (url.hostname.endsWith('.g.alchemy.com')) return alchemyRpc(url.hostname.split('.')[0], init);
  return new Response('not found', { status: 404 });
});

const explorerCalls = (chainId: string) => calls.filter((u) =>
  (u.hostname === 'api.etherscan.io' && u.searchParams.get('chainid') === chainId && u.searchParams.get('module') !== 'contract') ||
  (u.hostname === 'api.routescan.io' && u.pathname.includes(`/evm/${chainId}/`)));
const historyCalls = () => calls.filter((u) => ['txlist', 'tokentx'].includes(u.searchParams.get('action') ?? ''));
const alchemyCalls = () => calls.filter((u) => u.hostname.endsWith('.g.alchemy.com'));

type R = WalletActivityResult;
const chain = (r: R, id: string) => r.activity.chains?.find((c) => c.id === id);
const checkedIds = (r: R) => (r.activity.chains ?? []).filter((c) => c.checked).map((c) => c.id);
const notCheckedIds = (r: R) => (r.activity.chains ?? []).filter((c) => !c.checked).map((c) => c.id);

// fetchWalletActivity itself does not cache (the API route does), so each call reads the fakes afresh.
const read = (): Promise<R> => fetchWalletActivity(ADDR);

beforeEach(() => {
  chains = {};
  goplus = { blacklist_doubt: '0', sanctioned: '0', mixer: '0' };
  sourceCode = { status: '1', message: 'OK', result: [{ ContractName: '' }] };
  alchemy = {};
  calls = [];
  resetActivitySourceState();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ETHERSCAN_API_KEY', KEY);
  for (const k of ['SNOWTRACE_API_KEY', 'ALCHEMY_API_KEY', 'CHAINABUSE_API_KEY', 'CHAINALYSIS_API_KEY']) vi.stubEnv(k, '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('EVM activity across chains', () => {
  it('an Ethereum-only wallet: first and last activity named on Ethereum, transactions sent counted exactly', async () => {
    chains['1'] = {
      txs: [sent(400, 0), received(300), sent(10, 1)],
      tokens: [received(200)],
      balanceWei: '1500000000000000000',
    };
    const r = await read();
    const a = r.activity;
    expect(r.chain).toBe('evm');
    expect(a.firstSeen).toBe(isoDaysAgo(400));
    expect(a.firstSeenChain).toBe('Ethereum');
    expect(a.lastActivity).toBe(isoDaysAgo(10));
    expect(a.lastActivityChain).toBe('Ethereum');
    expect(a.txCount).toBe(2);
    expect(a.txCountBasis).toBe('sent');
    expect(a.txCountIsMinimum).toBe(false);
    expect(a.firstSeenComplete).toBe(true);
    expect(a.lastActivityComplete).toBe(true);
    expect(a.ethBalance).toBe('1.500000');
    expect(checkedIds(r)).toEqual(['ethereum', 'polygon', 'arbitrum', 'avalanche']);
    expect(chain(r, 'polygon')).toMatchObject({ checked: true, firstSeen: null, txCount: 0 });
    // Chains with no free source are listed, so a dash is never read as "no history".
    expect(notCheckedIds(r)).toEqual(['base', 'optimism', 'bnb']);
    expect(chain(r, 'base')?.reason).toBe('no_source');
    expect(showNewWalletNote(a)).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('a wallet active only on Polygon: found there, Ethereum read and empty', async () => {
    chains['137'] = { txs: [sent(90, 0), received(60)] };
    const r = await read();
    expect(r.activity.firstSeen).toBe(isoDaysAgo(90));
    expect(r.activity.firstSeenChain).toBe('Polygon');
    expect(r.activity.lastActivityChain).toBe('Polygon');
    expect(r.activity.txCount).toBe(1);
    expect(chain(r, 'ethereum')).toMatchObject({ checked: true, firstSeen: null, lastActivity: null });
  });

  it('a wallet active only on Avalanche is read through Routescan, keyless', async () => {
    chains['43114'] = { txs: [received(45)] };
    const r = await read();
    expect(r.activity.firstSeenChain).toBe('Avalanche');
    const routescan = calls.filter((u) => u.hostname === 'api.routescan.io');
    expect(routescan.length).toBeGreaterThan(0);
    expect(routescan.every((u) => !u.searchParams.has('apikey'))).toBe(true);
  });

  it('the earliest and latest activity are taken across chains', async () => {
    chains['1'] = { txs: [sent(20, 0)] };
    chains['42161'] = { txs: [sent(700, 0), sent(5, 1)] };
    chains['137'] = { tokens: [received(2)] };
    const r = await read();
    expect(r.activity.firstSeen).toBe(isoDaysAgo(700));
    expect(r.activity.firstSeenChain).toBe('Arbitrum');
    expect(r.activity.lastActivity).toBe(isoDaysAgo(2));
    expect(r.activity.lastActivityChain).toBe('Polygon');
    expect(r.activity.txCount).toBe(1 + 2 + 0);
  });

  it('a token-only wallet (it only ever received ERC-20s) has a first activity and 0 sent', async () => {
    chains['1'] = { tokens: [received(5), received(4)] };
    const r = await read();
    expect(r.activity.firstSeen).toBe(isoDaysAgo(5));
    expect(r.activity.lastActivity).toBe(isoDaysAgo(4));
    expect(r.activity.txCount).toBe(0);
    expect(showNewWalletNote(r.activity)).toBe(true);
    // A complete short history needs no nonce call.
    expect(calls.some((u) => u.searchParams.get('module') === 'proxy')).toBe(false);
  });

  it.each([
    ['a free-plan chain error', FREE_PLAN, 'not_on_plan'],
    ['"chain not supported"', { status: '0', message: 'chain not supported', result: null }, 'not_on_plan'],
    ['an invalid key', { status: '0', message: 'NOTOK', result: 'Missing/Invalid API Key' }, 'not_configured'],
    ['a rate limit', RATE_LIMITED, 'unavailable'],
    ['"Query Timeout"', { status: '0', message: 'NOTOK', result: 'Query Timeout occured. Please select a smaller result dataset' }, 'unavailable'],
  ])('%s on one chain lists it as not checked (%s), never as "no activity"', async (_name, body, reason) => {
    chains['1'] = { txs: [sent(400, 0)] };
    chains['42161'] = { body };
    const r = await read();
    expect(chain(r, 'arbitrum')).toMatchObject({ checked: false, reason, firstSeen: null, txCount: null });
    expect(notCheckedIds(r)).toContain('arbitrum');
    expect(checkedIds(r)).toEqual(['ethereum', 'polygon', 'avalanche']);
    expect(r.activity.firstSeenChain).toBe('Ethereum');
    // One chain failing is shown in the Activity tab, not raised as a check-wide error.
    expect(r.errors).toEqual([]);
  });

  it('an HTTP error on one chain is also "not checked"', async () => {
    chains['137'] = { http: 502 };
    const r = await read();
    expect(chain(r, 'polygon')).toMatchObject({ checked: false, reason: 'unavailable' });
  });

  it('when every chain fails: no dates, no count, no new-wallet note, and the error is raised', async () => {
    for (const id of ['1', '137', '42161', '43114']) chains[id] = { http: 500 };
    const r = await read();
    const a = r.activity;
    expect(checkedIds(r)).toEqual([]);
    expect(a.firstSeen).toBeNull();
    expect(a.lastActivity).toBeNull();
    expect(a.txCount).toBeNull();
    expect(showNewWalletNote(a)).toBe(false);
    expect(r.errors).toContain('Activity unavailable');
    expect(r.errors.join(' ')).not.toContain(KEY); // the key lives in the URL; never in an error
  });

  it('with no Etherscan key, Etherscan chains are "not configured" and Avalanche is still read', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    chains['43114'] = { txs: [sent(3, 0)] };
    const r = await read();
    expect(calls.some((u) => u.hostname === 'api.etherscan.io')).toBe(false);
    expect(chain(r, 'ethereum')).toMatchObject({ checked: false, reason: 'not_configured' });
    expect(checkedIds(r)).toEqual(['avalanche']);
    expect(r.activity.firstSeenChain).toBe('Avalanche');
    expect(r.errors).toContain('Etherscan not configured');
    // Ethereum, Polygon and Arbitrum were never read, so 3 days on Avalanche is not "new".
    expect(r.activity.firstSeenComplete).toBe(false);
    expect(showNewWalletNote(r.activity)).toBe(false);
  });
});

describe('a chain that could not be read qualifies every headline fact', () => {
  it('an old Ethereum wallet whose Ethereum read failed, active on Polygon 5 days ago: no new-wallet note', async () => {
    chains['1'] = { body: RATE_LIMITED, txs: [sent(1500, 0)] };
    chains['137'] = { txs: [sent(5, 0)] };
    const r = await read();
    expect(chain(r, 'ethereum')).toMatchObject({ checked: false, reason: 'unavailable' });
    expect(r.activity.firstSeen).toBe(isoDaysAgo(5));
    expect(r.activity.firstSeenComplete).toBe(false); // shown as "On or before …"
    expect(r.activity.lastActivityComplete).toBe(false);
    expect(r.activity.txCount).toBe(1);
    expect(r.activity.txCountIsMinimum).toBe(true); // "1+", not "1"
    expect(showNewWalletNote(r.activity)).toBe(false);
  });

  it('a busy Ethereum wallet whose newest-first page is rate-limited keeps its first activity; Polygon active 5 days ago gives no note', async () => {
    chains['1'] = {
      txs: Array.from({ length: 12 }, (_, i) => sent(1500 - i, i)),
      nonce: 12,
      descBody: RATE_LIMITED,
    };
    chains['137'] = { txs: [sent(5, 0)] };
    const r = await read();
    // Ethereum is still checked: its oldest pages answered, so its first activity stands.
    expect(chain(r, 'ethereum')).toMatchObject({
      checked: true, firstSeen: isoDaysAgo(1500), lastActivityComplete: false,
    });
    expect(r.activity.firstSeen).toBe(isoDaysAgo(1500));
    expect(r.activity.firstSeenChain).toBe('Ethereum');
    expect(r.activity.firstSeenComplete).toBe(true);
    // The latest found is Polygon's, but Ethereum's newest entries were not read.
    expect(r.activity.lastActivity).toBe(isoDaysAgo(5));
    expect(r.activity.lastActivityComplete).toBe(false); // shown as "On or after …"
    expect(showNewWalletNote(r.activity)).toBe(false);
  });

  it('a chain unread for no source (Base, OP, BNB) or not on our plan does not hold the note back', async () => {
    chains['1'] = { txs: [sent(3, 0)] };
    chains['42161'] = { body: FREE_PLAN };
    const r = await read();
    expect(chain(r, 'arbitrum')?.reason).toBe('not_on_plan');
    expect(r.activity.firstSeenComplete).toBe(true);
    expect(r.activity.txCountIsMinimum).toBe(false);
    expect(showNewWalletNote(r.activity)).toBe(true);
  });

  it('a wallet with no history where one chain failed counts "0+", not 0', async () => {
    chains['42161'] = { body: RATE_LIMITED };
    const r = await read();
    expect(r.activity.txCount).toBe(0);
    expect(r.activity.txCountIsMinimum).toBe(true);
    expect(r.activity.firstSeen).toBeNull();
    expect(r.activity.firstSeenComplete).toBe(false); // a dash, never "None found"
  });
});

describe('remembered refusals', () => {
  it('a chain the plan refuses is skipped on the next check, without a call', async () => {
    chains['42161'] = { body: FREE_PLAN };
    await read();
    expect(explorerCalls('42161').length).toBeGreaterThan(0);
    calls = [];
    const again = await read();
    expect(explorerCalls('42161')).toEqual([]);
    expect(chain(again, 'arbitrum')).toMatchObject({ checked: false, reason: 'not_on_plan' });
  });

  it('three failures in a row skip the chain for a while; one success resets the count', async () => {
    chains['137'] = { http: 503 };
    await read();
    await read();
    chains['137'] = {};
    await read(); // a success between failures
    chains['137'] = { http: 503 };
    await read();
    await read();
    calls = [];
    await read(); // the third failure in a row since the success
    expect(explorerCalls('137').length).toBeGreaterThan(0);
    calls = [];
    const skipped = await read();
    expect(explorerCalls('137')).toEqual([]);
    expect(chain(skipped, 'polygon')).toMatchObject({ checked: false, reason: 'unavailable' });
  });
});

describe('transactions sent is a real number', () => {
  it('a busy wallet: read from the nonce on its newest outgoing transaction', async () => {
    chains['1'] = {
      txs: [
        ...Array.from({ length: 12 }, (_, i) => received(500 - i)),
        sent(30, 40), received(20), sent(10, 41), received(1),
      ],
    };
    const r = await read();
    expect(r.activity.txCount).toBe(42);
    expect(r.activity.txCountIsMinimum).toBe(false);
    expect(r.activity.firstSeen).toBe(isoDaysAgo(500));
    expect(r.activity.lastActivity).toBe(isoDaysAgo(1));
    const eth = explorerCalls('1');
    expect(eth.some((u) => u.searchParams.get('action') === 'txlist' && u.searchParams.get('sort') === 'desc')).toBe(true);
    expect(eth.some((u) => u.searchParams.get('module') === 'proxy')).toBe(false);
  });

  it('a busy wallet whose newest 10 are all incoming: read from the account nonce', async () => {
    chains['1'] = { txs: Array.from({ length: 25 }, (_, i) => received(100 - i)), nonce: 26 };
    const r = await read();
    expect(r.activity.txCount).toBe(26);
    const proxy = explorerCalls('1').filter((u) => u.searchParams.get('module') === 'proxy').map((u) => u.searchParams.get('action'));
    expect(proxy.sort()).toEqual(['eth_getCode', 'eth_getTransactionCount']);
  });

  it('a busy contract (a Safe) never shows its contract nonce as transactions sent', async () => {
    chains['1'] = { txs: Array.from({ length: 25 }, (_, i) => received(100 - i)), nonce: 1, code: '0x608060405234801561001057600080fd5b50' };
    chains['137'] = { txs: [sent(50, 0)] };
    const r = await read();
    expect(chain(r, 'ethereum')).toMatchObject({ checked: true, txCount: null });
    expect(r.activity.txCount).toBe(1);
    expect(r.activity.txCountIsMinimum).toBe(true);
  });

  it('an EIP-7702 account (delegated code) still counts its nonce', async () => {
    chains['1'] = {
      txs: Array.from({ length: 25 }, (_, i) => received(100 - i)),
      nonce: 9,
      code: '0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d',
    };
    const r = await read();
    expect(chain(r, 'ethereum')?.txCount).toBe(9);
  });

  it('a checked chain whose count cannot be read makes the total a minimum ("N+")', async () => {
    chains['1'] = { txs: Array.from({ length: 12 }, (_, i) => received(100 - i)) };
    chains['137'] = { txs: [sent(50, 0), sent(40, 1)] };
    // The nonce call on Ethereum answers with an explorer error instead of a hex count.
    const realExplorer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.searchParams.get('action') === 'eth_getTransactionCount') {
        calls.push(url);
        return json(RATE_LIMITED);
      }
      return realExplorer(input, init);
    });
    try {
      const r = await read();
      expect(chain(r, 'ethereum')).toMatchObject({ checked: true, txCount: null });
      expect(r.activity.txCount).toBe(2);
      expect(r.activity.txCountIsMinimum).toBe(true);
    } finally {
      fetchMock.mockImplementation(realExplorer);
    }
  });

  it('a wallet that never used a chain costs two history calls there (no newest-first page, no nonce)', async () => {
    const r = await read();
    expect(checkedIds(r)).toEqual(['ethereum', 'polygon', 'arbitrum', 'avalanche']);
    for (const id of ['137', '42161', '43114']) {
      expect(explorerCalls(id).map((u) => `${u.searchParams.get('action')}:${u.searchParams.get('sort')}`).sort())
        .toEqual(['tokentx:asc', 'txlist:asc']);
    }
    // Ethereum also reads the ETH balance.
    expect(explorerCalls('1')).toHaveLength(3);
    expect(r.activity.txCount).toBe(0);
  });
});

describe('Alchemy for the nonce, contract code and balance', () => {
  it('with an Alchemy key, those reads skip the explorers (their rate limit is the scarce one)', async () => {
    vi.stubEnv('ALCHEMY_API_KEY', ALCHEMY_KEY);
    chains['1'] = { txs: Array.from({ length: 25 }, (_, i) => received(100 - i)), nonce: 26, balanceWei: '2000000000000000000' };
    const r = await read();
    expect(r.activity.txCount).toBe(26);
    expect(r.activity.ethBalance).toBe('2.000000');
    expect(calls.some((u) => u.hostname === 'api.etherscan.io' && (u.searchParams.get('module') === 'proxy' || u.searchParams.get('action') === 'balance'))).toBe(false);
    expect(alchemyCalls().every((u) => u.hostname === 'eth-mainnet.g.alchemy.com')).toBe(true);
    expect(r.errors.join(' ')).not.toContain(ALCHEMY_KEY);
  });

  it('a network Alchemy refuses falls back to the explorer, and is not asked again for a while', async () => {
    vi.stubEnv('ALCHEMY_API_KEY', ALCHEMY_KEY);
    alchemy['arb-mainnet'] = 403;
    chains['42161'] = { txs: Array.from({ length: 25 }, (_, i) => received(100 - i)), nonce: 4 };
    const r = await read();
    expect(chain(r, 'arbitrum')?.txCount).toBe(4);
    expect(explorerCalls('42161').some((u) => u.searchParams.get('action') === 'eth_getTransactionCount')).toBe(true);
    calls = [];
    await read();
    expect(alchemyCalls().some((u) => u.hostname === 'arb-mainnet.g.alchemy.com')).toBe(false);
  });
});

describe('activity is a fact, apart from the verdict', () => {
  it('checkWallet reads no activity at all: no history calls, an empty activity field', async () => {
    chains['1'] = { txs: [sent(3, 0)] };
    const r = await checkWallet(ADDR);
    expect(historyCalls()).toEqual([]);
    expect(r.activity).toMatchObject({ firstSeen: null, lastActivity: null, txCount: null, ethBalance: null });
    expect(r.errors.filter((e) => /activity/i.test(e))).toEqual([]);
  });

  it('a brand-new wallet gets the note; an old one does not', async () => {
    chains['1'] = { txs: [sent(3, 0)] };
    const fresh = await read();
    expect(showNewWalletNote(fresh.activity)).toBe(true);

    chains['1'] = { txs: [sent(400, 0)] };
    const old = await read();
    expect(showNewWalletNote(old.activity)).toBe(false);
  });

  it('age does not move the score or the level: new, old and unreadable wallets with no flags are all the same', async () => {
    const verdicts = [];
    for (const setup of [
      () => { chains['1'] = { txs: [sent(2, 0)] }; },
      () => { chains['1'] = { txs: [sent(900, 0)] }; },
      () => { for (const id of ['1', '137', '42161', '43114']) chains[id] = { http: 500 }; },
    ]) {
      chains = {};
      setup();
      verdicts.push(await checkWallet(ADDR));
    }
    const [fresh] = verdicts;
    for (const r of verdicts) {
      expect(r.scamLevel).toBe('clean');
      expect(r.scamScore).toBe(0);
      expect(r.flags).toEqual(fresh.flags);
      expect(r.partialCoverage).toBe(fresh.partialCoverage);
      expect(r.errors).toEqual(fresh.errors);
    }
  });

  it('with a caution flag, a new wallet scores exactly what an old one does', async () => {
    goplus = { ...goplus, mixer: '1' };
    chains['1'] = { txs: [sent(2, 0)] };
    const fresh = await checkWallet(ADDR);
    chains['1'] = { txs: [sent(900, 0)] };
    const old = await checkWallet(ADDR);
    expect(fresh.scamLevel).toBe('caution');
    expect(fresh.scamLevel).toBe(old.scamLevel);
    expect(fresh.scamScore).toBe(old.scamScore);
    expect(fresh.scamScore).toBe(calculateScamScore(fresh.flags).score);
  });
});

describe('the contract-name lookup (it can identify a mixer) never fails silently', () => {
  it('an answer, also an empty name for a plain address, is no error', async () => {
    const r = await checkWallet(ADDR);
    expect(r.errors).not.toContain(CONTRACT_NAME_UNAVAILABLE);
  });

  it.each([
    ['a rate-limit answer', RATE_LIMITED],
    ['a non-list answer', { status: '1', message: 'OK', result: 'unexpected' }],
  ])('%s is reported, so the "checks unavailable" banner shows', async (_name, body) => {
    sourceCode = body;
    const r = await checkWallet(ADDR);
    expect(r.errors).toContain(CONTRACT_NAME_UNAVAILABLE);
    expect(r.entityLabel).toBeNull();
  });

  it('with no Etherscan key the name is not checked, and that is reported too', async () => {
    vi.stubEnv('ETHERSCAN_API_KEY', '');
    const r = await checkWallet(ADDR);
    expect(r.errors).toContain(CONTRACT_NAME_UNAVAILABLE);
  });

  it('a named contract is labeled, with no error', async () => {
    sourceCode = { status: '1', message: 'OK', result: [{ ContractName: 'TornadoProxy' }] };
    const r = await checkWallet(ADDR);
    expect(r.errors).not.toContain(CONTRACT_NAME_UNAVAILABLE);
    expect(r.flags.mixer).toBe(true);
  });
});

describe('showNewWalletNote and summarizeChains', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z');
  const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
  const c = (over: Partial<ActivityChain>): ActivityChain =>
    ({ id: 'x', name: 'X', checked: true, firstSeen: null, lastActivity: null, txCount: 0, ...over });
  const act = (chainsIn: ActivityChain[]): WalletActivity =>
    ({ totalReceivedEth: null, totalSentEth: null, ethBalance: null, ...summarizeChains(chainsIn, 'sent') });

  it('needs at least one chain actually read', () => {
    const a = act([c({ checked: false, reason: 'unavailable' })]);
    // Even a stray date is ignored when nothing was read.
    expect(showNewWalletNote({ ...a, firstSeen: ago(1) }, NOW)).toBe(false);
  });

  it('is shown under 30 days and not at 30 days or more', () => {
    expect(showNewWalletNote(act([c({ firstSeen: ago(29.9), lastActivity: ago(1) })]), NOW)).toBe(true);
    expect(showNewWalletNote(act([c({ firstSeen: ago(30), lastActivity: ago(1) })]), NOW)).toBe(false);
  });

  it('is not shown from a capped read (the first activity may be older)', () => {
    const a = act([c({ firstSeen: ago(2), lastActivity: ago(1), firstSeenComplete: false })]);
    expect(showNewWalletNote(a, NOW)).toBe(false);
    expect(a.firstSeenComplete).toBe(false);
  });

  it.each(['unavailable', 'not_configured', undefined] as const)(
    'is not shown while a chain with a source is unread (reason %s)', (reason) => {
      const a = act([
        c({ id: 'p', name: 'Polygon', firstSeen: ago(5), lastActivity: ago(1), txCount: 1 }),
        c({ id: 'e', name: 'Ethereum', checked: false, reason, txCount: null }),
      ]);
      expect(a.firstSeen).toBe(ago(5));
      expect(a.firstSeenComplete).toBe(false);
      expect(a.lastActivityComplete).toBe(false);
      expect(a.txCountIsMinimum).toBe(true);
      expect(showNewWalletNote(a, NOW)).toBe(false);
    },
  );

  it.each(['no_source', 'not_on_plan'] as const)('is still shown when the only unread chains are not covered (%s)', (reason) => {
    const a = act([
      c({ id: 'e', name: 'Ethereum', firstSeen: ago(10), lastActivity: ago(3), txCount: 2 }),
      c({ id: 'p', name: 'Polygon', firstSeen: ago(5), lastActivity: ago(1), txCount: 1 }),
      c({ id: 'b', name: 'Base', checked: false, reason, txCount: null }),
    ]);
    expect(a.firstSeenChain).toBe('Ethereum');
    expect(a.lastActivityChain).toBe('Polygon');
    expect(a.txCount).toBe(3);
    expect(a.txCountIsMinimum).toBe(false);
    expect(a.firstSeenComplete).toBe(true);
    expect(showNewWalletNote(a, NOW)).toBe(true);
  });

  it('falls back to the single firstSeen on a result from before the per-chain fields', () => {
    const legacy: WalletActivity = { firstSeen: ago(3), lastActivity: ago(1), txCount: null, totalReceivedEth: null, totalSentEth: null, ethBalance: null };
    expect(showNewWalletNote(legacy, NOW)).toBe(true);
  });
});

describe('readExplorerList: only a real answer counts as a history', () => {
  it.each([
    [{ status: '1', message: 'OK', result: [{ timeStamp: '1' }] }, 1],
    [{ status: '0', message: 'No transactions found', result: [] }, 0],
    [{ status: '0', message: 'No token transfers found', result: [] }, 0],
    [{ status: '1', message: 'OK', result: [] }, 0],
  ])('%j reads as %i rows', (body, rows) => {
    expect(readExplorerList(body)).toHaveLength(rows);
  });

  it.each([
    [{ status: '0', message: 'NOTOK', result: 'Free API access is not supported for this chain' }],
    [{ status: '0', message: 'NOTOK', result: 'Max rate limit reached' }],
    [{ status: '0', message: 'NOTOK', result: [] }],
    [{ status: '0', message: 'chain not supported', result: null }],
    [null],
  ])('%j is not a history', (body) => {
    expect(() => readExplorerList(body)).toThrow();
  });

  it('sorts refusals that will repeat from failures that may pass', () => {
    expect(classifyExplorerError(FREE_PLAN)).toBe('not_on_plan');
    expect(classifyExplorerError({ status: '0', message: 'NOTOK', result: 'Invalid API Key (#err2)|x' })).toBe('not_configured');
    expect(classifyExplorerError(RATE_LIMITED)).toBe('unavailable');
    expect(classifyExplorerError(null)).toBe('unavailable');
  });
});

describe('Sui transaction count', () => {
  const SUI_ADDR = `0x${'ab'.repeat(32)}`;
  const tx = (digest: string, daysAgo: number) => ({ digest, timestampMs: String(Date.now() - daysAgo * 86_400_000) });

  function suiFetch(to: { data: unknown[]; hasNextPage: boolean }, from: { data: unknown[]; hasNextPage: boolean }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://fullnode.mainnet.sui.io')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const result =
          body.method === 'suix_queryTransactionBlocks' ? (body.params[0].filter.ToAddress ? to : from)
          : body.method === 'suix_getBalance' ? { totalBalance: '2000000000' }
          : body.method === 'suix_getAllBalances' ? []
          : null;
        return json({ jsonrpc: '2.0', id: 1, result });
      }
      if (url.includes('coingecko')) return json({ sui: { usd: 1 } });
      return new Response('not found', { status: 404 });
    });
  }

  it('counts each transaction once (a self-send is in both lists)', async () => {
    const first = tx('a', 40);
    const self = tx('self', 10);
    vi.stubGlobal('fetch', suiFetch(
      { data: [first, tx('b', 20), self], hasNextPage: false },
      { data: [self, tx('c', 5)], hasNextPage: false },
    ));
    const r = await fetchWalletActivity(SUI_ADDR);
    expect(r.chain).toBe('sui');
    expect(r.activity.txCount).toBe(4);
    expect(r.activity.txCountBasis).toBe('all');
    expect(r.activity.txCountIsMinimum).toBe(false);
    expect(r.activity.firstSeen).toBe(new Date(Number(first.timestampMs)).toISOString());
    expect(r.activity.ethBalance).toBe('2 SUI');
    expect(showNewWalletNote(r.activity)).toBe(false);
  });

  it('a capped read is a minimum and never claims a new wallet', async () => {
    vi.stubGlobal('fetch', suiFetch(
      { data: Array.from({ length: 50 }, (_, i) => tx(`t${i}`, 2)), hasNextPage: true },
      { data: [tx('f', 1)], hasNextPage: false },
    ));
    const r = await fetchWalletActivity(SUI_ADDR);
    expect(r.activity.txCount).toBe(51);
    expect(r.activity.txCountIsMinimum).toBe(true);
    expect(r.activity.chains?.[0]).toMatchObject({ id: 'sui', checked: true, firstSeenComplete: false });
    expect(showNewWalletNote(r.activity)).toBe(false);
  });
});

describe('<WalletActivityPanel>', () => {
  type PanelProps = { activity: WalletActivity | null; status?: 'loading' | 'failed'; chain: string; c: typeof en.checker; now?: number };
  let Panel: (p: PanelProps) => React.ReactElement;
  beforeAll(async () => {
    (globalThis as any).React = React;
    Panel = (await import('../../src/components/WalletActivityPanel')).default as any;
  });
  const render = (activity: WalletActivity | null, c = en.checker, extra: Partial<PanelProps> = {}) =>
    renderToStaticMarkup(React.createElement(Panel, { activity, chain: 'evm', c, ...extra }));

  it('shows the caution note in amber, stating both sides, for a new wallet', async () => {
    chains['1'] = { txs: [sent(3, 0)] };
    const html = render((await read()).activity);
    expect(html).toContain('wallet-activity__note');
    expect(html).toContain(en.checker.newWalletNote);
    expect(html).not.toContain('🚩');
    expect(html).toContain('Not covered yet: Base, Optimism, BNB Chain');
    expect(html).not.toContain('Could not be read right now');
  });

  it('when nothing could be read: dashes, the unknown note, the unread chains listed apart, no new-wallet note', async () => {
    for (const id of ['1', '137', '42161', '43114']) chains[id] = { http: 500 };
    const html = render((await read()).activity);
    expect(html).not.toContain('wallet-activity__note');
    expect(html).not.toContain(en.checker.activityNoneFound);
    expect(html).toContain(en.checker.activityUnknownNote);
    expect(html).toContain('Could not be read right now: Ethereum, Polygon, Arbitrum, Avalanche');
    expect(html).toContain('Not covered yet: Base, Optimism, BNB Chain');
  });

  it('a read wallet with no history says "None found", not a dash', async () => {
    const html = render((await read()).activity);
    expect(html).toContain(en.checker.activityNoneFound);
    expect(html).not.toContain(en.checker.activityUnknownNote);
  });

  it('with one chain unread, an empty history is a dash and the count a minimum, never "None found" or 0', async () => {
    chains['42161'] = { body: RATE_LIMITED };
    const html = render((await read()).activity);
    expect(html).not.toContain(en.checker.activityNoneFound);
    expect(html).toContain('>0+<');
    expect(html).toContain('Could not be read right now: Arbitrum');
  });

  it('a date found while a chain is unread is "On or before"; a cut newest page makes the last "On or after"', async () => {
    chains['1'] = { txs: Array.from({ length: 12 }, (_, i) => sent(900 - i, i)), descBody: RATE_LIMITED };
    chains['42161'] = { body: RATE_LIMITED };
    const html = render((await read()).activity);
    expect(html).toContain('On or before ');
    expect(html).toContain('On or after ');
  });

  it('names the chain of the first activity ("on Polygon") and labels the count as sent', async () => {
    chains['137'] = { txs: [sent(90, 0), sent(80, 1)] };
    const html = render((await read()).activity);
    expect(html).toContain('on Polygon');
    expect(html).toContain(en.checker.txCount);
    expect(html).toContain('>2<');
  });

  it('French: per-chain counts and lists read right for one, with the French colon', async () => {
    chains['137'] = { txs: [sent(90, 0)] };
    chains['42161'] = { body: RATE_LIMITED };
    const html = render((await read()).activity, fr.checker);
    expect(html).toContain('envoyées : 1');
    expect(html).toContain('Lecture impossible pour le moment : Arbitrum');
    expect(html).toContain('sur Polygon');
  });

  it('Bitcoin and the other chains with no activity source: one line, no dashes, no explorer source line', () => {
    const html = render(null, en.checker, { chain: 'bitcoin' });
    expect(html).toContain(en.checker.activityNotAvailable);
    expect(html).not.toContain('—');
    expect(html).not.toContain('Etherscan');
  });

  it('while the activity request loads, and when it failed', () => {
    expect(render(null, en.checker, { status: 'loading' })).toContain(en.checker.activityLoading);
    const failed = render(null, en.checker, { status: 'failed' });
    expect(failed).toContain(en.checker.activityUnknownNote);
    expect(failed).not.toContain(en.checker.activityNoneFound);
  });

  // Base, Optimism and BNB Chain are never read, so the note and "None found" speak only
  // for the chains checked: a wallet with years on Base must not read as brand new.
  it('the note copy, EN exactly and translated in ES and FR, limited to the chains checked', () => {
    expect(en.checker.newWalletNote).toBe(
      'First activity found on the chains checked is less than 30 days old. New wallets are common in scams, and also for exchange deposit addresses.',
    );
    expect(es.checker.newWalletNote).toMatch(/^La primera actividad encontrada en las cadenas verificadas tiene menos de 30 días\. .*exchanges\.$/);
    expect(fr.checker.newWalletNote).toMatch(/^La première activité trouvée sur les chaînes vérifiées date de moins de 30 jours\. .*plateformes d’échange\.$/);
    expect(en.checker.activityNoneFound).toBe('None found on the chains checked');
    expect(es.checker.activityNoneFound).toBe('Ninguna en las cadenas verificadas');
    expect(fr.checker.activityNoneFound).toBe('Aucune sur les chaînes vérifiées');
  });

  it('the wallet-age card and FAQ state both sides, never "red flag", in every language', () => {
    for (const t of [en, es, fr]) {
      const ageCard = t.signals.walletCards.find((card) => card.icon === '📅')!;
      const ageFaq = t.faq.items.find((item) => /new wallet|billetera nueva|nouveau portefeuille/i.test(item.q))!;
      for (const text of [ageCard.body, ageFaq.a]) {
        expect(text).not.toMatch(/red flag|señal de alerta|signal d’alerte/i);
        expect(text).toMatch(/exchange|plateformes d’échange/);
      }
    }
  });
});
