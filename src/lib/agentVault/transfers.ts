/**
 * Transfers: what a block explorer's account listings say about one wallet, reduced to the
 * movements the Vault records. The reader itself is shared with Wallet Watcher and lives in
 * src/lib/evmTransfers.ts (the rules for what counts as a movement, and how a movement is named by
 * its hash and leg, are written there). This file is the Vault's side of it: the Vault's chains,
 * and which listings are read on each.
 *
 * On Base only `tokentx` is read (explorerActionsFor). A caller reads a transaction's rows whole:
 * the scan in ./watcher.ts never keeps the rows of a block it may have cut short.
 */
import type { VaultChain } from './addresses';
import { EXPLORER_ACTIONS, type ExplorerAction } from '@/lib/evmTransfers';

export {
  EXPLORER_ACTIONS,
  NATIVE_SYMBOL,
  cleanSymbol,
  normalizeTransfers,
  transferTime,
  type ExplorerAction,
  type NormalizedTransfers,
  type Transfer,
} from '@/lib/evmTransfers';

/**
 * Base is read through its public JSON-RPC (./baseRpc.ts), which has token transfer logs but no
 * account listings and no traces: only `tokentx` there. The chain's own coin moving on Base is not read.
 */
const TOKEN_TRANSFERS_ONLY: readonly ExplorerAction[] = ['tokentx'];

/** The listings read for a wallet on `chain`: all three on an explorer-backed chain, token transfers only on Base. */
export function explorerActionsFor(chain: VaultChain): readonly ExplorerAction[] {
  return chain === 'base' ? TOKEN_TRANSFERS_ONLY : EXPLORER_ACTIONS;
}
