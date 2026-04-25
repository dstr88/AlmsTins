// src/lib/etherscan.ts
//
// Centralized scan/provider client with:
// - Etherscan v2 + Snowtrace support
// - Per-provider throttling
// - Short TTL memoization by URL
// - In-flight request de-dupe (same URL shares one fetch)
// - Consistent handling of "No transactions found" => []
// - Structured debug logging (SCAN_DEBUG=1)
//
// Usage examples:
//   import * as scan from '@/lib/etherscan';
//   const txs = await scan.getTokentxPaged({ chainId: 1, address, maxPages: 10, requestId });
//   const wei = await scan.getNativeBalanceWei({ chainId: 1, address, requestId });
//   const isContract = await scan.isContract({ chainId: 1, address: someAddr, requestId });

export const CHAIN_IDS = {
  ethereum: 1,
  polygon: 137,
  avalanche: 43114,
} as const;

const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';
// Snowtrace was rebranded to Routescan in 2023; api.snowtrace.io is dead (404).
// The replacement endpoint is Etherscan-compatible — same query params, new URL.
// API key: get a free key at https://routescan.io/apis (SNOWTRACE_API_KEY env var)
const SNOWTRACE_BASE_URL = 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';

// Defaults (override per call if needed)
const DEFAULT_MIN_INTERVAL_MS = 1200;
const DEFAULT_BACKOFF_MS = 5000;

const DEFAULT_URL_TTL_MS = 15_000; // memoize identical URL for 15s
const DEFAULT_URL_MAX_BYTES_LOG = 220;

const DEBUG = String(import.meta.env.SCAN_DEBUG ?? '').trim() === '1';

type Provider = 'etherscan' | 'snowtrace';

type Json = Record<string, any>;

type OkPayload<T> = { status: '1'; message?: string; result: T };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ErrPayload = { status: '0'; message?: string; result?: any };

// Etherscan-style token tx shape (also used by Snowtrace)
export type TokenTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
};

// ERC-721 / ERC-1155 transfer items (roughly)
export type NftTx = Record<string, any>;

// ─────────────────────────────────────────────────────────────
// Internal state: throttles, cache, inflight
// ─────────────────────────────────────────────────────────────

const lastCallAt: Record<Provider, number> = { etherscan: 0, snowtrace: 0 };

// Per-URL memo cache
const urlCache = new Map<string, { expiresAt: number; payloadText: string }>();

// In-flight de-dupe
const inflight = new Map<string, Promise<string>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logDebug(event: string, meta: Record<string, any>) {
  if (!DEBUG) return;
  // Keep logs compact and structured
  console.log(`[scan] ${event}`, meta);
}

function providerForChain(chainId: number): Provider {
  return chainId === CHAIN_IDS.avalanche ? 'snowtrace' : 'etherscan';
}

function getApiKey(provider: Provider): string | null {
  if (provider === 'snowtrace') {
    const k = import.meta.env.SNOWTRACE_API_KEY;
    if (!k) {
      console.warn('[scan] SNOWTRACE_API_KEY not set — Avalanche chain will be skipped');
      return null;
    }
    return String(k);
  }
  const k = import.meta.env.ETHERSCAN_API_KEY;
  if (!k) {
    console.warn('[scan] ETHERSCAN_API_KEY not set — Ethereum/Polygon chains will be skipped');
    return null;
  }
  return String(k);
}

function baseUrl(provider: Provider): string {
  return provider === 'snowtrace' ? SNOWTRACE_BASE_URL : ETHERSCAN_V2_BASE_URL;
}

function isRateLimited(payload: any): boolean {
  const msg = String(payload?.message ?? '').toLowerCase();
  const res = String(payload?.result ?? '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    res.includes('rate limit') ||
    msg.includes('too many requests') ||
    res.includes('too many requests')
  );
}

function isNoTxFound(payload: any): boolean {
  const msg = String(payload?.message ?? '').toLowerCase();
  const res = String(payload?.result ?? '').toLowerCase();
  return msg.includes('no transactions found') || res.includes('no transactions found');
}

function normalizeAddress(address: string): string {
  return String(address ?? '').trim().toLowerCase();
}

function buildUrl(chainId: number, params: Record<string, string | number>): string | null {
  const provider = providerForChain(chainId);
  const apikey = getApiKey(provider);
  if (!apikey) return null; // key missing — caller must handle

  const query = new URLSearchParams({ apikey });
  // Etherscan v2 requires chainid; Snowtrace doesn't, but harmless to omit
  if (provider === 'etherscan') query.set('chainid', String(chainId));

  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  return `${baseUrl(provider)}?${query.toString()}`;
}

async function throttled(provider: Provider, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
  const now = Date.now();
  const waitMs = Math.max(0, lastCallAt[provider] + minIntervalMs - now);
  if (waitMs > 0) await sleep(waitMs);
  lastCallAt[provider] = Date.now();
}

async function fetchTextWithCache(
  url: string,
  {
    provider,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    cacheTtlMs = DEFAULT_URL_TTL_MS,
    requestId,
  }: { provider: Provider; minIntervalMs?: number; cacheTtlMs?: number; requestId?: string },
): Promise<string> {
  // Memo cache by URL
  const cached = urlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    logDebug('cache.hit', {
      requestId,
      provider,
      url: url.slice(0, DEFAULT_URL_MAX_BYTES_LOG),
      ttlMs: cached.expiresAt - Date.now(),
    });
    return cached.payloadText;
  }

  // Inflight dedupe by URL
  const existing = inflight.get(url);
  if (existing) {
    logDebug('inflight.join', { requestId, provider, url: url.slice(0, DEFAULT_URL_MAX_BYTES_LOG) });
    return existing;
  }

  const promise = (async () => {
    const started = Date.now();
    await throttled(provider, minIntervalMs);

    const res = await fetch(url);
    const text = await res.text();

    logDebug('fetch', {
      requestId,
      provider,
      status: res.status,
      ms: Date.now() - started,
      url: url.slice(0, DEFAULT_URL_MAX_BYTES_LOG),
    });

    if (!res.ok) {
      throw new Error(`${provider} HTTP ${res.status}: ${text.slice(0, 240)}`);
    }

    urlCache.set(url, { expiresAt: Date.now() + cacheTtlMs, payloadText: text });
    return text;
  })();

  inflight.set(url, promise);

  try {
    const out = await promise;
    return out;
  } finally {
    inflight.delete(url);
  }
}

async function fetchJsonWithRetries(
  url: string,
  {
    provider,
    requestId,
    attempts = 3,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    backoffMs = DEFAULT_BACKOFF_MS,
    cacheTtlMs = DEFAULT_URL_TTL_MS,
  }: {
    provider: Provider;
    requestId?: string;
    attempts?: number;
    minIntervalMs?: number;
    backoffMs?: number;
    cacheTtlMs?: number;
  },
): Promise<Json> {
  let lastErr: any = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const text = await fetchTextWithCache(url, { provider, minIntervalMs, cacheTtlMs, requestId });
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`${provider} returned non-JSON: ${text.slice(0, 240)}`);
      }

      // Rate limit backoff path
      if (isRateLimited(payload)) {
        logDebug('rate_limit', { requestId, provider, attempt, backoffMs });
        // Do not cache rate-limited payloads longer than our short TTL;
        // but they might already be cached if upstream returned it. That's OK for troubleshooting.
        await sleep(backoffMs);
        continue;
      }

      return payload;
    } catch (err: any) {
      lastErr = err;
      logDebug('retry.error', { requestId, provider, attempt, error: String(err?.message ?? err) });
      // brief delay before next attempt
      if (attempt < attempts) await sleep(250);
    }
  }

  throw new Error(lastErr?.message ?? 'Provider fetch failed');
}

function throwIfNotOk(payload: any, provider: Provider) {
  // Etherscan/Snowtrace style: status/message/result
  const status = String(payload?.status ?? '');
  if (status !== '0') return;
  const message = String(payload?.message ?? 'NOTOK');
  const result = payload?.result;
  const details = typeof result === 'string' ? result : JSON.stringify(result);
  throw new Error(`${provider} NOTOK: ${message} | result=${details}`);
}

function readResultArray<T = any>(payload: any, provider: Provider): T[] {
  const status = String(payload?.status ?? '');
  const result = payload?.result;

  if (Array.isArray(result)) return result as T[];

  // If status=0 and "No transactions found" => empty array (non-fatal)
  if (status === '0' && isNoTxFound(payload)) return [];

  // Otherwise treat as error
  throwIfNotOk(payload, provider);

  // If status wasn't 0 but result isn't an array, return empty
  return [];
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function weiToDecimalString(wei: bigint, decimals: number) {
  if (decimals <= 0) return wei.toString();
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  let frac = s.slice(-decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

/**
 * Native balance (wei) for Ethereum/Polygon via Etherscan v2.
 * Avalanche native balance should be done via Snowtrace "account balance" too,
 * but for now this function supports it (same action) as Snowtrace is Etherscan-style.
 */
export async function getNativeBalanceWei({
  chainId,
  address,
  requestId,
}: {
  chainId: number;
  address: string;
  requestId?: string;
}): Promise<bigint> {
  const provider = providerForChain(chainId);
  const addr = normalizeAddress(address);

  const url = buildUrl(chainId, {
    module: 'account',
    action: 'balance',
    address: addr,
    tag: 'latest',
  });
  if (!url) return 0n;

  const payload = await fetchJsonWithRetries(url, { provider, requestId });
  // For balance calls, status=0 is a real error (not "No tx found")
  throwIfNotOk(payload, provider);

  return BigInt(payload?.result ?? '0');
}

/**
 * Token transfers (ERC-20) – single page.
 */
export async function getTokentxPage({
  chainId,
  address,
  page = 1,
  offset = 100,
  requestId,
}: {
  chainId: number;
  address: string;
  page?: number;
  offset?: number;
  requestId?: string;
}): Promise<TokenTx[]> {
  const provider = providerForChain(chainId);
  const addr = normalizeAddress(address);

  const url = buildUrl(chainId, {
    module: 'account',
    action: 'tokentx',
    address: addr,
    startblock: 0,
    endblock: 99999999,
    page,
    offset,
    sort: 'desc',
  });
  if (!url) return [];

  const payload = await fetchJsonWithRetries(url, { provider, requestId });
  const items = readResultArray<TokenTx>(payload, provider);

  logDebug('tokentx.page', {
    requestId,
    chainId,
    page,
    offset,
    count: items.length,
    status: String(payload?.status ?? ''),
    message: String(payload?.message ?? ''),
  });

  return items;
}

/**
 * Token transfers (ERC-20) – paged helper.
 * Stops early when:
 * - page returns < offset
 * - page returns empty
 * - reaches maxPages
 */
export async function getTokentxPaged({
  chainId,
  address,
  pageSize = 100,
  maxPages = 10,
  requestId,
}: {
  chainId: number;
  address: string;
  pageSize?: number;
  maxPages?: number;
  requestId?: string;
}): Promise<TokenTx[]> {
  const all: TokenTx[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const items = await getTokentxPage({ chainId, address, page, offset: pageSize, requestId });
    if (!items.length) break;
    all.push(...items);
    if (items.length < pageSize) break;
    // Respect provider throttling is already handled internally; no need to add extra sleep here.
  }
  logDebug('tokentx.paged', {
    requestId,
    chainId,
    pages: Math.ceil(all.length / pageSize),
    total: all.length,
  });
  return all;
}

/**
 * NFT transfers – ERC-721 (tokennfttx) and ERC-1155 (token1155tx)
 */
export async function getNftTransfers({
  chainId,
  address,
  action,
  page = 1,
  offset = 200,
  requestId,
}: {
  chainId: number;
  address: string;
  action: 'tokennfttx' | 'token1155tx';
  page?: number;
  offset?: number;
  requestId?: string;
}): Promise<NftTx[]> {
  const provider = providerForChain(chainId);
  const addr = normalizeAddress(address);

  const url = buildUrl(chainId, {
    module: 'account',
    action,
    address: addr,
    page,
    offset,
    sort: 'desc',
  });
  if (!url) return [];

  const payload = await fetchJsonWithRetries(url, { provider, requestId });
  const items = readResultArray<NftTx>(payload, provider);

  logDebug('nft.page', { requestId, chainId, action, page, offset, count: items.length });
  return items;
}

/**
 * Proxy eth_getCode (contract detection)
 * Cached by URL cache + inflight dedupe already.
 * Consider adding your own longer TTL cache in interactions.ts too (hours/days).
 */
export async function getCodeHex({
  chainId,
  address,
  requestId,
}: {
  chainId: number;
  address: string;
  requestId?: string;
}): Promise<string> {
  const provider = providerForChain(chainId);
  const addr = normalizeAddress(address);

  const url = buildUrl(chainId, {
    module: 'proxy',
    action: 'eth_getCode',
    address: addr,
    tag: 'latest',
  });
  if (!url) return '0x'; // treat as non-contract when key is missing

  const payload = await fetchJsonWithRetries(url, { provider, requestId });

  // proxy calls may not include status/message consistently; treat missing result as error
  const code = String(payload?.result ?? '');
  if (!code) throw new Error(`${provider} eth_getCode missing result`);
  return code;
}

export async function isContract({
  chainId,
  address,
  requestId,
}: {
  chainId: number;
  address: string;
  requestId?: string;
}): Promise<boolean> {
  const code = await getCodeHex({ chainId, address, requestId });
  return Boolean(code && code !== '0x');
}

/**
 * Fetch a single transaction by hash via eth_getTransactionByHash (proxy module).
 * Returns { from, to } on success, null if not found or on error.
 * Supports Ethereum (chainId 1), Polygon (137), and Avalanche (43114).
 */
export async function getTxByHash({
  chainId,
  txHash,
  requestId,
}: {
  chainId: number;
  txHash: string;
  requestId?: string;
}): Promise<{ from: string; to: string | null } | null> {
  const provider = providerForChain(chainId);
  const url = buildUrl(chainId, {
    module: 'proxy',
    action: 'eth_getTransactionByHash',
    txhash: txHash,
  });
  if (!url) return null;

  try {
    const payload = await fetchJsonWithRetries(url, { provider, requestId, attempts: 2 });
    const result = payload?.result;
    if (!result || typeof result !== 'object') return null;
    return {
      from: String(result.from ?? '').toLowerCase(),
      to: result.to ? String(result.to).toLowerCase() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Optional: clear internal caches (useful in tests/dev)
 */
export function _debugClearCaches() {
  urlCache.clear();
  inflight.clear();
}

// ─────────────────────────────────────────────────────────────
// Back-compat exports (older callers like scanSync.ts)
// ─────────────────────────────────────────────────────────────

export function buildEtherscanV2Url(
  chainOrChainId: 'ethereum' | 'polygon' | number,
  params: Record<string, string | number>,
): string | null {
  const chainId =
    typeof chainOrChainId === 'number'
      ? chainOrChainId
      : chainOrChainId === 'ethereum'
        ? CHAIN_IDS.ethereum
        : CHAIN_IDS.polygon;

  // Force etherscan v2 style (chainid required) — matches new buildUrl behavior.
  return buildUrl(chainId, params);
}

export async function requestEtherscan(
  url: string | null,
  opts?: { requestId?: string; attempts?: number; minIntervalMs?: number; backoffMs?: number; cacheTtlMs?: number },
) {
  // Guard: null URL means the API key is missing — return empty result instead of crashing.
  if (!url) return { status: '0', message: 'skipped', result: [] };
  // For these legacy callers, URL is already an etherscan URL.
  // providerForChain is safe here, but url already implies etherscan; keep it consistent.
  const provider: Provider = 'etherscan';
  return fetchJsonWithRetries(url, { provider, ...(opts ?? {}) });
}

// Back-compat: older callers
export async function getContractCode(args: { chainId: number; address: string; requestId?: string }) {
  return getCodeHex(args);
}

// NOTE:
// If you want to reduce call volume further, add higher-level caching on top of this:
// - snapshot TTLs (you already do)
// - store last scanned block and only scan forward
// - lower maxPages for tokentx for "quick view" (vault)
// - background refresh for deep history
