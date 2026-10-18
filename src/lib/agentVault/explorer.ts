/**
 * The block explorer, as the watcher reads it: Etherscan's v2 API for Ethereum and Polygon,
 * Routescan's compatible one for Avalanche, through the shared client in src/lib/etherscan.ts
 * (one rate gate per API key for the whole process, a pause between calls, retries on a rate
 * limit). The watcher only sees the two small functions below, so tests give it a table of
 * transfers instead of a network.
 *
 * Both answer "I could not read it" with null, and that is a different thing from "there is
 * nothing there" (an empty list). Mixing the two up is how a watcher decides a quiet hour was
 * fully read when it was not, so the difference is kept all the way up: a null never moves a
 * cursor.
 *
 * Read-only: these are account listings and a block lookup. Nothing here signs or sends.
 */
import { buildEtherscanV2Url, CHAIN_IDS, requestEtherscan } from '@/lib/etherscan';
import type { VaultChain } from './addresses';
import type { ExplorerAction } from './transfers';

export interface ExplorerQuery {
  chain: VaultChain;
  action: ExplorerAction;
  /** The wallet whose listing is read, lowercase. */
  address: string;
  startBlock: number;
  endBlock: number;
  /** 1-based. The explorer allows page times offset up to 10,000. */
  page: number;
  offset: number;
}

export interface ExplorerDeps {
  /** The block mined at or before this time (seconds), or null when the explorer cannot say. */
  blockAt(chain: VaultChain, atSec: number): Promise<number | null>;
  /** One page of a listing, oldest first; an empty list when there is nothing, null when it could not be read. */
  page(q: ExplorerQuery): Promise<Array<Record<string, unknown>> | null>;
}

/**
 * An Etherscan-style listing as rows, or null when it could not be read. "No transactions found"
 * is an empty listing; NOTOK, a rate limit, a skipped call (no API key) and anything else that is
 * not a list of rows is unavailable.
 */
export function readRows(payload: unknown): Array<Record<string, unknown>> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { status?: unknown; message?: unknown; result?: unknown };
  const none = /no transactions found/i;
  if (none.test(String(p.message ?? '')) || (typeof p.result === 'string' && none.test(p.result))) return [];
  if (String(p.status ?? '') === '1' && Array.isArray(p.result)) return p.result as Array<Record<string, unknown>>;
  return null;
}

/** The block number inside a getblocknobytime answer, or null. */
export function readBlockNumber(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { status?: unknown; result?: unknown };
  if (String(p.status ?? '') !== '1') return null;
  const raw = p.result && typeof p.result === 'object' ? (p.result as { blockNumber?: unknown }).blockNumber : p.result;
  const block = Number(raw);
  return Number.isSafeInteger(block) && block >= 0 ? block : null;
}

// A block's number at a past time never changes, so it is remembered across passes.
const BLOCK_CACHE = new Map<string, number>();
const BLOCK_CACHE_LIMIT = 2_000;

export const defaultExplorer: ExplorerDeps = {
  async blockAt(chain, atSec) {
    const key = `${chain}:${atSec}`;
    const cached = BLOCK_CACHE.get(key);
    if (cached !== undefined) return cached;
    try {
      const url = buildEtherscanV2Url(CHAIN_IDS[chain], { module: 'block', action: 'getblocknobytime', timestamp: atSec, closest: 'before' });
      if (!url) return null; // no API key configured
      const block = readBlockNumber(await requestEtherscan(url));
      if (block === null) return null;
      if (BLOCK_CACHE.size >= BLOCK_CACHE_LIMIT) BLOCK_CACHE.clear();
      BLOCK_CACHE.set(key, block);
      return block;
    } catch {
      return null;
    }
  },

  async page(q) {
    try {
      const url = buildEtherscanV2Url(CHAIN_IDS[q.chain], {
        module: 'account',
        action: q.action,
        address: q.address,
        startblock: q.startBlock,
        endblock: q.endBlock,
        page: q.page,
        offset: q.offset,
        sort: 'asc',
      });
      if (!url) return null; // no API key configured
      return readRows(await requestEtherscan(url));
    } catch {
      return null;
    }
  },
};
