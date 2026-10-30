/**
 * ledgerAdapters/pipeline.ts: the tax pipeline's classified rows as ledger events. Pure.
 *
 * The pipeline (yearEnd/pass1 to pass3b) puts a category on every import and on-chain row it can
 * read. This adapter turns those categories into ledger events; lots, moves, terms and findings
 * are the ledger core's (lotLedger.ts), the same ones the lifecycle engine uses.
 *
 *   buy, income, airdrop, the received leg of a swap, loan proceeds     acquire
 *   sell, the sent leg of a swap, liquidation, burn, lost, nft-sale     dispose (taxable), with the
 *                                                                       owner's entered basis, if any
 *   transfer                                                            a transfer leg (see below)
 *   an on-chain row nothing classified that touches a tracked address   a transfer leg too: it may be the
 *                                                                       arrival of an exchange Send
 *
 * A transfer leg paired with its other leg is a MOVE: no sale, no new lot. Left unpaired, an exchange
 * Send (or an on-chain out the pipeline called a transfer) consumes the coins and is listed for review;
 * a priced Deposit from a source Almstins does not track opens a lot at its value on arrival, as it
 * always has. An unpriced one opens nothing (pass 5 asks for the price), and neither does an unpaired
 * on-chain arrival or an on-chain out nobody labeled: those stay as they were, left to pass 5.
 *
 * On-chain quantities are in the token's smallest unit, so they are divided by 10^token_decimals.
 * A row without a `token_decimals` field at all (not even null) is read as whole units.
 */

import { buildOwnedIndex, walletOfRow, type WalletEntry, type WalletOfRowContext } from '../walletOfRow';
import { isChainSource, normalizeWalletAddress } from '../../walletKey';
import { isXprReviewKind } from '../../xpr/systemAccounts';
import { normalizeAmount } from '../normalize';
import type { OwnerIndex } from '../../walletIdentity';
import type { ClassificationResult, RawImportTx, RawOnchainTx } from '../../yearEnd/types';
import type { AcquireOrigin, LedgerEvent, ManualBasis } from '../lotLedger';
import type { TransferMatchRow, TransferRow } from '../transferLinks';
import { transferEvents, type TransferCandidate } from './transfers';
import { FIAT_SYMBOLS, type RefInfo } from './shared';

export interface PipelineAdapterInput {
	importRows: readonly RawImportTx[];
	onchainRows: readonly RawOnchainTx[];
	classifications: ReadonlyMap<string, ClassificationResult>;
	/** The classification keys (`import:{id}`) the owner set by hand: their links are the owner's own. */
	manualKeys?: ReadonlySet<string>;
	/** The tenant's rows of `wallets`, by wallets.id. Without them a wallet is known by its row's own columns. */
	wallets?: ReadonlyMap<string, WalletEntry>;
	/** transactions.wallet_id by normalized tx hash, for the Aave import rows that carry only a hash. */
	walletIdByTxHash?: ReadonlyMap<string, string>;
	transferMatches?: readonly TransferMatchRow[];
	ownerIndex: OwnerIndex;
	/** The owner's entered bases, by the source id of the sale. */
	manualBasis?: ReadonlyMap<string, ManualBasis>;
}

export interface PipelineAdapterOutput {
	events: LedgerEvent[];
	refs: Map<string, RefInfo>;
}

const DISPOSAL_CATEGORIES = new Set(['sell', 'swap', 'liquidation', 'burn', 'lost', 'nft-sale']);

const abs = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : Math.abs(v));
const text = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Whole units of an on-chain row's value. */
export function onchainQuantity(row: RawOnchainTx): number {
	const raw = row.value ?? '0';
	if (row.token_decimals === undefined) return Math.abs(parseFloat(raw) || 0);
	// normalizeAmount reads a decimals of 0 as a fraction; whole-unit tokens need no scaling at all.
	if (row.token_decimals === 0) return Math.abs(Number(raw) || 0);
	return Math.abs(normalizeAmount(raw, row.token_decimals) ?? 0);
}

export function pipelineToLedger(input: PipelineAdapterInput): PipelineAdapterOutput {
	const wallets = new Map<string, WalletEntry>(input.wallets ?? []);
	const owned = buildOwnedIndex([
		...[...wallets.values()].map((w) => w.address),
		...(input.wallets ? [] : input.onchainRows.map((r) => r.wallet_address)),
	]);
	const ctx: WalletOfRowContext = { wallets, owned, walletIdByTxHash: input.walletIdByTxHash };

	const refs = new Map<string, RefInfo>();
	const events: LedgerEvent[] = [];
	const candidates: TransferCandidate[] = [];
	const selfSends = new Set<string>();
	const category = (key: string) => input.classifications.get(key)?.category ?? 'unknown';
	/** The row a classification links this one to, by leg id. */
	const linkTargets = new Map<string, { target: string; manual: boolean }>();

	for (const row of input.importRows) {
		const key = `import:${row.id}`;
		const cat = category(key);
		const symbol = row.asset_symbol ? row.asset_symbol.toUpperCase() : '';
		if (!symbol) continue;
		const direction = row.direction === 'in' || row.direction === 'out' ? row.direction : null;
		const cost = abs(row.native_usd);
		const wallet = walletOfRow(
			{ origin: 'import', source: row.source, walletId: row.wallet_id, accountId: row.account_id, importBatchId: row.import_batch_id, txHash: row.tx_hash },
			ctx,
		).legs[0].wallet;
		const info = (qty: number): RefInfo => ({
			sourceType: 'import', sourceId: row.id, groupId: row.id, txHash: row.tx_hash, transactionClass: cat, amount: qty, valueUsd: cost,
		});

		// Received side: what a buy, income, airdrop, swap-in or loan brings.
		const received = row.to_amount !== null ? Math.abs(row.to_amount) : abs(row.amount);
		let origin: AcquireOrigin | null = null;
		if (cat === 'buy') origin = 'purchase';
		else if (cat === 'income') origin = 'income';
		else if (cat === 'airdrop') origin = 'airdrop';
		else if (cat === 'swap' && direction === 'in') origin = 'swap_in';
		else if (cat === 'loan-proceeds' && direction === 'in') origin = 'loan_proceeds';
		if (origin) {
			// Fiat is never a lot, and a zero quantity is nothing.
			if (!received || FIAT_SYMBOLS.has(symbol)) continue;
			refs.set(row.id, info(received));
			events.push({ kind: 'acquire', id: row.id, asset: symbol, wallet, at: row.timestamp_utc, qty: received, costUsd: cost, origin, sourceRef: row.id });
			continue;
		}

		if (DISPOSAL_CATEGORIES.has(cat)) {
			// The received leg of a two-row swap is handled above.
			if (cat === 'swap' && direction === 'in') continue;
			const qty = abs(row.amount);
			if (!qty) continue;
			const manualBasis = input.manualBasis?.get(row.id);
			refs.set(row.id, info(qty));
			events.push({
				kind: 'dispose', id: row.id, asset: symbol, wallet, at: row.timestamp_utc, qty, proceedsUsd: cost, taxable: true, category: cat,
				sourceRef: row.id, ...(manualBasis ? { manualBasis } : {}),
			});
			continue;
		}

		if (cat === 'transfer' && direction) {
			// Principal returning from Crypto.com Earn is not a transfer between wallets: its lot already exists.
			if (FIAT_SYMBOLS.has(symbol) || row.kind === 'crypto_earn_program_withdrawn') continue;
			const qty = direction === 'in' ? received : abs(row.amount) ?? abs(row.to_amount);
			if (!qty) continue;
			refs.set(row.id, info(qty));
			const link = input.classifications.get(key);
			if (link?.linkedTxId) linkTargets.set(row.id, { target: link.linkedTxId, manual: !!input.manualKeys?.has(key) });
			const leg: TransferRow = {
				id: row.id, direction, asset: symbol, qty, at: row.timestamp_utc, wallet, source: isChainSource(row.source) ? 'chain_sync' : 'import',
				hash: row.tx_hash, category: 'transfer', kind: row.kind,
			};
			const manualBasis = direction === 'out' ? input.manualBasis?.get(row.id) : undefined;
			const chainSynced = leg.source === 'chain_sync';
			candidates.push({
				row: leg,
				sourceRef: row.id,
				// An exchange Send consumes the coins; a chain-synced send names no destination, so unpaired it stays a sale (as in the
				// lifecycle), except an XPR transfer stored for review (staking, lock, swap, system accounts): it is not booked as a sale.
				unpaired: direction === 'out'
					? chainSynced && !isXprReviewKind(row.kind) ? { kind: 'dispose', proceedsUsd: cost, category: 'sell' } : { kind: 'send', valueUsd: cost }
					: cost !== null ? { kind: 'acquire', costUsd: cost, origin: 'transfer_in_untracked' } : { kind: 'ignore' },
				...(manualBasis ? { manualBasis } : {}),
			});
		}
	}

	for (const row of input.onchainRows) {
		const key = `onchain:${row.id}`;
		const cat = category(key);
		const symbol = row.token_symbol ? row.token_symbol.toUpperCase() : '';
		if (!symbol) continue;
		const qty = onchainQuantity(row);
		if (!qty) continue;
		const cost = abs(row.usd_value);
		const resolved = walletOfRow(
			{ origin: 'onchain', walletId: row.wallet_id, chain: row.chain, fromAddress: row.from_address, toAddress: row.to_address, txType: row.tx_type },
			ctx,
		);
		const wallet = (resolved.legs.find((l) => l.side !== null) ?? resolved.legs[0]).wallet;
		const hash = text(row.hash) || null;
		const info: RefInfo = { sourceType: 'onchain', sourceId: row.id, groupId: row.id, txHash: hash, transactionClass: cat, amount: qty, valueUsd: cost };

		if (cat === 'buy' || cat === 'income' || cat === 'airdrop') {
			refs.set(row.id, info);
			events.push({
				kind: 'acquire', id: row.id, asset: symbol, wallet, at: row.timestamp, qty, costUsd: cost,
				origin: cat === 'buy' ? 'purchase' : cat === 'income' ? 'income' : 'airdrop', sourceRef: row.id,
			});
			continue;
		}
		if (DISPOSAL_CATEGORIES.has(cat)) {
			const manualBasis = input.manualBasis?.get(row.id);
			refs.set(row.id, info);
			events.push({
				kind: 'dispose', id: row.id, asset: symbol, wallet, at: row.timestamp, qty, proceedsUsd: cost, taxable: true, category: cat,
				sourceRef: row.id, ...(manualBasis ? { manualBasis } : {}),
			});
			continue;
		}

		// A transfer the pipeline paired, or a row that touches a tracked address and nothing classified:
		// it may be the other leg of an exchange Send or Deposit (pass 1 labels those, pass 2 only pairs rows
		// pass 1 left alone), so it is offered to the resolver. Left unpaired it stays what it was: nothing.
		const touchesOwned = resolved.basis === 'owned_address';
		if (cat !== 'transfer' && !(cat === 'unknown' && touchesOwned)) continue;
		if (FIAT_SYMBOLS.has(symbol)) continue;
		const selfSend = touchesOwned && resolved.legs.length === 2;
		refs.set(row.id, info);
		const legRow = (id: string, side: 'in' | 'out', legWallet: string): TransferRow => ({
			id, direction: side, asset: symbol, qty, at: row.timestamp, wallet: legWallet, source: 'onchain', hash,
			fromAddress: row.from_address, toAddress: row.to_address,
		});
		// An out the pipeline itself called a transfer is an explicit send; one nobody labeled is not.
		const outUnpaired: TransferCandidate['unpaired'] = cat === 'transfer' ? { kind: 'send', valueUsd: cost } : { kind: 'ignore' };
		const inUnpaired: TransferCandidate['unpaired'] = { kind: 'ignore' };
		if (selfSend) {
			const dedupe = [row.chain, hash ?? row.id, normalizeWalletAddress(row.from_address), normalizeWalletAddress(row.to_address), symbol, qty].join('|');
			if (selfSends.has(dedupe)) continue;
			selfSends.add(dedupe);
			const shared = hash ?? `self:${row.id}`;
			const out = resolved.legs.find((l) => l.side === 'out');
			const inn = resolved.legs.find((l) => l.side === 'in');
			if (!out || !inn) continue;
			candidates.push({ row: { ...legRow(`${row.id}:out`, 'out', out.wallet), hash: shared }, sourceRef: row.id, unpaired: outUnpaired });
			candidates.push({ row: { ...legRow(`${row.id}:in`, 'in', inn.wallet), hash: shared }, sourceRef: row.id, unpaired: inUnpaired });
			continue;
		}
		const leg = resolved.legs.find((l) => l.side !== null);
		if (!leg || !leg.side) continue;
		const link = input.classifications.get(key);
		if (link?.linkedTxId) linkTargets.set(row.id, { target: link.linkedTxId, manual: !!input.manualKeys?.has(key) });
		candidates.push({ row: legRow(row.id, leg.side, leg.wallet), sourceRef: row.id, unpaired: leg.side === 'out' ? outUnpaired : inUnpaired });
	}

	// The pipeline's own pairs (pass 2, or the owner's) become links for the resolver to weigh with the others.
	const directionOf = new Map(candidates.map((c) => [c.row.id, c.row.direction] as const));
	const seen = new Set<string>();
	const matches: TransferMatchRow[] = [...(input.transferMatches ?? [])];
	for (const [id, { target, manual }] of linkTargets) {
		const a = directionOf.get(id);
		const b = directionOf.get(target);
		if (!a || !b || a === b) continue;
		const outId = a === 'out' ? id : target;
		const inId = a === 'out' ? target : id;
		const pair = `${outId}\u0000${inId}`;
		if (seen.has(pair)) continue;
		seen.add(pair);
		matches.push({ outId, inId, status: manual ? 'confirmed' : 'auto' });
	}

	const moved = transferEvents(candidates, owned, matches, input.ownerIndex);
	events.push(...moved.events);
	return { events, refs };
}
