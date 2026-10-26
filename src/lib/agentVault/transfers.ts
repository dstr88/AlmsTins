/**
 * Transfers: what a block explorer's account listings say about one wallet, reduced to the
 * movements the Vault records. Pure (no database, no network), so it is tested directly.
 *
 * Three listings carry a wallet's movements. `txlist` has the transactions that moved the chain's
 * own coin, `txlistinternal` the coin moved by contract calls (how a smart-contract wallet pays
 * out), and `tokentx` the token transfers. A row becomes a `Transfer` only when it is a real
 * movement between the wallet and one other address:
 *
 *   - a transaction that failed moved nothing, and neither did a row of value zero (approvals and
 *     zero-value token pokes are not transfers);
 *   - a row from the wallet to itself moves nothing between two parties;
 *   - a row that does not involve the wallet at all is not its movement;
 *   - a row whose fields cannot be read (no hash, no time, a value that is not an integer, a token
 *     without usable decimals) is counted as unreadable and dropped. Nothing is ever guessed.
 *
 * Amounts are exact: an integer value from the explorer is scaled to a decimal string with
 * BigInt, never through a float.
 *
 * Identity. A transaction can hold several movements (two token transfers of the same amount to
 * the same address, say), and the token listing carries no log index to tell them apart. A
 * movement is therefore named by its transaction hash and a `leg`: what kind of movement it is,
 * who and what and how much, and a count of identical rows before it in the same transaction. The
 * same rows always give the same legs, so a movement keeps its name when the history is read again.
 * That holds because a caller reads a transaction's rows whole: the scan in ./watcher.ts never
 * keeps the rows of a block it may have cut short.
 */
import { weiToDecimalString } from '@/lib/etherscan';
import type { VaultChain } from './addresses';
import { EVM_ADDRESS_LOWER, EVM_TX_HASH_LOWER } from '@/lib/addressFormats';

export type ExplorerAction = 'txlist' | 'txlistinternal' | 'tokentx';
export const EXPLORER_ACTIONS: readonly ExplorerAction[] = ['txlist', 'txlistinternal', 'tokentx'];

/** The symbol of each chain's own coin. All three have 18 decimals. */
export const NATIVE_SYMBOL: Readonly<Record<VaultChain, string>> = { ethereum: 'ETH', polygon: 'POL', avalanche: 'AVAX' };
const NATIVE_DECIMALS = 18;

export interface Transfer {
  chain: VaultChain;
  /** Lowercase transaction hash. */
  hash: string;
  /** Which movement of the transaction this is; with the hash it identifies the transfer (see above). */
  leg: string;
  /** The block's time in whole seconds since the epoch. */
  atSec: number;
  blockNumber: number;
  /** `in` reached the wallet; `out` left it. */
  direction: 'in' | 'out';
  /** The wallet whose listing this came from, lowercase. */
  wallet: string;
  /** The other side of the movement, lowercase. */
  counterparty: string;
  /** Exact amount in whole units of the asset, as a decimal string. */
  amount: string;
  /** The coin's symbol, or the token's as the explorer reported it. */
  asset: string;
  /** The token's contract, lowercase; null for the chain's own coin. */
  assetContract: string | null;
  source: ExplorerAction;
}

export interface NormalizedTransfers {
  transfers: Transfer[];
  /** Rows dropped because a field could not be read. Failed, zero-value and self-send rows are not counted: they are not movements. */
  unreadable: number;
}

type Row = Record<string, unknown>;

const HASH = EVM_TX_HASH_LOWER;
const ADDRESS = EVM_ADDRESS_LOWER;
const TRACE = /^[A-Za-z0-9_.-]{0,64}$/;
const lower = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** A non-negative integer written in digits, or null. */
function digits(v: unknown): bigint | null {
  const s = String(v ?? '').trim();
  return /^\d{1,78}$/.test(s) ? BigInt(s) : null;
}

/** A token's symbol for display: control characters out, whitespace collapsed, 24 characters at most. */
export function cleanSymbol(raw: unknown): string {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, 24).join('') || 'UNKNOWN';
}

const failed = (row: Row): boolean =>
  String(row.isError ?? '') === '1' || String(row.txreceipt_status ?? '') === '0';

/**
 * The movements in one explorer listing for `wallet`. `rows` come whole transactions at a time,
 * in the order the explorer gave them.
 */
export function normalizeTransfers(chain: VaultChain, wallet: string, action: ExplorerAction, rows: readonly Row[]): NormalizedTransfers {
  const me = lower(wallet);
  const transfers: Transfer[] = [];
  const before = new Map<string, number>();
  let unreadable = 0;

  for (const row of rows) {
    const hash = lower(row.hash);
    const atSec = Number(row.timeStamp);
    const blockNumber = Number(row.blockNumber);
    const value = digits(row.value);
    if (!HASH.test(hash) || !Number.isSafeInteger(atSec) || atSec <= 0 || !Number.isSafeInteger(blockNumber) || blockNumber < 0 || value === null) {
      unreadable += 1;
      continue;
    }
    if (failed(row) || value === 0n) continue;

    const from = lower(row.from);
    const to = lower(row.to);
    if (!from || !to) continue; // a contract creation has no `to`: no second party
    if (!ADDRESS.test(from) || !ADDRESS.test(to)) {
      unreadable += 1;
      continue;
    }
    if (from === me && to === me) continue;
    const direction = from === me ? 'out' : to === me ? 'in' : null;
    if (!direction) continue;
    const counterparty = direction === 'out' ? to : from;

    let asset: string;
    let assetContract: string | null = null;
    let amount: string;
    let identity: string;
    if (action === 'tokentx') {
      const contract = lower(row.contractAddress);
      // Strictly digits: an empty field would read as 0 decimals and overstate the amount a millionfold.
      const decimalsText = String(row.tokenDecimal ?? '').trim();
      const decimals = /^\d{1,2}$/.test(decimalsText) ? Number(decimalsText) : NaN;
      if (!ADDRESS.test(contract) || !Number.isInteger(decimals) || decimals > 36) {
        unreadable += 1;
        continue;
      }
      asset = cleanSymbol(row.tokenSymbol);
      assetContract = contract;
      amount = weiToDecimalString(value, decimals);
      identity = `token:${contract}:${from}:${to}:${value}`;
    } else {
      asset = NATIVE_SYMBOL[chain];
      amount = weiToDecimalString(value, NATIVE_DECIMALS);
      if (action === 'txlist') {
        identity = `native:${from}:${to}:${value}`;
      } else {
        const trace = String(row.traceId ?? '').trim();
        identity = `internal:${TRACE.test(trace) ? trace : ''}:${from}:${to}:${value}`;
      }
    }

    const key = `${hash}|${identity}`;
    const ordinal = before.get(key) ?? 0;
    before.set(key, ordinal + 1);
    transfers.push({
      chain,
      hash,
      leg: `${identity}:${ordinal}`,
      atSec,
      blockNumber,
      direction,
      wallet: me,
      counterparty,
      amount,
      asset,
      assetContract,
      source: action,
    });
  }
  return { transfers, unreadable };
}

/** A transfer's time as the ledger writes it: UTC ISO-8601 with milliseconds. */
export const transferTime = (t: Pick<Transfer, 'atSec'>): string => new Date(t.atSec * 1000).toISOString();
