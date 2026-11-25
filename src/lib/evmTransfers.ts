/**
 * EVM transfers: what a block explorer's account listings say about one wallet, reduced to the
 * movements it made. Shared by Agentics (src/lib/agentVault/transfers.ts, a thin layer over this
 * file) and Wallet Watcher's EVM sync (src/lib/sync/evmSyncRows.ts). Pure (no database, no
 * network), so it is tested directly.
 *
 * Three listings carry a wallet's movements. `txlist` has the transactions that moved the chain's
 * own coin, `txlistinternal` the coin moved by contract calls (how a smart-contract wallet pays
 * out, and how a swap pays coin back), and `tokentx` the token transfers. A row becomes a
 * `Transfer` only when it is a real movement between the wallet and one other address:
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
 * Identity. A transaction can hold several movements (a swap's two sides, or two token transfers
 * of the same amount to the same address), and the token listing carries no log index to tell
 * them apart. A movement is therefore named by its transaction hash and a `leg`: what kind of
 * movement it is, who and what and how much, and a count of identical rows before it in the same
 * transaction. The same rows always give the same legs, so a movement keeps its name when the
 * history is read again. That holds because a caller reads a transaction's rows whole: neither
 * the Agentics scan (./agentVault/watcher.ts) nor the Wallet Watcher sync keeps the rows of a
 * block it may have cut short.
 *
 * Contracts. A payment routed through a swap or a router is, on the chain, a transfer between the
 * wallet and that contract, and that is what is recorded: the contract is the other side. The
 * listing says when the other side is a contract where it can: a `txlist` row that carries call
 * data (`input` longer than the empty `0x`) is a contract call, and every `txlistinternal` row is
 * coin moved by one. A token transfer says nothing about the other side, so `contract` is null
 * there: not known, never guessed.
 *
 * Gas. A transaction the wallet sent cost it gas whether or not it moved anything: a failed
 * transaction and an approval both pay. `readGasFees` reads that from the `txlist` rows, one fee
 * per transaction the wallet sent. Agentics does not read it; Wallet Watcher records it.
 */
import { weiToDecimalString } from '@/lib/etherscan';
import { CHAINS, VAULT_CHAINS, WALLET_SYNC_EVM_CHAINS } from '@/lib/chains';
import { EVM_ADDRESS_LOWER, EVM_TX_HASH_LOWER } from '@/lib/addressFormats';

/** The chains this reader serves: the ones Agentics watches and the ones Wallet Watcher syncs. */
export type EvmTransferChain = (typeof VAULT_CHAINS)[number] | (typeof WALLET_SYNC_EVM_CHAINS)[number];

export type ExplorerAction = 'txlist' | 'txlistinternal' | 'tokentx';
export const EXPLORER_ACTIONS: readonly ExplorerAction[] = ['txlist', 'txlistinternal', 'tokentx'];

const READ_CHAINS: readonly EvmTransferChain[] = [...new Set<EvmTransferChain>([...VAULT_CHAINS, ...WALLET_SYNC_EVM_CHAINS])];

/** The symbol of each chain's own coin (src/lib/chains.ts). */
export const NATIVE_SYMBOL: Readonly<Record<EvmTransferChain, string>> = Object.fromEntries(
  READ_CHAINS.map((c) => [c, CHAINS[c].native.symbol]),
) as Record<EvmTransferChain, string>;

export interface Transfer {
  chain: EvmTransferChain;
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
  /**
   * Whether the other side is a contract, as far as the listing says: true for coin moved by a
   * contract call (a `txlistinternal` row, or a `txlist` row with call data), false for a plain
   * coin transfer, null when the listing cannot say (a token transfer, or a row with no `input`).
   */
  contract: boolean | null;
  source: ExplorerAction;
}

/** A transfer with what a bookkeeping row also stores: the value as the chain wrote it, and the scale. */
export interface EvmTransfer extends Transfer {
  /** The integer value from the listing, in the asset's smallest unit (wei for the coin). */
  rawValue: string;
  /** How many decimal places `rawValue` carries: the coin's, or the token's as the listing reported them. */
  decimals: number;
  /** The token's name as the listing reported it, cleaned like a symbol; null for the chain's own coin. */
  assetName: string | null;
  /** The first four bytes of a `txlist` row's call data, lowercase (`0x` and eight hex digits); null otherwise. */
  selector: string | null;
}

export interface NormalizedTransfers {
  transfers: Transfer[];
  /** Rows dropped because a field could not be read. Failed, zero-value and self-send rows are not counted: they are not movements. */
  unreadable: number;
}

export interface ReadTransfers {
  transfers: EvmTransfer[];
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

/** A token's name the same way, 64 characters at most; null when the listing gave none. */
function cleanName(raw: unknown): string | null {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? Array.from(s).slice(0, 64).join('') : null;
}

/** Whether a `txlist` row carries call data: true past the empty `0x`, false for a plain transfer, null when the field is not there. */
function callData(input: unknown): boolean | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === '' || s === '0x') return false;
  return /^0x[0-9a-f]+$/.test(s) ? true : null;
}

/** The four-byte selector of a call, or null when the row carries no readable call data. */
function selectorOf(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  return /^0x[0-9a-f]{8}/.test(s) ? s.slice(0, 10) : null;
}

const failed = (row: Row): boolean =>
  String(row.isError ?? '') === '1' || String(row.txreceipt_status ?? '') === '0';

/**
 * The movements in one explorer listing for `wallet`, with the raw value and scale beside each
 * amount. `rows` come whole transactions at a time, in the order the explorer gave them.
 */
export function readTransfers(chain: EvmTransferChain, wallet: string, action: ExplorerAction, rows: readonly Row[]): ReadTransfers {
  const me = lower(wallet);
  const transfers: EvmTransfer[] = [];
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
    let assetName: string | null = null;
    let amount: string;
    let decimals: number;
    let identity: string;
    let contract: boolean | null = null;
    let selector: string | null = null;
    if (action === 'tokentx') {
      const contract = lower(row.contractAddress);
      // Strictly digits: an empty field would read as 0 decimals and overstate the amount a millionfold.
      const decimalsText = String(row.tokenDecimal ?? '').trim();
      const tokenDecimals = /^\d{1,2}$/.test(decimalsText) ? Number(decimalsText) : NaN;
      if (!ADDRESS.test(contract) || !Number.isInteger(tokenDecimals) || tokenDecimals > 36) {
        unreadable += 1;
        continue;
      }
      asset = cleanSymbol(row.tokenSymbol);
      assetContract = contract;
      assetName = cleanName(row.tokenName);
      decimals = tokenDecimals;
      amount = weiToDecimalString(value, decimals);
      identity = `token:${contract}:${from}:${to}:${value}`;
    } else {
      asset = NATIVE_SYMBOL[chain];
      decimals = CHAINS[chain].native.decimals;
      amount = weiToDecimalString(value, decimals);
      if (action === 'txlist') {
        identity = `native:${from}:${to}:${value}`;
        contract = callData(row.input);
        selector = selectorOf(row.input);
      } else {
        const trace = String(row.traceId ?? '').trim();
        identity = `internal:${TRACE.test(trace) ? trace : ''}:${from}:${to}:${value}`;
        contract = true;
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
      contract,
      source: action,
      rawValue: value.toString(),
      decimals,
      assetName,
      selector,
    });
  }
  return { transfers, unreadable };
}

/**
 * The movements in one explorer listing for `wallet`, as Agentics records them. `rows` come whole
 * transactions at a time, in the order the explorer gave them.
 */
export function normalizeTransfers(chain: EvmTransferChain, wallet: string, action: ExplorerAction, rows: readonly Row[]): NormalizedTransfers {
  const { transfers, unreadable } = readTransfers(chain, wallet, action, rows);
  return {
    transfers: transfers.map(({ rawValue: _raw, decimals: _decimals, assetName: _name, selector: _selector, ...t }) => t),
    unreadable,
  };
}

/** The gas one transaction the wallet sent cost it. */
export interface GasFee {
  chain: EvmTransferChain;
  /** Lowercase transaction hash. */
  hash: string;
  atSec: number;
  blockNumber: number;
  /** The wallet that sent the transaction and paid, lowercase. */
  wallet: string;
  /** The address the transaction was sent to, lowercase; null for a contract creation. */
  to: string | null;
  /** gasUsed × gasPrice, in the coin's smallest unit (wei), as an integer string. */
  feeRaw: string;
  /** The same fee in whole coins, as an exact decimal string. */
  fee: string;
  /** The transaction failed: it moved nothing, but the gas was spent. */
  failed: boolean;
  /** The four-byte selector of the call, lowercase; null for a plain transfer. */
  selector: string | null;
}

export interface ReadGasFees {
  fees: GasFee[];
  /** `txlist` rows the wallet sent whose hash, time or gas could not be read. */
  unreadable: number;
}

/**
 * The gas fee of every transaction the wallet sent, from its `txlist` rows: failed transactions,
 * approvals and other zero-value calls included, since each of them still paid. A transaction
 * sent by someone else cost the wallet nothing and is left out. One fee per transaction hash.
 */
export function readGasFees(chain: EvmTransferChain, wallet: string, rows: readonly Row[]): ReadGasFees {
  const me = lower(wallet);
  const fees: GasFee[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const row of rows) {
    if (lower(row.from) !== me) continue;
    const hash = lower(row.hash);
    const atSec = Number(row.timeStamp);
    const blockNumber = Number(row.blockNumber);
    const gasUsed = digits(row.gasUsed);
    const gasPrice = digits(row.gasPrice);
    if (!HASH.test(hash) || !Number.isSafeInteger(atSec) || atSec <= 0 || !Number.isSafeInteger(blockNumber) || blockNumber < 0 || gasUsed === null || gasPrice === null) {
      unreadable += 1;
      continue;
    }
    if (seen.has(hash)) continue;
    seen.add(hash);
    const to = lower(row.to);
    const feeWei = gasUsed * gasPrice;
    fees.push({
      chain,
      hash,
      atSec,
      blockNumber,
      wallet: me,
      to: ADDRESS.test(to) ? to : null,
      feeRaw: feeWei.toString(),
      fee: weiToDecimalString(feeWei, CHAINS[chain].native.decimals),
      failed: failed(row),
      selector: selectorOf(row.input),
    });
  }
  return { fees, unreadable };
}

/** A transfer's time as the ledger writes it: UTC ISO-8601 with milliseconds. */
export const transferTime = (t: Pick<Transfer, 'atSec'>): string => new Date(t.atSec * 1000).toISOString();
