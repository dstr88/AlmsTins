/**
 * ledgerAdapters/lifecycle.ts: the lifecycle engine's rows as ledger events. Pure: no database.
 *
 * The lifecycle engine reads asset_lifecycle_events (one row per import or on-chain transaction,
 * with the rebuild's own class) joined back to its source row. This adapter decides what each one
 * is; lots, moves, terms and findings are the ledger core's (lotLedger.ts).
 *
 *   in, not a transfer leg      acquire at native_usd (a lot, as it has always been)
 *   out, collateral deposit,    dispose, not taxable: it uses up lots and books no gain
 *     withdrawal or repayment
 *   out, anything else          dispose, taxable, at native_usd (with the owner's entered basis, if any)
 *   a transfer leg              paired with its other leg it is a MOVE: no sale, no new lot, the
 *                               coins keep their date and cost. Left unpaired: an exchange Send
 *                               consumes the coins and is listed for review, a chain-synced or on-chain out
 *                               to an address Almstins does not track stays a sale, an arrival opens a lot.
 *
 * Which rows are transfer legs (the same reading the pipeline's pass 1 gives them):
 *   an import row pass 1 calls a transfer (an exchange Send, Receive, Deposit, Withdrawal), or any
 *   row of a chain-synced source; an on-chain row that touches an address Almstins tracks. An
 *   on-chain row whose two ends are both tracked (the sync stores one row per transaction) is two
 *   legs, an out and an in, linked by the transaction.
 */

import { buildOwnedIndex, walletOfRow, type WalletOfRowContext } from '../walletOfRow';
import { walletContextOf, type WalletRecord } from '../eventWallet';
import { classifyImportTxPass1 } from '../../yearEnd/pass1';
import { isChainSource, normalizeWalletAddress } from '../../walletKey';
import type { OwnerIndex } from '../../walletIdentity';
import type { LedgerEvent, ManualBasis } from '../lotLedger';
import type { TransferMatchRow, TransferRow } from '../transferLinks';
import { transferEvents, type TransferCandidate } from './transfers';
import { FIAT_SYMBOLS, type RefInfo } from './shared';

/** One row of the lifecycle query: the event, joined to the import or on-chain row it came from. */
export interface LifecycleEventRow {
	asset_symbol: unknown;
	direction: unknown;
	amount: unknown;
	native_usd: unknown;
	timestamp_utc: unknown;
	transaction_class: unknown;
	source_id: unknown;
	group_id: unknown;
	tx_hash: unknown;
	source_type: unknown;
	import_wallet_id?: unknown;
	import_source?: unknown;
	import_account_id?: unknown;
	import_kind?: unknown;
	import_description?: unknown;
	import_batch_id?: unknown;
	tx_wallet_id?: unknown;
	tx_chain?: unknown;
	from_address?: unknown;
	to_address?: unknown;
}

export interface LifecycleAdapterInput {
	/** Already without the classes the lifecycle never lots (liability_increase, interest_income). */
	events: readonly LifecycleEventRow[];
	wallets: readonly WalletRecord[];
	/** transactions.wallet_id by normalized tx hash, for the Aave import rows that carry only a hash. */
	walletIdByTxHash?: ReadonlyMap<string, string>;
	transferMatches?: readonly TransferMatchRow[];
	ownerIndex: OwnerIndex;
	/** The owner's entered bases, by the source id of the sale. */
	manualBasis?: ReadonlyMap<string, ManualBasis>;
}

export interface LifecycleAdapterOutput {
	events: LedgerEvent[];
	/** What the rows were, by sourceRef: the surfaces that list a sale or a transfer need it. */
	refs: Map<string, RefInfo>;
}

/** Classes that move real lots through the ledger without being taxable: the cost goes to the protocol and returns. */
export const FIFO_NONTAXABLE = new Set(['collateral_deposit', 'collateral_withdrawal', 'liability_repayment']);

const text = (v: unknown): string => (v == null ? '' : String(v)).trim();
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function lifecycleToLedger(input: LifecycleAdapterInput): LifecycleAdapterOutput {
	const walletCtx: WalletOfRowContext = { ...walletContextOf(input.wallets), walletIdByTxHash: input.walletIdByTxHash };
	const ownedIndex = buildOwnedIndex(input.wallets.map((w) => w.address));
	const refs = new Map<string, RefInfo>();
	const events: LedgerEvent[] = [];
	const candidates: TransferCandidate[] = [];
	const selfSends = new Set<string>();

	input.events.forEach((row, index) => {
		const asset = text(row.asset_symbol).toUpperCase();
		const direction = text(row.direction);
		const amount = Math.abs(Number(row.amount ?? 0));
		if (!asset || !amount || (direction !== 'in' && direction !== 'out')) return;

		const at = text(row.timestamp_utc);
		const nativeUsd = num(row.native_usd);
		const txClass = text(row.transaction_class);
		const sourceType = text(row.source_type);
		const sourceId = text(row.source_id);
		const sourceRef = sourceId || `${sourceType || 'event'}:#${index}`;
		const txHash = text(row.tx_hash) || null;
		const info: RefInfo = {
			sourceType, sourceId, groupId: text(row.group_id), txHash, transactionClass: txClass,
			amount, valueUsd: nativeUsd,
		};
		const nonTaxable = FIFO_NONTAXABLE.has(txClass);
		const manualBasis = sourceId ? input.manualBasis?.get(sourceId) : undefined;
		const fiat = FIAT_SYMBOLS.has(asset);

		// Which wallet(s) the row belongs to, and whether it can be a transfer leg at all.
		let legs: { side: 'in' | 'out' | null; wallet: string }[] = [];
		let transfer: TransferRow['source'] | null = null;
		let kind: string | null = null;
		if (sourceType === 'import') {
			const resolved = walletOfRow(
				{ origin: 'import', source: row.import_source, walletId: row.import_wallet_id, accountId: row.import_account_id, importBatchId: row.import_batch_id, txHash },
				walletCtx,
			);
			legs = resolved.legs;
			kind = text(row.import_kind) || null;
			if (!nonTaxable && !fiat) {
				const category = classifyImportTxPass1({
					id: sourceId, timestamp_utc: at, asset_symbol: asset, direction, kind, amount, to_amount: null, native_usd: nativeUsd,
					tx_hash: txHash, source: text(row.import_source), notes: null, category: null, description: text(row.import_description) || null,
				})?.category;
				if (isChainSource(row.import_source)) transfer = 'chain_sync';
				else if (category === 'transfer') transfer = 'import';
			}
		} else if (sourceType === 'onchain') {
			const resolved = walletOfRow(
				{ origin: 'onchain', walletId: row.tx_wallet_id, chain: row.tx_chain, fromAddress: row.from_address, toAddress: row.to_address },
				walletCtx,
			);
			legs = resolved.legs;
			if (!nonTaxable && !fiat && resolved.basis === 'owned_address') transfer = 'onchain';
		}
		const wallet = (legs.find((l) => l.side === direction) ?? legs[0])?.wallet ?? '';

		if (transfer === null) {
			refs.set(sourceRef, info);
			if (direction === 'in') {
				events.push({ kind: 'acquire', id: sourceRef, asset, wallet, at, qty: amount, costUsd: nativeUsd, origin: sourceType === 'import' ? 'purchase' : 'other', sourceRef });
			} else {
				events.push({
					kind: 'dispose', id: sourceRef, asset, wallet, at, qty: amount, proceedsUsd: nativeUsd, taxable: !nonTaxable, category: txClass || 'other',
					sourceRef, ...(manualBasis && !nonTaxable ? { manualBasis } : {}),
				});
			}
			return;
		}

		const legRow = (id: string, dir: 'in' | 'out', legWallet: string): TransferRow => ({
			id, direction: dir, asset, qty: amount, at, wallet: legWallet, source: transfer as TransferRow['source'], hash: txHash,
			category: transfer === 'import' ? 'transfer' : null, kind, fromAddress: text(row.from_address) || null, toAddress: text(row.to_address) || null,
		});
		// Only an exchange's own Send / Withdrawal is an explicit send. A chain-synced row names no destination (a payment, a swap
		// leg and a send to another wallet look alike), so one nothing is paired with stays a sale, like an on-chain out.
		const unpairedOut = (): TransferCandidate['unpaired'] =>
			transfer === 'import' ? { kind: 'send', valueUsd: nativeUsd } : { kind: 'dispose', proceedsUsd: nativeUsd, category: txClass || 'other' };
		const unpairedIn = (): TransferCandidate['unpaired'] => ({
			kind: 'acquire', costUsd: nativeUsd, origin: transfer === 'onchain' ? 'other' : 'transfer_in_untracked',
		});

		refs.set(sourceRef, info);
		// An on-chain row with both ends tracked and in different wallets: one row, two legs.
		const out = legs.find((l) => l.side === 'out');
		const inn = legs.find((l) => l.side === 'in');
		if (transfer === 'onchain' && out && inn) {
			const key = [text(row.tx_chain), txHash ?? sourceRef, normalizeWalletAddress(row.from_address), normalizeWalletAddress(row.to_address), asset, amount].join('|');
			if (selfSends.has(key)) return;
			selfSends.add(key);
			const hash = txHash ?? `self:${sourceRef}`;
			const outRow = { ...legRow(`${sourceRef}:out`, 'out', out.wallet), hash };
			const inRow = { ...legRow(`${sourceRef}:in`, 'in', inn.wallet), hash };
			candidates.push({ row: outRow, sourceRef, unpaired: unpairedOut(), ...(manualBasis ? { manualBasis } : {}) });
			candidates.push({ row: inRow, sourceRef, unpaired: unpairedIn() });
			return;
		}
		candidates.push({
			row: legRow(sourceRef, direction, wallet),
			sourceRef,
			unpaired: direction === 'out' ? unpairedOut() : unpairedIn(),
			...(direction === 'out' && manualBasis ? { manualBasis } : {}),
		});
	});

	const moved = transferEvents(candidates, ownedIndex, input.transferMatches ?? [], input.ownerIndex);
	events.push(...moved.events);
	return { events, refs };
}
