/**
 * evmActivity.ts — first activity, last activity and transactions sent for one EVM
 * address, across the EVM chains we have a free source for. Served by /api/wallet-activity
 * (through walletChecker.ts), never by the verdict. Read-only; the address is never logged
 * or stored.
 *
 * Sources (checked 2026-10-08):
 *   - Etherscan API v2 (ETHERSCAN_API_KEY): Ethereum, Polygon and Arbitrum are on the free
 *     plan. Base, OP Mainnet, BNB Chain and Avalanche are paid-only there; a free key gets
 *     "Free API access is not supported for this chain".
 *   - Routescan (Etherscan-compatible): Avalanche C-Chain, keyless (2 calls/s) or with
 *     SNOWTRACE_API_KEY. It answers "chain not supported" for Base, OP Mainnet and BNB.
 *   - Alchemy JSON-RPC (ALCHEMY_API_KEY), when set: the account nonce, contract code and
 *     ETH balance, so those reads do not use the explorers' scarce rate-limit slots. Any
 *     Alchemy failure falls back to the explorer.
 *   - Not covered: Base (its Blockscout API answered with a Cloudflare bot challenge),
 *     OP Mainnet (its Blockscout API allows about 10 keyless calls per IP per quarter hour,
 *     too few for a public checker) and BNB Chain (no free history source found). They are
 *     listed as "not checked" so a dash is never read as "new" or "no history".
 *
 * Call budget per chain: normal transactions (txlist) and ERC-20 transfers (tokentx),
 * oldest first, 10 per page. When a page holds fewer than 10, it is the whole history of
 * that kind, so it also gives the last activity and, for txlist, the exact count sent.
 * Only a full page needs the newest-first page, and a transactions-sent count is read
 * from the nonce on the newest transaction the address sent, else from the account nonce
 * (with the contract code, since a contract's nonce does not count transactions sent).
 * A chain the address never used costs 2 explorer calls; a busy one up to 4 (plus 2 RPC
 * reads, through Alchemy when it is set up).
 *
 * Partial reads: without both oldest-first pages a chain is not checked. When only a
 * newest-first page fails, the first activity still stands and the last one is marked
 * as a lower bound (lastActivityComplete: false), instead of the chain being dropped.
 *
 * Why not the helpers in etherscan.ts: they space every call 1.2 s apart in one lane, retry
 * rate limits after a 5 s back-off and have no request timeout. Right for background sync,
 * too slow for a live check. This module reuses its chain ids and the Routescan URL, and
 * shares one rate gate per provider with it (explorerGates.ts).
 *
 * Remembered refusals: a refusal that retrying cannot fix (the plan does not cover the
 * chain, or the key is rejected) skips that chain for an hour; three failures in a row
 * skip it for 30 s. Either way the chain is listed as not checked, without spending calls.
 */

import { CHAIN_IDS, SNOWTRACE_BASE_URL } from './etherscan';
import { ACTIVITY_MAX_WAIT_MS, etherscanGate, GATE_PRIORITY, routescanGate } from './explorerGates';
import { RateGateTimeout } from './rateGate';
import {
  emptyActivity, summarizeChains,
  type ActivityChain, type ActivityGapReason, type WalletActivity,
} from './walletActivity';

const ETHERSCAN_V2_API = 'https://api.etherscan.io/v2/api';
const ARBITRUM_CHAIN_ID = 42161;

type Provider = 'etherscan' | 'routescan';

interface ChainSource {
  id: string;
  name: string;
  chainId: number;
  provider: Provider;
  /** Alchemy network slug, for the RPC reads (nonce, code, balance). */
  alchemyNetwork: string;
}

/** Chains read for activity, in display order (also their order in the rate gate). */
export const EVM_ACTIVITY_CHAINS: readonly ChainSource[] = [
  { id: 'ethereum',  name: 'Ethereum',  chainId: CHAIN_IDS.ethereum,  provider: 'etherscan', alchemyNetwork: 'eth-mainnet' },
  { id: 'polygon',   name: 'Polygon',   chainId: CHAIN_IDS.polygon,   provider: 'etherscan', alchemyNetwork: 'polygon-mainnet' },
  { id: 'arbitrum',  name: 'Arbitrum',  chainId: ARBITRUM_CHAIN_ID,   provider: 'etherscan', alchemyNetwork: 'arb-mainnet' },
  { id: 'avalanche', name: 'Avalanche', chainId: CHAIN_IDS.avalanche, provider: 'routescan', alchemyNetwork: 'avax-mainnet' },
];

/** EVM chains with no free history source we can rely on (see the header). */
export const EVM_CHAINS_NOT_COVERED: readonly { id: string; name: string }[] = [
  { id: 'base',     name: 'Base' },
  { id: 'optimism', name: 'Optimism' },
  { id: 'bnb',      name: 'BNB Chain' },
];

const PAGE_SIZE = 10;
const REQUEST_TIMEOUT_MS = 6_000;
/** Whole activity read, including time spent waiting for a rate-limit slot. */
export const ACTIVITY_BUDGET_MS = 9_000;

const PERMANENT_SKIP_MS = 60 * 60_000;
const TRANSIENT_SKIP_MS = 30_000;
const FAILURES_BEFORE_SKIP = 3;

function etherscanKey(): string {
  return import.meta.env.ETHERSCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? '';
}

function routescanKey(): string {
  return import.meta.env.SNOWTRACE_API_KEY ?? process.env.SNOWTRACE_API_KEY ?? '';
}

function alchemyKey(): string {
  return process.env.ALCHEMY_API_KEY ?? import.meta.env.ALCHEMY_API_KEY ?? '';
}

/** Explorer transaction / token-transfer row: only the fields read here. */
interface ExplorerRow {
  timeStamp?: string;
  from?: string;
  nonce?: string;
}

interface ReadContext {
  address: string;
  deadline: number;
}

type ReadFailure = Exclude<ActivityGapReason, 'no_source'>;

/**
 * A read that did not produce a history. `fromSource` is false when the source was never
 * asked (our rate gate was full, or the budget was spent), so it does not count toward
 * skipping that source.
 */
class ActivityReadError extends Error {
  constructor(readonly failure: ReadFailure, readonly fromSource: boolean) {
    super(`activity read failed (${failure})`);
    this.name = 'ActivityReadError';
  }
}

// ─── Remembered refusals ──────────────────────────────────────────────────────

interface SourceState { skipUntil: number; skipReason: ReadFailure; failuresInRow: number }
const sourceStates = new Map<string, SourceState>();
const alchemyRefusedUntil = new Map<string, number>();

function sourceState(source: ChainSource): SourceState {
  let s = sourceStates.get(source.id);
  if (!s) {
    s = { skipUntil: 0, skipReason: 'unavailable', failuresInRow: 0 };
    sourceStates.set(source.id, s);
  }
  return s;
}

function skippedFor(source: ChainSource): ReadFailure | null {
  const s = sourceStates.get(source.id);
  return s && s.skipUntil > Date.now() ? s.skipReason : null;
}

function noteFailure(source: ChainSource, err: ActivityReadError): void {
  if (!err.fromSource) return;
  const s = sourceState(source);
  if (err.failure === 'not_on_plan' || err.failure === 'not_configured') {
    Object.assign(s, { skipUntil: Date.now() + PERMANENT_SKIP_MS, skipReason: err.failure, failuresInRow: 0 });
    return;
  }
  s.failuresInRow += 1;
  if (s.failuresInRow >= FAILURES_BEFORE_SKIP) {
    Object.assign(s, { skipUntil: Date.now() + TRANSIENT_SKIP_MS, skipReason: 'unavailable', failuresInRow: 0 });
  }
}

function noteSuccess(source: ChainSource): void {
  const s = sourceStates.get(source.id);
  if (s) s.failuresInRow = 0;
}

/** Forgets remembered refusals. For tests. */
export function resetActivitySourceState(): void {
  sourceStates.clear();
  alchemyRefusedUntil.clear();
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/**
 * fetch with the per-request timeout, clipped to the activity budget; the body is read
 * inside the timeout too. Never puts the URL in an error (it holds an API key).
 */
async function timedFetch(url: string, init: RequestInit | undefined, ctx: ReadContext): Promise<{ status: number; body: any }> {
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, ctx.deadline - Date.now());
  if (timeoutMs <= 0) throw new ActivityReadError('unavailable', false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON: body stays null */ }
    return { status: res.status, body };
  } catch {
    throw new ActivityReadError('unavailable', true); // network error or timeout
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(source: ChainSource, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  if (source.provider === 'etherscan') {
    query.set('chainid', String(source.chainId));
    query.set('apikey', etherscanKey());
    return `${ETHERSCAN_V2_API}?${query.toString()}`;
  }
  const key = routescanKey();
  if (key) query.set('apikey', key);
  return `${SNOWTRACE_BASE_URL}?${query.toString()}`;
}

/** Gate priority: every chain's first pages, in chain order, ahead of any follow-up call. */
function gatePriority(source: ChainSource, stage: 'first' | 'later'): number {
  const order = EVM_ACTIVITY_CHAINS.indexOf(source);
  return (stage === 'first' ? GATE_PRIORITY.activityFirst : GATE_PRIORITY.activityLater) + order;
}

/**
 * One explorer call through the provider's rate gate, inside the activity budget.
 * Resolves with the parsed JSON body; rejects with an ActivityReadError on a gate
 * timeout, a network error, a non-2xx status or an exhausted budget.
 */
async function explorerCall(
  source: ChainSource, params: Record<string, string>, ctx: ReadContext, stage: 'first' | 'later',
): Promise<any> {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) throw new ActivityReadError('unavailable', false);
  const gate = source.provider === 'etherscan' ? etherscanGate : routescanGate;
  try {
    const { status, body } = await gate.schedule(() => timedFetch(buildUrl(source, params), undefined, ctx), {
      priority: gatePriority(source, stage),
      maxWaitMs: Math.min(ACTIVITY_MAX_WAIT_MS, remaining),
    });
    if (status < 200 || status >= 300) throw new ActivityReadError('unavailable', true);
    return body;
  } catch (err) {
    if (err instanceof ActivityReadError) throw err;
    // RateGateTimeout: our own queue was full, so the source was never asked.
    throw new ActivityReadError('unavailable', !(err instanceof RateGateTimeout));
  }
}

/**
 * Sorts an explorer error answer into a not-checked reason. A refusal for our plan, an
 * unsupported chain or a rejected key will repeat; anything else (a rate limit, "Query
 * Timeout", an unknown message) may pass.
 */
export function classifyExplorerError(json: any): ReadFailure {
  const text = `${json?.message ?? ''} ${typeof json?.result === 'string' ? json.result : ''}`;
  if (/free api access is not supported|upgrade your api plan|not supported for this chain|chain (is )?not supported|unsupported chain/i.test(text)) {
    return 'not_on_plan';
  }
  if (/invalid api key|missing\/invalid api key|api key (is )?(invalid|missing)/i.test(text)) return 'not_configured';
  return 'unavailable';
}

/**
 * The rows of a txlist / tokentx answer, or a throw when the source did not answer.
 * Only two shapes mean "read": status '1' with a list, or an empty list with a
 * "No transactions found" / "No token transfers found" message. Everything else (a
 * paid-plan-only chain, a rate limit, a bad key, "chain not supported") is NOT an empty
 * history, so the chain is reported as not checked.
 */
export function readExplorerList(json: any): ExplorerRow[] {
  const status = String(json?.status ?? '');
  const message = String(json?.message ?? '');
  const result = json?.result;
  if (Array.isArray(result) && status === '1') return result as ExplorerRow[];
  if (Array.isArray(result) && result.length === 0 && /^no (transactions|token transfers|records) found/i.test(message)) {
    return [];
  }
  throw new ActivityReadError(classifyExplorerError(json), true);
}

async function listPage(
  source: ChainSource, action: 'txlist' | 'tokentx', sort: 'asc' | 'desc', ctx: ReadContext,
): Promise<ExplorerRow[]> {
  return readExplorerList(await explorerCall(source, {
    module: 'account', action, address: ctx.address, page: '1', offset: String(PAGE_SIZE), sort,
  }, ctx, sort === 'asc' ? 'first' : 'later'));
}

const HEX = /^0x[0-9a-f]*$/i;

/**
 * One JSON-RPC read through Alchemy. Undefined when there is no key, Alchemy refused this
 * network for our app (remembered for an hour), or it did not answer: the caller then falls
 * back to the explorer. Never throws.
 */
async function alchemyRead(source: ChainSource, method: string, ctx: ReadContext): Promise<string | undefined> {
  const key = alchemyKey();
  if (!key || (alchemyRefusedUntil.get(source.alchemyNetwork) ?? 0) > Date.now()) return undefined;
  try {
    const { status, body } = await timedFetch(`https://${source.alchemyNetwork}.g.alchemy.com/v2/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [ctx.address, 'latest'] }),
    }, ctx);
    // 401/403: a rejected key, or a network not enabled for the app. Both will repeat.
    if (status === 401 || status === 403) {
      alchemyRefusedUntil.set(source.alchemyNetwork, Date.now() + PERMANENT_SKIP_MS);
      return undefined;
    }
    const result = body?.result;
    return status >= 200 && status < 300 && typeof result === 'string' && HEX.test(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

/** eth_getCode / eth_getTransactionCount: Alchemy first, else the explorer's proxy module. Null when unreadable. */
async function rpcRead(
  source: ChainSource, method: 'eth_getCode' | 'eth_getTransactionCount', ctx: ReadContext,
): Promise<string | null> {
  const viaAlchemy = await alchemyRead(source, method, ctx);
  if (viaAlchemy !== undefined) return viaAlchemy;
  try {
    const json = await explorerCall(source, { module: 'proxy', action: method, address: ctx.address, tag: 'latest' }, ctx, 'later');
    const hex = json?.result;
    return typeof hex === 'string' && HEX.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

function rowTimeMs(row: ExplorerRow): number | null {
  const s = Number(row?.timeStamp);
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

function isFrom(row: ExplorerRow, address: string): boolean {
  return String(row?.from ?? '').toLowerCase() === address.toLowerCase();
}

/** Transactions sent, from the newest page of normal transactions, or null if none of them is outgoing. */
function sentFromNewest(newest: ExplorerRow[], address: string): number | null {
  let maxNonce = -1;
  for (const row of newest) {
    if (!isFrom(row, address)) continue;
    const n = Number(row.nonce);
    if (Number.isInteger(n) && n > maxNonce) maxNonce = n;
  }
  return maxNonce >= 0 ? maxNonce + 1 : null;
}

/**
 * Transactions sent, from the account nonce. Only an externally owned account sends
 * transactions: a contract's nonce counts the contracts it created, so for a contract (a
 * Safe, a smart account) the count is unknown (null), never its nonce. An EIP-7702 account
 * (code 0xef0100…) is still externally owned, so its nonce counts.
 */
async function sentFromNonce(source: ChainSource, ctx: ReadContext): Promise<number | null> {
  const [code, nonce] = await Promise.all([
    rpcRead(source, 'eth_getCode', ctx),
    rpcRead(source, 'eth_getTransactionCount', ctx),
  ]);
  if (code === null || nonce === null || nonce === '0x') return null;
  const externallyOwned = /^0x0*$/i.test(code) || /^0xef0100/i.test(code);
  return externallyOwned ? parseInt(nonce, 16) : null;
}

function earliest(times: number[]): string | null {
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function latest(times: number[]): string | null {
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function rowTimes(...pages: ExplorerRow[][]): number[] {
  return pages.flat().map(rowTimeMs).filter((t): t is number => t !== null);
}

async function readChain(source: ChainSource, ctx: ReadContext): Promise<ActivityChain> {
  const base: ActivityChain = {
    id: source.id, name: source.name, checked: false,
    firstSeen: null, lastActivity: null, txCount: null,
  };
  if (source.provider === 'etherscan' && !etherscanKey()) return { ...base, reason: 'not_configured' };
  const skipped = skippedFor(source);
  if (skipped) return { ...base, reason: skipped };

  // 1. Oldest first. Both pages are needed: without either, the first activity is unknown.
  let txOldest: ExplorerRow[];
  let tokOldest: ExplorerRow[];
  try {
    [txOldest, tokOldest] = await Promise.all([
      listPage(source, 'txlist', 'asc', ctx),
      listPage(source, 'tokentx', 'asc', ctx),
    ]);
  } catch (err) {
    const failure = err instanceof ActivityReadError ? err : new ActivityReadError('unavailable', true);
    noteFailure(source, failure);
    return { ...base, reason: failure.failure };
  }
  noteSuccess(source);

  // 2. Newest first, only for a full page (a short page is the whole history of that kind).
  // A failure here keeps what was read: the first activity stands, the last is a lower bound.
  const txAll = txOldest.length < PAGE_SIZE;
  const tokAll = tokOldest.length < PAGE_SIZE;
  const [txNewest, tokNewest] = await Promise.allSettled([
    txAll ? Promise.resolve(txOldest) : listPage(source, 'txlist', 'desc', ctx),
    tokAll ? Promise.resolve(tokOldest) : listPage(source, 'tokentx', 'desc', ctx),
  ]);
  const txNewestRows = txNewest.status === 'fulfilled' ? txNewest.value : [];
  const tokNewestRows = tokNewest.status === 'fulfilled' ? tokNewest.value : [];
  const lastComplete = txNewest.status === 'fulfilled' && tokNewest.status === 'fulfilled';

  // 3. Transactions sent. Every transaction an address sends is in its txlist, so a
  // complete list counts them exactly. Otherwise the newest outgoing transaction's nonce
  // + 1 is the count; failing that (none of the newest 10 is outgoing), the account nonce.
  let txCount: number | null;
  if (txAll) txCount = txOldest.filter((row) => isFrom(row, ctx.address)).length;
  else txCount = sentFromNewest(txNewestRows, ctx.address) ?? await sentFromNonce(source, ctx);

  return {
    ...base,
    checked: true,
    firstSeen: earliest(rowTimes(txOldest, tokOldest)),
    lastActivity: latest(rowTimes(txOldest, tokOldest, txNewestRows, tokNewestRows)),
    ...(lastComplete ? {} : { lastActivityComplete: false }),
    txCount,
  };
}

async function readEthBalance(ctx: ReadContext): Promise<string | null> {
  const ethereum = EVM_ACTIVITY_CHAINS[0];
  let wei: bigint | null = null;
  const hex = await alchemyRead(ethereum, 'eth_getBalance', ctx);
  if (hex !== undefined && hex !== '0x') {
    wei = BigInt(hex);
  } else if (etherscanKey()) {
    try {
      const json = await explorerCall(ethereum, {
        module: 'account', action: 'balance', address: ctx.address, tag: 'latest',
      }, ctx, 'later');
      if (String(json?.status) === '1' && typeof json?.result === 'string' && /^\d+$/.test(json.result)) {
        wei = BigInt(json.result);
      }
    } catch { /* balance stays unknown */ }
  }
  return wei === null ? null : (Number(wei) / 1e18).toFixed(6);
}

/**
 * Activity for an EVM address across EVM_ACTIVITY_CHAINS, run in parallel (each provider's
 * gate keeps it under that provider's rate limit). Never throws. `errors` is non-empty only
 * when nothing could be read at all, or when the Etherscan key is missing: a single chain
 * that failed is reported in `activity.chains`.
 */
export async function fetchEvmActivity(address: string): Promise<{ activity: WalletActivity; errors: string[] }> {
  const errors: string[] = [];
  const ctx: ReadContext = { address, deadline: Date.now() + ACTIVITY_BUDGET_MS };

  const [read, ethBalance] = await Promise.all([
    Promise.all(EVM_ACTIVITY_CHAINS.map((source) => readChain(source, ctx))),
    readEthBalance(ctx),
  ]);

  const chains: ActivityChain[] = [
    ...read,
    ...EVM_CHAINS_NOT_COVERED.map((c): ActivityChain => ({
      id: c.id, name: c.name, checked: false, reason: 'no_source',
      firstSeen: null, lastActivity: null, txCount: null,
    })),
  ];

  if (!etherscanKey()) errors.push('Etherscan not configured');
  if (!chains.some((c) => c.checked)) errors.push('Activity unavailable');

  return {
    activity: { ...emptyActivity(), ethBalance, ...summarizeChains(chains, 'sent') },
    errors,
  };
}
