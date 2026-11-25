/**
 * Wallet Watcher's EVM rows: one wallet's explorer listings on one chain, turned into the rows the
 * `transactions` table keeps. Pure (no database, no network), so it is tested directly.
 *
 * The movements come from the reader Agentics uses (src/lib/evmTransfers.ts), so both products
 * read a transaction the same way: every movement is its own row, named by the transaction hash
 * and a leg. A swap of ETH for USDC is two rows, ETH out and USDC in; coin a contract pays back to
 * the wallet (the ETH of a USDC to ETH swap) comes from the internal-transactions listing; two
 * identical transfers in one transaction stay two rows. Each row belongs to the wallet whose
 * listing it came from, so a transfer between two of the customer's own wallets is a row on each.
 *
 * Gas. Every transaction the wallet sent paid gas, whether it moved coin, only tokens, or nothing
 * at all (an approval, a failed transaction). The fee is recorded once per transaction, in
 * `fee_paid` (wei), on the row of the coin the wallet sent in it. When the wallet sent no coin,
 * the fee gets a row of its own: leg `fee`, value 0, the chain's coin, and status `failed` when
 * the transaction failed. A failed transaction moved nothing, so that row is all it leaves.
 *
 * Aave. A call the wallet made to an Aave V3 pool is marked on the row that carries its fee
 * (tx_type `aave_supply`, `aave_borrow`, `aave_repay` or `aave_withdraw`), as before; the tokens
 * the call moved are their own rows, read by the lifecycle classifier together (src/lib/aave/classify.ts).
 */
import { readGasFees, readTransfers, type EvmTransfer, type GasFee } from '@/lib/evmTransfers';
import { AAVE_POOL_ADDRESSES, CHAINS, type WALLET_SYNC_EVM_CHAINS } from '@/lib/chains';
import type { NewTransaction } from '@/lib/transactions';

export type WalletSyncEvmChain = (typeof WALLET_SYNC_EVM_CHAINS)[number];

/** The leg of a row that holds only a transaction's gas fee. */
export const FEE_LEG = 'fee';

/** Aave V3 Pool function selectors and the action each one is. */
const AAVE_SELECTORS: ReadonlyMap<string, string> = new Map([
	['0x617ba037', 'supply'],
	['0xa415bcad', 'borrow'],
	['0x573ade81', 'repay'],
	['0x69328dec', 'withdraw'],
]);

type Row = Record<string, unknown>;

export interface WalletListings {
	txlist: readonly Row[];
	txlistinternal: readonly Row[];
	tokentx: readonly Row[];
}

export interface WalletSyncRows {
	rows: NewTransaction[];
	/** Listing rows dropped because a field could not be read (counted, never guessed). */
	unreadable: number;
}

/** The Aave action of a call the wallet sent to an Aave V3 pool, or null. */
function aaveAction(to: string | null, selector: string | null): string | null {
	if (!to || !selector || !AAVE_POOL_ADDRESSES.has(to)) return null;
	return AAVE_SELECTORS.get(selector) ?? null;
}

const ends = (t: Pick<EvmTransfer, 'direction' | 'wallet' | 'counterparty'>) =>
	t.direction === 'out' ? { from: t.wallet, to: t.counterparty } : { from: t.counterparty, to: t.wallet };

function transferRow(walletId: string, t: EvmTransfer, fee: GasFee | undefined): NewTransaction {
	const { from, to } = ends(t);
	const base = {
		walletId,
		hash: t.hash,
		leg: t.leg,
		chain: t.chain,
		blockNumber: t.blockNumber,
		timestamp: new Date(t.atSec * 1000),
		from,
		to,
		value: t.rawValue,
		tokenDecimals: t.decimals,
		status: 'confirmed',
	};
	if (t.source === 'tokentx') {
		return {
			...base,
			tokenSymbol: t.asset,
			contractAddress: t.assetContract ?? undefined,
			txType: t.direction === 'in' ? 'token_in' : 'token_out',
			metadata: { tokenName: t.assetName, source: 'scan_token' },
		};
	}
	if (t.source === 'txlistinternal') {
		return {
			...base,
			tokenSymbol: 'native',
			txType: t.direction === 'in' ? 'incoming' : 'outgoing',
			metadata: { source: 'scan_internal' },
		};
	}
	const aave = t.direction === 'out' ? aaveAction(t.counterparty, t.selector) : null;
	return {
		...base,
		tokenSymbol: 'native',
		txType: aave ? `aave_${aave}` : t.direction === 'in' ? 'incoming' : 'outgoing',
		feePaid: fee?.feeRaw,
		metadata: aave ? { source: 'aave', aaveAction: aave } : { source: 'scan_native' },
	};
}

function feeRow(walletId: string, fee: GasFee): NewTransaction {
	const aave = aaveAction(fee.to, fee.selector);
	return {
		walletId,
		hash: fee.hash,
		leg: FEE_LEG,
		chain: fee.chain,
		blockNumber: fee.blockNumber,
		timestamp: new Date(fee.atSec * 1000),
		from: fee.wallet,
		to: fee.to ?? undefined,
		value: '0',
		tokenSymbol: 'native',
		tokenDecimals: CHAINS[fee.chain].native.decimals,
		txType: aave ? `aave_${aave}` : 'outgoing',
		status: fee.failed ? 'failed' : 'confirmed',
		feePaid: fee.feeRaw,
		metadata: aave ? { source: 'aave', aaveAction: aave, feeOnly: true } : { source: 'scan_native', feeOnly: true },
	};
}

/**
 * The rows for one wallet on one chain from its three listings. Each listing's rows come whole
 * transactions at a time, oldest first, as the explorer gave them; the rows come back in block
 * order, a transaction's coin row (or fee row) first.
 */
export function walletSyncRows(chain: WalletSyncEvmChain, wallet: { id: string; address: string }, listings: WalletListings): WalletSyncRows {
	const coin = readTransfers(chain, wallet.address, 'txlist', listings.txlist);
	const internal = readTransfers(chain, wallet.address, 'txlistinternal', listings.txlistinternal);
	const tokens = readTransfers(chain, wallet.address, 'tokentx', listings.tokentx);
	const gas = readGasFees(chain, wallet.address, listings.txlist);

	const feeByHash = new Map(gas.fees.map((f) => [f.hash, f]));
	const feeCarried = new Set<string>();
	const rows: Array<{ row: NewTransaction; order: number }> = [];

	for (const t of coin.transfers) {
		const fee = t.direction === 'out' ? feeByHash.get(t.hash) : undefined;
		if (fee) feeCarried.add(t.hash);
		rows.push({ row: transferRow(wallet.id, t, fee), order: 0 });
	}
	for (const fee of gas.fees) {
		if (!feeCarried.has(fee.hash)) rows.push({ row: feeRow(wallet.id, fee), order: 0 });
	}
	for (const t of internal.transfers) rows.push({ row: transferRow(wallet.id, t, undefined), order: 1 });
	for (const t of tokens.transfers) rows.push({ row: transferRow(wallet.id, t, undefined), order: 2 });

	// Stable sort: by block, then the coin row first; inside a listing the explorer's order stays.
	rows.sort((a, b) => (a.row.blockNumber ?? 0) - (b.row.blockNumber ?? 0) || a.order - b.order);
	return {
		rows: rows.map((r) => r.row),
		unreadable: coin.unreadable + internal.unreadable + tokens.unreadable + gas.unreadable,
	};
}
