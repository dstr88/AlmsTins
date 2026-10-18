/**
 * A block explorer for the watcher tests: tables of raw rows per wallet and listing, on a synthetic
 * chain where block n is mined at CHAIN_START_SEC + 12 n seconds. It answers the way Etherscan's
 * account listings do where it matters: rows come oldest first inside a block range, a page is a
 * slice of that list, a read past page times offset 10,000 is refused, and a listing with nothing
 * in it is an empty list (not a failure). A test can make any read fail to see what the watcher
 * does with an explorer that cannot answer.
 *
 * Every address, hash and amount here is invented. The two token contracts are the well-known public
 * ones from src/lib/knownContracts.ts, because pricing is decided by contract.
 */
import type { VaultChain } from '../../src/lib/agentVault/addresses';
import type { ExplorerDeps, ExplorerQuery } from '../../src/lib/agentVault/explorer';
import type { ExplorerAction } from '../../src/lib/agentVault/transfers';

export const CHAIN_START_SEC = Date.UTC(2026, 9, 1) / 1000;
export const BLOCK_SECONDS = 12;
export const blockTime = (block: number): number => CHAIN_START_SEC + block * BLOCK_SECONDS;
/** The block mined at or before a time, the way getblocknobytime with closest=before answers. */
export const blockAtOrBefore = (sec: number): number => Math.max(0, Math.floor((sec - CHAIN_START_SEC) / BLOCK_SECONDS));
/** A block's time as an ISO string, handy for seeding registry rows. */
export const blockIso = (block: number): string => new Date(blockTime(block) * 1000).toISOString();

/** The public USDC contract on Ethereum (a "legitimate" one for pricing), and a copycat that uses the same symbol. */
export const USDC_ETHEREUM = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const COPYCAT_USDC = `0x${'badc0de'.padEnd(40, '0')}`;

export type RawRow = Record<string, string>;

export const txHash = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

/** A decimal amount ("1.5") as an integer string with that many decimals, exactly. */
export function units(amount: string, decimals = 18): string {
  const [whole, frac = ''] = amount.split('.');
  return (BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals)) || 0n).toString();
}

interface RowBase {
  hash: number | string;
  block: number;
  from: string;
  to: string;
  value: string;
}
const hashOf = (h: number | string): string => (typeof h === 'number' ? txHash(h) : h);

/** A `txlist` row: a transaction that moved the chain's own coin. */
export function nativeRow(o: RowBase & { failed?: boolean }): RawRow {
  return {
    blockNumber: String(o.block), timeStamp: String(blockTime(o.block)), hash: hashOf(o.hash), from: o.from, to: o.to, value: o.value,
    isError: o.failed ? '1' : '0', txreceipt_status: o.failed ? '0' : '1', contractAddress: '',
  };
}

/** A `txlistinternal` row: coin moved by a contract call. */
export function internalRow(o: RowBase & { traceId?: string }): RawRow {
  return {
    blockNumber: String(o.block), timeStamp: String(blockTime(o.block)), hash: hashOf(o.hash), from: o.from, to: o.to, value: o.value,
    contractAddress: '', type: 'call', traceId: o.traceId ?? '0_1', isError: '0', errCode: '',
  };
}

/** A `tokentx` row: a token transfer. */
export function tokenRow(o: RowBase & { contract: string; symbol: string; decimals?: number }): RawRow {
  return {
    blockNumber: String(o.block), timeStamp: String(blockTime(o.block)), hash: hashOf(o.hash), from: o.from, to: o.to, value: o.value,
    contractAddress: o.contract, tokenSymbol: o.symbol, tokenName: o.symbol, tokenDecimal: String(o.decimals ?? 6),
  };
}

export type ExplorerCall =
  | { kind: 'blockAt'; chain: VaultChain; atSec: number }
  | { kind: 'page'; q: ExplorerQuery };

export interface FakeExplorer extends ExplorerDeps {
  calls: ExplorerCall[];
  /** Adds raw rows to one wallet's listing. */
  add(chain: VaultChain, wallet: string, action: ExplorerAction, ...rows: RawRow[]): void;
  /** Return true to make that page read fail (the watcher sees `null`, as it would a NOTOK). */
  failPage: ((q: ExplorerQuery) => boolean) | null;
  /** Return true to make that block lookup fail. */
  failBlockAt: ((chain: VaultChain, atSec: number) => boolean) | null;
  /** The pages asked for, in order. */
  pages(): ExplorerQuery[];
}

export function createFakeExplorer(): FakeExplorer {
  const listings = new Map<string, RawRow[]>();
  const key = (chain: VaultChain, wallet: string, action: ExplorerAction) => `${chain}|${wallet.toLowerCase()}|${action}`;
  const ex: FakeExplorer = {
    calls: [],
    failPage: null,
    failBlockAt: null,
    add(chain, wallet, action, ...rows) {
      const k = key(chain, wallet, action);
      listings.set(k, [...(listings.get(k) ?? []), ...rows]);
    },
    async blockAt(chain, atSec) {
      ex.calls.push({ kind: 'blockAt', chain, atSec });
      if (ex.failBlockAt?.(chain, atSec)) return null;
      return blockAtOrBefore(atSec);
    },
    async page(q) {
      ex.calls.push({ kind: 'page', q });
      if (ex.failPage?.(q)) return null;
      if (q.page * q.offset > 10_000) return null; // the explorer's result window
      const rows = (listings.get(key(q.chain, q.address, q.action)) ?? [])
        .filter((r) => Number(r.blockNumber) >= q.startBlock && Number(r.blockNumber) <= q.endBlock)
        .map((r, i) => ({ r, i }))
        .sort((a, b) => Number(a.r.blockNumber) - Number(b.r.blockNumber) || a.i - b.i)
        .map((x) => x.r);
      return rows.slice((q.page - 1) * q.offset, q.page * q.offset).map((r) => ({ ...r }));
    },
    pages: () => ex.calls.flatMap((c) => (c.kind === 'page' ? [c.q] : [])),
  };
  return ex;
}
