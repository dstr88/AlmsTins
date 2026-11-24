/**
 * Base, read through its public JSON-RPC (https://mainnet.base.org, or BASE_RPC_URL), for the
 * watcher's two questions (./explorer.ts): which block was mined at a time, and a wallet's token
 * transfers over a block range, as Etherscan-style `tokentx` rows so ./transfers.ts reads them as
 * it reads every other chain's.
 *
 * Why the RPC: Etherscan reads Base only on a paid plan, Routescan does not carry it, and
 * Blockscout's API sits behind a bot check. A node has no account listings and no traces, so on
 * Base only token transfers are read: the ERC-20 `Transfer` logs with the wallet on one side. The
 * chain's own coin (ETH) moving on Base is not read.
 *
 * How it reads:
 *   - One gate for the process: calls start at least RPC_MIN_GAP_MS apart (the public endpoint
 *     allows a handful a second), each with a timeout, retried with a growing pause on a rate limit,
 *     a 5xx answer or a dropped connection.
 *   - Logs are asked for in windows of LOG_WINDOW_BLOCKS, once with the wallet as sender and once as
 *     receiver. A node that refuses a window as too wide gets one half as wide, down to one block.
 *   - Only standard ERC-20 transfers: three topics and a 32-byte amount. An ERC-721 transfer (four
 *     topics) is skipped. A log is named by its transaction and log index, so the sender and the
 *     receiver query finding one log (a send to itself) keep it once.
 *   - Each block's time comes from the log when the node says it, else from the block's header;
 *     each token's decimals and symbol from the contract itself (decimals(), symbol()), remembered.
 *   - One scan serves every page of a listing: it is kept SCAN_CACHE_TTL_MS, so paging does not
 *     read the chain again.
 *
 * Anything that could not be read is null, never an empty list: a failed call, a timeout, a scan
 * that runs past SCAN_BUDGET_MS. A token whose contract answers decimals() with nothing usable (it
 * reverts, or says something that is not a number) is not guessed at: its rows go out without
 * decimals and ./transfers.ts counts them unreadable.
 *
 * Read-only: blocks, logs and two view calls. Nothing here signs or sends.
 */
import { EVM_ADDRESS_LOWER, EVM_TX_HASH_LOWER } from '@/lib/addressFormats';
import type { ExplorerQuery } from './explorer';

export const BASE_RPC_DEFAULT_URL = 'https://mainnet.base.org';
/** keccak256("Transfer(address,address,uint256)"). */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DECIMALS_CALL = '0x313ce567';
const SYMBOL_CALL = '0x95d89b41';

/** Blocks per eth_getLogs call at first (about 67 minutes of Base); halved when a node refuses it. */
export const LOG_WINDOW_BLOCKS = 2_000;
/** Base makes a block every two seconds; the first guess of blockAt, corrected by reading headers. */
export const BASE_BLOCK_TIME_S = 2;
/** Headers blockAt reads, at most, to settle on a block; more and it says it cannot (null). */
export const BLOCK_AT_MAX_READS = 12;
/** The least time between two calls' starts, for the whole process. */
export const RPC_MIN_GAP_MS = 250;
/** One call's limit, request and body. */
export const RPC_TIMEOUT_MS = 10_000;
/** Tries per call, and the pause after the first failed one (doubled each time). */
export const RPC_ATTEMPTS = 3;
export const RPC_BACKOFF_MS = 1_000;
/** One wallet's scan, all calls together: past this it stops and says it could not read (null). */
export const SCAN_BUDGET_MS = 120_000;
/** How long one scan serves the pages of its listing. */
export const SCAN_CACHE_TTL_MS = 5 * 60_000;

const SCAN_CACHE_LIMIT = 50;
const BLOCK_CACHE_LIMIT = 20_000;
const TOKEN_CACHE_LIMIT = 2_000;

type Row = Record<string, unknown>;

export interface BaseRpcOptions {
  url?: string;
  fetch?: typeof fetch;
  /** Milliseconds; Date.now when omitted. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minGapMs?: number;
  timeoutMs?: number;
  attempts?: number;
  backoffMs?: number;
  windowBlocks?: number;
  scanBudgetMs?: number;
}

export interface BaseRpcReader {
  /** The block mined at or before this time (seconds), or null when it could not be read. */
  blockAt(atSec: number): Promise<number | null>;
  /** One page of the wallet's token transfers as `tokentx` rows, oldest first; [] when there are none, null when they could not be read. */
  tokenTransfers(q: Pick<ExplorerQuery, 'address' | 'startBlock' | 'endBlock' | 'page' | 'offset'>): Promise<Row[] | null>;
}

/** Why a call failed: `range` is a node refusing an eth_getLogs window (made smaller), `revert` a contract call that reverted. */
type RpcFailure = 'range' | 'revert' | 'failed';

export class BaseRpcError extends Error {
  constructor(
    readonly kind: RpcFailure,
    message: string,
  ) {
    super(message);
    this.name = 'BaseRpcError';
  }
}

const RATE_LIMITED = /rate.?limit|request limit|too many requests|throttl|capacity/i;
const RANGE_REFUSED =
  /block range|range (is )?too (large|wide|big)|max(imum)? (block )?range|more than \d+ (results|logs|blocks)|too many (results|logs|blocks)|response (size|is too)|exceeds? (the )?(max|limit)|query timeout|limit exceeded/i;

const HEX_QUANTITY = /^0x[0-9a-f]{1,64}$/;
/** 32 bytes as hex: a word, a topic, a transaction hash. */
const HEX_32 = EVM_TX_HASH_LOWER;
const HEX_ADDRESS = EVM_ADDRESS_LOWER;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;

const toHex = (n: number): string => `0x${n.toString(16)}`;
const lower = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** A hex quantity as a safe integer, or null. */
function quantity(v: unknown): number | null {
  const s = lower(v);
  if (!HEX_QUANTITY.test(s)) return null;
  const n = Number.parseInt(s, 16);
  return Number.isSafeInteger(n) ? n : null;
}

/** A 32-byte topic holding an address (12 zero bytes, then 20), as the lowercase address; null otherwise. */
function topicAddress(topic: string): string | null {
  return /^0x0{24}[0-9a-f]{40}$/.test(topic) ? `0x${topic.slice(26)}` : null;
}

/** The address as a 32-byte topic. */
const addressTopic = (address: string): string => `0x${'0'.repeat(24)}${address.slice(2)}`;

/** A uint8 answer of decimals(), or null when the answer is not one. */
export function decodeDecimals(result: unknown): number | null {
  const s = lower(result);
  if (!HEX_32.test(s)) return null;
  const n = BigInt(s);
  return n <= 255n ? Number(n) : null;
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const utf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(bytes);

/**
 * The answer of symbol(): an ABI string (offset, length, bytes), or the older bytes32 form (the text
 * padded with zero bytes, as MKR has it). '' when it is neither; ./transfers.ts shows that as UNKNOWN.
 */
export function decodeSymbol(result: unknown): string {
  const s = lower(result);
  if (!HEX_DATA.test(s)) return '';
  const body = s.slice(2);
  if (body.length === 64) {
    return utf8(hexBytes(body.replace(/(00)+$/, '')));
  }
  if (body.length >= 128) {
    const offset = Number.parseInt(body.slice(0, 64), 16);
    if (!Number.isSafeInteger(offset) || offset % 32 !== 0 || (offset + 32) * 2 > body.length) return '';
    const length = Number.parseInt(body.slice(offset * 2, offset * 2 + 64), 16);
    const start = (offset + 32) * 2;
    if (!Number.isSafeInteger(length) || length > 256 || start + length * 2 > body.length) return '';
    return utf8(hexBytes(body.slice(start, start + length * 2)));
  }
  return '';
}

interface TransferLog {
  hash: string;
  blockNumber: number;
  logIndex: number;
  /** The block's time when the node gave it with the log, else null. */
  timeStamp: number | null;
  token: string;
  from: string;
  to: string;
  value: string;
}

/** A log as an ERC-20 transfer, or null when it is not one (an ERC-721 transfer, a removed log, a field that cannot be read). */
export function readTransferLog(log: unknown): TransferLog | null {
  if (!log || typeof log !== 'object') return null;
  const l = log as Record<string, unknown>;
  if (l.removed === true) return null;
  const topics = Array.isArray(l.topics) ? l.topics.map(lower) : [];
  if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC) return null;
  const data = lower(l.data);
  if (!HEX_32.test(data)) return null;
  const from = topicAddress(topics[1]);
  const to = topicAddress(topics[2]);
  const hash = lower(l.transactionHash);
  const token = lower(l.address);
  const blockNumber = quantity(l.blockNumber);
  const logIndex = quantity(l.logIndex);
  if (!from || !to || !HEX_32.test(hash) || !HEX_ADDRESS.test(token) || blockNumber === null || logIndex === null) return null;
  return { hash, blockNumber, logIndex, timeStamp: quantity(l.blockTimestamp), token, from, to, value: BigInt(data).toString() };
}

/** Remembers up to `limit` answers; full, it forgets them all (they are cheap to ask again). */
function boundedSet<K, V>(map: Map<K, V>, limit: number, key: K, value: V): void {
  if (map.size >= limit) map.clear();
  map.set(key, value);
}

export function createBaseRpcReader(opts: BaseRpcOptions = {}): BaseRpcReader {
  const url = opts.url ?? BASE_RPC_DEFAULT_URL;
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minGapMs = opts.minGapMs ?? RPC_MIN_GAP_MS;
  const timeoutMs = opts.timeoutMs ?? RPC_TIMEOUT_MS;
  const attempts = opts.attempts ?? RPC_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? RPC_BACKOFF_MS;
  const windowBlocks = Math.max(1, opts.windowBlocks ?? LOG_WINDOW_BLOCKS);
  const scanBudgetMs = opts.scanBudgetMs ?? SCAN_BUDGET_MS;

  // The gate: each call takes the next free start time before it waits, so calls made together are spaced too.
  let nextStartAt = 0;
  async function pace(): Promise<void> {
    const t = now();
    const at = Math.max(t, nextStartAt);
    nextStartAt = at + minGapMs;
    if (at > t) await sleep(at - t);
  }

  let id = 0;
  async function call(method: string, params: unknown[]): Promise<unknown> {
    let last = 'no attempt';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await sleep(backoffMs * 2 ** (attempt - 2));
      await pace();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status: number;
      let text: string;
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
          signal: controller.signal,
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        last = (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network';
        continue;
      } finally {
        clearTimeout(timer);
      }

      let payload: { result?: unknown; error?: { code?: unknown; message?: unknown } } | null = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const error = payload && typeof payload === 'object' ? payload.error : undefined;
      const message = String(error?.message ?? '');
      if (status === 429 || status >= 500 || RATE_LIMITED.test(message)) {
        last = `rate limit or server error (${status})`;
        continue;
      }
      if (error) {
        if (Number(error.code) === 3 || /revert/i.test(message)) throw new BaseRpcError('revert', message);
        if (RANGE_REFUSED.test(message) || Number(error.code) === -32005) throw new BaseRpcError('range', message);
        throw new BaseRpcError('failed', `${method}: ${message.slice(0, 200)}`);
      }
      if (status === 413) throw new BaseRpcError('range', 'response too large');
      if (status < 200 || status >= 300 || !payload || !('result' in payload)) throw new BaseRpcError('failed', `${method}: HTTP ${status}`);
      return payload.result;
    }
    throw new BaseRpcError('failed', `${method}: ${last}`);
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  const blockTimes = new Map<number, number>();
  const blockAtCache = new Map<number, number>();

  async function header(block: number | 'latest'): Promise<{ number: number; timestamp: number }> {
    const result = (await call('eth_getBlockByNumber', [block === 'latest' ? 'latest' : toHex(block), false])) as Record<string, unknown> | null;
    const number = quantity(result?.number);
    const timestamp = quantity(result?.timestamp);
    if (number === null || timestamp === null) throw new BaseRpcError('failed', 'eth_getBlockByNumber: no such block');
    boundedSet(blockTimes, BLOCK_CACHE_LIMIT, number, timestamp);
    return { number, timestamp };
  }

  async function blockTime(block: number): Promise<number> {
    return blockTimes.get(block) ?? (await header(block)).timestamp;
  }

  async function blockAt(atSec: number): Promise<number | null> {
    if (!Number.isSafeInteger(atSec)) return null;
    const cached = blockAtCache.get(atSec);
    if (cached !== undefined) return cached;
    try {
      const latest = await header('latest');
      if (atSec >= latest.timestamp) return latest.number; // not remembered: a newer block may still come at this time
      // Known bounds: `lo` was mined at or before atSec (none yet: -1), `hi` after it.
      let lo = { number: -1, timestamp: Number.NEGATIVE_INFINITY };
      let hi = latest;
      // The first guess assumes two-second blocks; later ones use the pace measured between the bounds.
      let guess = latest.number - Math.ceil((latest.timestamp - atSec) / BASE_BLOCK_TIME_S);
      for (let reads = 0; reads < BLOCK_AT_MAX_READS && hi.number - lo.number > 1; reads += 1) {
        const g = Math.min(hi.number - 1, Math.max(lo.number + 1, guess));
        const h = { number: g, timestamp: await blockTime(g) };
        if (h.timestamp <= atSec) lo = h;
        else hi = h;
        if (hi.number - lo.number <= 1) break;
        if (lo.number < 0) {
          // Blocks were closer together than guessed. A block's time is at least one second after the
          // one before it, so going back one block per second cannot overshoot: this lands at or before.
          guess = hi.number - (hi.timestamp - atSec);
        } else {
          const perSec = (hi.number - lo.number) / Math.max(1, hi.timestamp - lo.timestamp);
          guess = lo.number + Math.floor((atSec - lo.timestamp) * perSec);
          // Past a few reads, halve the gap so a lopsided guess cannot crawl.
          if (reads >= 4) guess = Math.floor((lo.number + hi.number) / 2);
        }
      }
      if (hi.number - lo.number > 1) return null;
      const block = Math.max(0, lo.number); // a time before the first block: the first block
      boundedSet(blockAtCache, BLOCK_CACHE_LIMIT, atSec, block);
      return block;
    } catch {
      return null;
    }
  }

  // ── Tokens ────────────────────────────────────────────────────────────────

  interface TokenMeta {
    decimals: string;
    symbol: string;
  }
  const tokens = new Map<string, TokenMeta>();

  /** A view call's answer, or null when the contract reverted (an answer: it has no such function). */
  async function view(to: string, data: string): Promise<string | null> {
    try {
      const result = await call('eth_call', [{ to, data }, 'latest']);
      return typeof result === 'string' ? result : null;
    } catch (err) {
      if (err instanceof BaseRpcError && err.kind === 'revert') return null;
      throw err;
    }
  }

  async function tokenMeta(token: string): Promise<TokenMeta> {
    const known = tokens.get(token);
    if (known) return known;
    const decimals = decodeDecimals(await view(token, DECIMALS_CALL));
    const symbol = decodeSymbol(await view(token, SYMBOL_CALL));
    // No usable decimals is left empty, never guessed: ./transfers.ts counts the row unreadable.
    const meta = { decimals: decimals === null ? '' : String(decimals), symbol };
    boundedSet(tokens, TOKEN_CACHE_LIMIT, token, meta);
    return meta;
  }

  // ── Transfers ─────────────────────────────────────────────────────────────

  const scans = new Map<string, { at: number; rows: Promise<Row[] | null> }>();

  /** Every ERC-20 transfer log with the wallet in topic `side` (1 sender, 2 receiver), in windows. */
  async function transferLogs(
    wallet: string,
    side: 1 | 2,
    range: { startBlock: number; endBlock: number; deadline: number; window: number },
  ): Promise<TransferLog[] | null> {
    const { startBlock, endBlock, deadline } = range;
    const topics = side === 1 ? [TRANSFER_TOPIC, addressTopic(wallet)] : [TRANSFER_TOPIC, null, addressTopic(wallet)];
    const out: TransferLog[] = [];
    let from = startBlock;
    while (from <= endBlock) {
      if (now() >= deadline) return null;
      const to = Math.min(endBlock, from + range.window - 1);
      let logs: unknown;
      try {
        logs = await call('eth_getLogs', [{ fromBlock: toHex(from), toBlock: toHex(to), topics }]);
      } catch (err) {
        // A narrower window stays narrow for the rest of the scan, both directions.
        if (err instanceof BaseRpcError && err.kind === 'range' && range.window > 1) {
          range.window = Math.max(1, Math.floor(range.window / 2));
          continue;
        }
        return null;
      }
      if (!Array.isArray(logs)) return null;
      for (const log of logs) {
        const t = readTransferLog(log);
        // The node filtered on the topic; a log without the wallet on that side is not this wallet's.
        if (t && (side === 1 ? t.from : t.to) === wallet) out.push(t);
      }
      from = to + 1;
    }
    return out;
  }

  async function scan(wallet: string, startBlock: number, endBlock: number): Promise<Row[] | null> {
    const deadline = now() + scanBudgetMs;
    const range = { startBlock, endBlock, deadline, window: windowBlocks };
    try {
      const sent = await transferLogs(wallet, 1, range);
      if (!sent) return null;
      const received = await transferLogs(wallet, 2, range);
      if (!received) return null;

      const byId = new Map<string, TransferLog>();
      for (const t of [...sent, ...received]) byId.set(`${t.hash}:${t.logIndex}`, t);
      const logs = [...byId.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

      for (const t of logs) if (t.timeStamp !== null && !blockTimes.has(t.blockNumber)) boundedSet(blockTimes, BLOCK_CACHE_LIMIT, t.blockNumber, t.timeStamp);
      const rows: Row[] = [];
      for (const t of logs) {
        if (now() >= deadline) return null;
        const timeStamp = t.timeStamp ?? (await blockTime(t.blockNumber));
        const meta = await tokenMeta(t.token);
        rows.push({
          hash: t.hash,
          blockNumber: String(t.blockNumber),
          logIndex: String(t.logIndex),
          timeStamp: String(timeStamp),
          from: t.from,
          to: t.to,
          value: t.value,
          contractAddress: t.token,
          tokenDecimal: meta.decimals,
          tokenSymbol: meta.symbol,
        });
      }
      return rows;
    } catch {
      return null;
    }
  }

  async function tokenTransfers(q: Pick<ExplorerQuery, 'address' | 'startBlock' | 'endBlock' | 'page' | 'offset'>): Promise<Row[] | null> {
    const wallet = lower(q.address);
    const { startBlock, endBlock, page, offset } = q;
    if (!HEX_ADDRESS.test(wallet)) return null;
    if (![startBlock, endBlock, page, offset].every(Number.isSafeInteger) || startBlock < 0 || page < 1 || offset < 1) return null;
    if (startBlock > endBlock) return [];

    const key = `${wallet}:${startBlock}:${endBlock}`;
    let entry = scans.get(key);
    if (!entry || now() - entry.at > SCAN_CACHE_TTL_MS) {
      for (const [k, v] of scans) if (now() - v.at > SCAN_CACHE_TTL_MS) scans.delete(k);
      if (scans.size >= SCAN_CACHE_LIMIT) scans.delete(scans.keys().next().value as string);
      entry = { at: now(), rows: scan(wallet, startBlock, endBlock) };
      scans.set(key, entry);
      const mine = entry;
      // A scan that could not be read is not kept: the next ask reads again.
      void mine.rows.then((rows) => {
        if (rows === null && scans.get(key) === mine) scans.delete(key);
      });
    }
    const rows = await entry.rows;
    return rows === null ? null : rows.slice((page - 1) * offset, page * offset);
  }

  return { blockAt, tokenTransfers };
}

/** BASE_RPC_URL when it is set to an http(s) address (another node, a local one), else the public endpoint. */
export function configuredUrl(raw: unknown = import.meta.env.BASE_RPC_URL ?? process.env.BASE_RPC_URL): string {
  const s = String(raw ?? '').trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : BASE_RPC_DEFAULT_URL;
}

/** The reader the Vault uses: one per process, so its gate spaces every Base call the process makes. */
export const baseRpcReader: BaseRpcReader = createBaseRpcReader({ url: configuredUrl() });
