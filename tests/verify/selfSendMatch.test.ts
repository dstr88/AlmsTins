import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The EVM path reads through '@/lib/etherscan' (API keys, throttle, cache). Stub it with
// a URL builder that keeps the query readable plus a request fn each test routes, so the
// suite needs no network and no keys. Esplora and Solana go through global fetch, stubbed
// per test below.
const scan = vi.hoisted(() => ({ build: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/etherscan', () => ({
  CHAIN_IDS: { ethereum: 1, polygon: 137, avalanche: 43114 },
  buildEtherscanV2Url: scan.build,
  requestEtherscan: scan.request,
}));

import {
  detectBoundSelfSend,
  captureSelfSendBaseline,
  parseSelfSendBaseline,
  railNeedsBaseline,
  readEtherscanRows,
  evmRowVerdict,
  utxoTxVerdict,
  solanaTxVerdict,
  _resetSelfSendCaches,
  EVM_PAGE_SIZE,
  EVM_MAX_PAGES,
  ESPLORA_CHAIN_PAGE,
  SOL_SIG_PAGE,
  type SelfSendChallenge,
  type SelfSendBaseline,
} from '../../src/lib/verifyDeposit';

/**
 * Detection rule bound_v1: a transaction FROM the registered address TO that same
 * address for EXACTLY the challenge amount, inside [issued_at, expires_at] plus per-chain
 * slack. Anything else (a routine send, the wrong amount, another recipient, coins
 * arriving from elsewhere, a reverted or out-of-window tx) must not prove the address.
 * Explorer/RPC failures are 'unavailable', never 'not yet'.
 */

const ISSUED = 1_800_000_000; // epoch seconds
const EXPIRES = ISSUED + 24 * 60 * 60;
const NOW = ISSUED + 600;
// The slack the rule promises, pinned here as literals (not the module's constants).
const SLACK_ACCOUNT_S = 2 * 60; // EVM and Solana
const SLACK_UTXO_BLOCK_S = 2 * 60 * 60; // confirmed BTC/LTC block time

beforeEach(() => {
  _resetSelfSendCaches();
  scan.request.mockReset();
  scan.build.mockReset();
  scan.build.mockImplementation((chainId: number, params: Record<string, string | number>) => {
    const q = new URLSearchParams({ chainid: String(chainId) });
    for (const [k, v] of Object.entries(params)) q.set(k, String(v));
    return `https://scan.test/api?${q.toString()}`;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── EVM ──────────────────────────────────────────────────────────────────────

const EVM = '0xAbCdEf0000000000000000000000000000001234'; // registered as typed (mixed case)
const EVM_LC = EVM.toLowerCase();
const EVM_OTHER = '0x9999999999999999999999999999999999999999';
const WEI = 1234n * 10n ** 10n; // 0.00001234 ETH

const evmCh = (o: Partial<SelfSendChallenge> = {}): SelfSendChallenge => ({
  rail: 'ethereum', address: EVM, expected: WEI, issuedAt: ISSUED, expiresAt: EXPIRES, ...o,
});
const evmRow = (o: Record<string, string> = {}) => ({
  hash: '0xhash', from: EVM_LC, to: EVM_LC, value: WEI.toString(),
  isError: '0', txreceipt_status: '1', timeStamp: String(ISSUED + 300), ...o,
});
const okRows = (rows: unknown[]) => ({ status: '1', message: 'OK', result: rows });
const NO_TX = { status: '0', message: 'No transactions found', result: [] };
const filler = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => evmRow({ hash: `${prefix}${i}`, from: EVM_OTHER, value: '5' })); // unrelated incoming

/** Route the stubbed explorer: getblocknobytime → block, txlist page N → pages[N-1]. */
function evmExplorer(pages: unknown[], block: unknown = { status: '1', message: 'OK', result: '19000000' }) {
  scan.request.mockImplementation(async (url: string) => {
    const q = new URL(url).searchParams;
    if (q.get('action') === 'getblocknobytime') return block;
    if (q.get('action') === 'txlist') return pages[Number(q.get('page')) - 1] ?? NO_TX;
    throw new Error(`unexpected ${url}`);
  });
}
const txlistCalls = () =>
  scan.request.mock.calls.map((c) => new URL(String(c[0])).searchParams).filter((q) => q.get('action') === 'txlist');

describe('bound_v1 EVM matcher', () => {
  it('passes: exact self-send (from == to == address, exact wei, not reverted)', async () => {
    evmExplorer([okRows([evmRow({ hash: '0xpass' })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: true, ref: '0xpass' });
    // Paged ascending from the block at the window start.
    const blockQ = new URL(String(scan.request.mock.calls[0][0])).searchParams;
    expect(blockQ.get('action')).toBe('getblocknobytime');
    expect(blockQ.get('timestamp')).toBe(String(ISSUED - SLACK_ACCOUNT_S));
    expect(blockQ.get('closest')).toBe('before');
    const [q] = txlistCalls();
    expect(q.get('address')).toBe(EVM_LC);
    expect(q.get('startblock')).toBe('19000000');
    expect(q.get('sort')).toBe('asc');
    expect(q.get('chainid')).toBe('1');
  });

  it('never caps the read below the chain: endblock is absent or far above any height', async () => {
    // Avalanche C-chain and Polygon pass block 100,000,000 in late 2026. A txlist capped at
    // 99999999 then returns [] for every read, so a valid test would read as not_yet forever.
    for (const rail of ['ethereum', 'polygon', 'avalanche']) {
      scan.request.mockReset();
      evmExplorer([okRows([evmRow({ hash: '0xhigh', blockNumber: '100000123' })])], { status: '1', message: 'OK', result: '100000000' });
      expect(await detectBoundSelfSend(evmCh({ rail }), NOW)).toEqual({ found: true, ref: '0xhigh' });
      for (const q of txlistCalls()) {
        const end = q.get('endblock');
        if (end !== null) expect(Number(end)).toBeGreaterThanOrEqual(1_000_000_000);
        expect(Number(q.get('startblock'))).toBe(100_000_000);
      }
    }
  });

  it('reads the registered rail (Polygon uses chainid 137)', async () => {
    evmExplorer([okRows([evmRow({ hash: '0xpoly' })])]);
    expect(await detectBoundSelfSend(evmCh({ rail: 'polygon' }), NOW)).toEqual({ found: true, ref: '0xpoly' });
    expect(txlistCalls()[0].get('chainid')).toBe('137');
  });

  it('fails: wrong amount (a routine send from the address is not the test)', async () => {
    evmExplorer([okRows([evmRow({ value: (WEI + 1n).toString() })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('fails: a token send or contract call (value 0) is wrong_amount', async () => {
    evmExplorer([okRows([evmRow({ to: EVM_OTHER, value: '0' })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('fails: exact amount to another address (to != self)', async () => {
    evmExplorer([okRows([evmRow({ to: EVM_OTHER })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'wrong_recipient' });
  });

  it('fails: incoming deposit of the exact amount (from another wallet)', async () => {
    evmExplorer([okRows([evmRow({ from: EVM_OTHER })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'sent_to_not_from' });
  });

  it('fails: before the window (beyond the 2-minute slack)', async () => {
    evmExplorer([okRows([evmRow({ timeStamp: String(ISSUED - SLACK_ACCOUNT_S - 1) })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('passes inside the 2-minute slack before issue', async () => {
    evmExplorer([okRows([evmRow({ hash: '0xslack', timeStamp: String(ISSUED - 60) })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: true, ref: '0xslack' });
  });

  it('fails: after expiry (beyond the slack)', async () => {
    evmExplorer([okRows([evmRow({ timeStamp: String(EXPIRES + SLACK_ACCOUNT_S + 1) })])]);
    expect(await detectBoundSelfSend(evmCh(), EXPIRES + 3600)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('fails: reverted (isError 1, or receipt status 0)', async () => {
    evmExplorer([okRows([evmRow({ isError: '1' }), evmRow({ txreceipt_status: '0' })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('a pass anywhere in the window beats earlier diagnostics', async () => {
    evmExplorer([okRows([evmRow({ to: EVM_OTHER }), evmRow({ hash: '0xlater', timeStamp: String(ISSUED + 900) })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: true, ref: '0xlater' });
  });

  it('pagination: finds the test beyond the first page', async () => {
    evmExplorer([okRows(filler(EVM_PAGE_SIZE, '0xf')), okRows([evmRow({ hash: '0xpage2' })])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: true, ref: '0xpage2' });
    expect(txlistCalls().map((q) => q.get('page'))).toEqual(['1', '2']);
  });

  it('pagination: stops at the page cap', async () => {
    const pages = Array.from({ length: EVM_MAX_PAGES }, (_, p) => okRows(filler(EVM_PAGE_SIZE, `0x${p}f`)));
    pages.push(okRows([evmRow({ hash: '0xtoofar' })]));
    evmExplorer(pages);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    expect(txlistCalls()).toHaveLength(EVM_MAX_PAGES);
  });

  it('pagination: stops once a page runs past the window end', async () => {
    const page1 = filler(EVM_PAGE_SIZE, '0xf');
    page1[page1.length - 1] = evmRow({ hash: '0xlate', from: EVM_OTHER, value: '5', timeStamp: String(EXPIRES + 9999) });
    evmExplorer([okRows(page1), okRows([evmRow()])]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    expect(txlistCalls()).toHaveLength(1);
  });

  it('error mapping: "No transactions found" is not_yet', async () => {
    evmExplorer([NO_TX]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('error mapping: NOTOK is unavailable, never not_yet', async () => {
    evmExplorer([{ status: '0', message: 'NOTOK', result: 'Max rate limit reached' }]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: a failure on a later page is unavailable', async () => {
    evmExplorer([okRows(filler(EVM_PAGE_SIZE, '0xf')), { status: '0', message: 'NOTOK', result: 'Query Timeout' }]);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: explorer throws (HTTP error / retries exhausted) is unavailable', async () => {
    scan.request.mockRejectedValue(new Error('etherscan HTTP 502'));
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: getblocknobytime failure is unavailable', async () => {
    evmExplorer([okRows([evmRow()])], { status: '0', message: 'NOTOK', result: 'Error! Invalid timestamp' });
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: missing explorer key is unavailable', async () => {
    scan.build.mockReturnValue(null);
    expect(await detectBoundSelfSend(evmCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
    expect(scan.request).not.toHaveBeenCalled();
  });

  it('readEtherscanRows: only an OK array or "No transactions found" count as a real answer', () => {
    expect(readEtherscanRows(okRows([1]))).toEqual([1]);
    expect(readEtherscanRows(NO_TX)).toEqual([]);
    expect(readEtherscanRows({ status: '0', message: 'NOTOK', result: 'Invalid API Key' })).toBeNull();
    expect(readEtherscanRows({ status: '0', message: 'NOTOK', result: [] })).toBeNull();
    expect(readEtherscanRows({ status: '1', message: 'OK', result: 'oops' })).toBeNull();
    expect(readEtherscanRows(null)).toBeNull();
  });

  it('evmRowVerdict: amounts compare as BigInt, never floats', () => {
    const w = { start: ISSUED, end: EXPIRES };
    // 2^53 + 1 wei is not representable as a double; a float compare would call these equal.
    const big = 9007199254740993n;
    expect(evmRowVerdict(evmRow({ value: '9007199254740992' }), EVM_LC, big, w)).toBe('wrong_amount');
    expect(evmRowVerdict(evmRow({ value: big.toString() }), EVM_LC, big, w)).toBe('pass');
  });
});

// ── Bitcoin / Litecoin (esplora) ─────────────────────────────────────────────

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_OTHER = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const SATS = 1234n;
const TIP = 900_000; // chain tip height when the amount was issued

const BASELINE: SelfSendBaseline = { tipHeight: TIP, mempool: [] };
const btcCh = (o: Partial<SelfSendChallenge> = {}): SelfSendChallenge => ({
  rail: 'bitcoin', address: BTC, expected: SATS, issuedAt: ISSUED, expiresAt: EXPIRES, baseline: BASELINE, ...o,
});
function btcTx(o: {
  txid?: string; confirmed?: boolean; blockTime?: number; height?: number;
  vin?: string[]; vout?: Array<[string, number]>;
} = {}) {
  const { txid = 'tx', confirmed = true, blockTime = ISSUED + 600, height = TIP + 1 } = o;
  const vin = o.vin ?? [BTC];
  const vout = o.vout ?? [[BTC, Number(SATS)], [BTC, 40_000]]; // the test output + change back to self
  return {
    txid,
    status: confirmed ? { confirmed: true, block_height: height, block_time: blockTime } : { confirmed: false },
    vin: vin.map((a) => ({ prevout: { scriptpubkey_address: a, value: 50_000 } })),
    vout: vout.map(([a, v]) => ({ scriptpubkey_address: a, value: v })),
  };
}

/** Stub esplora: mempool body, and /txs/chain pages keyed by the last-seen txid ('' = first). */
function esplora(routes: { mempool?: unknown; chain?: Record<string, unknown> }) {
  const fetchMock = vi.fn(async (url: string) => {
    const m = String(url).match(/\/address\/([^/]+)\/txs\/(mempool|chain)(?:\/([^/]+))?$/);
    if (!m) throw new Error(`unexpected ${url}`);
    const body = m[2] === 'mempool' ? (routes.mempool ?? []) : (routes.chain?.[m[3] ?? ''] ?? []);
    return typeof body === 'number' ? new Response('error', { status: body }) : json(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

describe('bound_v1 Bitcoin/Litecoin matcher (esplora)', () => {
  it('passes: exact self-send, confirmed (change back to self is fine)', async () => {
    const f = esplora({ chain: { '': [btcTx({ txid: 'pass' })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: true, ref: 'pass' });
    expect(urls(f)[0]).toBe(`https://blockstream.info/api/address/${BTC}/txs/mempool`);
  });

  it('passes: mempool, judged by our own first sighting (now) inside the window', async () => {
    esplora({ mempool: [btcTx({ txid: 'mem', confirmed: false })] });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: true, ref: 'mem' });
  });

  it('passes: a new mempool tx first seen after expiry but inside the 2h a block gets (the check grace)', async () => {
    esplora({ mempool: [btcTx({ txid: 'mem', confirmed: false })] });
    expect(await detectBoundSelfSend(btcCh(), EXPIRES + 60)).toEqual({ found: true, ref: 'mem' });
  });

  it('fails: a mempool tx first seen more than 2h after expiry', async () => {
    esplora({ mempool: [btcTx({ txid: 'mem', confirmed: false })] });
    expect(await detectBoundSelfSend(btcCh(), EXPIRES + SLACK_UTXO_BLOCK_S + 60)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('passes: confirmed block time up to 2h before issue (clock drift), in a block mined after issue', async () => {
    esplora({ chain: { '': [btcTx({ txid: 'early', blockTime: ISSUED - SLACK_UTXO_BLOCK_S + 60 })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: true, ref: 'early' });
  });

  it('fails: block time more than 2h before issue', async () => {
    esplora({ chain: { '': [btcTx({ blockTime: ISSUED - SLACK_UTXO_BLOCK_S - 60 })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('fails: block time more than 2h after expiry', async () => {
    esplora({ chain: { '': [btcTx({ blockTime: EXPIRES + SLACK_UTXO_BLOCK_S + 60 })] } });
    expect(await detectBoundSelfSend(btcCh(), EXPIRES + 3 * 3600)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('fails: wrong amount', async () => {
    esplora({ chain: { '': [btcTx({ vout: [[BTC, 1235], [BTC, 40_000]] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('fails: exact amount to another address (to != self)', async () => {
    esplora({ chain: { '': [btcTx({ vout: [[BTC_OTHER, 1234], [BTC, 40_000]] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'wrong_recipient' });
  });

  it('fails: exact output to the address, but inputs come from another address', async () => {
    esplora({ chain: { '': [btcTx({ vin: [BTC_OTHER], vout: [[BTC, 1234], [BTC_OTHER, 40_000]] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'sent_to_not_from' });
  });

  it('fails: change merged into the test output, so no output is exactly the amount', async () => {
    esplora({ chain: { '': [btcTx({ vout: [[BTC, 1234 + 40_000]] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('passes with mixed inputs, as long as one input is the address', async () => {
    esplora({ chain: { '': [btcTx({ txid: 'mixed', vin: [BTC_OTHER, BTC] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: true, ref: 'mixed' });
  });

  it('matches an address registered in uppercase bech32', async () => {
    const f = esplora({ chain: { '': [btcTx({ txid: 'upper' })] } });
    expect(await detectBoundSelfSend(btcCh({ address: BTC.toUpperCase() }), NOW)).toEqual({ found: true, ref: 'upper' });
    expect(urls(f)[0]).toContain(`/address/${BTC}/`);
  });

  it('pagination: pages /txs/chain back by last txid and finds the test on page 2', async () => {
    const page1 = Array.from({ length: ESPLORA_CHAIN_PAGE }, (_, i) =>
      btcTx({ txid: `p1-${i}`, blockTime: ISSUED + 5000 - i, vin: [BTC_OTHER], vout: [[BTC, 777]] }));
    const f = esplora({ chain: { '': page1, [`p1-${ESPLORA_CHAIN_PAGE - 1}`]: [btcTx({ txid: 'p2' })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: true, ref: 'p2' });
    expect(urls(f)).toContain(`https://blockstream.info/api/address/${BTC}/txs/chain/p1-${ESPLORA_CHAIN_PAGE - 1}`);
  });

  it('pagination: stops once a block time predates the window', async () => {
    const page1 = Array.from({ length: ESPLORA_CHAIN_PAGE }, (_, i) =>
      btcTx({ txid: `old-${i}`, blockTime: ISSUED - SLACK_UTXO_BLOCK_S - 10 - i, vin: [BTC_OTHER], vout: [[BTC, 777]] }));
    const f = esplora({ chain: { '': page1, [`old-${ESPLORA_CHAIN_PAGE - 1}`]: [btcTx()] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    expect(urls(f).filter((u) => u.includes('/txs/chain'))).toHaveLength(1);
  });

  it('error mapping: failed mempool or chain fetch is unavailable', async () => {
    esplora({ mempool: 503 });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
    esplora({ chain: { '': 500 } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
    esplora({ mempool: { error: 'not an array' } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: a failure on a later page is unavailable', async () => {
    const page1 = Array.from({ length: ESPLORA_CHAIN_PAGE }, (_, i) =>
      btcTx({ txid: `p1-${i}`, blockTime: ISSUED + 5000 - i, vin: [BTC_OTHER], vout: [[BTC, 777]] }));
    esplora({ chain: { '': page1, [`p1-${ESPLORA_CHAIN_PAGE - 1}`]: 502 } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: network error is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('Litecoin: reads litecoinspace and matches litoshis exactly', async () => {
    const LTC = 'ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n';
    const f = esplora({ chain: { '': [btcTx({ txid: 'ltc', vin: [LTC], vout: [[LTC, 123_400], [LTC, 9_000_000]] })] } });
    const ch = btcCh({ rail: 'litecoin', address: LTC, expected: 123_400n });
    expect(await detectBoundSelfSend(ch, NOW)).toEqual({ found: true, ref: 'ltc' });
    expect(urls(f)[0]).toBe(`https://litecoinspace.org/api/address/${LTC}/txs/mempool`);
  });

  it('utxoTxVerdict: an unrelated incoming payment says nothing', () => {
    expect(utxoTxVerdict(btcTx({ vin: [BTC_OTHER], vout: [[BTC, 777]] }), BTC, SATS)).toBeNull();
  });
});

describe('bound_v1 Bitcoin/Litecoin: nothing already on chain at issuance can prove the test', () => {
  // The reroll attack: an address-reusing wallet sent 4,321 sats of change back to the
  // address shortly BEFORE a squatter's amount was issued. If the squatter's amount happens
  // to be (or was rerolled to be) 4,321, that old change output has the exact shape of the
  // test: an input from the address and an exact output back to it.
  const CHANGE = 4_321n;
  const changeTx = (o: { txid?: string; confirmed?: boolean; blockTime?: number; height?: number } = {}) =>
    btcTx({ vout: [[BTC_OTHER, 150_000], [BTC, Number(CHANGE)]], ...o }); // paid a merchant, change back to self
  const squat = (o: Partial<SelfSendChallenge> = {}) => btcCh({ expected: CHANGE, ...o });

  it('the old change output IS the test shape (why a baseline is needed)', () => {
    expect(utxoTxVerdict(changeTx(), BTC, CHANGE)).toBe('pass');
  });

  it('fails: confirmed at or below the issuance tip, even inside the 2h block-time slack', async () => {
    esplora({ chain: { '': [changeTx({ txid: 'old', blockTime: ISSUED - 600, height: TIP })] } });
    expect(await detectBoundSelfSend(squat(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    esplora({ chain: { '': [changeTx({ txid: 'older', blockTime: ISSUED - 3600, height: TIP - 5 })] } });
    expect(await detectBoundSelfSend(squat(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('fails: in the mempool at issuance, however long it has sat there', async () => {
    esplora({ mempool: [changeTx({ txid: 'stuck', confirmed: false })] });
    const ch = squat({ baseline: { tipHeight: TIP, mempool: ['stuck'] } });
    expect(await detectBoundSelfSend(ch, NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('fails: in the mempool at issuance and confirmed after it (above the tip)', async () => {
    esplora({ chain: { '': [changeTx({ txid: 'stuck', blockTime: ISSUED + 900, height: TIP + 2 })] } });
    const ch = squat({ baseline: { tipHeight: TIP, mempool: ['stuck'] } });
    expect(await detectBoundSelfSend(ch, NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('a pre-issuance tx gives no hints either (it was never an attempt at the test)', async () => {
    esplora({ chain: { '': [btcTx({ txid: 'old', height: TIP, vout: [[BTC_OTHER, Number(SATS)]] })] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('still passes a real test sent after issuance next to the old ones', async () => {
    esplora({
      mempool: [btcTx({ txid: 'stuck', confirmed: false })],
      chain: { '': [btcTx({ txid: 'new', height: TIP + 1 }), btcTx({ txid: 'old', height: TIP })] },
    });
    const ch = btcCh({ baseline: { tipHeight: TIP, mempool: ['stuck'] } });
    expect(await detectBoundSelfSend(ch, NOW)).toEqual({ found: true, ref: 'new' });
  });

  it('fails closed: no baseline means no pass, on either UTXO chain', async () => {
    esplora({ mempool: [btcTx({ txid: 'mem', confirmed: false })], chain: { '': [btcTx({ txid: 'c' })] } });
    expect(await detectBoundSelfSend(btcCh({ baseline: null }), NOW)).toEqual({ found: false, reason: 'unavailable' });
    expect(await detectBoundSelfSend(btcCh({ rail: 'litecoin', baseline: undefined }), NOW))
      .toEqual({ found: false, reason: 'unavailable' });
  });

  it('a confirmed tx with no block height never counts', async () => {
    const tx = btcTx({ txid: 'noheight' });
    delete (tx.status as { block_height?: number }).block_height;
    esplora({ chain: { '': [tx] } });
    expect(await detectBoundSelfSend(btcCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });
});

describe('captureSelfSendBaseline', () => {
  it('reads the mempool, then the tip, and keeps only txids', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/txs/mempool')) return json([{ txid: 'm1', vin: [] }, { txid: 'm2' }, { nope: 1 }]);
      if (url.endsWith('/blocks/tip/height')) return new Response('900123', { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', f);
    expect(await captureSelfSendBaseline('bitcoin', BTC.toUpperCase())).toEqual({ tipHeight: 900_123, mempool: ['m1', 'm2'] });
    expect(urls(f)).toEqual([
      `https://blockstream.info/api/address/${BTC}/txs/mempool`,
      'https://blockstream.info/api/blocks/tip/height',
    ]);
  });

  it('Litecoin reads litecoinspace', async () => {
    const f = vi.fn(async (url: string) => (url.endsWith('/height') ? new Response('3000000') : json([])));
    vi.stubGlobal('fetch', f);
    expect(await captureSelfSendBaseline('litecoin', 'ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n'))
      .toEqual({ tipHeight: 3_000_000, mempool: [] });
    expect(urls(f)[1]).toBe('https://litecoinspace.org/api/blocks/tip/height');
  });

  it('is unavailable when either read fails (no amount is issued without it)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/txs/mempool') ? new Response('x', { status: 502 }) : new Response('1'))));
    expect(await captureSelfSendBaseline('bitcoin', BTC)).toBe('unavailable');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/txs/mempool') ? json([]) : new Response('not a height'))));
    expect(await captureSelfSendBaseline('bitcoin', BTC)).toBe('unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await captureSelfSendBaseline('litecoin', 'ltc1qg9stkxrszkdqsuj4gr3ezcrrwe8h8f8vvnfl8n')).toBe('unavailable');
  });

  it('account chains need none, and read nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const rail of ['ethereum', 'polygon', 'avalanche', 'solana']) {
      expect(await captureSelfSendBaseline(rail, EVM)).toBeNull();
      expect(railNeedsBaseline(rail)).toBe(false);
    }
    expect(railNeedsBaseline('bitcoin')).toBe(true);
    expect(railNeedsBaseline('litecoin')).toBe(true);
    expect(railNeedsBaseline('constructor')).toBe(false); // own keys only
    expect(f).not.toHaveBeenCalled();
  });

  it('parseSelfSendBaseline round-trips and rejects malformed rows', () => {
    const b = { tipHeight: 5, mempool: ['a'] };
    expect(parseSelfSendBaseline(JSON.stringify(b))).toEqual(b);
    expect(parseSelfSendBaseline(null)).toBeNull();
    expect(parseSelfSendBaseline('')).toBeNull();
    expect(parseSelfSendBaseline('{')).toBeNull();
    expect(parseSelfSendBaseline(JSON.stringify({ tipHeight: -1, mempool: [] }))).toBeNull();
    expect(parseSelfSendBaseline(JSON.stringify({ tipHeight: 1.5, mempool: [] }))).toBeNull();
    expect(parseSelfSendBaseline(JSON.stringify({ tipHeight: 1, mempool: [1] }))).toBeNull();
    expect(parseSelfSendBaseline(JSON.stringify({ mempool: [] }))).toBeNull();
  });
});

// ── Solana ───────────────────────────────────────────────────────────────────

const SOL = '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK';
const SOL_OTHER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const LAMPORTS = 12_340n; // 0.00001234 SOL

const solCh = (o: Partial<SelfSendChallenge> = {}): SelfSendChallenge => ({
  rail: 'solana', address: SOL, expected: LAMPORTS, issuedAt: ISSUED, expiresAt: EXPIRES, ...o,
});
function solTx(o: { source?: string; destination?: string; lamports?: number; err?: unknown; signer?: string; token?: boolean } = {}) {
  const { source = SOL, destination = SOL, lamports = Number(LAMPORTS), err = null, signer = source } = o;
  const ix = o.token
    ? { program: 'spl-token', programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'transfer', info: { source: 'tokacct1', destination: 'tokacct2', amount: '1000' } } }
    : { program: 'system', programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source, destination, lamports } } };
  return {
    meta: { err },
    transaction: { message: { accountKeys: [{ pubkey: signer, signer: true, writable: true }], instructions: [ix] } },
  };
}
type Sig = { signature: string; blockTime?: number | null; err?: unknown };
const sig = (signature: string, blockTime: number | null = ISSUED + 300, err: unknown = null): Sig => ({ signature, blockTime, err });

/** Stub the Solana RPC: signature pages (paged by `before`) and transactions by signature. */
function solana(pages: Sig[][], txs: Record<string, unknown>, opts: { sigError?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (opts.status) return new Response('rate limited', { status: opts.status });
    const { method, params } = JSON.parse(String(init?.body ?? '{}'));
    if (method === 'getSignaturesForAddress') {
      if (opts.sigError) return json({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind' } });
      const before = params[1]?.before;
      const idx = before ? pages.findIndex((p) => p[p.length - 1]?.signature === before) + 1 : 0;
      return json({ jsonrpc: '2.0', id: 1, result: pages[idx] ?? [] });
    }
    if (method === 'getTransaction') return json({ jsonrpc: '2.0', id: 1, result: txs[params[0]] ?? null });
    throw new Error(`unexpected ${method}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const rpcCalls = (f: ReturnType<typeof vi.fn>, method: string) =>
  f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))).filter((b) => b.method === method);

describe('bound_v1 Solana matcher', () => {
  it('passes: parsed system transfer, source == destination == address, exact lamports', async () => {
    const f = solana([[sig('s1')]], { s1: solTx() });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: true, ref: 's1' });
    const [getSigs] = rpcCalls(f, 'getSignaturesForAddress');
    expect(getSigs.params[0]).toBe(SOL);
    expect(getSigs.params[1].commitment).toBe('confirmed');
    const [getTx] = rpcCalls(f, 'getTransaction');
    expect(getTx.params[1]).toMatchObject({ encoding: 'jsonParsed', commitment: 'confirmed' });
  });

  it('fails: wrong amount', async () => {
    solana([[sig('s1')]], { s1: solTx({ lamports: 12_350 }) });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('fails: exact amount to another address (to != self)', async () => {
    solana([[sig('s1')]], { s1: solTx({ destination: SOL_OTHER }) });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'wrong_recipient' });
  });

  it('fails: incoming deposit of the exact amount', async () => {
    solana([[sig('s1')]], { s1: solTx({ source: SOL_OTHER }) });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'sent_to_not_from' });
  });

  it('fails: a token send signed by the address is wrong_amount (SOL only)', async () => {
    solana([[sig('s1')]], { s1: solTx({ token: true, signer: SOL }) });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'wrong_amount' });
  });

  it('fails: a failed transaction never counts (tx meta.err, or signature err)', async () => {
    const f = solana([[sig('s1'), sig('s2', ISSUED + 200, { InstructionError: [0, 'Custom'] })]], {
      s1: solTx({ err: { InstructionError: [0, 'Custom'] } }),
      s2: solTx(),
    });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    expect(rpcCalls(f, 'getTransaction').map((b) => b.params[0])).toEqual(['s1']); // s2 skipped unread
  });

  it('fails: before the window (beyond the 2-minute slack), without reading it', async () => {
    const f = solana([[sig('s1', ISSUED - SLACK_ACCOUNT_S - 1)]], { s1: solTx() });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
    expect(rpcCalls(f, 'getTransaction')).toHaveLength(0);
  });

  it('fails: after expiry (beyond the slack)', async () => {
    solana([[sig('s1', EXPIRES + SLACK_ACCOUNT_S + 1)]], { s1: solTx() });
    expect(await detectBoundSelfSend(solCh(), EXPIRES + 3600)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('pagination: pages with `before` and finds the test beyond the first page', async () => {
    const page1 = Array.from({ length: SOL_SIG_PAGE }, (_, i) => sig(`n${i}`, ISSUED + 5000 - i));
    const txs: Record<string, unknown> = { pass: solTx() };
    for (const s of page1) txs[s.signature] = solTx({ source: SOL_OTHER, lamports: 5 }); // unrelated incoming
    const f = solana([page1, [sig('pass', ISSUED + 100)]], txs);
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: true, ref: 'pass' });
    const sigCalls = rpcCalls(f, 'getSignaturesForAddress');
    expect(sigCalls).toHaveLength(2);
    expect(sigCalls[1].params[1].before).toBe(`n${SOL_SIG_PAGE - 1}`);
  });

  it('error mapping: a null getTransaction is unavailable', async () => {
    solana([[sig('s1')]], {});
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('error mapping: RPC error or HTTP failure on getSignaturesForAddress is unavailable', async () => {
    solana([], {}, { sigError: true });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
    solana([], {}, { status: 429 });
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'unavailable' });
  });

  it('an address with no signatures yet is not_yet', async () => {
    solana([[]], {});
    expect(await detectBoundSelfSend(solCh(), NOW)).toEqual({ found: false, reason: 'not_yet' });
  });

  it('repeat checks read each confirmed transaction once', async () => {
    const f = solana([[sig('s1')]], { s1: solTx({ lamports: 1 }) });
    await detectBoundSelfSend(solCh(), NOW);
    await detectBoundSelfSend(solCh(), NOW + 20);
    expect(rpcCalls(f, 'getTransaction')).toHaveLength(1);
  });

  it('solanaTxVerdict: lamports compare as BigInt', () => {
    expect(solanaTxVerdict(solTx({ lamports: 12_340 }), SOL, LAMPORTS)).toBe('pass');
    expect(solanaTxVerdict(solTx({ lamports: 12_341 }), SOL, LAMPORTS)).toBe('wrong_amount');
  });
});

describe('bound_v1 guards', () => {
  it('an unsupported rail or empty address is unsupported_rail, never a pass', async () => {
    expect(await detectBoundSelfSend({ ...evmCh(), rail: 'tron' }, NOW)).toEqual({ found: false, reason: 'unsupported_rail' });
    expect(await detectBoundSelfSend({ ...evmCh(), address: '  ' }, NOW)).toEqual({ found: false, reason: 'unsupported_rail' });
    expect(await detectBoundSelfSend({ ...evmCh(), expected: 0n }, NOW)).toEqual({ found: false, reason: 'unsupported_rail' });
  });
});
