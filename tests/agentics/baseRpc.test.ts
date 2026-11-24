import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TRANSFER_TOPIC,
  configuredUrl,
  createBaseRpcReader,
  decodeDecimals,
  decodeSymbol,
  readTransferLog,
  type BaseRpcOptions,
} from '../../src/lib/agentVault/baseRpc';
import { normalizeTransfers } from '../../src/lib/agentVault/transfers';
import { addr } from '../helpers/agentVault';

/**
 * The Base reader over a fake JSON-RPC node: a synthetic chain where block n is mined at
 * GENESIS + blockSeconds n, a table of logs, and token contracts that answer decimals() and
 * symbol(). No network. Every address, hash and amount is invented, except Base's public USDC
 * contract, which pricing knows by address.
 */

const GENESIS = Date.UTC(2026, 9, 1) / 1000;
const WALLET = addr(1);
const OTHER = addr(2);
const THIRD = addr(3);
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const OLD_TOKEN = `0x${'0dd'.padEnd(40, '0')}`; // answers symbol() as bytes32
const NO_DECIMALS = `0x${'dead'.padEnd(40, '0')}`; // reverts on decimals()

const hex = (n: number | bigint) => `0x${n.toString(16)}`;
const word = (n: number | bigint) => n.toString(16).padStart(64, '0');
const topic = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
const txHash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const abiString = (s: string) => {
  const bytes = Buffer.from(s, 'utf8').toString('hex');
  return `0x${word(32)}${word(bytes.length / 2)}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64 || 64, '0')}`;
};
const bytes32 = (s: string) => `0x${Buffer.from(s, 'utf8').toString('hex').padEnd(64, '0')}`;

interface FakeLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
  blockTimestamp?: string;
}

function transferLog(o: { block: number; hash: number; index: number; from: string; to: string; value: bigint; token?: string; withTime?: boolean }): FakeLog {
  return {
    address: o.token ?? USDC_BASE,
    topics: [TRANSFER_TOPIC, topic(o.from), topic(o.to)],
    data: `0x${word(o.value)}`,
    blockNumber: hex(o.block),
    transactionHash: txHash(o.hash),
    logIndex: hex(o.index),
    ...(o.withTime ? { blockTimestamp: hex(GENESIS + o.block * 2) } : {}),
  };
}

interface Node {
  latest: number;
  blockSeconds: (n: number) => number;
  logs: FakeLog[];
  /** The widest eth_getLogs window the node accepts. */
  maxRange: number;
  calls: Array<{ method: string; params: any[] }>;
  /** Return a Response-like answer to replace the node's own for this call. */
  intercept: ((method: string, params: any[], n: number) => { status: number; body: unknown } | 'hang' | 'throw' | null) | null;
  contracts: Record<string, { decimals?: string | 'revert'; symbol?: string | 'revert' }>;
}

let node: Node;

function makeNode(): Node {
  return {
    latest: 100_000,
    blockSeconds: (n) => GENESIS + n * 2,
    logs: [],
    maxRange: 10_000,
    calls: [],
    intercept: null,
    contracts: {
      [USDC_BASE]: { decimals: `0x${word(6)}`, symbol: abiString('USDC') },
      [OLD_TOKEN]: { decimals: `0x${word(18)}`, symbol: bytes32('OLD') },
      [NO_DECIMALS]: { decimals: 'revert', symbol: abiString('SPAM') },
    },
  };
}

const ok = (result: unknown) => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result } });
const rpcError = (code: number, message: string, status = 200) => ({ status, body: { jsonrpc: '2.0', id: 1, error: { code, message } } });

function answer(method: string, params: any[]): { status: number; body: unknown } {
  if (method === 'eth_getBlockByNumber') {
    const n = params[0] === 'latest' ? node.latest : Number.parseInt(params[0], 16);
    if (n > node.latest) return ok(null);
    return ok({ number: hex(n), timestamp: hex(node.blockSeconds(n)), hash: txHash(n) });
  }
  if (method === 'eth_getLogs') {
    const f = params[0];
    const from = Number.parseInt(f.fromBlock, 16);
    const to = Number.parseInt(f.toBlock, 16);
    if (to - from + 1 > node.maxRange) return rpcError(-32602, `query exceeds max block range ${node.maxRange}`);
    const [t0, t1, t2] = f.topics as Array<string | null>;
    return ok(
      node.logs.filter((l) => {
        const b = Number.parseInt(l.blockNumber, 16);
        return b >= from && b <= to && l.topics[0] === t0 && (t1 == null || l.topics[1] === t1) && (t2 == null || l.topics[2] === t2);
      }),
    );
  }
  if (method === 'eth_call') {
    const { to, data } = params[0];
    const c = node.contracts[to];
    const field = data === '0x313ce567' ? c?.decimals : data === '0x95d89b41' ? c?.symbol : undefined;
    if (!c || field === undefined) return ok('0x');
    if (field === 'revert') return rpcError(3, 'execution reverted');
    return ok(field);
  }
  return rpcError(-32601, 'method not found');
}

const fakeFetch = (async (_url: string, init: RequestInit) => {
  const { method, params } = JSON.parse(String(init.body));
  node.calls.push({ method, params });
  const forced = node.intercept?.(method, params, node.calls.length);
  if (forced === 'throw') throw new Error('connection reset');
  if (forced === 'hang') {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }
  const r = forced ?? answer(method, params);
  return { status: r.status, text: async () => JSON.stringify(r.body) } as Response;
}) as unknown as typeof fetch;

const sleeps: number[] = [];
let clock = 0;
const reader = (over: BaseRpcOptions = {}) =>
  createBaseRpcReader({
    url: 'https://rpc.test',
    fetch: fakeFetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    timeoutMs: 20,
    ...over,
  });

const q = (over: Partial<{ address: string; startBlock: number; endBlock: number; page: number; offset: number }> = {}) => ({
  address: WALLET, startBlock: 1_000, endBlock: 9_000, page: 1, offset: 1_000, ...over,
});
const getLogs = () => node.calls.filter((c) => c.method === 'eth_getLogs');

beforeEach(() => {
  node = makeNode();
  sleeps.length = 0;
  clock = 1_000_000;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('decoding', () => {
  it('reads an ERC-20 Transfer log, lowercase, with the amount as a decimal string', () => {
    const t = readTransferLog(transferLog({ block: 10, hash: 1, index: 3, from: WALLET, to: OTHER, value: 1_234_567n }));
    expect(t).toEqual({ hash: txHash(1), blockNumber: 10, logIndex: 3, timeStamp: null, token: USDC_BASE, from: WALLET, to: OTHER, value: '1234567' });
  });

  it('takes the block time from the log when the node gives it', () => {
    expect(readTransferLog(transferLog({ block: 10, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n, withTime: true }))?.timeStamp).toBe(GENESIS + 20);
  });

  it('skips what is not a standard ERC-20 transfer: four topics (ERC-721), a short amount, a removed log, another event', () => {
    const base = transferLog({ block: 10, hash: 1, index: 0, from: WALLET, to: OTHER, value: 5n });
    expect(readTransferLog({ ...base, topics: [...base.topics, `0x${word(7)}`], data: '0x' })).toBeNull();
    expect(readTransferLog({ ...base, data: '0x01' })).toBeNull();
    expect(readTransferLog({ ...base, removed: true })).toBeNull();
    expect(readTransferLog({ ...base, topics: [`0x${'11'.repeat(32)}`, base.topics[1], base.topics[2]] })).toBeNull();
    expect(readTransferLog({ ...base, transactionHash: '0x12' })).toBeNull();
    expect(readTransferLog(null)).toBeNull();
  });

  it('decimals() must be a 32-byte number of at most 255', () => {
    expect(decodeDecimals(`0x${word(6)}`)).toBe(6);
    expect(decodeDecimals('0x')).toBeNull();
    expect(decodeDecimals(`0x${word(256)}`)).toBeNull();
    expect(decodeDecimals(null)).toBeNull();
  });

  it('symbol() as an ABI string or as bytes32', () => {
    expect(decodeSymbol(abiString('USDC'))).toBe('USDC');
    expect(decodeSymbol(abiString('A'.repeat(40)))).toBe('A'.repeat(40));
    expect(decodeSymbol(bytes32('MKR'))).toBe('MKR');
    expect(decodeSymbol('0x')).toBe('');
    expect(decodeSymbol('nonsense')).toBe('');
    expect(decodeSymbol(`0x${word(999)}${word(4)}`)).toBe(''); // an offset past the end
  });

  it('BASE_RPC_URL overrides the public endpoint only with an http(s) address', () => {
    expect(configuredUrl('https://node.example/rpc')).toBe('https://node.example/rpc');
    expect(configuredUrl('http://localhost:8545')).toBe('http://localhost:8545');
    expect(configuredUrl('')).toBe('https://mainnet.base.org');
    expect(configuredUrl(undefined)).toBe('https://mainnet.base.org');
    expect(configuredUrl('javascript:alert(1)')).toBe('https://mainnet.base.org');
  });
});

describe('token transfers as tokentx rows', () => {
  it('asks once with the wallet as sender and once as receiver, and builds rows the normalizer reads', async () => {
    node.logs.push(
      transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 2_500_000n }),
      transferLog({ block: 1_500, hash: 2, index: 4, from: THIRD, to: WALLET, value: 1_000_000n }),
      transferLog({ block: 1_600, hash: 3, index: 0, from: THIRD, to: OTHER, value: 9n }), // not the wallet's
    );
    const rows = await reader().tokenTransfers(q());
    expect(rows).toEqual([
      { hash: txHash(2), blockNumber: '1500', logIndex: '4', timeStamp: String(GENESIS + 3_000), from: THIRD, to: WALLET, value: '1000000', contractAddress: USDC_BASE, tokenDecimal: '6', tokenSymbol: 'USDC' },
      { hash: txHash(1), blockNumber: '2000', logIndex: '0', timeStamp: String(GENESIS + 4_000), from: WALLET, to: OTHER, value: '2500000', contractAddress: USDC_BASE, tokenDecimal: '6', tokenSymbol: 'USDC' },
    ]);
    const topics = getLogs().map((c) => c.params[0].topics);
    expect(topics[0]).toEqual([TRANSFER_TOPIC, topic(WALLET)]);
    expect(topics.at(-1)).toEqual([TRANSFER_TOPIC, null, topic(WALLET)]);

    const { transfers, unreadable } = normalizeTransfers('base', WALLET, 'tokentx', rows!);
    expect(unreadable).toBe(0);
    expect(transfers.map((t) => [t.direction, t.counterparty, t.amount, t.asset, t.assetContract])).toEqual([
      ['in', THIRD, '1', 'USDC', USDC_BASE],
      ['out', OTHER, '2.5', 'USDC', USDC_BASE],
    ]);
  });

  it('reads the range in windows of at most 2,000 blocks, edge to edge', async () => {
    await reader().tokenTransfers(q({ startBlock: 1_000, endBlock: 5_500 }));
    const ranges = getLogs().slice(0, 3).map((c) => [Number.parseInt(c.params[0].fromBlock, 16), Number.parseInt(c.params[0].toBlock, 16)]);
    expect(ranges).toEqual([[1_000, 2_999], [3_000, 4_999], [5_000, 5_500]]);
    expect(getLogs()).toHaveLength(6);
  });

  it('halves the window when the node refuses it as too wide, and keeps reading', async () => {
    node.maxRange = 600;
    node.logs.push(transferLog({ block: 2_900, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n }));
    const rows = await reader().tokenTransfers(q({ startBlock: 1_000, endBlock: 3_000 }));
    expect(rows?.map((r) => r.hash)).toEqual([txHash(1)]);
    const widths = getLogs().map((c) => Number.parseInt(c.params[0].toBlock, 16) - Number.parseInt(c.params[0].fromBlock, 16) + 1);
    expect(widths.slice(0, 3)).toEqual([2_000, 1_000, 500]);
    expect(Math.max(...widths.slice(2))).toBeLessThanOrEqual(600); // and stays narrow, the receiving side too
  });

  it('keeps one row for a log both queries find (a send to itself), and sorts by block, then log index', async () => {
    node.logs.push(
      transferLog({ block: 3_000, hash: 9, index: 7, from: WALLET, to: WALLET, value: 5n }),
      transferLog({ block: 3_000, hash: 9, index: 2, from: OTHER, to: WALLET, value: 6n }),
      transferLog({ block: 2_000, hash: 8, index: 9, from: WALLET, to: OTHER, value: 7n }),
    );
    const rows = await reader().tokenTransfers(q());
    expect(rows?.map((r) => [r.blockNumber, r.logIndex])).toEqual([['2000', '9'], ['3000', '2'], ['3000', '7']]);
  });

  it('skips ERC-721 transfers (four topics) that share the event signature', async () => {
    node.logs.push({ ...transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 0n }), topics: [TRANSFER_TOPIC, topic(WALLET), topic(OTHER), `0x${word(42)}`], data: '0x' });
    expect(await reader().tokenTransfers(q())).toEqual([]);
  });

  it('a range with nothing in it is an empty list, not a failure', async () => {
    expect(await reader().tokenTransfers(q())).toEqual([]);
  });

  it('reads each block time once, each token once, and takes the time from the log when it is there', async () => {
    node.logs.push(
      transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n }),
      transferLog({ block: 2_000, hash: 1, index: 1, from: WALLET, to: THIRD, value: 1n }),
      transferLog({ block: 2_500, hash: 2, index: 0, from: OTHER, to: WALLET, value: 1n, withTime: true }),
    );
    const rows = await reader().tokenTransfers(q());
    expect(rows?.map((r) => r.timeStamp)).toEqual([String(GENESIS + 4_000), String(GENESIS + 4_000), String(GENESIS + 5_000)]);
    expect(node.calls.filter((c) => c.method === 'eth_getBlockByNumber').map((c) => c.params[0])).toEqual([hex(2_000)]);
    expect(node.calls.filter((c) => c.method === 'eth_call')).toHaveLength(2); // decimals and symbol, once
  });

  it('a bytes32 symbol is read, and a token whose decimals() reverts goes out without decimals (unreadable, never guessed)', async () => {
    node.logs.push(
      transferLog({ block: 2_000, hash: 1, index: 0, from: OTHER, to: WALLET, value: 10n ** 18n, token: OLD_TOKEN }),
      transferLog({ block: 2_100, hash: 2, index: 0, from: OTHER, to: WALLET, value: 1n, token: NO_DECIMALS }),
    );
    const rows = await reader().tokenTransfers(q());
    expect(rows?.map((r) => [r.tokenSymbol, r.tokenDecimal])).toEqual([['OLD', '18'], ['SPAM', '']]);
    const { transfers, unreadable } = normalizeTransfers('base', WALLET, 'tokentx', rows!);
    expect(transfers.map((t) => [t.asset, t.amount])).toEqual([['OLD', '1']]);
    expect(unreadable).toBe(1);
  });

  it('pages are slices of one scan: the second page does not read the chain again', async () => {
    for (let i = 0; i < 5; i += 1) node.logs.push(transferLog({ block: 2_000 + i, hash: i + 1, index: 0, from: WALLET, to: OTHER, value: 1n }));
    const r = reader();
    const first = await r.tokenTransfers(q({ offset: 2 }));
    const callsAfterFirst = node.calls.length;
    const second = await r.tokenTransfers(q({ offset: 2, page: 2 }));
    const third = await r.tokenTransfers(q({ offset: 2, page: 3 }));
    expect([first, second, third].map((p) => p?.map((x) => x.blockNumber))).toEqual([['2000', '2001'], ['2002', '2003'], ['2004']]);
    expect(node.calls.length).toBe(callsAfterFirst);
  });

  it('a scan is read again once it is older than the cache allows', async () => {
    const r = reader();
    await r.tokenTransfers(q());
    const n = getLogs().length;
    clock += 6 * 60_000;
    await r.tokenTransfers(q());
    expect(getLogs().length).toBe(2 * n);
  });

  it('a wallet that is not an address, or a nonsense page, is null', async () => {
    expect(await reader().tokenTransfers(q({ address: 'nope' }))).toBeNull();
    expect(await reader().tokenTransfers(q({ page: 0 }))).toBeNull();
    expect(node.calls).toEqual([]);
  });
});

describe('what could not be read is null, never an empty list', () => {
  it('an RPC error on the logs', async () => {
    node.intercept = (m) => (m === 'eth_getLogs' ? rpcError(-32000, 'internal failure') : null);
    expect(await reader().tokenTransfers(q())).toBeNull();
  });

  it('a range error at one block wide', async () => {
    node.maxRange = 0;
    expect(await reader().tokenTransfers(q({ startBlock: 1_000, endBlock: 1_010 }))).toBeNull();
  });

  it('a rate limit that does not lift, after the retries, with a growing pause', async () => {
    node.intercept = (m) => (m === 'eth_getLogs' ? rpcError(-32011, 'request limit reached', 429) : null);
    expect(await reader({ backoffMs: 100 }).tokenTransfers(q())).toBeNull();
    expect(getLogs()).toHaveLength(3);
    // The retry pauses (100, then 200) among the gate's own spacing.
    expect(sleeps.indexOf(100)).toBeGreaterThanOrEqual(0);
    expect(sleeps.indexOf(200)).toBeGreaterThan(sleeps.indexOf(100));
  });

  it('a rate limit or a server error that lifts is retried and read', async () => {
    let failures = 2;
    node.intercept = (m) => (m === 'eth_getLogs' && failures-- > 0 ? (failures ? { status: 503, body: 'busy' } : rpcError(-32011, 'request limit reached', 429)) : null);
    node.logs.push(transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n }));
    expect((await reader().tokenTransfers(q()))?.length).toBe(1);
  });

  it('a dropped connection is retried; one that stays down is null', async () => {
    node.intercept = (m) => (m === 'eth_getLogs' ? 'throw' : null);
    expect(await reader().tokenTransfers(q())).toBeNull();
    expect(getLogs()).toHaveLength(3);
  });

  it('a node that never answers times out and is null, without hanging', async () => {
    node.intercept = (m) => (m === 'eth_getLogs' ? 'hang' : null);
    expect(await reader({ attempts: 1 }).tokenTransfers(q())).toBeNull();
  });

  it('a block time that cannot be read', async () => {
    node.logs.push(transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n }));
    node.intercept = (m) => (m === 'eth_getBlockByNumber' ? rpcError(-32000, 'header not found') : null);
    expect(await reader().tokenTransfers(q())).toBeNull();
  });

  it('a token whose decimals() call fails (not a revert: the node did not answer)', async () => {
    node.logs.push(transferLog({ block: 2_000, hash: 1, index: 0, from: WALLET, to: OTHER, value: 1n }));
    node.intercept = (m) => (m === 'eth_call' ? { status: 502, body: 'bad gateway' } : null);
    expect(await reader().tokenTransfers(q())).toBeNull();
  });

  it('a scan that runs past its time budget', async () => {
    expect(await reader({ scanBudgetMs: 1_000, minGapMs: 400 }).tokenTransfers(q({ startBlock: 0, endBlock: 90_000 }))).toBeNull();
    expect(getLogs().length).toBeLessThan(10);
  });

  it('a failed scan is not kept: the next ask reads again', async () => {
    let down = true;
    node.intercept = (m) => (m === 'eth_getLogs' && down ? rpcError(-32000, 'internal failure') : null);
    const r = reader();
    expect(await r.tokenTransfers(q())).toBeNull();
    down = false;
    expect(await r.tokenTransfers(q())).toEqual([]);
  });
});

describe('pacing', () => {
  it('starts calls at least the minimum gap apart, even when asked together', async () => {
    // The clock stands still, so each call's wait is exactly how far after the first its start was booked.
    const waits: number[] = [];
    const r = createBaseRpcReader({ url: 'https://rpc.test', fetch: fakeFetch, now: () => clock, sleep: async (ms) => void waits.push(ms), minGapMs: 250 });
    await Promise.all([r.blockAt(GENESIS + 10), r.blockAt(GENESIS + 5_000), r.blockAt(GENESIS + 9_000)]);
    const calls = node.calls.length;
    expect(waits).toEqual(Array.from({ length: calls - 1 }, (_, i) => 250 * (i + 1)));
  });

  it('books a gap between consecutive calls', async () => {
    await reader({ minGapMs: 250 }).tokenTransfers(q({ startBlock: 1_000, endBlock: 1_100 }));
    expect(getLogs()).toHaveLength(2);
    expect(sleeps).toContain(250);
  });
});

describe('blockAt: the block mined at or before a time', () => {
  it('lands on the block from the two-second guess and checks the next one', async () => {
    const r = reader();
    expect(await r.blockAt(GENESIS + 4_001)).toBe(2_000);
    expect(await r.blockAt(GENESIS + 4_000)).toBe(2_000);
    expect(node.calls.filter((c) => c.method === 'eth_getBlockByNumber').length).toBeLessThanOrEqual(6);
  });

  it('corrects the guess when blocks were not two seconds apart', async () => {
    // One-second blocks up to 50,000, two-second blocks after: the first guess is far off.
    node.blockSeconds = (n) => (n <= 50_000 ? GENESIS + n : GENESIS + 50_000 + (n - 50_000) * 2);
    const r = reader();
    expect(await r.blockAt(GENESIS + 30_000)).toBe(30_000);
    const t = GENESIS + 50_000 + 2 * 20_000 + 1; // between blocks 70,000 and 70,001
    expect(await r.blockAt(t)).toBe(70_000);
    expect(node.calls.filter((c) => c.method === 'eth_getBlockByNumber').length).toBeLessThanOrEqual(2 * 13);
  });

  it('a time after the newest block is the newest block', async () => {
    expect(await reader().blockAt(GENESIS + 10_000_000)).toBe(node.latest);
  });

  it('a time before the first block is block 0', async () => {
    expect(await reader().blockAt(GENESIS - 100)).toBe(0);
  });

  it('remembers an answer for a past time', async () => {
    const r = reader();
    await r.blockAt(GENESIS + 4_001);
    const n = node.calls.length;
    expect(await r.blockAt(GENESIS + 4_001)).toBe(2_000);
    expect(node.calls.length).toBe(n);
  });

  it('is null when a header cannot be read, and that is not remembered', async () => {
    let down = true;
    node.intercept = (m) => (m === 'eth_getBlockByNumber' && down ? rpcError(-32000, 'header not found') : null);
    const r = reader();
    expect(await r.blockAt(GENESIS + 4_001)).toBeNull();
    down = false;
    expect(await r.blockAt(GENESIS + 4_001)).toBe(2_000);
  });

  it('is null for a time that is not a whole number of seconds', async () => {
    expect(await reader().blockAt(Number.NaN)).toBeNull();
    expect(node.calls).toEqual([]);
  });
});
